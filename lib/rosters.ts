import { supabase } from '@/lib/supabase';
import type { Roster } from '@/lib/types';

export function mapRoster(row: Record<string, unknown> | null): Roster | null {
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    owner_id: row.owner_id as string,
    created_at: row.created_at as string,
    tryout_active: Boolean(row.tryout_active),
    tryout_day_count:
      row.tryout_day_count == null ? null : Number(row.tryout_day_count),
  };
}

export async function listRosters(): Promise<Roster[]> {
  const { data, error } = await supabase
    .from('rosters')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? [])
    .map((row) => mapRoster(row as Record<string, unknown>))
    .filter((r): r is Roster => Boolean(r));
}

export async function createRoster(name: string, ownerId: string): Promise<Roster> {
  const { data, error } = await supabase
    .from('rosters')
    .insert({ name: name.trim(), owner_id: ownerId })
    .select('*')
    .single();

  if (error) throw error;
  const roster = mapRoster(data as Record<string, unknown>);
  if (!roster) throw new Error('Failed to create roster');
  return roster;
}

export async function getRoster(id: string): Promise<Roster | null> {
  const { data, error } = await supabase
    .from('rosters')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return mapRoster(data as Record<string, unknown> | null);
}

export async function deleteRoster(id: string): Promise<void> {
  const { error } = await supabase.from('rosters').delete().eq('id', id);
  if (error) throw error;
}
