-- Aggiornamento 1: segnalibro di sincronizzazione scritto dal server.
-- Da eseguire UNA volta nell'editor SQL di Supabase se le tabelle erano
-- state create con la prima versione di schema.sql. Idempotente.
-- (schema.sql aggiornato contiene già tutto questo: eseguire quello è equivalente.)

alter table public.impegni  add column if not exists sincronizzato_il timestamptz not null default now();
alter table public.chiusure add column if not exists sincronizzato_il timestamptz not null default now();

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
