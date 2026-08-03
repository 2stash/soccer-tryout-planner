/** Standard soccer shirt numbers / roles (1–11). */
export type PositionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type SoccerPosition = {
  number: PositionNumber;
  abbr: string;
  name: string;
};

export const SOCCER_POSITIONS: SoccerPosition[] = [
  { number: 1, abbr: 'GK', name: 'Goalkeeper' },
  { number: 2, abbr: 'RB', name: 'Right Back' },
  { number: 3, abbr: 'LB', name: 'Left Back' },
  { number: 4, abbr: 'CB', name: 'Center Back' },
  { number: 5, abbr: 'CB', name: 'Center Back' },
  { number: 6, abbr: 'CDM', name: 'Defensive Midfielder' },
  { number: 7, abbr: 'RW', name: 'Right Winger' },
  { number: 8, abbr: 'CM', name: 'Central Midfielder' },
  { number: 9, abbr: 'ST', name: 'Striker' },
  { number: 10, abbr: 'CAM', name: 'Attacking Midfielder' },
  { number: 11, abbr: 'LW', name: 'Left Winger' },
];

const BY_NUMBER = new Map(SOCCER_POSITIONS.map((p) => [p.number, p]));

export function getPosition(number: number): SoccerPosition | undefined {
  return BY_NUMBER.get(number as PositionNumber);
}

/**
 * Depth-chart groups: CB (4 & 5) share one pool with 2 starter slots.
 * All other shirt numbers are their own group with 1 starter.
 */
export const DEPTH_POSITION_GROUPS: readonly (readonly PositionNumber[])[] = [
  [1],
  [2],
  [3],
  [4, 5],
  [6],
  [7],
  [8],
  [9],
  [10],
  [11],
] as const;

/**
 * Fixed XI display order (attack → defense → GK).
 * `index` is which starter to take from that depth group (CB uses 0 and 1).
 */
export type StarterDisplaySlot = {
  group: PositionNumber;
  index: number;
  label: string;
};

export const STARTER_DISPLAY_SLOTS: readonly StarterDisplaySlot[] = [
  { group: 9, index: 0, label: 'ST' },
  { group: 10, index: 0, label: 'CAM' },
  { group: 11, index: 0, label: 'LW' },
  { group: 7, index: 0, label: 'RW' },
  { group: 8, index: 0, label: 'CM' },
  { group: 6, index: 0, label: 'CDM' },
  { group: 3, index: 0, label: 'LB' },
  { group: 4, index: 0, label: 'CB' },
  { group: 4, index: 1, label: 'CB' },
  { group: 2, index: 0, label: 'RB' },
  { group: 1, index: 0, label: 'GK' },
] as const;

export function getDepthPositionGroup(positionNumber: number): PositionNumber[] {
  const group = DEPTH_POSITION_GROUPS.find((g) =>
    g.includes(positionNumber as PositionNumber)
  );
  return group ? [...group] : [positionNumber as PositionNumber];
}

/** Canonical DB key for a depth group (lowest shirt number). */
export function getDepthCanonicalPosition(positionNumber: number): PositionNumber {
  const group = getDepthPositionGroup(positionNumber);
  return Math.min(...group) as PositionNumber;
}

/** How many starters this depth group contributes to the XI. */
export function getDepthStarterCount(positionNumber: number): number {
  return getDepthPositionGroup(positionNumber).length;
}

export function formatDepthGroupLabel(positionNumber: number): string {
  const group = getDepthPositionGroup(positionNumber);
  return getPosition(group[0])?.abbr ?? String(group[0]);
}

export function playerInDepthGroup(
  positions: number[] | null | undefined,
  positionNumber: number
): boolean {
  const group = getDepthPositionGroup(positionNumber);
  const normalized = normalizePositions(positions);
  return group.some((n) => normalized.includes(n));
}

export function sortPositionNumbers(numbers: number[]): number[] {
  return [...new Set(numbers.filter((n) => n >= 1 && n <= 11))].sort((a, b) => a - b);
}

/** Short label for tables, e.g. "ST · CAM" (numbers omitted; duplicate abbrs collapsed). */
export function formatPositionsShort(numbers: number[] | null | undefined): string {
  const sorted = sortPositionNumbers(numbers ?? []);
  if (sorted.length === 0) return '';
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const n of sorted) {
    const p = getPosition(n);
    const label = p?.abbr ?? String(n);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(' · ');
}

/** Full label, e.g. "ST Striker · CAM Attacking Midfielder" */
export function formatPositionsFull(numbers: number[] | null | undefined): string {
  const sorted = sortPositionNumbers(numbers ?? []);
  if (sorted.length === 0) return '';
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const n of sorted) {
    const p = getPosition(n);
    const key = p?.abbr ?? String(n);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(p ? `${p.abbr} ${p.name}` : String(n));
  }
  return labels.join(' · ');
}

/** Parse spreadsheet / free text into position numbers. Accepts 9, ST, "9/10", "ST, CAM". */
export function parsePositionsInput(value: unknown): number[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return sortPositionNumbers(value.map(Number).filter((n) => Number.isFinite(n)));
  }

  const raw = String(value).trim();
  if (!raw) return [];

  const tokens = raw.split(/[,;/|]+/).map((t) => t.trim()).filter(Boolean);
  const found: number[] = [];

  for (const token of tokens) {
    const asNum = Number(token);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 11) {
      found.push(asNum);
      continue;
    }

    const key = token.toUpperCase().replace(/\./g, '');
    const byAbbr = SOCCER_POSITIONS.filter((p) => p.abbr === key);
    if (byAbbr.length === 1) {
      found.push(byAbbr[0].number);
      continue;
    }
    // Ambiguous CB → prefer 4 if neither center back selected yet, else 5
    if (key === 'CB') {
      if (!found.includes(4)) found.push(4);
      else if (!found.includes(5)) found.push(5);
      continue;
    }

    const byName = SOCCER_POSITIONS.find(
      (p) => p.name.toUpperCase() === key || p.name.toUpperCase().replace(/\s+/g, '') === key
    );
    if (byName) found.push(byName.number);
  }

  return sortPositionNumbers(found);
}

export function normalizePositions(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return sortPositionNumbers(value.map(Number).filter((n) => Number.isFinite(n)));
}

export function positionsEqual(a: number[], b: number[]): boolean {
  const aa = sortPositionNumbers(a);
  const bb = sortPositionNumbers(b);
  if (aa.length !== bb.length) return false;
  return aa.every((n, i) => n === bb[i]);
}
