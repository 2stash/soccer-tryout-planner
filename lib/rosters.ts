import { supabase } from '@/lib/supabase';
import type { Roster } from '@/lib/types';

export async function listRosters(): Promise<Roster[]> {
  const { data, error } = await supabase
    .from('rosters')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Roster[];
}

export async function createRoster(name: string, ownerId: string): Promise<Roster> {
  const { data, error } = await supabase
    .from('rosters')
    .insert({ name: name.trim(), owner_id: ownerId })
    .select('*')
    .single();

  if (error) throw error;
  return data as Roster;
}

export async function getRoster(id: string): Promise<Roster | null> {
  const { data, error } = await supabase
    .from('rosters')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as Roster | null;
}

export async function deleteRoster(id: string): Promise<void> {
  const { error } = await supabase.from('rosters').delete().eq('id', id);
  if (error) throw error;
}
