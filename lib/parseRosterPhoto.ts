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

/**
 * Parse OCR text lines from a printed roster photo
 * (column 1: Last, First · column 2: class).
 */
export function parseRosterPhotoText(texts: string[]): ImportParseResult {
  const lines = flattenOcrLines(texts);
  const rows: PlayerInput[] = [];
  const errors: ImportParseResult['errors'] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADER_RE.test(line)) continue;

    const match = line.match(NAME_LINE_RE);
    if (!match) {
      // Skip third-column style "First Last" and other noise.
      continue;
    }

    const lastName = match[1].trim();
    const firstName = match[2].trim();
    let classRaw = (match[3] ?? '').trim();

    if (!classRaw && i + 1 < lines.length && isClassToken(lines[i + 1])) {
      classRaw = lines[i + 1].trim();
      i += 1;
    }

    if (!firstName || !lastName) {
      errors.push({
        row: i + 1,
        message: 'Could not read first and last name',
      });
      continue;
    }

    const schoolYear = classRaw ? mapPhotoClassToken(classRaw) : '';
    if (classRaw && !schoolYear) {
      errors.push({
        row: i + 1,
        message: `Unrecognized class “${classRaw}” for ${lastName}, ${firstName}`,
      });
    }

    const row = toPlayerInput(firstName, lastName, schoolYear);
    const key = `${row.last_name}|${row.first_name}|${row.school_year}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
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
    headersFound: ['photo: last_name, first_name', 'photo: school_year'],
  };
}
