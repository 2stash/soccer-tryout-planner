import { supabase } from '@/lib/supabase';
import type { SquadTeam } from '@/lib/types';
import type { FormationAssignment } from '@/lib/formation';
import type { RealtimeChannel } from '@supabase/supabase-js';

export async function listFormationAssignments(
  rosterId: string,
  squadTeam: SquadTeam
): Promise<FormationAssignment[]> {
  const { data, error } = await supabase
    .from('formation_assignments')
    .select('*')
    .eq('roster_id', rosterId)
    .eq('squad_team', squadTeam)
    .order('slot_number', { ascending: true })
    .order('depth_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as FormationAssignment[];
}

export async function assignPlayerToSlot(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  slotNumber: number;
  playerId: string;
}): Promise<FormationAssignment> {
  const existing = await listFormationAssignments(params.rosterId, params.squadTeam);
  const inSlot = existing.filter((a) => a.slot_number === params.slotNumber);
  const nextDepth =
    inSlot.reduce((max, a) => Math.max(max, a.depth_order), 0) + 1;

  // Move if already placed elsewhere on this squad board
  const prior = existing.find((a) => a.player_id === params.playerId);
  if (prior) {
    const { data, error } = await supabase
      .from('formation_assignments')
      .update({
        slot_number: params.slotNumber,
        depth_order: nextDepth,
      })
      .eq('id', prior.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as FormationAssignment;
  }

  const { data, error } = await supabase
    .from('formation_assignments')
    .insert({
      roster_id: params.rosterId,
      squad_team: params.squadTeam,
      slot_number: params.slotNumber,
      player_id: params.playerId,
      depth_order: nextDepth,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as FormationAssignment;
}

export async function removeFormationAssignment(id: string): Promise<void> {
  const { error } = await supabase
    .from('formation_assignments')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export function subscribeToFormationAssignments(
  rosterId: string,
  squadTeam: SquadTeam,
  onChange: () => void
): RealtimeChannel {
  const topic = `formation:${rosterId}:${squadTeam}:${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'formation_assignments',
        filter: `roster_id=eq.${rosterId}`,
      },
      () => onChange()
    )
    .subscribe();
}

export async function unsubscribeFormation(
  channel: RealtimeChannel
): Promise<void> {
  await supabase.removeChannel(channel);
}
