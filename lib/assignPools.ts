import type { Player, PlayerAssignment } from '@/lib/types';
import { UNAVAILABLE_POOL } from '@/lib/types';

/** Ranked assign pools (star / ↑↓ / sort). */
export type RankPool = 'available' | 'unavailable';

export function assignmentForRankPool(
  pool: RankPool
): PlayerAssignment | null {
  return pool === 'unavailable' ? UNAVAILABLE_POOL : null;
}

export function rankPoolForPlayer(player: Player): RankPool | null {
  if (player.squad_team == null) return 'available';
  if (player.squad_team === UNAVAILABLE_POOL) return 'unavailable';
  return null;
}

export function playersInRankPool(
  players: Player[],
  pool: RankPool
): Player[] {
  if (pool === 'unavailable') {
    return players.filter((p) => p.squad_team === UNAVAILABLE_POOL);
  }
  return players.filter((p) => p.squad_team == null);
}

export function rankPoolLabel(pool: RankPool): string {
  return pool === 'unavailable' ? 'Unavailable' : 'Available';
}
