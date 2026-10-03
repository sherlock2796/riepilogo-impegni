-- Schema per la sincronizzazione dell'app Impegni.
-- Incolla tutto nell'editor SQL di Supabase ed esegui una volta sola.

create table if not exists public.impegni (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titolo          text not null,
  data            date not null,
  ora             text,
  priorita        text not null default 'Media',
  tipo            text not null default 'Personale',
  note            text,
  ricorrenza      jsonb,
  serie_id        uuid,
  prossimo_creato uuid,
  fatto           boolean not null default false,
  fatto_il        timestamptz,
  eliminato       boolean not null default false,
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz not null default now()
);
create index if not exists impegni_user_agg on public.impegni (user_id, aggiornato_il);

create table if not exists public.chiusure (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data          date not null,
  fatti         integer not null default 0,
  totali        integer not null default 0,
  slittati      integer not null default 0,
  chiusa_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  primary key (user_id, data)
);

create table if not exists public.impostazioni (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  dati          jsonb not null default '{}'::jsonb,
  aggiornato_il timestamptz not null default now()
);

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
