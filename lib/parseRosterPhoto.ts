import type { PlayerInput } from '@/lib/types';
import type { ImportParseResult } from '@/lib/importSpreadsheet';
import { normalizeSchoolYear } from '@/lib/schoolYear';

const HEADER_RE =
  /^(participant|class|name|first|last|first name|last name|grade|year|school year)$/i;

/** Last, First with optional class token on the same line. */
const NAME_LINE_RE =
  /^([A-Za-z][A-Za-z .'\-]*?)\s*,\s*([A-Za-z][A-Za-z .'\-]*)(?:\s+([A-Za-z0-9.]+))?$/;

const CLASS_TOKEN_RE =
  /^(FR|SO|JR|SR|FRESHMAN|SOPHOMORE|JUNIOR|SENIOR|SOPH|SO\.|FR\.|JR\.|SR\.|20\d{2})$/i;

/**
 * Map a class / grad-year token from a printed roster photo.
 * Grad years assume a 2026–27 season (2027=Sr … 2030=Fr; 2026→Sr).
 */
export function mapPhotoClassToken(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  if (/^20\d{2}$/.test(t)) {
    const year = Number(t);
    if (year <= 2027) return 'Sr';
    if (year === 2028) return 'Jr';
    if (year === 2029) return 'Soph';
    if (year === 2030) return 'Fr';
    return '';
  }
  return normalizeSchoolYear(t);
}

export function isClassToken(raw: string): boolean {
  return CLASS_TOKEN_RE.test(String(raw ?? '').trim());
}

function titleCaseWord(word: string): string {
  const cleaned = word.replace(/\./g, '');
  const lower = cleaned.toLowerCase();
  if (lower === 'jr') return 'Jr';
  if (lower === 'sr') return 'Sr';
  if (lower === 'ii') return 'II';
  if (lower === 'iii') return 'III';
  if (lower === 'iv') return 'IV';
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Title-case a person-name fragment (handles spaces and hyphens). */
export function titleCaseName(name: string): string {
  return String(name ?? '')
    .trim()
    .split(/(\s+|-)/)
    .map((part) => {
      if (part === '-' || /^\s+$/.test(part)) return part;
      return titleCaseWord(part);
    })
    .join('');
}

/** Flatten OCR chunks into trimmed single-line strings. */
export function flattenOcrLines(texts: string[]): string[] {
  const out: string[] = [];
  for (const chunk of texts) {
    for (const line of String(chunk ?? '').split(/\r?\n/)) {
      const s = line.replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function toPlayerInput(
  firstName: string,
  lastName: string,
  schoolYear: string
): PlayerInput {
  return {
    first_name: titleCaseName(firstName),
    last_name: titleCaseName(lastName),
    school_year: schoolYear,
    positions: [],
    position_rank: null,
    team_rank: null,
  };
}

type NameHit = {
  index: number;
  firstName: string;
  lastName: string;
  inlineClass: string;
  classRaw: string;
};

function applyColumnZip(names: NameHit[], classTokens: string[]) {
  let cursor = 0;
  for (const name of names) {
    if (name.inlineClass) {
      name.classRaw = name.inlineClass;
      continue;
    }
    name.classRaw = cursor < classTokens.length ? classTokens[cursor++] : '';
  }
}

/**
 * Parse OCR text from a printed roster photo.
 *
 * 1) Row-first: class on the same line, or the next OCR line if it is a class token.
 * 2) If most names still lack a year but class tokens remain, fall back to
 *    column zip (all names × all class tokens by order).
 * 3) Otherwise fill only the remaining gaps from leftover class tokens.
 *
 * Blank years are OK — names still import and can be fixed later.
 */
export function parseRosterPhotoText(texts: string[]): ImportParseResult {
  const lines = flattenOcrLines(texts);
  const names: NameHit[] = [];
  const classByIndex = new Map<number, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADER_RE.test(line)) continue;

    if (isClassToken(line) && !line.includes(',')) {
      classByIndex.set(i, line.trim());
      continue;
    }

    const match = line.match(NAME_LINE_RE);
    if (!match) continue;

    names.push({
      index: i,
      lastName: match[1].trim(),
      firstName: match[2].trim(),
      inlineClass: (match[3] ?? '').trim(),
      classRaw: '',
    });
  }

  const allClassTokens = [...classByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, token]) => token);

  const usedClassIndexes = new Set<number>();

  // Pass 1 — row-wise pairing.
  for (const name of names) {
    if (name.inlineClass) {
      name.classRaw = name.inlineClass;
      continue;
    }
    const nextIdx = name.index + 1;
    const next = classByIndex.get(nextIdx);
    if (next) {
      name.classRaw = next;
      usedClassIndexes.add(nextIdx);
    }
  }

  const missingAfterRow = names.filter((n) => !n.classRaw).length;
  const namesNeedingClass = names.filter((n) => !n.inlineClass).length;
  const leftoverClasses = [...classByIndex.entries()]
    .filter(([idx]) => !usedClassIndexes.has(idx))
    .sort((a, b) => a[0] - b[0])
    .map(([, token]) => token);

  let strategy: 'row' | 'column' | 'row+fill' = 'row';

  // Row pairing mostly failed (typical when OCR reads the name column, then the class column).
  const rowMostlyFailed =
    names.length > 0 &&
    missingAfterRow >= names.length / 2 &&
    allClassTokens.length >= Math.max(1, namesNeedingClass - missingAfterRow) &&
    leftoverClasses.length >= missingAfterRow;

  if (rowMostlyFailed && allClassTokens.length > 0) {
    applyColumnZip(names, allClassTokens);
    strategy = 'column';
  } else if (missingAfterRow > 0 && leftoverClasses.length > 0) {
    let cursor = 0;
    for (const name of names) {
      if (name.classRaw) continue;
      if (cursor >= leftoverClasses.length) break;
      name.classRaw = leftoverClasses[cursor++];
    }
    strategy = 'row+fill';
  }

  const rows: PlayerInput[] = [];
  const errors: ImportParseResult['errors'] = [];
  const seen = new Set<string>();
  let missingYearCount = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name.firstName || !name.lastName) {
      errors.push({
        row: i + 1,
        message: 'Could not read first and last name',
      });
      continue;
    }

    const schoolYear = name.classRaw ? mapPhotoClassToken(name.classRaw) : '';
    if (name.classRaw && !schoolYear) {
      errors.push({
        row: i + 1,
        message: `Unrecognized class “${name.classRaw}” for ${name.lastName}, ${name.firstName}`,
      });
    }
    if (!schoolYear) missingYearCount += 1;

    const row = toPlayerInput(name.firstName, name.lastName, schoolYear);
    const key = `${row.last_name}|${row.first_name}|${row.school_year}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  if (missingYearCount > 0) {
    errors.push({
      row: 0,
      message: `${missingYearCount} player${
        missingYearCount === 1 ? '' : 's'
      } missing year — still safe to import; edit year later if needed.`,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({
      row: 0,
      message:
        'No player names found. Photograph the Last, First and Class columns clearly and try again.',
    });
  }

  return {
    rows,
    errors,
    headersFound: [
      `photo: names (${names.length})`,
      `photo: class (${allClassTokens.length})`,
      `photo: ${strategy}`,
    ],
  };
}
