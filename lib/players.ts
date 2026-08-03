import { supabase } from '@/lib/supabase';
import type { Player, PlayerAssignment, PlayerInput } from '@/lib/types';
import {
  formatPositionsShort,
  normalizePositions,
  sortPositionNumbers,
} from '@/lib/positions';
import { planAvailableRanksAfterImport } from '@/lib/availableRank';
import type { RealtimeChannel } from '@supabase/supabase-js';

type AssignmentRow = {
  player_id: string;
  squad_team: PlayerAssignment | null;
  team_rank: number | null;
  available_pinned: boolean;
};

function mapPlayer(
  row: Record<string, unknown>,
  assignment?: AssignmentRow | null
): Player {
  const positions = normalizePositions(row.positions);
  return {
    id: row.id as string,
    roster_id: row.roster_id as string,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    school_year: (row.school_year as string) ?? '',
    position:
      typeof row.position === 'string' && row.position
        ? row.position
        : formatPositionsShort(positions),
    positions,
    position_rank: (row.position_rank as number | null) ?? null,
    team_rank: assignment?.team_rank ?? null,
    available_pinned: Boolean(assignment?.available_pinned),
    squad_team: assignment?.squad_team ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function toDbPayload(input: PlayerInput) {
  const positions = sortPositionNumbers(input.positions);
  return {
    first_name: input.first_name,
    last_name: input.last_name,
    school_year: input.school_year,
    positions,
    position: formatPositionsShort(positions),
    position_rank: input.position_rank,
    // team_rank on players is legacy; overlays own ranking.
    team_rank: null,
  };
}

async function listAssignments(
  workspaceId: string
): Promise<Map<string, AssignmentRow>> {
  const { data, error } = await supabase
    .from('player_assignments')
    .select('player_id, squad_team, team_rank, available_pinned')
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  const map = new Map<string, AssignmentRow>();
  for (const row of data ?? []) {
    map.set(row.player_id as string, {
      player_id: row.player_id as string,
      squad_team: (row.squad_team as PlayerAssignment | null) ?? null,
      team_rank: (row.team_rank as number | null) ?? null,
      available_pinned: Boolean(row.available_pinned),
    });
  }
  return map;
}

async function upsertAssignment(
  workspaceId: string,
  playerId: string,
  patch: {
    squad_team?: PlayerAssignment | null;
    team_rank?: number | null;
    available_pinned?: boolean;
  }
): Promise<AssignmentRow> {
  const { data: existing, error: readError } = await supabase
    .from('player_assignments')
    .select('player_id, squad_team, team_rank, available_pinned')
    .eq('workspace_id', workspaceId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (readError) throw readError;

  const next: AssignmentRow = {
    player_id: playerId,
    squad_team:
      'squad_team' in patch
        ? (patch.squad_team ?? null)
        : ((existing?.squad_team as PlayerAssignment | null) ?? null),
    team_rank:
      'team_rank' in patch
        ? (patch.team_rank ?? null)
        : ((existing?.team_rank as number | null) ?? null),
    available_pinned:
      'available_pinned' in patch
        ? Boolean(patch.available_pinned)
        : Boolean(existing?.available_pinned),
  };

  const { error } = await supabase.from('player_assignments').upsert(
    {
      workspace_id: workspaceId,
      player_id: playerId,
      squad_team: next.squad_team,
      team_rank: next.team_rank,
      available_pinned: next.available_pinned,
    },
    { onConflict: 'workspace_id,player_id' }
  );
  if (error) throw error;
  return next;
}

export async function listPlayers(
  rosterId: string,
  workspaceId: string
): Promise<Player[]> {
  const [{ data, error }, assignments] = await Promise.all([
    supabase
      .from('players')
      .select('*')
      .eq('roster_id', rosterId)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true }),
    listAssignments(workspaceId),
  ]);

  if (error) throw error;
  return (data ?? []).map((row) =>
    mapPlayer(
      row as Record<string, unknown>,
      assignments.get((row as { id: string }).id)
    )
  );
}

export async function getPlayer(
  id: string,
  workspaceId?: string
): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!workspaceId) {
    return mapPlayer(data as Record<string, unknown>, null);
  }
  const assignments = await listAssignments(workspaceId);
  return mapPlayer(
    data as Record<string, unknown>,
    assignments.get(id)
  );
}

export async function createPlayer(
  rosterId: string,
  input: PlayerInput
): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .insert({ roster_id: rosterId, ...toDbPayload(input) })
    .select('*')
    .single();

  if (error) throw error;
  // No assignment row yet → Available in every workspace.
  return mapPlayer(data as Record<string, unknown>, null);
}

export async function updatePlayer(
  id: string,
  input: PlayerInput,
  workspaceId?: string
): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update(toDbPayload(input))
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  if (!workspaceId) {
    return mapPlayer(data as Record<string, unknown>, null);
  }
  const assignments = await listAssignments(workspaceId);
  return mapPlayer(
    data as Record<string, unknown>,
    assignments.get(id)
  );
}

export async function deletePlayer(id: string): Promise<void> {
  const { error } = await supabase.from('players').delete().eq('id', id);
  if (error) throw error;
}

export async function setPlayerSquadTeam(
  id: string,
  squadTeam: PlayerAssignment | null,
  workspaceId: string
): Promise<Player> {
  const assignment = await upsertAssignment(workspaceId, id, {
    squad_team: squadTeam,
  });
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return mapPlayer(data as Record<string, unknown>, assignment);
}

export async function setPlayerPositions(
  id: string,
  positions: number[],
  workspaceId: string
): Promise<Player> {
  const next = sortPositionNumbers(positions);
  const { data, error } = await supabase
    .from('players')
    .update({
      positions: next,
      position: formatPositionsShort(next),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  const assignments = await listAssignments(workspaceId);
  return mapPlayer(
    data as Record<string, unknown>,
    assignments.get(id)
  );
}

/** Single round-trip when squad and/or positions both need to change. */
export async function patchPlayer(
  id: string,
  patch: {
    squad_team?: PlayerAssignment | null;
    positions?: number[];
    team_rank?: number | null;
    available_pinned?: boolean;
  },
  workspaceId: string
): Promise<Player> {
  const identity: Record<string, unknown> = {};
  if (patch.positions) {
    const next = sortPositionNumbers(patch.positions);
    identity.positions = next;
    identity.position = formatPositionsShort(next);
  }

  let row: Record<string, unknown>;
  if (Object.keys(identity).length > 0) {
    const { data, error } = await supabase
      .from('players')
      .update(identity)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    row = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    row = data as Record<string, unknown>;
  }

  const needsAssignment =
    'squad_team' in patch ||
    'team_rank' in patch ||
    'available_pinned' in patch;

  let assignment: AssignmentRow | null | undefined;
  if (needsAssignment) {
    const assignmentPatch: {
      squad_team?: PlayerAssignment | null;
      team_rank?: number | null;
      available_pinned?: boolean;
    } = {};
    if ('squad_team' in patch) assignmentPatch.squad_team = patch.squad_team ?? null;
    if ('team_rank' in patch) assignmentPatch.team_rank = patch.team_rank ?? null;
    if ('available_pinned' in patch) {
      assignmentPatch.available_pinned = Boolean(patch.available_pinned);
    }
    assignment = await upsertAssignment(workspaceId, id, assignmentPatch);
  } else {
    const map = await listAssignments(workspaceId);
    assignment = map.get(id);
  }

  return mapPlayer(row, assignment);
}

export type AvailableRankWrite = {
  playerId: string;
  team_rank: number;
  available_pinned?: boolean;
};

/**
 * Persist Available pool ranks (and optional pin flags) for a workspace.
 * One read + one upsert batch — not N sequential round-trips.
 */
export async function setPlayerTeamRanks(
  ranks: AvailableRankWrite[],
  workspaceId: string
): Promise<void> {
  if (ranks.length === 0) return;

  const ids = ranks.map((r) => r.playerId);
  const { data: existing, error: readError } = await supabase
    .from('player_assignments')
    .select('player_id, squad_team')
    .eq('workspace_id', workspaceId)
    .in('player_id', ids);

  if (readError) throw readError;

  const squadById = new Map<string, PlayerAssignment | null>();
  for (const row of existing ?? []) {
    squadById.set(
      row.player_id as string,
      (row.squad_team as PlayerAssignment | null) ?? null
    );
  }

  const payload = ranks.map((row) => ({
    workspace_id: workspaceId,
    player_id: row.playerId,
    squad_team: squadById.get(row.playerId) ?? null,
    team_rank: row.team_rank,
    available_pinned: Boolean(row.available_pinned),
  }));

  const { error } = await supabase
    .from('player_assignments')
    .upsert(payload, { onConflict: 'workspace_id,player_id' });
  if (error) throw error;
}

export async function bulkInsertPlayers(
  rosterId: string,
  rows: PlayerInput[],
  workspaceId: string
): Promise<Player[]> {
  if (rows.length === 0) return [];

  // Seed Available by class then name after insert — ignore sheet team_rank.
  const payload = rows.map((row) => ({
    roster_id: rosterId,
    ...toDbPayload({ ...row, team_rank: null }),
  }));
  const { data, error } = await supabase
    .from('players')
    .insert(payload)
    .select('*');

  if (error) throw error;
  const inserted = (data ?? []).map((row) =>
    mapPlayer(row as Record<string, unknown>, null)
  );
  const newIds = new Set(inserted.map((p) => p.id));

  const all = await listPlayers(rosterId, workspaceId);
  const available = all.filter((p) => !p.squad_team);
  const planned = planAvailableRanksAfterImport({
    available,
    newPlayerIds: newIds,
  });
  await setPlayerTeamRanks(planned, workspaceId);

  const rankById = new Map(planned.map((r) => [r.playerId, r]));
  return inserted.map((p) => {
    const row = rankById.get(p.id);
    if (!row) return p;
    return {
      ...p,
      team_rank: row.team_rank,
      available_pinned: row.available_pinned,
    };
  });
}

/** Load player rows by id (no workspace assignment overlay). */
export async function fetchPlayersByIds(
  ids: string[]
): Promise<Map<string, Player>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const byId = new Map<string, Player>();
  if (unique.length === 0) return byId;

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .in('id', unique);

  if (error) throw error;
  for (const row of data ?? []) {
    const player = mapPlayer(row as Record<string, unknown>, null);
    byId.set(player.id, player);
  }
  return byId;
}

export function subscribeToPlayers(
  rosterId: string,
  workspaceId: string,
  onChange: () => void
): RealtimeChannel {
  const topic = `players:roster:${rosterId}:${workspaceId}:${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'players',
        filter: `roster_id=eq.${rosterId}`,
      },
      () => onChange()
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'player_assignments',
        filter: `workspace_id=eq.${workspaceId}`,
      },
      () => onChange()
    )
    .subscribe();
}

/**
 * Admin Live: watch identity + all three master assignment/depth/sub tables
 * so remote coach edits refresh the Live overlay.
 */
export function subscribeToLiveMasterRoster(
  rosterId: string,
  masterWorkspaceIds: string[],
  onChange: () => void
): RealtimeChannel {
  const idsKey = [...masterWorkspaceIds].sort().join(',');
  const topic = `live-roster:${rosterId}:${idsKey}:${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  let channel = supabase.channel(topic).on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'players',
      filter: `roster_id=eq.${rosterId}`,
    },
    () => onChange()
  );

  for (const workspaceId of masterWorkspaceIds) {
    for (const table of [
      'player_assignments',
      'depth_chart_entries',
      'sub_order_entries',
    ] as const) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => onChange()
      );
    }
  }

  return channel.subscribe();
}

export async function unsubscribePlayers(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
