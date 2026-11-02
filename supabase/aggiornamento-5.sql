-- Aggiornamento 5: da eseguire UNA volta nell'editor SQL di Supabase. Idempotente.

-- Permessi al server delle notifiche (ruolo service_role) e tabella di stato
-- del controllo automatico. In questo progetto le tabelle nuove non ricevono
-- privilegi automatici: senza queste righe il giro ogni minuto fallisce con
-- "permission denied".
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create table if not exists public.notifiche_stato (
  id          integer primary key default 1 check (id = 1),
  ultimo_giro timestamptz not null default now(),
  esito       jsonb not null default '{}'::jsonb
);
alter table public.notifiche_stato enable row level security;
grant select on table public.notifiche_stato to authenticated;
grant all on table public.notifiche_stato to service_role;
drop policy if exists "stato: lettura" on public.notifiche_stato;
create policy "stato: lettura" on public.notifiche_stato for select to authenticated using (true);
