import { supabase } from '@/lib/supabase';

/** Swap two rows' sort_order values via a temporary value to avoid unique conflicts. */
export async function swapSortOrders(
  table: 'depth_chart_entries' | 'sub_order_entries',
  a: { id: string; sort_order: number },
  b: { id: string; sort_order: number }
): Promise<void> {
  const aOrder = a.sort_order;
  const bOrder = b.sort_order;

  const { error: e1 } = await supabase
    .from(table)
    .update({ sort_order: 1000 + aOrder })
    .eq('id', a.id);
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from(table)
    .update({ sort_order: aOrder })
    .eq('id', b.id);
  if (e2) throw e2;

  const { error: e3 } = await supabase
    .from(table)
    .update({ sort_order: bOrder })
    .eq('id', a.id);
  if (e3) throw e3;
}
