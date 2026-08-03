import { comparePlayersByName } from '@/lib/playerSort';
import { normalizeSchoolYear, schoolYearSortKey } from '@/lib/schoolYear';
import type { Player } from '@/lib/types';

export type GradeFilter = 'all' | 'Sr' | 'Jr' | 'Soph' | 'Fr';

export type AvailableRankPlan = {
  playerId: string;
  team_rank: number;
  available_pinned: boolean;
};

function isPinned(p: Player): boolean {
  return Boolean(p.available_pinned);
}

/** Default Available order: class (Sr→Fr), then name. Used to seed team_rank. */
export function compareAvailableDefault(a: Player, b: Player): number {
  const classCmp =
    schoolYearSortKey(a.school_year) - schoolYearSortKey(b.school_year);
  if (classCmp !== 0) return classCmp;
  return comparePlayersByName(a, b);
}

/**
 * Master Available order: starred (pinned) band first, then the rest.
 * Within each band: team_rank, then class/name.
 */
export function orderAvailablePlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const ap = isPinned(a) ? 0 : 1;
    const bp = isPinned(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ar = a.team_rank ?? Number.POSITIVE_INFINITY;
    const br = b.team_rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return compareAvailableDefault(a, b);
  });
}

export function filterAvailableByGrade(
  players: Player[],
  grade: GradeFilter
): Player[] {
  if (grade === 'all') return players;
  return players.filter((p) => normalizeSchoolYear(p.school_year) === grade);
}

function toPlan(ordered: Player[]): AvailableRankPlan[] {
  return ordered.map((p, index) => ({
    playerId: p.id,
    team_rank: index + 1,
    available_pinned: isPinned(p),
  }));
}

/**
 * Build contiguous team_rank 1..n for unassigned players.
 * Preserves pin bands and relative ranks.
 */
export function planAvailableRanks(available: Player[]): AvailableRankPlan[] {
  return toPlan(orderAvailablePlayers(available));
}

export function ranksNeedSync(
  available: Player[],
  planned: AvailableRankPlan[]
): boolean {
  if (available.length !== planned.length) return true;
  const byId = new Map(planned.map((r) => [r.playerId, r]));
  for (const p of available) {
    const row = byId.get(p.id);
    if (!row) return true;
    if (row.team_rank !== p.team_rank) return true;
    if (row.available_pinned !== isPinned(p)) return true;
  }
  return false;
}

/** Replace the filtered subsequence in master with nextFiltered (same ids). */
function weaveFilteredOrder(
  master: Player[],
  nextFiltered: Player[]
): Player[] {
  const filteredIds = new Set(nextFiltered.map((p) => p.id));
  const result: Player[] = [];
  let fi = 0;
  for (const p of master) {
    if (filteredIds.has(p.id)) {
      result.push(nextFiltered[fi++]);
    } else {
      result.push(p);
    }
  }
  return result;
}

function withPin(player: Player, pinned: boolean): Player {
  return { ...player, available_pinned: pinned };
}

/**
 * ↑↓ within the current grade filter.
 * Starred only swap with starred; unpinned only with unpinned
 * (so ↑ never climbs above a star).
 */
export function moveAvailableInFilter(params: {
  available: Player[];
  grade: GradeFilter;
  playerId: string;
  direction: 'up' | 'down';
}): AvailableRankPlan[] | null {
  const master = orderAvailablePlayers(params.available);
  const filtered = filterAvailableByGrade(master, params.grade);
  const idx = filtered.findIndex((p) => p.id === params.playerId);
  if (idx < 0) return null;
  const swapWith = params.direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= filtered.length) return null;

  const a = filtered[idx];
  const b = filtered[swapWith];
  if (isPinned(a) !== isPinned(b)) return null;

  const nextFiltered = [...filtered];
  nextFiltered[idx] = b;
  nextFiltered[swapWith] = a;
  return toPlan(weaveFilteredOrder(master, nextFiltered));
}

/** Star: pin + move to #1 among starred. Unstar: unpin + first unpinned slot. */
export function toggleAvailablePin(params: {
  available: Player[];
  grade: GradeFilter;
  playerId: string;
}): AvailableRankPlan[] | null {
  const master = orderAvailablePlayers(params.available);
  const target = master.find((p) => p.id === params.playerId);
  if (!target) return null;

  const pinned = master.filter((p) => isPinned(p) && p.id !== target.id);
  const unpinned = master.filter((p) => !isPinned(p) && p.id !== target.id);

  let next: Player[];
  if (isPinned(target)) {
    // Unpin → top of unpinned band (just below stars).
    next = [...pinned, withPin(target, false), ...unpinned];
  } else {
    // Pin → top of starred band.
    next = [withPin(target, true), ...pinned, ...unpinned];
  }

  // Preserve grade-filter relative order for everyone else via weave when filtered.
  if (params.grade === 'all') {
    return toPlan(next);
  }

  // When filtered, still apply global pin bands; filtered view will reflect it.
  return toPlan(next);
}

/**
 * Move to top of the allowed band:
 * - starred → first starred
 * - unpinned → first unpinned (never above a star)
 */
export function moveAvailableToTop(params: {
  available: Player[];
  grade: GradeFilter;
  playerId: string;
}): AvailableRankPlan[] | null {
  const master = orderAvailablePlayers(params.available);
  const filtered = filterAvailableByGrade(master, params.grade);
  const idx = filtered.findIndex((p) => p.id === params.playerId);
  if (idx < 0) return null;

  const player = filtered[idx];
  const pinned = filtered.filter((p) => isPinned(p) && p.id !== player.id);
  const unpinned = filtered.filter((p) => !isPinned(p) && p.id !== player.id);

  const nextFiltered = isPinned(player)
    ? [player, ...pinned, ...unpinned]
    : [...pinned, player, ...unpinned];

  if (idx === 0 && isPinned(player)) return null;
  if (
    !isPinned(player) &&
    filtered.findIndex((p) => !isPinned(p)) === idx
  ) {
    return null; // already first unpinned in filter
  }

  return toPlan(weaveFilteredOrder(master, nextFiltered));
}

/**
 * Move to bottom of the allowed band:
 * - starred → last starred
 * - unpinned → last unpinned
 */
export function moveAvailableToBottom(params: {
  available: Player[];
  grade: GradeFilter;
  playerId: string;
}): AvailableRankPlan[] | null {
  const master = orderAvailablePlayers(params.available);
  const filtered = filterAvailableByGrade(master, params.grade);
  const idx = filtered.findIndex((p) => p.id === params.playerId);
  if (idx < 0) return null;

  const player = filtered[idx];
  const pinned = filtered.filter((p) => isPinned(p) && p.id !== player.id);
  const unpinned = filtered.filter((p) => !isPinned(p) && p.id !== player.id);

  const nextFiltered = isPinned(player)
    ? [...pinned, player, ...unpinned]
    : [...pinned, ...unpinned, player];

  if (idx === filtered.length - 1 && !isPinned(player)) return null;
  if (
    isPinned(player) &&
    filtered.filter((p) => isPinned(p)).length > 0 &&
    filtered.filter((p) => isPinned(p)).at(-1)?.id === player.id
  ) {
    return null;
  }

  return toPlan(weaveFilteredOrder(master, nextFiltered));
}

/** ↑↓ / ⇈⇊ affordances for a ranked Available/Unavailable row. */
export function availableRankMoveFlags(
  ordered: Player[],
  playerId: string
): {
  index: number;
  rank: number;
  pinned: boolean;
  canUp: boolean;
  canDown: boolean;
  canTop: boolean;
  canBottom: boolean;
} | null {
  const index = ordered.findIndex((p) => p.id === playerId);
  if (index < 0) return null;
  const pinned = isPinned(ordered[index]);
  const total = ordered.length;
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index < total - 1 ? ordered[index + 1] : null;
  const canUp = index > 0 && Boolean(prev?.available_pinned) === pinned;
  const canDown =
    index < total - 1 && Boolean(next?.available_pinned) === pinned;
  const firstUnpinnedIdx = ordered.findIndex((p) => !p.available_pinned);
  const canTop = pinned
    ? index > 0
    : firstUnpinnedIdx >= 0 && index > firstUnpinnedIdx;
  let lastPinnedIdx = -1;
  ordered.forEach((p, i) => {
    if (p.available_pinned) lastPinnedIdx = i;
  });
  const canBottom = pinned ? index < lastPinnedIdx : index < total - 1;
  return {
    index,
    rank: index + 1,
    pinned,
    canUp,
    canDown,
    canTop,
    canBottom,
  };
}

/**
 * Reset Available order to default: starred band kept (current relative order),
 * unpinned sorted by class (Sr→Fr) then last/first name.
 */
export function resetAvailableDefaultOrder(
  available: Player[]
): AvailableRankPlan[] {
  const master = orderAvailablePlayers(available);
  const pinned = master.filter((p) => isPinned(p));
  const unpinned = master
    .filter((p) => !isPinned(p))
    .sort(compareAvailableDefault);
  return toPlan([...pinned, ...unpinned]);
}

/**
 * After import: if Available was unranked, apply full default order;
 * otherwise keep existing order and append newcomers (grade then name).
 */
export function planAvailableRanksAfterImport(params: {
  available: Player[];
  newPlayerIds: ReadonlySet<string>;
}): AvailableRankPlan[] {
  const { available, newPlayerIds } = params;
  const prior = available.filter((p) => !newPlayerIds.has(p.id));
  const newcomers = available
    .filter((p) => newPlayerIds.has(p.id))
    .map((p) => withPin(p, false))
    .sort(compareAvailableDefault);

  if (
    prior.length === 0 ||
    prior.every((p) => p.team_rank == null)
  ) {
    return resetAvailableDefaultOrder(available.map((p) => withPin(p, isPinned(p))));
  }

  const master = orderAvailablePlayers(prior);
  const pinned = master.filter((p) => isPinned(p));
  const unpinned = master.filter((p) => !isPinned(p));
  return toPlan([...pinned, ...unpinned, ...newcomers]);
}
