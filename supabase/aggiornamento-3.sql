-- Aggiornamento 3: impegni "entro una data" (scadenze).
-- Da eseguire UNA volta nell'editor SQL di Supabase. Idempotente.
-- Senza, l'app sincronizza comunque tutto tranne il contrassegno di scadenza
-- e mostra l'avviso "Il database va aggiornato per le scadenze".

alter table public.impegni add column if not exists scadenza boolean not null default false;
