import * as XLSX from 'xlsx';
import type { PlayerInput } from '@/lib/types';
import { SPREADSHEET_HEADERS } from '@/lib/types';
import { parsePositionsInput } from '@/lib/positions';
import { normalizeSchoolYear } from '@/lib/schoolYear';

export type ImportRowError = {
  row: number;
  message: string;
};

export type ImportParseResult = {
  rows: PlayerInput[];
  errors: ImportRowError[];
  headersFound: string[];
};

type ImportField = keyof PlayerInput | 'position';

const HEADER_ALIASES: Record<string, ImportField> = {
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
  positions: 'positions',
  position: 'position',
  pos: 'position',
  position_rank: 'position_rank',
  positionrank: 'position_rank',
  'position rank': 'position_rank',
  team_rank: 'team_rank',
  teamrank: 'team_rank',
  'team rank': 'team_rank',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ' ');
}

function parseOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function mapHeaders(rawHeaders: unknown[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  rawHeaders.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key && map[key] === undefined) {
      map[key] = index;
    }
  });
  return map;
}

export function parseSpreadsheetBuffer(data: ArrayBuffer | Uint8Array): ImportParseResult {
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, message: 'Workbook has no sheets' }], headersFound: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (matrix.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'Sheet is empty' }], headersFound: [] };
  }

  const headerRow = matrix[0] ?? [];
  const headersFound = headerRow.map((h) => String(h ?? '').trim()).filter(Boolean);
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
          message: `Missing required columns: ${missingRequired.join(', ')}. Expected headers like: ${SPREADSHEET_HEADERS.join(', ')}`,
        },
      ],
      headersFound,
    };
  }

  const rows: PlayerInput[] = [];
  const errors: ImportRowError[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const spreadsheetRow = i + 1;

    const firstName = String(line[columnMap.first_name!] ?? '').trim();
    const lastName = String(line[columnMap.last_name!] ?? '').trim();

    if (!firstName && !lastName && line.every((cell) => String(cell ?? '').trim() === '')) {
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

    const positionRaw =
      columnMap.positions !== undefined
        ? line[columnMap.positions]
        : columnMap.position !== undefined
          ? line[columnMap.position]
          : '';
    const positions = parsePositionsInput(positionRaw);

    let positionRank: number | null = null;
    let teamRank: number | null = null;

    if (columnMap.position_rank !== undefined) {
      const raw = line[columnMap.position_rank];
      if (String(raw ?? '').trim() !== '') {
        positionRank = parseOptionalInt(raw);
        if (positionRank === null) {
          errors.push({
            row: spreadsheetRow,
            message: 'position_rank must be a number',
          });
          continue;
        }
      }
    }

    if (columnMap.team_rank !== undefined) {
      const raw = line[columnMap.team_rank];
      if (String(raw ?? '').trim() !== '') {
        teamRank = parseOptionalInt(raw);
        if (teamRank === null) {
          errors.push({
            row: spreadsheetRow,
            message: 'team_rank must be a number',
          });
          continue;
        }
      }
    }

    rows.push({
      first_name: firstName,
      last_name: lastName,
      school_year: schoolYear,
      positions,
      position_rank: positionRank,
      team_rank: teamRank,
    });
  }

  return { rows, errors, headersFound };
}

export async function parseSpreadsheetFile(file: File | Blob): Promise<ImportParseResult> {
  const buffer = await file.arrayBuffer();
  return parseSpreadsheetBuffer(buffer);
}
