-- Per-day time trial finish times (milliseconds elapsed from Start).

alter table public.player_tryout_days
  add column if not exists time_trial_ms integer null;

alter table public.player_tryout_days
  drop constraint if exists player_tryout_days_time_trial_ms_check;

alter table public.player_tryout_days
  add constraint player_tryout_days_time_trial_ms_check
  check (time_trial_ms is null or time_trial_ms >= 0);
