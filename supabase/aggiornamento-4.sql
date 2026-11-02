-- Aggiornamento 4: notifiche push.
-- Da eseguire UNA volta nell'editor SQL di Supabase, DOPO aver pubblicato la
-- Edge Function "notifiche" (vedi README, sezione Notifiche). Idempotente.

-- Notifiche push: dispositivi registrati e registro di ciò che è già partito.
create table if not exists public.push_abbonamenti (
  endpoint      text primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh        text not null,
  auth          text not null,
  dispositivo   text,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index if not exists push_abbonamenti_user on public.push_abbonamenti (user_id);

create table if not exists public.notifiche_inviate (
  user_id    uuid not null references auth.users(id) on delete cascade,
  chiave     text not null,
  inviata_il timestamptz not null default now(),
  primary key (user_id, chiave)
);

alter table public.push_abbonamenti  enable row level security;
alter table public.notifiche_inviate enable row level security;  -- la usa solo il server
grant select, insert, update, delete on table public.push_abbonamenti to authenticated;
drop policy if exists "push: proprietario" on public.push_abbonamenti;
create policy "push: proprietario" on public.push_abbonamenti
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Estensioni per il controllo programmato. Se queste due righe danno errore,
-- attiva pg_cron e pg_net da Database → Extensions e riesegui il resto.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Ogni minuto chiama la funzione "notifiche" (autenticata con la chiave anon del progetto).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'notifiche-impegni') then
    perform cron.unschedule('notifiche-impegni');
  end if;
end $$;

select cron.schedule(
  'notifiche-impegni',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://siifawqmapfdybhvyeyi.supabase.co/functions/v1/notifiche',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpaWZhd3FtYXBmZHliaHZ5ZXlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTM0ODQsImV4cCI6MjEwNjU4OTQ4NH0.DO905PmXOvOzBKVH1HJT-DPa-kDNHeDHSH78EkZdzKM'
    ),
    body    := '{"cron": true}'::jsonb
  );
  $$
);
