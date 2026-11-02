// Supabase Edge Function "notifiche": manda le notifiche push dell'app Impegni.
//
// Viene chiamata:
//   - ogni minuto da pg_cron (vedi supabase/aggiornamento-4.sql), senza corpo;
//   - dall'app, con { "chiavePubblica": true } per avere la chiave pubblica VAPID;
//   - dall'app, con { "prova": true } e il token dell'utente, per la notifica di prova.
//
// Secrets da impostare nel pannello (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (es. "mailto:tu@esempio.it")
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già forniti dall'ambiente.
//
// Questo è il SORGENTE. Il file da incollare nel pannello è index.ts, generato
// con scripts/costruisci-funzione.sh: contiene già la logica di
// app/js/notifiche-logica.js e le frasi, perché il pannello di Supabase non
// accetta importazioni da indirizzi web qualsiasi.
// deno-lint-ignore-file no-explicit-any

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pianifica, NOTIFICHE_DEFAULT, oraLocale, spostaGiorno } from "../../../app/js/notifiche-logica.js";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? "";
const CHIAVE_SERVIZIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUB = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:impegni@example.com";

type Abbonamento = { endpoint: string; p256dh: string; auth: string; user_id: string };
type Notifica = { chiave?: string; titolo: string; corpo: string; url?: string; tag?: string };

// Intestazioni CORS: l'app chiama la funzione dal browser, che prima manda una
// richiesta OPTIONS di controllo e poi pretende queste intestazioni nella risposta.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function invia(admin: any, abb: Abbonamento, n: Notifica): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: abb.endpoint, keys: { p256dh: abb.p256dh, auth: abb.auth } },
      JSON.stringify({ titolo: n.titolo, corpo: n.corpo, url: n.url ?? "./#/oggi", tag: n.tag ?? "impegni" }),
      { TTL: 3600, urgency: "high" },
    );
    return true;
  } catch (e: any) {
    console.error("push fallita", abb.endpoint.slice(0, 48), e?.statusCode, e?.body ?? e?.message);
    // 404/410: il dispositivo ha revocato l'abbonamento, lo dimentico.
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await admin.from("push_abbonamenti").delete().eq("endpoint", abb.endpoint);
    }
    return false;
  }
}

async function impegniDi(admin: any, userId: string, da: string, a: string) {
  const colonne = "id,titolo,data,ora,tipo,note,scadenza,priorita,fatto,eliminato";
  let r = await admin.from("impegni").select(colonne).eq("user_id", userId).eq("eliminato", false).gte("data", da).lte("data", a);
  if (r.error && /scadenza/i.test(r.error.message ?? "")) {
    // Database senza la colonna scadenza (aggiornamento-3 non eseguito): vado avanti senza.
    r = await admin.from("impegni").select(colonne.replace("scadenza,", "")).eq("user_id", userId).eq("eliminato", false).gte("data", da).lte("data", a);
  }
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "Solo POST" }, 405);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { corpo = {}; }

  // ---------------- l'app chiede la chiave pubblica per registrarsi ----------------
  if (corpo?.chiavePubblica) {
    if (!VAPID_PUB) return json({ errore: "Manca VAPID_PUBLIC_KEY nei secrets della funzione" }, 500);
    return json({ chiave: VAPID_PUB });
  }

  if (!VAPID_PUB || !VAPID_PRIV) return json({ errore: "Mancano VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nei secrets della funzione" }, 500);
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);
  const admin = createClient(URL_SUPABASE, CHIAVE_SERVIZIO, { auth: { persistSession: false } });

  // ---------------- notifica di prova, richiesta dall'app ----------------
  if (corpo?.prova) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json({ errore: "Non autorizzato" }, 401);
    const { data: abbonamenti, error: eAbb } = await admin.from("push_abbonamenti").select("*").eq("user_id", data.user.id);
    if (eAbb) return json({ errore: /does not exist|schema cache/i.test(eAbb.message) ? "Tabella push_abbonamenti mancante: esegui supabase/aggiornamento-4.sql" : eAbb.message }, 500);
    if (!abbonamenti?.length) return json({ errore: "Nessun dispositivo registrato per questo account" }, 404);
    let inviate = 0;
    for (const a of abbonamenti as Abbonamento[]) {
      if (await invia(admin, a, { titolo: "Funziona! 🎉", corpo: "Le notifiche sono attive. Ci sentiamo domattina.", url: "./#/impostazioni", tag: "prova" })) inviate++;
    }
    return json({ ok: true, inviate, dispositivi: abbonamenti.length });
  }

  // ---------------- giro programmato (ogni minuto) ----------------
  const { data: abbonamenti, error: e1 } = await admin.from("push_abbonamenti").select("*");
  if (e1) return json({ errore: /does not exist|schema cache/i.test(e1.message) ? "Tabella push_abbonamenti mancante: esegui supabase/aggiornamento-4.sql" : e1.message }, 500);

  const perUtente = new Map<string, Abbonamento[]>();
  for (const a of (abbonamenti ?? []) as Abbonamento[]) {
    if (!perUtente.has(a.user_id)) perUtente.set(a.user_id, []);
    perUtente.get(a.user_id)!.push(a);
  }

  const adesso = new Date();
  const esito = { utenti: perUtente.size, notifiche: 0, inviate: 0, errori: [] as string[] };

  for (const [userId, abbs] of perUtente) {
    try {
      const { data: imp } = await admin.from("impostazioni").select("dati").eq("user_id", userId).maybeSingle();
      const dati = imp?.dati ?? {};
      const notifiche = { ...NOTIFICHE_DEFAULT, ...(dati.notifiche ?? {}) };
      const { oggi } = oraLocale(adesso, notifiche.fuso);
      const impegni = await impegniDi(admin, userId, spostaGiorno(oggi, -61), spostaGiorno(oggi, 1));

      const { data: registro } = await admin.from("notifiche_inviate").select("chiave").eq("user_id", userId)
        .gte("inviata_il", new Date(adesso.getTime() - 2 * 86400000).toISOString());
      const inviate = new Set<string>((registro ?? []).map((r: any) => r.chiave));

      const daMandare = pianifica({ adesso, notifiche, impegni, inviate, impostazioni: dati });
      for (const n of daMandare) {
        // Registro prima di spedire: se un altro giro parte in parallelo, niente doppioni.
        const { error } = await admin.from("notifiche_inviate").insert({ user_id: userId, chiave: n.chiave });
        if (error) continue;
        esito.notifiche++;
        for (const abb of abbs) if (await invia(admin, abb, n)) esito.inviate++;
      }
    } catch (e: any) {
      console.error("utente", userId, e?.message ?? e);
      esito.errori.push(String(e?.message ?? e));
    }
  }

  // Pulizia del registro: bastano pochi giorni.
  await admin.from("notifiche_inviate").delete().lt("inviata_il", new Date(adesso.getTime() - 7 * 86400000).toISOString());
  return json({ ok: true, ...esito });
});
