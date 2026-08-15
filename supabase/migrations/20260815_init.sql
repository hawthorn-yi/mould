create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{"suppliers":[],"molds":[],"orders":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "anon_all_app_state" on public.app_state;
create policy "anon_all_app_state"
  on public.app_state
  for all
  using (true)
  with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.app_state to anon, authenticated, service_role;
