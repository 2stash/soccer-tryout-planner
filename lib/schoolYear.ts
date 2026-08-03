export const SCHOOL_YEARS = ['Fr', 'Soph', 'Jr', 'Sr'] as const;

export type SchoolYear = (typeof SCHOOL_YEARS)[number];

/** Header / filter display: Sr → Fr (upperclass first). */
export const CLASS_ORDER_DESC: readonly SchoolYear[] = [
  'Sr',
  'Jr',
  'Soph',
  'Fr',
];

/** Map common aliases (So., Sophomore, etc.) onto Fr / Soph / Jr / Sr. */
export function normalizeSchoolYear(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const key = raw.toLowerCase().replace(/\./g, '');

  if (key === 'fr' || key === 'freshman' || key === '9') return 'Fr';
  if (key === 'so' || key === 'soph' || key === 'sophomore' || key === '10') return 'Soph';
  if (key === 'jr' || key === 'junior' || key === '11') return 'Jr';
  if (key === 'sr' || key === 'senior' || key === '12') return 'Sr';

  // Already one of the canonical labels (case-insensitive)
  const match = SCHOOL_YEARS.find((y) => y.toLowerCase() === key);
  return match ?? raw;
}

/** Sort key: Sr=0 … Fr=3; unknown last. */
export function schoolYearSortKey(value: string | null | undefined): number {
  const year = normalizeSchoolYear(value);
  const idx = CLASS_ORDER_DESC.indexOf(year as SchoolYear);
  return idx >= 0 ? idx : CLASS_ORDER_DESC.length;
}

export function countBySchoolYear(
  players: { school_year?: string | null }[]
): Record<SchoolYear, number> {
  const counts: Record<SchoolYear, number> = {
    Sr: 0,
    Jr: 0,
    Soph: 0,
    Fr: 0,
  };
  for (const p of players) {
    const year = normalizeSchoolYear(p.school_year);
    if (year === 'Sr' || year === 'Jr' || year === 'Soph' || year === 'Fr') {
      counts[year] += 1;
    }
  }
  return counts;
}

/** e.g. "Sr 2 · Jr 4 · Soph 3 · Fr 5" (omit zeros). */
export function formatClassCounts(
  players: { school_year?: string | null }[]
): string {
  const counts = countBySchoolYear(players);
  return CLASS_ORDER_DESC.filter((y) => counts[y] > 0)
    .map((y) => `${y} ${counts[y]}`)
    .join(' · ');
}
