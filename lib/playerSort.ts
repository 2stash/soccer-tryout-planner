import type { Player } from '@/lib/types';

export function comparePlayersByName(a: Player, b: Player): number {
  const last = (a.last_name ?? '').localeCompare(b.last_name ?? '');
  if (last !== 0) return last;
  return (a.first_name ?? '').localeCompare(b.first_name ?? '');
}

/** Order players by sort_order entries; append any leftovers (optionally by name). */
export function orderPlayersBySortEntries(
  players: Player[],
  entries: { player_id: string; sort_order: number }[],
  options?: { sortLeftoversByName?: boolean }
): Player[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ordered: Player[] = [];
  const seen = new Set<string>();

  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  for (const entry of sorted) {
    const player = byId.get(entry.player_id);
    if (player && !seen.has(player.id)) {
      ordered.push(player);
      seen.add(player.id);
    }
  }

  const leftovers = players.filter((p) => !seen.has(p.id));
  if (options?.sortLeftoversByName) {
    leftovers.sort(comparePlayersByName);
  }
  ordered.push(...leftovers);
  return ordered;
}
