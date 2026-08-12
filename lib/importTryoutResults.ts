import * as XLSX from 'xlsx';
import { playerNameKey } from '@/lib/importPreview';
import { normalizeSchoolYear } from '@/lib/schoolYear';
import type { Player, PlayerInput } from '@/lib/types';

export type TryoutImportRowError = {
  row: number;
  message: string;
};

export type TryoutImportRow = {
  first_name: string;
  last_name: string;
  school_year: string;
  tryout_number: number | null;
  /** Elapsed finish time in ms, or null if blank / unparsable. */
  time_trial_ms: number | null;
  /** True when a time cell was present but could not be parsed. */
  time_invalid: boolean;
};

export type TryoutImportParseResult = {
  rows: TryoutImportRow[];
  errors: TryoutImportRowError[];
  headersFound: string[];
};

export type TryoutImportPreviewRow = TryoutImportRow & {
  matchedPlayerId: string | null;
  isNew: boolean;
  willMarkPresent: boolean;
};

type TryoutField =
  | 'first_name'
  | 'last_name'
  | 'school_year'
  | 'tryout_number'
  | 'time';

const HEADER_ALIASES: Record<string, TryoutField> = {
  first_name: 'first_name',
  firstname: 'first_name',
  'first name': 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  'last name': 'last_name',
  school_year: 'school_year',
  schoolyear: 'school_year',
  'school year': 'school_year',
  year: 'school_year',
  grade: 'school_year',
  class: 'school_year',
  number: 'tryout_number',
  tryout_number: 'tryout_number',
  'tryout number': 'tryout_number',
  tryout: 'tryout_number',
  bib: 'tryout_number',
  '#': 'tryout_number',
  time: 'time',
  time_trial: 'time',
  'time trial': 'time',
  timetrial: 'time',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ' ');
}

function mapHeaders(
  rawHeaders: unknown[]
): Partial<Record<TryoutField, number>> {
  const map: Partial<Record<TryoutField, number>> = {};
  rawHeaders.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key && map[key] === undefined) {
      map[key] = index;
    }
  });
  return map;
}

function parseOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Parse tryout finish times like `7:18`, `5:02`, or whole seconds.
 * Returns null for blank. Throws via invalid flag for bad values.
 */
export function parseTimeTrialCell(value: unknown): {
  ms: number | null;
  invalid: boolean;
} {
  if (value === null || value === undefined) {
    return { ms: null, invalid: false };
  }
  const raw = String(value).trim();
  if (!raw) return { ms: null, invalid: false };

  const clock = raw.match(/^(\d{1,3}):([0-5]?\d)(?:\.(\d+))?$/);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return { ms: null, invalid: true };
    }
    const ms = minutes * 60_000 + seconds * 1000;
    return { ms, invalid: false };
  }

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    // Bare number: treat as total seconds (common spreadsheet export).
    return { ms: Math.floor(asNumber) * 1000, invalid: false };
  }

  return { ms: null, invalid: true };
}

export function formatTimeTrialPreview(ms: number | null): string {
  if (ms == null) return '—';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseTryoutResultsBuffer(
  data: ArrayBuffer | Uint8Array
): TryoutImportParseResult {
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      errors: [{ row: 0, message: 'Workbook has no sheets' }],
      headersFound: [],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (matrix.length === 0) {
    return {
      rows: [],
      errors: [{ row: 0, message: 'Sheet is empty' }],
      headersFound: [],
    };
  }

  const headerRow = matrix[0] ?? [];
  const headersFound = headerRow
    .map((h) => String(h ?? '').trim())
    .filter(Boolean);
  const columnMap = mapHeaders(headerRow);

  const missingRequired = (['first_name', 'last_name'] as const).filter(
    (field) => columnMap[field] === undefined
  );
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: `Missing required columns: ${missingRequired.join(', ')}. Expected headers like: number, last_name, first_name, time, class`,
        },
      ],
      headersFound,
    };
  }

  const rows: TryoutImportRow[] = [];
  const errors: TryoutImportRowError[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const spreadsheetRow = i + 1;

    const firstName = String(line[columnMap.first_name!] ?? '').trim();
    const lastName = String(line[columnMap.last_name!] ?? '').trim();

    if (
      !firstName &&
      !lastName &&
      line.every((cell) => String(cell ?? '').trim() === '')
    ) {
      continue;
    }

    if (!firstName || !lastName) {
      errors.push({
        row: spreadsheetRow,
        message: 'first_name and last_name are required',
      });
      continue;
    }

    const schoolYear =
      columnMap.school_year !== undefined
        ? normalizeSchoolYear(String(line[columnMap.school_year] ?? ''))
        : '';

    let tryoutNumber: number | null = null;
    if (columnMap.tryout_number !== undefined) {
      const raw = line[columnMap.tryout_number];
      if (String(raw ?? '').trim() !== '') {
        tryoutNumber = parseOptionalInt(raw);
        if (tryoutNumber === null || tryoutNumber < 1 || tryoutNumber > 99) {
          errors.push({
            row: spreadsheetRow,
            message: 'number must be between 1 and 99',
          });
          continue;
        }
      }
    }

    let timeTrialMs: number | null = null;
    let timeInvalid = false;
    if (columnMap.time !== undefined) {
      const parsed = parseTimeTrialCell(line[columnMap.time]);
      timeTrialMs = parsed.ms;
      timeInvalid = parsed.invalid;
      if (timeInvalid) {
        errors.push({
          row: spreadsheetRow,
          message: 'time must look like m:ss (e.g. 7:18)',
        });
      }
    }

    rows.push({
      first_name: firstName,
      last_name: lastName,
      school_year: schoolYear,
      tryout_number: tryoutNumber,
      time_trial_ms: timeInvalid ? null : timeTrialMs,
      time_invalid: timeInvalid,
    });
  }

  return { rows, errors, headersFound };
}

export function buildTryoutImportPreviewRows(
  parsed: TryoutImportRow[],
  existing: Pick<Player, 'id' | 'first_name' | 'last_name'>[]
): TryoutImportPreviewRow[] {
  const byName = new Map(
    existing.map((p) => [playerNameKey(p.first_name, p.last_name), p.id])
  );
  const claimedNew = new Set<string>();
  const rows: TryoutImportPreviewRow[] = [];

  for (const row of parsed) {
    const key = playerNameKey(row.first_name, row.last_name);
    const matchedPlayerId = byName.get(key) ?? null;
    let isNew = false;
    if (matchedPlayerId == null) {
      isNew = !claimedNew.has(key);
      if (isNew) claimedNew.add(key);
    }
    rows.push({
      ...row,
      matchedPlayerId,
      isNew,
      // Rows on a tryout-results sheet are treated as present for that day.
      willMarkPresent: true,
    });
  }

  return rows;
}

export function tryoutRowToPlayerInput(row: TryoutImportRow): PlayerInput {
  return {
    first_name: row.first_name,
    last_name: row.last_name,
    school_year: row.school_year,
    positions: [],
  };
}
