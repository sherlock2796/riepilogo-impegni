-- Aggiornamento 2: permessi del ruolo "authenticated" sulle tabelle.
-- Nei progetti Supabase recenti le tabelle nuove non ricevono automaticamente
-- i privilegi per gli utenti collegati: senza questi l'app mostra
-- "permission denied for table impegni". Idempotente.

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.impegni      to authenticated;
grant select, insert, update, delete on table public.chiusure     to authenticated;
grant select, insert, update, delete on table public.impostazioni to authenticated;
grant execute on function public.tocca_sincronizzato_il() to authenticated;
