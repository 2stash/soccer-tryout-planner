-- Must run (and commit) before 016: Postgres forbids using a new enum value
-- in the same transaction that adds it.
do $$ begin
  alter type public.workspace_kind add value 'shared';
exception
  when duplicate_object then null;
end $$;
