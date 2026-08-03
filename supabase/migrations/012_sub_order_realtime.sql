-- Sub order edits were watched in the client but never added to the publication.
do $$
begin
  alter publication supabase_realtime add table public.sub_order_entries;
exception
  when duplicate_object then null;
end $$;
