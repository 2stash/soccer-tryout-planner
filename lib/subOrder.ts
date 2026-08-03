import { supabase } from '@/lib/supabase';
import { orderPlayersBySortEntries } from '@/lib/playerSort';
import { swapSortOrders } from '@/lib/sortOrder';
import type { Player, SquadTeam } from '@/lib/types';

export type SubOrderEntry = {
  id: string;
  roster_id: string;
  workspace_id: string;
  squad_team: SquadTeam;
  player_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function listSubOrderEntries(
  rosterId: string,
  squadTeam: SquadTeam,
  workspaceId: string
): Promise<SubOrderEntry[]> {
  const { data, error } = await supabase
    .from('sub_order_entries')
    .select('*')
    .eq('roster_id', rosterId)
    .eq('squad_team', squadTeam)
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as SubOrderEntry[];
}

async function reindexSubOrders(entries: SubOrderEntry[]): Promise<SubOrderEntry[]> {
  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const updates = sorted
    .map((entry, index) => ({ entry, sort_order: index + 1 }))
    .filter(({ entry, sort_order }) => entry.sort_order !== sort_order);

  for (const { entry, sort_order } of updates) {
    const { error } = await supabase
      .from('sub_order_entries')
      .update({ sort_order })
      .eq('id', entry.id);
    if (error) throw error;
  }

  if (updates.length === 0) return sorted;
  return sorted.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

/**
 * Keep sub order in sync with current non-starter squad members.
 * New subs append at the end; players who became starters are removed.
 */
export async function syncSubOrder(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  subPlayers: Player[];
}): Promise<SubOrderEntry[]> {
  const eligibleIds = new Set(params.subPlayers.map((p) => p.id));
  const existing = await listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);

  const toRemove = existing.filter((e) => !eligibleIds.has(e.player_id));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('sub_order_entries')
      .delete()
      .in(
        'id',
        toRemove.map((e) => e.id)
      );
    if (error) throw error;
  }

  const remaining = existing
    .filter((e) => eligibleIds.has(e.player_id))
    .sort((a, b) => a.sort_order - b.sort_order);

  const presentIds = new Set(remaining.map((e) => e.player_id));
  const toAdd = params.subPlayers.filter((p) => !presentIds.has(p.id));

  if (toAdd.length > 0) {
    let nextOrder = remaining.length + 1;
    const rows = toAdd.map((p) => ({
      roster_id: params.rosterId,
      workspace_id: params.workspaceId,
      squad_team: params.squadTeam,
      player_id: p.id,
      sort_order: nextOrder++,
    }));
    const { error } = await supabase.from('sub_order_entries').insert(rows);
    if (error) throw error;
  }

  const refreshed = await listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);
  return reindexSubOrders(refreshed);
}

export async function moveSubOrderEntry(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  playerId: string;
  direction: 'up' | 'down';
}): Promise<SubOrderEntry[]> {
  const entries = await listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);
  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((e) => e.player_id === params.playerId);
  if (index < 0) return sorted;

  const swapWith = params.direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return sorted;

  await swapSortOrders('sub_order_entries', sorted[index], sorted[swapWith]);
  return listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);
}

/**
 * After a starter swap: incoming leaves the bench; outgoing stays on this team as a sub.
 * If incoming was bench #12+N, outgoing takes that exact slot.
 */
export function buildSwappedSubOrder(params: {
  previousSubIds: string[];
  incomingPlayerId: string;
  outgoingPlayerId: string | null;
  /** 0-based index of incoming in previousSubIds when they were a sub here. */
  incomingSubIndex: number | null;
}): string[] {
  const {
    previousSubIds,
    incomingPlayerId,
    outgoingPlayerId,
    incomingSubIndex,
  } = params;

  const without = previousSubIds.filter(
    (id) => id !== incomingPlayerId && id !== outgoingPlayerId
  );

  if (!outgoingPlayerId) return without;

  const wasSubHere =
    incomingSubIndex != null &&
    incomingSubIndex >= 0 &&
    previousSubIds[incomingSubIndex] === incomingPlayerId;

  if (wasSubHere) {
    const insertAt = Math.min(incomingSubIndex, without.length);
    return [
      ...without.slice(0, insertAt),
      outgoingPlayerId,
      ...without.slice(insertAt),
    ];
  }

  return [...without, outgoingPlayerId];
}

async function writeSubSortOrders(entries: SubOrderEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const temp = await Promise.all(
    entries.map((entry, i) =>
      supabase
        .from('sub_order_entries')
        .update({ sort_order: 10000 + i })
        .eq('id', entry.id)
    )
  );
  const tempErr = temp.find((r) => r.error)?.error;
  if (tempErr) throw tempErr;

  const final = await Promise.all(
    entries.map((entry, i) =>
      supabase
        .from('sub_order_entries')
        .update({ sort_order: i + 1 })
        .eq('id', entry.id)
    )
  );
  const finalErr = final.find((r) => r.error)?.error;
  if (finalErr) throw finalErr;
}

/** Replace bench order with an exact player-id sequence (batched writes). */
export async function replaceSubOrder(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  workspaceId: string;
  orderedPlayerIds: string[];
}): Promise<SubOrderEntry[]> {
  const existing = await listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);
  const desired = params.orderedPlayerIds;
  const desiredSet = new Set(desired);

  const toRemove = existing.filter((e) => !desiredSet.has(e.player_id));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('sub_order_entries')
      .delete()
      .in(
        'id',
        toRemove.map((e) => e.id)
      );
    if (error) throw error;
  }

  const remaining = existing.filter((e) => desiredSet.has(e.player_id));
  const present = new Set(remaining.map((e) => e.player_id));
  const toAdd = desired.filter((id) => !present.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((playerId, i) => ({
      roster_id: params.rosterId,
      workspace_id: params.workspaceId,
      squad_team: params.squadTeam,
      player_id: playerId,
      sort_order: 20000 + i,
    }));
    const { error } = await supabase.from('sub_order_entries').insert(rows);
    if (error) throw error;
  }

  const refreshed = await listSubOrderEntries(params.rosterId, params.squadTeam, params.workspaceId);
  const byPlayer = new Map(refreshed.map((e) => [e.player_id, e]));
  const ordered = desired
    .map((id) => byPlayer.get(id))
    .filter((e): e is SubOrderEntry => Boolean(e));

  await writeSubSortOrders(ordered);
  return ordered.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

export function orderPlayersBySubOrder(
  players: Player[],
  entries: SubOrderEntry[]
): Player[] {
  return orderPlayersBySortEntries(players, entries, { sortLeftoversByName: true });
}
