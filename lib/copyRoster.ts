import { listDepthChartEntries } from '@/lib/depthChart';
import { listFormationAssignments } from '@/lib/formationAssignments';
import type { RosterSnapshot } from '@/lib/offline/types';
import { listPlayers } from '@/lib/players';
import { createRoster } from '@/lib/rosters';
import { listSubOrderEntries } from '@/lib/subOrder';
import { supabase } from '@/lib/supabase';
import type { Player, Roster, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS } from '@/lib/types';
import {
  formatPositionsShort,
  normalizePositions,
  sortPositionNumbers,
} from '@/lib/positions';
import {
  getSharedWorkspace,
  listRosterWorkspaces,
} from '@/lib/workspaces';

async function waitForSharedWorkspace(rosterId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const workspaces = await listRosterWorkspaces(rosterId);
    const shared = getSharedWorkspace(workspaces);
    if (shared) return shared.id;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Shared workspace not ready for copied team');
}

async function insertPlayersCopy(
  targetRosterId: string,
  sourcePlayers: Player[]
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  if (sourcePlayers.length === 0) return idMap;

  const payload = sourcePlayers.map((p) => {
    const positions = sortPositionNumbers(normalizePositions(p.positions));
    return {
      roster_id: targetRosterId,
      first_name: p.first_name,
      last_name: p.last_name,
      school_year: p.school_year ?? '',
      positions,
      position: formatPositionsShort(positions) || p.position || '',
    };
  });

  const { data, error } = await supabase
    .from('players')
    .insert(payload)
    .select('id');
  if (error) throw error;

  const inserted = data ?? [];
  if (inserted.length !== sourcePlayers.length) {
    throw new Error('Player copy count mismatch');
  }
  sourcePlayers.forEach((p, i) => {
    idMap.set(p.id, inserted[i].id as string);
  });
  return idMap;
}

async function insertAssignmentsCopy(
  targetWorkspaceId: string,
  sourcePlayers: Player[],
  idMap: Map<string, string>
): Promise<void> {
  const rows = sourcePlayers
    .map((p) => {
      const newId = idMap.get(p.id);
      if (!newId) return null;
      // Available = no row needed, but ranks/pins need a row with null squad.
      if (
        p.squad_team == null &&
        p.team_rank == null &&
        !p.available_pinned
      ) {
        return null;
      }
      return {
        workspace_id: targetWorkspaceId,
        player_id: newId,
        squad_team: p.squad_team,
        team_rank: p.team_rank,
        available_pinned: Boolean(p.available_pinned),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (rows.length === 0) return;
  const { error } = await supabase.from('player_assignments').insert(rows);
  if (error) throw error;
}

async function insertDepthAndSubsFromCache(
  targetRosterId: string,
  targetWorkspaceId: string,
  depthCache: RosterSnapshot['depthCache'],
  idMap: Map<string, string>
): Promise<void> {
  const depthRows: {
    roster_id: string;
    workspace_id: string;
    squad_team: SquadTeam;
    position_number: number;
    player_id: string;
    sort_order: number;
  }[] = [];
  const subRows: {
    roster_id: string;
    workspace_id: string;
    squad_team: SquadTeam;
    player_id: string;
    sort_order: number;
  }[] = [];

  for (const team of SQUAD_TEAMS) {
    const cache = depthCache[team.id];
    if (!cache) continue;
    for (const e of cache.depthEntries) {
      const playerId = idMap.get(e.player_id);
      if (!playerId) continue;
      depthRows.push({
        roster_id: targetRosterId,
        workspace_id: targetWorkspaceId,
        squad_team: e.squad_team,
        position_number: e.position_number,
        player_id: playerId,
        sort_order: e.sort_order,
      });
    }
    for (const e of cache.subEntries) {
      const playerId = idMap.get(e.player_id);
      if (!playerId) continue;
      subRows.push({
        roster_id: targetRosterId,
        workspace_id: targetWorkspaceId,
        squad_team: e.squad_team,
        player_id: playerId,
        sort_order: e.sort_order,
      });
    }
  }

  if (depthRows.length > 0) {
    const { error } = await supabase
      .from('depth_chart_entries')
      .insert(depthRows);
    if (error) throw error;
  }
  if (subRows.length > 0) {
    const { error } = await supabase.from('sub_order_entries').insert(subRows);
    if (error) throw error;
  }
}

async function copyDepthSubsFromServer(
  sourceRosterId: string,
  sourceWorkspaceId: string,
  targetRosterId: string,
  targetWorkspaceId: string,
  idMap: Map<string, string>
): Promise<void> {
  const depthCache: RosterSnapshot['depthCache'] = {};
  for (const team of SQUAD_TEAMS) {
    const [depthEntries, subEntries] = await Promise.all([
      listDepthChartEntries(sourceRosterId, team.id, sourceWorkspaceId),
      listSubOrderEntries(sourceRosterId, team.id, sourceWorkspaceId),
    ]);
    depthCache[team.id] = { depthEntries, subEntries };
  }
  await insertDepthAndSubsFromCache(
    targetRosterId,
    targetWorkspaceId,
    depthCache,
    idMap
  );
}

async function copyFormationsFromServer(
  sourceRosterId: string,
  targetRosterId: string,
  targetWorkspaceId: string,
  idMap: Map<string, string>
): Promise<void> {
  for (const team of SQUAD_TEAMS) {
    let rows: Awaited<ReturnType<typeof listFormationAssignments>>;
    try {
      rows = await listFormationAssignments(sourceRosterId, team.id);
    } catch {
      continue;
    }
    if (rows.length === 0) continue;
    const payload = rows
      .map((f) => {
        const playerId = idMap.get(f.player_id);
        if (!playerId) return null;
        return {
          roster_id: targetRosterId,
          workspace_id: targetWorkspaceId,
          squad_team: team.id,
          player_id: playerId,
          slot_number: f.slot_number,
          depth_order: f.depth_order,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (payload.length === 0) continue;
    const { error } = await supabase
      .from('formation_assignments')
      .insert(payload);
    if (error) {
      // Older rows may omit workspace_id — retry without it.
      const legacy = payload.map(
        ({ workspace_id: _w, ...rest }) => rest
      );
      const { error: err2 } = await supabase
        .from('formation_assignments')
        .insert(legacy);
      if (err2) {
        console.warn('formation copy skipped:', err2.message);
      }
    }
  }
}

/** Copy a live Supabase roster into a new team; caller becomes owner/Admin. */
export async function copyRosterFromServer(params: {
  sourceRosterId: string;
  newName: string;
  ownerUserId: string;
}): Promise<Roster> {
  const sourceWorkspaces = await listRosterWorkspaces(params.sourceRosterId);
  const sourceShared = getSharedWorkspace(sourceWorkspaces);
  if (!sourceShared) {
    throw new Error('Source team has no shared workspace');
  }

  const created = await createRoster(params.newName, params.ownerUserId);
  const targetWorkspaceId = await waitForSharedWorkspace(created.id);

  const players = await listPlayers(params.sourceRosterId, sourceShared.id);
  const idMap = await insertPlayersCopy(created.id, players);
  await insertAssignmentsCopy(targetWorkspaceId, players, idMap);
  await copyDepthSubsFromServer(
    params.sourceRosterId,
    sourceShared.id,
    created.id,
    targetWorkspaceId,
    idMap
  );
  await copyFormationsFromServer(
    params.sourceRosterId,
    created.id,
    targetWorkspaceId,
    idMap
  );

  return created;
}

/** Copy from an offline snapshot (device state) into a new team. */
export async function copyRosterFromSnapshot(params: {
  snapshot: RosterSnapshot;
  newName: string;
  ownerUserId: string;
}): Promise<Roster> {
  const created = await createRoster(params.newName, params.ownerUserId);
  const targetWorkspaceId = await waitForSharedWorkspace(created.id);

  const players = params.snapshot.players;
  const idMap = await insertPlayersCopy(created.id, players);
  await insertAssignmentsCopy(targetWorkspaceId, players, idMap);
  await insertDepthAndSubsFromCache(
    created.id,
    targetWorkspaceId,
    params.snapshot.depthCache,
    idMap
  );

  return created;
}

export function defaultCopyName(sourceName: string): string {
  const base = sourceName.trim() || 'Team';
  return `${base} (copy)`;
}

export function defaultOfflineCopyName(sourceName: string): string {
  const base = sourceName.trim() || 'Team';
  const d = new Date();
  const stamp = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${base} (offline ${stamp})`;
}
