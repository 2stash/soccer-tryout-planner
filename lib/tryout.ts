import { supabase } from '@/lib/supabase';
import type { Player, PlayerTryoutDay, Roster } from '@/lib/types';

/** True if the player has attended at least one tryout day. */
export function playerAttendedAnyTryout(
  player: Pick<Player, 'tryout_days'>
): boolean {
  return (player.tryout_days ?? []).some((d) => d.attended);
}

export type TryoutDayPatch = {
  tryout_number?: number | null;
  attended?: boolean;
  time_trial_ms?: number | null;
};

function mapTryoutDay(row: Record<string, unknown>): PlayerTryoutDay {
  return {
    day: Number(row.day),
    tryout_number:
      row.tryout_number == null ? null : Number(row.tryout_number),
    attended: Boolean(row.attended),
    time_trial_ms:
      row.time_trial_ms == null ? null : Number(row.time_trial_ms),
  };
}

export async function startTryout(
  rosterId: string,
  dayCount: number
): Promise<Roster> {
  const n = Math.floor(dayCount);
  if (n < 1 || n > 5) {
    throw new Error('Tryout days must be between 1 and 5.');
  }
  const { data, error } = await supabase
    .from('rosters')
    .update({ tryout_active: true, tryout_day_count: n })
    .eq('id', rosterId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Roster;
}

export async function endTryout(rosterId: string): Promise<Roster> {
  const { data, error } = await supabase
    .from('rosters')
    .update({ tryout_active: false })
    .eq('id', rosterId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Roster;
}

/** Load tryout day rows for many players; returns map playerId → days. */
export async function listTryoutDaysForPlayers(
  playerIds: string[]
): Promise<Map<string, PlayerTryoutDay[]>> {
  const unique = [...new Set(playerIds.filter(Boolean))];
  const byPlayer = new Map<string, PlayerTryoutDay[]>();
  if (unique.length === 0) return byPlayer;

  const { data, error } = await supabase
    .from('player_tryout_days')
    .select('player_id, day, tryout_number, attended, time_trial_ms')
    .in('player_id', unique);

  if (error) throw error;

  for (const row of data ?? []) {
    const playerId = row.player_id as string;
    const list = byPlayer.get(playerId) ?? [];
    list.push(mapTryoutDay(row as Record<string, unknown>));
    byPlayer.set(playerId, list);
  }

  for (const [id, list] of byPlayer) {
    list.sort((a, b) => a.day - b.day);
    byPlayer.set(id, list);
  }
  return byPlayer;
}

export async function upsertTryoutDay(params: {
  playerId: string;
  day: number;
  patch: TryoutDayPatch;
}): Promise<PlayerTryoutDay> {
  const { playerId, day, patch } = params;
  if (day < 1 || day > 5) throw new Error('Invalid tryout day');

  const { data: existing, error: readError } = await supabase
    .from('player_tryout_days')
    .select('player_id, day, tryout_number, attended, time_trial_ms')
    .eq('player_id', playerId)
    .eq('day', day)
    .maybeSingle();
  if (readError) throw readError;

  const next = {
    player_id: playerId,
    day,
    tryout_number:
      'tryout_number' in patch
        ? patch.tryout_number ?? null
        : existing?.tryout_number == null
          ? null
          : Number(existing.tryout_number),
    attended:
      'attended' in patch
        ? Boolean(patch.attended)
        : Boolean(existing?.attended),
    time_trial_ms:
      'time_trial_ms' in patch
        ? patch.time_trial_ms ?? null
        : existing?.time_trial_ms == null
          ? null
          : Number(existing.time_trial_ms),
  };

  const { data, error } = await supabase
    .from('player_tryout_days')
    .upsert(next, { onConflict: 'player_id,day' })
    .select('day, tryout_number, attended, time_trial_ms')
    .single();
  if (error) throw error;
  return mapTryoutDay(data as Record<string, unknown>);
}

/** Clear time_trial_ms for many players on one day (single update). */
export async function clearTryoutDayTimes(params: {
  playerIds: string[];
  day: number;
}): Promise<void> {
  const { playerIds, day } = params;
  if (day < 1 || day > 5) throw new Error('Invalid tryout day');
  const unique = [...new Set(playerIds.filter(Boolean))];
  if (unique.length === 0) return;

  const { error } = await supabase
    .from('player_tryout_days')
    .update({ time_trial_ms: null })
    .eq('day', day)
    .in('player_id', unique);
  if (error) throw error;
}

/**
 * Set tryout number on `day`, then prepopulate later days (through dayCount)
 * that still have a null tryout_number.
 */
export async function setTryoutNumberWithPrepopulate(params: {
  playerId: string;
  day: number;
  tryoutNumber: number | null;
  dayCount: number;
}): Promise<PlayerTryoutDay[]> {
  const { playerId, day, tryoutNumber, dayCount } = params;
  const written: PlayerTryoutDay[] = [];

  written.push(
    await upsertTryoutDay({
      playerId,
      day,
      patch: { tryout_number: tryoutNumber },
    })
  );

  if (tryoutNumber == null) return written;

  const maxDay = Math.min(5, Math.max(1, dayCount));
  for (let d = day + 1; d <= maxDay; d++) {
    const { data: existing, error } = await supabase
      .from('player_tryout_days')
      .select('tryout_number')
      .eq('player_id', playerId)
      .eq('day', d)
      .maybeSingle();
    if (error) throw error;
    if (existing?.tryout_number != null) continue;
    written.push(
      await upsertTryoutDay({
        playerId,
        day: d,
        patch: { tryout_number: tryoutNumber },
      })
    );
  }

  return written;
}
