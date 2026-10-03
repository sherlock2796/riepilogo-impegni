// Sincronizzazione con Supabase (accesso via link magico o codice email).
//
// Se config.js non ha URL e chiave, l'app resta solo locale e questo modulo
// non carica nemmeno la libreria. Quando si è collegati:
//   1. pull  -> righe cambiate sul server dopo l'ultima sync, fuse nello store
//   2. push  -> righe locali pendenti, upsert sul server
// Si ripete all'apertura, al ritorno in primo piano, al ritorno online e
// ogni due minuti.
//
// Il "segnalibro" dell'ultima sync usa la colonna sincronizzato_il, scritta
// dal server (trigger in supabase/schema.sql): così gli orologi dei vari
// dispositivi non contano. Per decidere chi vince in caso di conflitto si
// usa invece aggiornato_il del dispositivo (vince l'ultima modifica).

import * as store from "./store.js";

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const INTERVALLO_MS = 120000;
const PAGINA = 1000;

let client = null;
let utente = null;
let timer = null;
let promessaInit = null;
let promessaSync = null;
let richiestaInCoda = false;
let ascoltatoriGlobali = false;
let creaClientPersonalizzato = null; // usato solo dai test
const ascoltatori = new Set();

export const statoSync = { stato: "non-configurato", messaggio: "", utente: null, ultimaSync: null, recupero: false };

function emetti(patch) {
  Object.assign(statoSync, patch);
  for (const fn of ascoltatori) fn(statoSync);
}

export function subscribe(fn) {
  ascoltatori.add(fn);
  fn(statoSync);
  return () => ascoltatori.delete(fn);
}

export function configurato() {
  const c = globalThis.CONFIG || {};
  return !!(c.supabaseUrl && c.supabaseAnonKey && !c.supabaseUrl.includes("INSERISCI"));
}

// ------------------------------- avvio ---------------------------------------

async function caricaClient() {
  if (client) return client;
  if (creaClientPersonalizzato) {
    client = creaClientPersonalizzato();
    return client;
  }
  const { createClient } = await import(CDN);
  client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Avvia la sincronizzazione. Richiamabile: se la libreria non si era caricata, riprova. */
export function init() {
  if (!promessaInit) {
    promessaInit = _init().finally(() => { if (!client) promessaInit = null; });
  }
  return promessaInit;
}

async function _init() {
  if (!configurato()) { emetti({ stato: "non-configurato" }); return; }
  if (!ascoltatoriGlobali) {
    ascoltatoriGlobali = true;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) risveglia(); });
    window.addEventListener("online", risveglia);
    window.addEventListener("focus", risveglia);
  }
  try {
    await caricaClient();
  } catch (e) {
    console.error(e);
    emetti({ stato: "errore", messaggio: "Libreria di sincronizzazione non raggiungibile: riprovo appena c'è rete." });
    return;
  }

  client.auth.onAuthStateChange((evento, sessione) => {
    // Mai chiamare altre funzioni Supabase dentro questo callback: si rinvia al tick successivo.
    if (evento === "PASSWORD_RECOVERY") statoSync.recupero = true;
    setTimeout(() => impostaUtente(sessione?.user || null), 0);
  });
  const { data } = await client.auth.getSession();
  impostaUtente(data?.session?.user || null);

  if (/type=recovery/.test(location.hash)) emetti({ recupero: true });
  // Link scaduto o già usato: Supabase torna con #error=...&error_description=...
  const frammento = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (frammento.get("error_description") || frammento.get("error")) {
    const desc = frammento.get("error_description") || frammento.get("error") || "";
    emetti({ messaggio: traduci(desc.replace(/\+/g, " ")) });
  }
  // Pulisce il frammento lasciato dal link magico e torna alla vista Oggi.
  if (/access_token|refresh_token|error_description|error=/.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/oggi");
  }
}

function risveglia() {
  if (!client) { init(); return; }
  sincronizza();
}

function impostaUtente(u) {
  utente = u;
  clearInterval(timer);
  timer = null;
  if (!u) {
    emetti({ stato: "disconnesso", utente: null });
    return;
  }
  emetti({ stato: navigator.onLine ? "collegato" : "offline", utente: { email: u.email, id: u.id } });
  const info = store.infoSync();
  if (info.utenteId !== u.id) {
    // Nuovo account su questo dispositivo: spingo tutto il locale e riparto con il pull completo.
    store.aggiornaInfoSync({ utenteId: u.id, ultimaSyncImpegni: null, ultimaSyncChiusure: null, ultimaSyncImpostazioni: null });
    store.marcaTuttoPending();
  }
  sincronizza();
  timer = setInterval(sincronizza, INTERVALLO_MS);
  timer.unref?.();
}

// ------------------------------- accesso -------------------------------------

export async function inviaLink(email) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  const redirect = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirect, shouldCreateUser: true },
  });
  if (error) throw new Error(traduci(error.message));
}

export async function verificaCodice(email, codice) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token: codice.trim(), type: "email" });
  if (error) throw new Error(traduci(error.message));
}

/** Esce solo da questo dispositivo: gli altri restano collegati. */
export async function esci() {
  if (!client) return;
  await client.auth.signOut({ scope: "local" });
  store.aggiornaInfoSync({ utenteId: null, ultimaSyncImpegni: null, ultimaSyncChiusure: null, ultimaSyncImpostazioni: null });
}

// ------------------------------- password ------------------------------------
// L'accesso con password funziona ovunque, anche nell'app installata su iPhone
// (dove il link via email non può arrivare). La password si imposta da collegati.

export async function accediConPassword(email, password) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(traduci(error.message));
}

/** Crea un account con password. Ritorna { confermaRichiesta } se manca ancora la conferma email. */
export async function registraConPassword(email, password) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  const { data, error } = await client.auth.signUp({
    email: email.trim(), password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(traduci(error.message));
  return { confermaRichiesta: !data?.session };
}

export async function impostaPassword(nuova) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  if (!nuova || nuova.length < 8) throw new Error("La password deve avere almeno 8 caratteri.");
  const { error } = await client.auth.updateUser({ password: nuova });
  if (error) throw new Error(traduci(error.message));
}

export async function inviaRecupero(email) {
  if (!client) throw new Error("Sincronizzazione non disponibile: controlla la connessione.");
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(traduci(error.message));
}

function traduci(msg = "") {
  const m = String(msg).toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes")) return "Troppi tentativi: aspetta qualche minuto e riprova.";
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials")) return "Email o password non corretti.";
  if (m.includes("email not confirmed")) return "Email non ancora confermata: apri il link ricevuto per email.";
  if (m.includes("user already registered") || m.includes("already been registered")) return "Esiste già un account con questa email: accedi con la password, oppure entra con il link via email e impostala dalle Impostazioni.";
  if (m.includes("password should be") || m.includes("weak password") || m.includes("password is too")) return "Password troppo corta o troppo debole: usane una di almeno 8 caratteri.";
  if (m.includes("same password") || m.includes("different from the old")) return "La nuova password deve essere diversa da quella attuale.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Le registrazioni sono disattivate su Supabase (Authentication → Providers → Email).";
  if (m.includes("invalid") && m.includes("otp")) return "Codice non valido o scaduto.";
  if (m.includes("expired") || m.includes("otp_expired")) return "Link scaduto o già usato: richiedine uno nuovo.";
  if (m.includes("already used") || m.includes("refresh token")) return "Sessione non più valida: accedi di nuovo.";
  if (m.includes("invalid email")) return "Indirizzo email non valido.";
  if (m.includes("sincronizzato_il")) return "Il database Supabase va aggiornato: esegui supabase/aggiornamento-1.sql (vedi README).";
  if (m.includes("does not exist") && m.includes("relation")) return "Tabelle mancanti su Supabase: esegui supabase/schema.sql (vedi README).";
  if (m.includes("jwt") || m.includes("session")) return "Sessione scaduta: accedi di nuovo.";
  if (m.includes("fetch") || m.includes("load failed") || m.includes("network")) return "Nessuna connessione.";
  return String(msg);
}

// --------------------------------- sync --------------------------------------

/** Avvia una sincronizzazione (o si accoda a quella in corso). Ritorna una promessa. */
export function sincronizza() {
  if (!client || !utente) return Promise.resolve();
  if (!navigator.onLine) { emetti({ stato: "offline" }); return Promise.resolve(); }
  if (promessaSync) { richiestaInCoda = true; return promessaSync; }
  promessaSync = (async () => {
    emetti({ stato: "in-corso" });
    try {
      await pull();
      await push();
      emetti({ stato: "collegato", messaggio: "", ultimaSync: new Date().toISOString() });
    } catch (e) {
      console.error("Sync fallita", e);
      emetti({ stato: "errore", messaggio: traduci(e.message || String(e)) });
    } finally {
      promessaSync = null;
      if (richiestaInCoda) { richiestaInCoda = false; sincronizza(); }
    }
  })();
  return promessaSync;
}

function normalizzaTs(x) {
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d) ? x : d.toISOString();
}

/** Scarica da una tabella le righe con sincronizzato_il >= segnalibro, a pagine. */
async function scaricaTabella(tabella, segnalibro) {
  const righe = [];
  const visti = new Set();
  let cursore = segnalibro || null;
  for (let giro = 0; giro < 50; giro++) {
    let q = client.from(tabella).select("*").eq("user_id", utente.id)
      .order("sincronizzato_il", { ascending: true }).limit(PAGINA);
    if (cursore) q = q.gte("sincronizzato_il", cursore);
    const { data, error } = await q;
    if (error) throw error;
    const pagina = data || [];
    for (const r of pagina) {
      const k = tabella === "chiusure" ? r.data : r.id;
      if (!visti.has(k)) { visti.add(k); righe.push(r); }
    }
    if (pagina.length < PAGINA) break;
    const ultimo = normalizzaTs(pagina[pagina.length - 1].sincronizzato_il);
    if (ultimo === cursore) break; // tutte uguali: non si può avanzare oltre
    cursore = ultimo;
  }
  const ultimo = righe.length ? normalizzaTs(righe[righe.length - 1].sincronizzato_il) : null;
  return { righe, segnalibro: ultimo || segnalibro || null };
}

async function pull() {
  const info = store.infoSync();
  const imp = await scaricaTabella("impegni", info.ultimaSyncImpegni);
  const chi = await scaricaTabella("chiusure", info.ultimaSyncChiusure);
  const r3 = await client.from("impostazioni").select("*").eq("user_id", utente.id).maybeSingle();
  if (r3.error) throw r3.error;

  const impostazioni = r3.data ? { ...r3.data.dati, aggiornato_il: normalizzaTs(r3.data.aggiornato_il) } : null;
  store.applicaRemoto({
    impegni: imp.righe.map(daRigaImpegno),
    chiusure: chi.righe.map(daRigaChiusura),
    impostazioni,
  });
  store.aggiornaInfoSync({ ultimaSyncImpegni: imp.segnalibro, ultimaSyncChiusure: chi.segnalibro });
}

async function push() {
  const p = store.pendenti();
  if (p.impegni.length) {
    const righe = p.impegni.map((i) => aRigaImpegno(i, utente.id));
    const { error } = await client.from("impegni").upsert(righe, { onConflict: "id" });
    if (error) throw error;
    store.segnaSincronizzati({ impegni: p.impegni.map((i) => i.id) });
  }
  if (p.chiusure.length) {
    const righe = p.chiusure.map((c) => aRigaChiusura(c, utente.id));
    const { error } = await client.from("chiusure").upsert(righe, { onConflict: "user_id,data" });
    if (error) throw error;
    store.segnaSincronizzati({ chiusure: p.chiusure.map((c) => c.data) });
  }
  if (p.impostazioni) {
    const { aggiornato_il, ...dati } = p.impostazioni;
    const { error } = await client.from("impostazioni").upsert(
      { user_id: utente.id, dati, aggiornato_il: aggiornato_il || new Date().toISOString() },
      { onConflict: "user_id" });
    if (error) throw error;
    store.segnaSincronizzati({ impostazioni: true });
  }
}

const COLONNE = ["id", "titolo", "data", "ora", "priorita", "tipo", "note", "ricorrenza", "serie_id",
  "prossimo_creato", "fatto", "fatto_il", "eliminato", "creato_il", "aggiornato_il"];

function aRigaImpegno(i, userId) {
  const r = { user_id: userId };
  for (const c of COLONNE) r[c] = i[c] === undefined ? null : i[c];
  return r;
}

function daRigaImpegno(r) {
  const i = {};
  for (const c of COLONNE) i[c] = r[c] === undefined ? null : r[c];
  i.fatto = !!i.fatto;
  i.eliminato = !!i.eliminato;
  i.fatto_il = normalizzaTs(i.fatto_il);
  i.creato_il = normalizzaTs(i.creato_il);
  i.aggiornato_il = normalizzaTs(i.aggiornato_il);
  return i;
}

function aRigaChiusura(c, userId) {
  return {
    user_id: userId, data: c.data, fatti: c.fatti || 0, totali: c.totali || 0, slittati: c.slittati || 0,
    chiusa_il: c.chiusa_il || new Date().toISOString(), aggiornato_il: c.aggiornato_il || new Date().toISOString(),
  };
}

function daRigaChiusura(r) {
  return {
    data: r.data, fatti: r.fatti || 0, totali: r.totali || 0, slittati: r.slittati || 0,
    chiusa_il: normalizzaTs(r.chiusa_il), aggiornato_il: normalizzaTs(r.aggiornato_il),
  };
}

// ------------------------------- solo per i test -------------------------------

export function _usaClientPerTest(f) { creaClientPersonalizzato = f; }
export function _resetPerTest() {
  clearInterval(timer);
  client = null; utente = null; timer = null; promessaInit = null; promessaSync = null; richiestaInCoda = false;
  Object.assign(statoSync, { stato: "non-configurato", messaggio: "", utente: null, ultimaSync: null, recupero: false });
}
export function _attendiSync() { return promessaSync || Promise.resolve(); }
