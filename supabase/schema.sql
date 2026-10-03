-- Schema per la sincronizzazione dell'app Impegni.
-- Incolla tutto nell'editor SQL di Supabase ed esegui una volta sola.
-- È idempotente: rieseguirlo non fa danni.

create table if not exists public.impegni (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titolo           text not null,
  data             date not null,
  ora              text,
  priorita         text not null default 'Media',
  tipo             text not null default 'Personale',
  note             text,
  ricorrenza       jsonb,
  serie_id         uuid,
  prossimo_creato  uuid,
  fatto            boolean not null default false,
  fatto_il         timestamptz,
  eliminato        boolean not null default false,
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now(),
  sincronizzato_il timestamptz not null default now()
);

create table if not exists public.chiusure (
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data             date not null,
  fatti            integer not null default 0,
  totali           integer not null default 0,
  slittati         integer not null default 0,
  chiusa_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now(),
  sincronizzato_il timestamptz not null default now(),
  primary key (user_id, data)
);

create table if not exists public.impostazioni (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  dati          jsonb not null default '{}'::jsonb,
  aggiornato_il timestamptz not null default now()
);

-- Per chi ha creato le tabelle con una versione precedente dello schema.
alter table public.impegni  add column if not exists sincronizzato_il timestamptz not null default now();
alter table public.chiusure add column if not exists sincronizzato_il timestamptz not null default now();

-- sincronizzato_il è scritto dal server a ogni insert/update: è il
-- "segnalibro" con cui l'app scarica solo le novità, indipendente dagli
-- orologi dei dispositivi.
create or replace function public.tocca_sincronizzato_il()
returns trigger language plpgsql as $$
begin
  new.sincronizzato_il = now();
  return new;
end $$;

drop trigger if exists impegni_sincronizzato on public.impegni;
create trigger impegni_sincronizzato
  before insert or update on public.impegni
  for each row execute function public.tocca_sincronizzato_il();

drop trigger if exists chiusure_sincronizzato on public.chiusure;
create trigger chiusure_sincronizzato
  before insert or update on public.chiusure
  for each row execute function public.tocca_sincronizzato_il();

create index if not exists impegni_user_sync  on public.impegni  (user_id, sincronizzato_il);
create index if not exists chiusure_user_sync on public.chiusure (user_id, sincronizzato_il);

-- Sicurezza per riga: ognuno vede e tocca solo le proprie righe.
alter table public.impegni      enable row level security;
alter table public.chiusure     enable row level security;
alter table public.impostazioni enable row level security;

drop policy if exists "impegni: proprietario" on public.impegni;
create policy "impegni: proprietario" on public.impegni
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "chiusure: proprietario" on public.chiusure;
create policy "chiusure: proprietario" on public.chiusure
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "impostazioni: proprietario" on public.impostazioni;
create policy "impostazioni: proprietario" on public.impostazioni
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
