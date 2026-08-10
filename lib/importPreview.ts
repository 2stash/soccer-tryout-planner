import type { PlayerInput } from '@/lib/types';
import type { ImportParseResult } from '@/lib/importSpreadsheet';

export type ImportPreviewRow = PlayerInput & {
  isDuplicate: boolean;
};

/** Case-insensitive first+last key for import matching. */
export function playerNameKey(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  return `${String(lastName ?? '')
    .trim()
    .toLowerCase()}|${String(firstName ?? '')
    .trim()
    .toLowerCase()}`;
}

/** Merge multiple spreadsheet/photo parse results into one. */
export function mergeImportParseResults(
  parts: ImportParseResult[]
): ImportParseResult {
  const rows: PlayerInput[] = [];
  const errors: ImportParseResult['errors'] = [];
  const headersFound: string[] = [];
  const seenHeaders = new Set<string>();

  for (const part of parts) {
    rows.push(...part.rows);
    errors.push(...part.errors);
    for (const h of part.headersFound) {
      if (seenHeaders.has(h)) continue;
      seenHeaders.add(h);
      headersFound.push(h);
    }
  }

  return { rows, errors, headersFound };
}

/**
 * Flag rows that already exist on the roster (or repeat earlier in this
 * import) by first+last name. New rows sort first; duplicates keep relative order.
 */
export function buildImportPreviewRows(
  parsed: PlayerInput[],
  existing: { first_name: string; last_name: string }[]
): ImportPreviewRow[] {
  const existingKeys = new Set(
    existing.map((p) => playerNameKey(p.first_name, p.last_name))
  );
  const seenInBatch = new Set<string>();
  const rows: ImportPreviewRow[] = [];

  for (const row of parsed) {
    const key = playerNameKey(row.first_name, row.last_name);
    const isDuplicate = existingKeys.has(key) || seenInBatch.has(key);
    seenInBatch.add(key);
    rows.push({ ...row, isDuplicate });
  }

  rows.sort((a, b) => Number(a.isDuplicate) - Number(b.isDuplicate));
  return rows;
}
