// @ts-nocheck
// FILE GENERATO da sorgente.ts con scripts/costruisci-funzione.sh: non modificare a mano.
// Supabase Edge Function "notifiche": manda le notifiche push dell'app Impegni.
// Secrets richiesti: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// deno-lint-ignore-file

// supabase/functions/notifiche/sorgente.ts
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// app/js/frasi.js
var contatore = 0;
var f = (momento, testo, quando) => ({ id: `b${++contatore}`, momento, testo, quando });
var BASE = [
  // --- apertura: generiche -------------------------------------------------
  f("apertura", "Nuovo giorno, nuove cose da spuntare. Il caff\xE8 \xE8 facoltativo, la lista no."),
  f("apertura", "Oggi hai {n} impegni e una sola regola: uno alla volta, come le patatine. Ok, non come le patatine."),
  f("apertura", "La lista non si spunta da sola. Ci ho provato, non funziona."),
  f("apertura", "Ricorda: ogni impegno spuntato \xE8 un piccolo applauso che ti fai da solo. Nessuno ti giudica."),
  f("apertura", "Sei qui, hai aperto l'app: statisticamente gi\xE0 meglio della maggior parte delle persone."),
  f("apertura", "Procrastinare \xE8 un'arte, ma oggi facciamo gli artigiani: cose concrete, una dopo l'altra."),
  f("apertura", "Pensa a quanto sar\xE0 soddisfacente stasera vedere tutto spuntato. Ecco, parti da l\xEC."),
  f("apertura", "Non devi fare tutto subito. Devi solo iniziare dalla prima riga. Il resto segue."),
  f("apertura", "Giornata nuova, scuse vecchie. Lasciamole nel cassetto e andiamo."),
  f("apertura", "Il segreto \xE8 fare il primo impegno prima di pensare al secondo. Semplice, no?"),
  // --- apertura: situazioni ---------------------------------------------------
  f("apertura", "Giornata piena: {n} impegni. Respira, prendi la lista e mangiali uno alla volta.", ["piena"]),
  f("apertura", "{n} impegni oggi. Niente panico: le liste lunghe hanno un lato buono, danno pi\xF9 soddisfazione a svuotarle.", ["piena"]),
  f("apertura", "Oggi si corre: {n} cose in lista. Se ne spunti anche solo met\xE0, sei gi\xE0 un eroe della logistica.", ["piena"]),
  f("apertura", "Giornata leggera: {n} impegni soltanto. Finiscili presto e poi goditi il senso di superiorit\xE0.", ["leggera"]),
  f("apertura", "Solo {n} cose oggi. Pi\xF9 che una lista \xE8 un suggerimento. Suggerimento accettato?", ["leggera"]),
  f("apertura", "Ieri tutto fatto. Oggi hai una reputazione da difendere, sai com'\xE8.", ["ieri_bene"]),
  f("apertura", "Ieri hai spuntato tutto. Confermo: sei in uno stato di grazia. Non sprecarlo.", ["ieri_bene"]),
  f("apertura", "Ieri non \xE8 andata benissimo, ma la lista \xE8 magnanima e perdona. Oggi si riparte.", ["ieri_male"]),
  f("apertura", "Ieri cos\xEC cos\xEC. Succede ai migliori, e tu sei tra i migliori. Dimostramelo oggi.", ["ieri_male"]),
  f("apertura", "Hai qualche arretrato che ti guarda storto. Fai pace con lui prima di tutto il resto.", ["arretrati"]),
  f("apertura", "Gli arretrati non si offendono, ma pesano. Uno spuntato subito e ti senti gi\xE0 pi\xF9 leggero.", ["arretrati"]),
  f("apertura", "Weekend! Gli impegni di oggi sono quelli che ti fanno sentire bene quando li finisci, non quelli che ti servono.", ["weekend"]),
  f("apertura", "\xC8 weekend, quindi facciamo le cose con calma. Ma facciamole.", ["weekend"]),
  f("apertura", "Buongiorno! Il letto era comodo, lo so. La lista per\xF2 \xE8 pi\xF9 soddisfacente.", ["mattina"]),
  f("apertura", "\xC8 sera: vediamo cosa manca e poi chiudiamo bottega con stile.", ["sera"]),
  // --- vuoto -------------------------------------------------------------------
  f("vuoto", "Niente in lista oggi. O sei organizzatissimo o ti sei dimenticato qualcosa. Scegli tu."),
  f("vuoto", "Zero impegni. Il divano ti attende, ma se vuoi aggiungere qualcosa il tasto \xE8 l\xEC sotto."),
  f("vuoto", "Lista vuota: oggi sei libero come un gatto. Fai quello che ti pare, con la stessa dignit\xE0."),
  f("vuoto", "Oggi niente da fare. Approfittane: domani la lista potrebbe tornare a vendicarsi."),
  f("vuoto", "Giornata libera. Se ti annoi, c'\xE8 sempre quella cosa che rimandi da settimane. Dico per dire."),
  // --- arretrati ----------------------------------------------------------------
  f("arretrati", "Questi sono rimasti indietro. Non giudicarli, spuntali o rimandali con onore."),
  f("arretrati", "Arretrati: le cose che ieri ti sembravano una buona idea. Oggi decidi tu che fine fanno."),
  f("arretrati", "Ogni arretrato rimandato con una data vera \xE8 un arretrato in meno. La matematica \xE8 dalla tua."),
  f("arretrati", "Non sono in ritardo, stanno solo aspettando il loro momento. Che potrebbe essere adesso."),
  // --- fatto -------------------------------------------------------------------
  f("fatto", "Fatto! Uno in meno, e suonava anche bene."),
  f("fatto", "Spuntato. Il tuo io di stasera ti ringrazia."),
  f("fatto", "Bravo. Ora non montarti la testa, ne restano {rimasti}."),
  f("fatto", "Eccolo l\xEC, un altro impegno che non ti infastidir\xE0 pi\xF9."),
  f("fatto", "Fatto. Senti quel piccolo click di soddisfazione? \xC8 tutto tuo."),
  f("fatto", "E via! Se continui cos\xEC finisci prima del previsto."),
  f("fatto", "Un altro fuori dalla lista. La lista comincia ad averne un po' paura."),
  f("fatto", "Ottimo lavoro. Pausa di tre secondi e poi il prossimo."),
  f("fatto", "Spuntato con eleganza. Nessuno ha visto, ma io s\xEC."),
  f("fatto", "Fatto! Ne restano {rimasti}. Non \xE8 una minaccia, \xE8 un incoraggiamento."),
  // --- fatto_alta ----------------------------------------------------------------
  f("fatto_alta", "Quello importante \xE8 fatto. Il resto della giornata \xE8 in discesa."),
  f("fatto_alta", "Priorit\xE0 alta spuntata! Questo valeva doppio, lo sanno tutti."),
  f("fatto_alta", "Il pezzo grosso \xE8 andato. Puoi camminare a testa alta fino a sera."),
  f("fatto_alta", "Impegno importante archiviato. Se ci fosse una fanfara, suonerebbe adesso."),
  f("fatto_alta", "Hai fatto la cosa difficile per prima. Chi sei, un manuale di produttivit\xE0?"),
  f("fatto_alta", "Alta priorit\xE0: fatta. Tutto il resto oggi \xE8 bonus."),
  // --- tutto_fatto ---------------------------------------------------------------
  f("tutto_fatto", "Tutto fatto per oggi! Ora puoi dire \xABsono stanco\xBB con la coscienza pulita."),
  f("tutto_fatto", "Lista spuntata per intero. Giornata da incorniciare, o almeno da raccontare."),
  f("tutto_fatto", "Hai finito tutto. Vai pure a vantartene con qualcuno, te lo sei meritato."),
  f("tutto_fatto", "Zero impegni rimasti. La lista \xE8 vuota, tu no: sei pieno di soddisfazione."),
  f("tutto_fatto", "Fatto tutto. Il resto della giornata \xE8 ufficialmente tempo libero certificato."),
  f("tutto_fatto", "Lista completata. Se fosse un videogioco, adesso partirebbero i titoli di coda."),
  // --- chiusura serale -------------------------------------------------------------
  f("chiusura_ok", "{fatti} su {totali}: giornata perfetta. Chiudi, spegni, goditi la sera."),
  f("chiusura_ok", "Tutto fatto, tutto chiuso. Domani la lista ti trover\xE0 riposato e pericoloso."),
  f("chiusura_ok", "Giornata piena di spunte. Il tuo io di domani ha gi\xE0 meno lavoro, ringrazialo."),
  f("chiusura_ok", "{fatti} su {totali}. Non so cosa aggiungere, sei stato impeccabile."),
  f("chiusura_ok", "Chiusura col botto: tutto spuntato. Il divano \xE8 un diritto acquisito."),
  f("chiusura_parziale", "{fatti} su {totali} \xE8 comunque un buon bottino. Il resto va a domani, che \xE8 un giorno ottimo."),
  f("chiusura_parziale", "Non tutto, ma tanto. Ci\xF2 che slitta a domani non \xE8 una sconfitta, \xE8 pianificazione."),
  f("chiusura_parziale", "{fatti} fatti, {rimasti} rimandati. Domani li guardi con occhi nuovi e li sistemi."),
  f("chiusura_parziale", "Giornata onesta: {fatti} su {totali}. Chi fa tutto ogni giorno probabilmente mente."),
  f("chiusura_parziale", "Hai fatto quello che potevi. Quello che non hai fatto ha gi\xE0 una nuova data. Pace."),
  f("chiusura_zero", "Oggi zero su {totali}. Succede. Domani ti rifai, e questa frase far\xE0 meno male."),
  f("chiusura_zero", "Giornata a vuoto. Capita a tutti, tranne a quelli che non fanno le liste. Tu sei migliore."),
  f("chiusura_zero", "Niente spuntato oggi. Riposa, resetta, e domani parti dal pi\xF9 facile."),
  f("chiusura_zero", "Oggi la lista ha vinto. Domani \xE8 un'altra partita, e tu conosci gi\xE0 l'avversario."),
  // --- serie ----------------------------------------------------------------------
  f("serie", "{serie} giorni di fila con tutto fatto. Non chiamarla fortuna, chiamala abitudine."),
  f("serie", "Serie di {serie} giorni. A questo punto \xE8 una questione d'onore."),
  f("serie", "{serie} giorni consecutivi. La costanza \xE8 noiosa solo per chi non ce l'ha."),
  f("serie", "{serie} di fila! Continua cos\xEC e dovremo inventare un premio."),
  f("serie", "Serie attiva: {serie} giorni. Non interromperla oggi, sarebbe un peccato.")
];
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
function riempi(testo, ctx) {
  return testo.replace(/\{(\w+)\}/g, (_, k) => ctx[k] !== void 0 && ctx[k] !== null ? String(ctx[k]) : "");
}
function scegliFrase(momento, ctx = {}, opzioni = {}) {
  const tags = new Set(ctx.tags || []);
  const nascoste = new Set(opzioni.nascoste || []);
  const tutte = [...BASE, ...opzioni.extra || []].filter((fr) => fr.momento === momento && !nascoste.has(fr.id));
  const specifiche = tutte.filter((fr) => fr.quando && fr.quando.every((t) => tags.has(t)));
  const generiche = tutte.filter((fr) => !fr.quando);
  if (!specifiche.length && !generiche.length) return "";
  const seed = opzioni.seed ?? String(Math.random());
  const r1 = hash(seed + ":pool");
  const pool = specifiche.length && (r1 < 0.7 || !generiche.length) ? specifiche : generiche;
  const r2 = hash(seed + ":idx");
  const scelta = pool[Math.floor(r2 * pool.length)];
  return riempi(scelta.testo, ctx);
}

// app/js/notifiche-logica.js
var NOTIFICHE_DEFAULT = {
  mattino: true,
  oraMattino: "07:30",
  // riepilogo della giornata
  promemoria: true,
  anticipo: 10,
  // minuti prima di un impegno con orario
  scadenze: true,
  oraScadenze: "18:00",
  // "ultimo giorno!" per le scadenze non fatte
  fuso: "Europe/Rome"
};
var FINESTRA_MINUTI = 10;
var GIORNI = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function oraLocale(adesso = /* @__PURE__ */ new Date(), fuso = "Europe/Rome") {
  const opzioni = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" };
  let f2;
  try {
    f2 = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, ...opzioni });
  } catch {
    f2 = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", ...opzioni });
  }
  const p = Object.fromEntries(f2.formatToParts(adesso).map((x) => [x.type, x.value]));
  return {
    oggi: `${p.year}-${p.month}-${p.day}`,
    minuti: Number(p.hour) % 24 * 60 + Number(p.minute),
    giornoSettimana: GIORNI.indexOf(p.weekday)
  };
}
function spostaGiorno(iso, n) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, g + n)).toISOString().slice(0, 10);
}
var minutiDi = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
var inFinestra = (target, adesso) => adesso - target >= 0 && adesso - target < FINESTRA_MINUTI;
var ordinePriorita = { Alta: 0, Media: 1, Bassa: 2 };
function ordina(lista) {
  return [...lista].sort((a, b) => {
    if ((a.ora || "") !== (b.ora || "")) {
      if (!a.ora) return 1;
      if (!b.ora) return -1;
      return a.ora < b.ora ? -1 : 1;
    }
    return (ordinePriorita[a.priorita] ?? 1) - (ordinePriorita[b.priorita] ?? 1);
  });
}
function pianifica({ adesso = /* @__PURE__ */ new Date(), notifiche = {}, impegni = [], inviate = /* @__PURE__ */ new Set(), impostazioni = {} } = {}) {
  const n = { ...NOTIFICHE_DEFAULT, ...notifiche };
  const { oggi, minuti, giornoSettimana } = oraLocale(adesso, n.fuso);
  const ieri = spostaGiorno(oggi, -1);
  const vivi = impegni.filter((i) => !i.eliminato);
  const daFare = ordina(vivi.filter((i) => i.data === oggi && !i.fatto));
  const scadenzeOggi = daFare.filter((i) => i.scadenza);
  const arretrati = vivi.filter((i) => !i.fatto && i.data < oggi).length;
  const out = [];
  if (n.mattino && inFinestra(minutiDi(n.oraMattino), minuti)) {
    const chiave = `mattino:${oggi}`;
    if (!inviate.has(chiave)) {
      const diIeri = vivi.filter((i) => i.data === ieri);
      const fattiIeri = diIeri.filter((i) => i.fatto).length;
      const tags = ["mattina"];
      if (daFare.length >= 5) tags.push("piena");
      if (daFare.length >= 1 && daFare.length <= 2) tags.push("leggera");
      if (diIeri.length && fattiIeri === diIeri.length) tags.push("ieri_bene");
      if (diIeri.length && fattiIeri / diIeri.length < 0.5) tags.push("ieri_male");
      if (arretrati) tags.push("arretrati");
      if (giornoSettimana >= 5) tags.push("weekend");
      const ctx = { tags, n: daFare.length, fatti: 0, totali: daFare.length, rimasti: daFare.length };
      const frase = scegliFrase(daFare.length || arretrati ? "apertura" : "vuoto", ctx, {
        extra: impostazioni.frasiExtra || [],
        nascoste: impostazioni.frasiNascoste || [],
        seed: `${oggi}:notifica`
      });
      const righe = daFare.slice(0, 4).map((i) => `${i.ora ? i.ora + " " : ""}${i.titolo}${i.scadenza ? " (entro oggi)" : ""}`);
      if (daFare.length > 4) righe.push(`+${daFare.length - 4} ${daFare.length - 4 === 1 ? "altro" : "altri"}`);
      const pezzi = [];
      if (righe.length) pezzi.push(righe.join(" \xB7 "));
      if (arretrati) pezzi.push(`${arretrati} ${arretrati === 1 ? "arretrato" : "arretrati"} da sistemare`);
      pezzi.push(frase);
      out.push({
        chiave,
        titolo: daFare.length ? `Buongiorno! ${daFare.length === 1 ? "1 impegno" : daFare.length + " impegni"} oggi` : "Buongiorno! Oggi niente in lista",
        corpo: pezzi.join("\n"),
        url: "./#/oggi",
        tag: "mattino"
      });
    }
  }
  if (n.promemoria) {
    const anticipo = Math.max(0, Number(n.anticipo) || 0);
    for (const i of daFare) {
      if (!i.ora) continue;
      if (!inFinestra(minutiDi(i.ora) - anticipo, minuti)) continue;
      const chiave = `impegno:${i.id}:${oggi}`;
      if (inviate.has(chiave)) continue;
      out.push({
        chiave,
        titolo: anticipo ? `Tra ${anticipo} minuti: ${i.titolo}` : `Adesso: ${i.titolo}`,
        corpo: [i.ora, i.tipo].filter(Boolean).join(" \xB7 ") + (i.note ? `
${String(i.note).slice(0, 120)}` : ""),
        url: "./#/oggi",
        tag: `impegno-${i.id}`
      });
    }
  }
  if (n.scadenze && scadenzeOggi.length && inFinestra(minutiDi(n.oraScadenze), minuti)) {
    for (const i of scadenzeOggi) {
      const chiave = `scadenza:${i.id}:${oggi}`;
      if (inviate.has(chiave)) continue;
      out.push({
        chiave,
        titolo: `Ultimo giorno! ${i.titolo}`,
        corpo: "Scade oggi e non \xE8 ancora spuntato. Forza, che poi ti senti meglio.",
        url: "./#/oggi",
        tag: `scadenza-${i.id}`
      });
    }
  }
  return out;
}

// supabase/functions/notifiche/sorgente.ts
var URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? "";
var CHIAVE_SERVIZIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CHIAVE_SERVIZIO") || "";
var CHIAVE_ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("CHIAVE_ANON") || "";
var VAPID_PUB = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
var VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
var VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:impegni@example.com";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (dati, status = 200) => new Response(JSON.stringify(dati), { status, headers: { ...CORS, "Content-Type": "application/json" } });
async function invia(admin, abb, n) {
  try {
    await webpush.sendNotification(
      { endpoint: abb.endpoint, keys: { p256dh: abb.p256dh, auth: abb.auth } },
      JSON.stringify({ titolo: n.titolo, corpo: n.corpo, url: n.url ?? "./#/oggi", tag: n.tag ?? "impegni" }),
      { TTL: 3600, urgency: "high" }
    );
    return true;
  } catch (e) {
    console.error("push fallita", abb.endpoint.slice(0, 48), e?.statusCode, e?.body ?? e?.message);
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await admin.from("push_abbonamenti").delete().eq("endpoint", abb.endpoint);
    }
    return false;
  }
}
async function inviaDettagliato(client, abb, n) {
  try {
    await webpush.sendNotification(
      { endpoint: abb.endpoint, keys: { p256dh: abb.p256dh, auth: abb.auth } },
      JSON.stringify({ titolo: n.titolo, corpo: n.corpo, url: n.url ?? "./#/oggi", tag: n.tag ?? "impegni" }),
      { TTL: 3600, urgency: "high" }
    );
    return true;
  } catch (e) {
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await client.from("push_abbonamenti").delete().eq("endpoint", abb.endpoint);
      return "dispositivo non pi\xF9 registrato presso Apple/Google: disattiva e riattiva le notifiche";
    }
    return `stato ${e?.statusCode ?? "?"}: ${String(e?.body ?? e?.message ?? e).slice(0, 200)}`;
  }
}
async function impegniDi(admin, userId, da, a) {
  const colonne = "id,titolo,data,ora,tipo,note,scadenza,priorita,fatto,eliminato";
  let r = await admin.from("impegni").select(colonne).eq("user_id", userId).eq("eliminato", false).gte("data", da).lte("data", a);
  if (r.error && /scadenza/i.test(r.error.message ?? "")) {
    r = await admin.from("impegni").select(colonne.replace("scadenza,", "")).eq("user_id", userId).eq("eliminato", false).gte("data", da).lte("data", a);
  }
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "Solo POST" }, 405);
  let corpo = {};
  try {
    corpo = await req.json();
  } catch {
    corpo = {};
  }
  if (corpo?.chiavePubblica) {
    if (!VAPID_PUB) return json({ errore: "Manca VAPID_PUBLIC_KEY nei secrets della funzione" }, 500);
    return json({ chiave: VAPID_PUB });
  }
  if (!VAPID_PUB || !VAPID_PRIV) return json({ errore: "Mancano VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nei secrets della funzione" }, 500);
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);
  const spiegaErroreDb = (msg) => /does not exist|schema cache/i.test(msg) ? "Tabella push_abbonamenti mancante: esegui supabase/aggiornamento-4.sql" : /api key|apikey|jwt|invalid|unauthorized/i.test(msg) ? `Chiave del database non valida nella funzione (${msg}). Aggiungi il secret CHIAVE_SERVIZIO con la chiave service_role (Project Settings \u2192 API).` : `Lettura del database fallita: ${msg}`;
  if (corpo?.prova) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const chiaveClient = CHIAVE_ANON || CHIAVE_SERVIZIO;
    if (!chiaveClient) return json({ errore: "Mancano SUPABASE_ANON_KEY e CHIAVE_ANON: aggiungi il secret CHIAVE_ANON con la chiave anon del progetto." }, 500);
    const comeUtente = createClient(URL_SUPABASE, chiaveClient, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await comeUtente.auth.getUser(token);
    if (error || !data?.user) return json({ errore: `Non autorizzato: ${error?.message ?? "token mancante"}` }, 401);
    const { data: abbonamenti2, error: eAbb } = await comeUtente.from("push_abbonamenti").select("*").eq("user_id", data.user.id);
    if (eAbb) return json({ errore: spiegaErroreDb(eAbb.message) }, 500);
    if (!abbonamenti2?.length) return json({ errore: "Nessun dispositivo registrato per questo account" }, 404);
    let inviate = 0;
    const errori = [];
    for (const a of abbonamenti2) {
      const esito2 = await inviaDettagliato(comeUtente, a, { titolo: "Funziona! \u{1F389}", corpo: "Le notifiche sono attive. Ci sentiamo domattina.", url: "./#/impostazioni", tag: "prova" });
      if (esito2 === true) inviate++;
      else errori.push(esito2);
    }
    if (!inviate) return json({ errore: `Invio fallito: ${errori.join(" | ")}` }, 502);
    return json({ ok: true, inviate, dispositivi: abbonamenti2.length, errori });
  }
  if (!CHIAVE_SERVIZIO) return json({ errore: "Manca la chiave di servizio: aggiungi il secret CHIAVE_SERVIZIO con la chiave service_role del progetto (Project Settings \u2192 API)." }, 500);
  const admin = createClient(URL_SUPABASE, CHIAVE_SERVIZIO, { auth: { persistSession: false } });
  const { data: abbonamenti, error: e1 } = await admin.from("push_abbonamenti").select("*");
  if (e1) return json({ errore: spiegaErroreDb(e1.message) }, 500);
  const perUtente = /* @__PURE__ */ new Map();
  for (const a of abbonamenti ?? []) {
    if (!perUtente.has(a.user_id)) perUtente.set(a.user_id, []);
    perUtente.get(a.user_id).push(a);
  }
  const adesso = /* @__PURE__ */ new Date();
  const esito = { utenti: perUtente.size, notifiche: 0, inviate: 0, errori: [] };
  for (const [userId, abbs] of perUtente) {
    try {
      const { data: imp } = await admin.from("impostazioni").select("dati").eq("user_id", userId).maybeSingle();
      const dati = imp?.dati ?? {};
      const notifiche = { ...NOTIFICHE_DEFAULT, ...dati.notifiche ?? {} };
      const { oggi } = oraLocale(adesso, notifiche.fuso);
      const impegni = await impegniDi(admin, userId, spostaGiorno(oggi, -61), spostaGiorno(oggi, 1));
      const { data: registro } = await admin.from("notifiche_inviate").select("chiave").eq("user_id", userId).gte("inviata_il", new Date(adesso.getTime() - 2 * 864e5).toISOString());
      const inviate = new Set((registro ?? []).map((r) => r.chiave));
      const daMandare = pianifica({ adesso, notifiche, impegni, inviate, impostazioni: dati });
      for (const n of daMandare) {
        const { error } = await admin.from("notifiche_inviate").insert({ user_id: userId, chiave: n.chiave });
        if (error) continue;
        esito.notifiche++;
        for (const abb of abbs) if (await invia(admin, abb, n)) esito.inviate++;
      }
    } catch (e) {
      console.error("utente", userId, e?.message ?? e);
      esito.errori.push(String(e?.message ?? e));
    }
  }
  await admin.from("notifiche_inviate").delete().lt("inviata_il", new Date(adesso.getTime() - 7 * 864e5).toISOString());
  return json({ ok: true, ...esito });
});
