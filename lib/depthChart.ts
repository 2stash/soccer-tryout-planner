import { supabase } from '@/lib/supabase';
import { comparePlayersByName, orderPlayersBySortEntries } from '@/lib/playerSort';
import {
  DEPTH_POSITION_GROUPS,
  STARTER_DISPLAY_SLOTS,
  getDepthCanonicalPosition,
  getDepthPositionGroup,
  getDepthStarterCount,
  playerInDepthGroup,
  type PositionNumber,
} from '@/lib/positions';
import { swapSortOrders } from '@/lib/sortOrder';
import type { Player, SquadTeam } from '@/lib/types';

export type DepthChartEntry = {
  id: string;
  roster_id: string;
  workspace_id: string;
  squad_team: SquadTeam;
  position_number: number;
  player_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function listDepthChartEntries(
  rosterId: string,
  squadTeam: SquadTeam,
  workspaceId: string,
  positionNumber?: number
): Promise<DepthChartEntry[]> {
  let query = supabase
    .from('depth_chart_entries')
    .select('*')
    .eq('roster_id', rosterId)
    .eq('squad_team', squadTeam)
    .eq('workspace_id', workspaceId)
    .order('position_number', { ascending: true })
    .order('sort_order', { ascending: true });

  if (positionNumber != null) {
    const group = getDepthPositionGroup(positionNumber);
    if (group.length === 1) {
      query = query.eq('position_number', group[0]);
    } else {
      query = query.in('position_number', group);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DepthChartEntry[];
}

async function reindexDepthOrders(
  entries: DepthChartEntry[]
): Promise<DepthChartEntry[]> {
  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const updates = sorted
    .map((entry, index) => ({ entry, sort_order: index + 1 }))
    .filter(({ entry, sort_order }) => entry.sort_order !== sort_order);

  for (const { entry, sort_order } of updates) {
    const { error } = await supabase
      .from('depth_chart_entries')
      .update({ sort_order })
      .eq('id', entry.id);
    if (error) throw error;
  }

  if (updates.length === 0) return sorted;
  return sorted.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

/**
 * Ensure depth chart matches current squad + position-group membership.
 * CB (4/5) shares one ordered pool stored under canonical position 4.
 * New players are appended as subs; removed players are deleted; orders reindexed.
 */
export async function syncDepthChartPosition(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  positionNumber: number;
  squadPlayers: Player[];
}): Promise<DepthChartEntry[]> {
  const canonical = getDepthCanonicalPosition(params.positionNumber);

  const eligible = params.squadPlayers.filter(
    (p) =>
      p.squad_team === params.squadTeam &&
      playerInDepthGroup(p.positions, params.positionNumber)
  );
  const eligibleIds = new Set(eligible.map((p) => p.id));

  const existing = await listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId,
    params.positionNumber
  );

  // One row per player; prefer lowest sort_order, then canonical position number
  const bestByPlayer = new Map<string, DepthChartEntry>();
  for (const entry of existing) {
    const prev = bestByPlayer.get(entry.player_id);
    if (
      !prev ||
      entry.sort_order < prev.sort_order ||
      (entry.sort_order === prev.sort_order &&
        entry.position_number === canonical &&
        prev.position_number !== canonical)
    ) {
      bestByPlayer.set(entry.player_id, entry);
    }
  }

  const keepIds = new Set(
    [...bestByPlayer.values()]
      .filter((e) => eligibleIds.has(e.player_id))
      .map((e) => e.id)
  );
  const toRemove = existing.filter((e) => !keepIds.has(e.id));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('depth_chart_entries')
      .delete()
      .in(
        'id',
        toRemove.map((e) => e.id)
      );
    if (error) throw error;
  }

  // Move kept rows onto the canonical position number (shared CB pool → 4)
  for (const entry of bestByPlayer.values()) {
    if (!eligibleIds.has(entry.player_id)) continue;
    if (entry.position_number !== canonical) {
      const { error } = await supabase
        .from('depth_chart_entries')
        .update({ position_number: canonical })
        .eq('id', entry.id);
      if (error) throw error;
      entry.position_number = canonical;
    }
  }

  const remaining = [...bestByPlayer.values()]
    .filter((e) => eligibleIds.has(e.player_id))
    .sort((a, b) => a.sort_order - b.sort_order);

  const presentIds = new Set(remaining.map((e) => e.player_id));
  const toAdd = eligible.filter((p) => !presentIds.has(p.id));

  if (toAdd.length > 0) {
    let nextOrder = remaining.length + 1;
    const rows = toAdd.map((p) => ({
      roster_id: params.rosterId,
      workspace_id: params.workspaceId,
      squad_team: params.squadTeam,
      position_number: canonical,
      player_id: p.id,
      sort_order: nextOrder++,
    }));
    const { error } = await supabase.from('depth_chart_entries').insert(rows);
    if (error) throw error;
  }

  const refreshed = await listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId,
    canonical
  ).then((rows) => rows.filter((e) => e.position_number === canonical));

  return reindexDepthOrders(refreshed);
}

/** Move a player up/down within a position (or CB group) depth chart. */
export async function moveDepthChartEntry(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  positionNumber: number;
  playerId: string;
  direction: 'up' | 'down';
}): Promise<DepthChartEntry[]> {
  const canonical = getDepthCanonicalPosition(params.positionNumber);
  const entries = (
    await listDepthChartEntries(
      params.rosterId,
      params.squadTeam,
      params.workspaceId,
      params.positionNumber
    )
  ).filter((e) => e.position_number === canonical);

  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((e) => e.player_id === params.playerId);
  if (index < 0) return sorted;

  const swapWith = params.direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return sorted;

  const a = sorted[index];
  const b = sorted[swapWith];
  await swapSortOrders('depth_chart_entries', a, b);

  return listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId,
    canonical
  ).then((rows) =>
    rows
      .filter((e) => e.position_number === canonical)
      .sort((a, b) => a.sort_order - b.sort_order)
  );
}

async function writeDepthSortOrders(entries: DepthChartEntry[]): Promise<void> {
  if (entries.length === 0) return;
  // Two-pass batch to avoid unique sort_order conflicts.
  const temp = await Promise.all(
    entries.map((entry, i) =>
      supabase
        .from('depth_chart_entries')
        .update({ sort_order: 10000 + i })
        .eq('id', entry.id)
    )
  );
  const tempErr = temp.find((r) => r.error)?.error;
  if (tempErr) throw tempErr;

  const final = await Promise.all(
    entries.map((entry, i) =>
      supabase
        .from('depth_chart_entries')
        .update({ sort_order: i + 1 })
        .eq('id', entry.id)
    )
  );
  const finalErr = final.find((r) => r.error)?.error;
  if (finalErr) throw finalErr;
}

/**
 * Persist an absolute player order for one position group (offline replay).
 * Unknown ids are ignored; missing rows are left unchanged at the end.
 */
export async function replaceDepthOrderForPosition(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  positionNumber: number;
  orderedPlayerIds: string[];
}): Promise<DepthChartEntry[]> {
  const canonical = getDepthCanonicalPosition(params.positionNumber);
  const entries = (
    await listDepthChartEntries(
      params.rosterId,
      params.squadTeam,
      params.workspaceId,
      canonical
    )
  ).filter((e) => e.position_number === canonical);

  const byPlayer = new Map(entries.map((e) => [e.player_id, e]));
  const ordered: DepthChartEntry[] = [];
  const seen = new Set<string>();
  for (const id of params.orderedPlayerIds) {
    const row = byPlayer.get(id);
    if (!row || seen.has(id)) continue;
    seen.add(id);
    ordered.push(row);
  }
  for (const row of entries.sort((a, b) => a.sort_order - b.sort_order)) {
    if (seen.has(row.player_id)) continue;
    ordered.push(row);
  }
  await writeDepthSortOrders(ordered);
  return listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId,
    canonical
  ).then((rows) =>
    rows
      .filter((e) => e.position_number === canonical)
      .sort((a, b) => a.sort_order - b.sort_order)
  );
}

function uniqueOrderedEntries(entries: DepthChartEntry[]): DepthChartEntry[] {
  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const seen = new Set<string>();
  const unique: DepthChartEntry[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.player_id)) continue;
    seen.add(entry.player_id);
    unique.push(entry);
  }
  return unique;
}

function entriesForCanonical(
  teamEntries: DepthChartEntry[],
  canonical: PositionNumber
): DepthChartEntry[] {
  return uniqueOrderedEntries(
    teamEntries.filter((e) => e.position_number === canonical)
  );
}

function applyGroupOrder(
  teamEntries: DepthChartEntry[],
  canonical: PositionNumber,
  ordered: DepthChartEntry[]
): DepthChartEntry[] {
  const orderById = new Map(ordered.map((e, i) => [e.id, i + 1]));
  return teamEntries.map((entry) => {
    if (entry.position_number !== canonical) return entry;
    const nextOrder = orderById.get(entry.id);
    return nextOrder != null ? { ...entry, sort_order: nextOrder } : entry;
  });
}

/**
 * Pure starter-swap on depth rows (shared by optimistic UI + DB persist).
 *
 * Swap rules (All Players ↔ Depth alignment):
 * 1. Incoming is pinned at the target slot (depth index) for that position.
 * 2. Outgoing is moved to the end of that position's depth (leaves the XI slot).
 * 3. Incoming is NOT demoted from other positions — they may remain #1 elsewhere
 *    (dual-starter conflict shown on All Players formation).
 */
export function computeStarterSwapEntries(params: {
  teamEntries: DepthChartEntry[];
  positionNumber: number;
  slotIndex: number;
  incomingPlayerId: string;
  outgoingPlayerId?: string | null;
}): DepthChartEntry[] {
  const targetCanonical = getDepthCanonicalPosition(params.positionNumber);
  const targetStarterCount = getDepthStarterCount(targetCanonical);
  const slotIndex = Math.max(
    0,
    Math.min(params.slotIndex, Math.max(targetStarterCount - 1, 0))
  );
  const outgoingId =
    params.outgoingPlayerId &&
    params.outgoingPlayerId !== params.incomingPlayerId
      ? params.outgoingPlayerId
      : null;

  let teamEntries = [...params.teamEntries];
  let targetOrdered = entriesForCanonical(teamEntries, targetCanonical);
  let incomingEntry = targetOrdered.find(
    (e) => e.player_id === params.incomingPlayerId
  );

  // Caller should ensure a row exists; keep a safe local fallback for UI.
  if (!incomingEntry) {
    const template = teamEntries[0];
    incomingEntry = {
      id: `local-${params.incomingPlayerId}-${targetCanonical}`,
      roster_id: template?.roster_id ?? '',
      workspace_id: template?.workspace_id ?? '',
      squad_team: template?.squad_team ?? 'varsity',
      position_number: targetCanonical,
      player_id: params.incomingPlayerId,
      sort_order: targetOrdered.length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    teamEntries = [...teamEntries, incomingEntry];
    targetOrdered = [...targetOrdered, incomingEntry];
  }

  const outgoingEntry = outgoingId
    ? targetOrdered.find((e) => e.player_id === outgoingId) ?? null
    : null;

  const withoutBoth = targetOrdered.filter(
    (e) =>
      e.player_id !== params.incomingPlayerId && e.player_id !== outgoingId
  );
  // Depth is a dense ordered list (no vacant placeholders). Insert at the
  // requested index when possible; otherwise append (e.g. CB2 with empty CB1
  // becomes the first CB until a partner is added).
  const insertAt = Math.min(slotIndex, withoutBoth.length);
  const nextTarget = [
    ...withoutBoth.slice(0, insertAt),
    incomingEntry,
    ...withoutBoth.slice(insertAt),
  ];
  if (
    outgoingEntry &&
    !nextTarget.some((e) => e.player_id === outgoingEntry.player_id)
  ) {
    // Outgoing leaves this position's starter zone (end of this position's depth).
    nextTarget.push(outgoingEntry);
  }
  teamEntries = applyGroupOrder(teamEntries, targetCanonical, nextTarget);

  return teamEntries;
}

/** Ensure a player has a depth-chart row for a position group (appended if new). */
export async function ensurePlayerInDepthPosition(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  positionNumber: number;
  playerId: string;
}): Promise<DepthChartEntry[]> {
  const canonical = getDepthCanonicalPosition(params.positionNumber);
  const existing = (
    await listDepthChartEntries(
      params.rosterId,
      params.squadTeam,
      params.workspaceId,
      canonical
    )
  ).filter((e) => e.position_number === canonical);

  if (existing.some((e) => e.player_id === params.playerId)) {
    return existing.sort((a, b) => a.sort_order - b.sort_order);
  }

  const maxOrder = existing.reduce((m, e) => Math.max(m, e.sort_order), 0);
  const { error } = await supabase.from('depth_chart_entries').insert({
    roster_id: params.rosterId,
    workspace_id: params.workspaceId,
    squad_team: params.squadTeam,
    position_number: canonical,
    player_id: params.playerId,
    sort_order: maxOrder + 1,
  });
  if (error) throw error;

  return listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId,
    canonical
  ).then((rows) =>
    rows
      .filter((e) => e.position_number === canonical)
      .sort((a, b) => a.sort_order - b.sort_order)
  );
}

/**
 * Place a player into a starter slot for a depth group (persists sort order).
 * See `computeStarterSwapEntries` for the starter / swap rules.
 */
export async function setDepthStarter(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  positionNumber: number;
  /** 0 for most positions; 0 or 1 for CB. */
  slotIndex: number;
  playerId: string;
  /** Current starter being replaced — moved to end of this position's depth. */
  outgoingPlayerId?: string | null;
}): Promise<DepthChartEntry[]> {
  const targetCanonical = getDepthCanonicalPosition(params.positionNumber);

  await ensurePlayerInDepthPosition({
    rosterId: params.rosterId,
    squadTeam: params.squadTeam,
    workspaceId: params.workspaceId,
    positionNumber: targetCanonical,
    playerId: params.playerId,
  });

  const teamEntries = await listDepthChartEntries(
    params.rosterId,
    params.squadTeam,
    params.workspaceId
  );
  const nextEntries = computeStarterSwapEntries({
    teamEntries,
    positionNumber: params.positionNumber,
    slotIndex: params.slotIndex,
    incomingPlayerId: params.playerId,
    outgoingPlayerId: params.outgoingPlayerId,
  });

  // Persist group-by-group (sequential) so unique sort_order constraints stay calm.
  for (const group of DEPTH_POSITION_GROUPS) {
    const canonical = group[0];
    const before = entriesForCanonical(teamEntries, canonical);
    const after = entriesForCanonical(nextEntries, canonical);
    const changed =
      before.length !== after.length ||
      before.some(
        (entry, i) =>
          entry.id !== after[i]?.id || entry.sort_order !== after[i]?.sort_order
      );
    if (changed) await writeDepthSortOrders(after);
  }

  return listDepthChartEntries(params.rosterId, params.squadTeam, params.workspaceId);
}

export async function syncDepthChartTeam(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  squadPlayers: Player[];
}): Promise<DepthChartEntry[]> {
  const groups = await Promise.all(
    DEPTH_POSITION_GROUPS.map((group) =>
      syncDepthChartPosition({
        rosterId: params.rosterId,
        squadTeam: params.squadTeam,
        workspaceId: params.workspaceId,
        positionNumber: group[0],
        squadPlayers: params.squadPlayers,
      })
    )
  );
  return groups.flat();
}

/** Sync only the given position groups (deduped by canonical), then return full team entries. */
export async function syncDepthChartPositionGroups(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  squadPlayers: Player[];
  positionNumbers: number[];
}): Promise<DepthChartEntry[]> {
  const canonicals = [
    ...new Set(params.positionNumbers.map((n) => getDepthCanonicalPosition(n))),
  ];
  if (canonicals.length === 0) {
    return listDepthChartEntries(params.rosterId, params.squadTeam, params.workspaceId);
  }

  await Promise.all(
    canonicals.map((positionNumber) =>
      syncDepthChartPosition({
        rosterId: params.rosterId,
        squadTeam: params.squadTeam,
        workspaceId: params.workspaceId,
        positionNumber,
        squadPlayers: params.squadPlayers,
      })
    )
  );
  return listDepthChartEntries(params.rosterId, params.squadTeam, params.workspaceId);
}

export function orderPlayersByDepth(
  players: Player[],
  entries: DepthChartEntry[]
): Player[] {
  return orderPlayersBySortEntries(players, entries);
}

/**
 * Players in a depth group (e.g. CB 4/5), ordered like Depth Chart / All Players.
 */
export function orderPlayersAtDepthPosition(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[],
  positionNumber: number
): Player[] {
  const atPosition = squadPlayers.filter((p) =>
    playerInDepthGroup(p.positions, positionNumber)
  );
  const canonical = getDepthCanonicalPosition(positionNumber);
  const positionEntries = teamEntries.filter(
    (e) => e.position_number === canonical
  );
  return orderPlayersByDepth(atPosition, positionEntries);
}

/**
 * Squad Planner board lists for a shirt slot.
 * CB (4) and CB (5) each get one starter, then remaining subs are split
 * alternately with no duplicates.
 */
export function playersForBoardSlot(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[],
  positionNumber: number
): Player[] {
  if (positionNumber !== 4 && positionNumber !== 5) {
    return orderPlayersAtDepthPosition(
      squadPlayers,
      teamEntries,
      positionNumber
    );
  }

  const ordered = orderPlayersAtDepthPosition(squadPlayers, teamEntries, 4);
  const starterA = ordered[0];
  const starterB = ordered[1];
  const subs = ordered.slice(2);

  if (positionNumber === 4) {
    return [
      ...(starterA ? [starterA] : []),
      ...subs.filter((_, index) => index % 2 === 0),
    ];
  }

  return [
    ...(starterB ? [starterB] : []),
    ...subs.filter((_, index) => index % 2 === 1),
  ];
}

/**
 * Starters per depth group, in depth order (CB pool may have 2).
 * When `uniqueAcrossXi` is true (Rosters / unique game XI), a player can only
 * appear in one group — first claim in DEPTH_POSITION_GROUPS order wins.
 * When false (All Players conflict view), each group takes its own top N.
 */
function getStarterPoolsByGroup(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[],
  uniqueAcrossXi = true
): Map<PositionNumber, Player[]> {
  const byId = new Map(squadPlayers.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const pools = new Map<PositionNumber, Player[]>();

  for (const group of DEPTH_POSITION_GROUPS) {
    const canonical = group[0];
    const starterCount = getDepthStarterCount(canonical);
    const ordered = teamEntries
      .filter((e) => group.includes(e.position_number as PositionNumber))
      .sort((a, b) => a.sort_order - b.sort_order);

    const uniqueOrdered: string[] = [];
    for (const entry of ordered) {
      if (!uniqueOrdered.includes(entry.player_id)) {
        uniqueOrdered.push(entry.player_id);
      }
    }

    const pool: Player[] = [];
    for (const playerId of uniqueOrdered) {
      if (pool.length >= starterCount) break;
      if (!byId.has(playerId)) continue;
      if (uniqueAcrossXi && seen.has(playerId)) continue;
      const player = byId.get(playerId)!;
      if (uniqueAcrossXi) seen.add(playerId);
      pool.push(player);
    }
    pools.set(canonical, pool);
  }

  return pools;
}

/**
 * For each starter, which depth-group canonical positions they fill.
 * Uses independent top-N per group so dual-starters are visible.
 */
export function getStarterPositionsByPlayer(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[]
): Map<string, PositionNumber[]> {
  const pools = getStarterPoolsByGroup(squadPlayers, teamEntries, false);
  const result = new Map<string, PositionNumber[]>();
  for (const [canonical, pool] of pools) {
    for (const player of pool) {
      const list = result.get(player.id) ?? [];
      list.push(canonical);
      result.set(player.id, list);
    }
  }
  return result;
}

export type StarterSlot = {
  key: string;
  label: string;
  player: Player | null;
  group: PositionNumber;
  index: number;
  /** True when this player also starts at another XI slot. */
  conflict?: boolean;
  /** Other formation labels where the same player starts. */
  alsoLabels?: string[];
};

function mapPoolsToStarterSlots(
  pools: Map<PositionNumber, Player[]>
): StarterSlot[] {
  return STARTER_DISPLAY_SLOTS.map((slot) => {
    const player = pools.get(slot.group)?.[slot.index] ?? null;
    return {
      // Include slot identity — same player can appear in two conflict slots.
      key: `${player?.id ?? 'vacant'}-${slot.label}-${slot.group}-${slot.index}`,
      label: slot.label,
      player,
      group: slot.group,
      index: slot.index,
    };
  });
}

/** XI slots in fixed display order; unique across XI (Rosters / game sheet). */
export function getOrderedStarterSlots(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[]
): StarterSlot[] {
  return mapPoolsToStarterSlots(
    getStarterPoolsByGroup(squadPlayers, teamEntries, true)
  );
}

/**
 * XI slots without de-duping across positions — same player may appear twice.
 * Marks conflict slots for All Players formation.
 */
export function getOrderedStarterSlotsWithConflicts(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[]
): StarterSlot[] {
  const base = mapPoolsToStarterSlots(
    getStarterPoolsByGroup(squadPlayers, teamEntries, false)
  );

  const labelsByPlayer = new Map<string, string[]>();
  for (const slot of base) {
    if (!slot.player) continue;
    const list = labelsByPlayer.get(slot.player.id) ?? [];
    list.push(slot.label);
    labelsByPlayer.set(slot.player.id, list);
  }

  return base.map((slot) => {
    if (!slot.player) return slot;
    const labels = labelsByPlayer.get(slot.player.id) ?? [];
    if (labels.length < 2) return slot;
    return {
      ...slot,
      conflict: true,
      alsoLabels: labels.filter((l) => l !== slot.label),
    };
  });
}

/**
 * Map formation shirt numbers (1–11) to starting players.
 * CB pool fills both 4 and 5 (index 0 → 4, index 1 → 5).
 */
export function getFormationStartersByNumber(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[]
): Map<PositionNumber, Player | null> {
  const pools = getStarterPoolsByGroup(squadPlayers, teamEntries);
  const result = new Map<PositionNumber, Player | null>();
  for (let n = 1; n <= 11; n++) {
    const number = n as PositionNumber;
    if (number === 4) {
      result.set(4, pools.get(4)?.[0] ?? null);
    } else if (number === 5) {
      result.set(5, pools.get(4)?.[1] ?? null);
    } else {
      const canonical = getDepthCanonicalPosition(number);
      result.set(number, pools.get(canonical)?.[0] ?? null);
    }
  }
  return result;
}

/**
 * Build XI starters + remaining subs.
 * - `starterSlots` / `starters`: unique across XI (Rosters / Depth right panel).
 * - `conflictStarterSlots`: All Players formation (allows dual-starter conflicts).
 * - `subs`: anyone not in a conflict-aware starter slot.
 */
export function getStartersAndSubs(
  squadPlayers: Player[],
  teamEntries: DepthChartEntry[]
): {
  starters: Player[];
  subs: Player[];
  starterSlots: StarterSlot[];
  conflictStarterSlots: StarterSlot[];
} {
  const starterSlots = getOrderedStarterSlots(squadPlayers, teamEntries);
  const conflictStarterSlots = getOrderedStarterSlotsWithConflicts(
    squadPlayers,
    teamEntries
  );
  const starters = starterSlots
    .map((s) => s.player)
    .filter((p): p is Player => Boolean(p));
  const conflictIds = new Set(
    conflictStarterSlots
      .map((s) => s.player?.id)
      .filter((id): id is string => Boolean(id))
  );

  const subs = squadPlayers
    .filter((p) => !conflictIds.has(p.id))
    .sort(comparePlayersByName);

  return { starters, subs, starterSlots, conflictStarterSlots };
}