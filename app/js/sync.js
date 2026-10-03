// Sincronizzazione con Supabase (accesso via link magico o codice email).
//
// Se config.js non ha URL e chiave, l'app resta solo locale e questo modulo
// non carica nemmeno la libreria. Quando si è collegati:
//   1. pull  -> righe cambiate dal server dopo l'ultima sync, fuse nello store
//   2. push  -> righe locali pendenti, upsert sul server
// Si ripete all'apertura, al ritorno in primo piano, al ritorno online e
// ogni due minuti.

import * as store from "./store.js";

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const INTERVALLO_MS = 120000;

let client = null;
let utente = null;
let timer = null;
let inCorso = false;
const ascoltatori = new Set();
export const statoSync = { stato: "non-configurato", messaggio: "", utente: null, ultimaSync: null };

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

export async function init() {
  if (!configurato()) { emetti({ stato: "non-configurato" }); return; }
  try {
    const { createClient } = await import(CDN);
    client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.error(e);
    emetti({ stato: "errore", messaggio: "Libreria di sincronizzazione non raggiungibile" });
    return;
  }

  client.auth.onAuthStateChange((_evento, sessione) => {
    // Mai chiamare altre funzioni Supabase dentro questo callback: si rinvia al tick successivo.
    setTimeout(() => impostaUtente(sessione?.user || null), 0);
  });
  const { data } = await client.auth.getSession();
  impostaUtente(data?.session?.user || null);

  // Link scaduto o già usato: Supabase torna con #error=...&error_description=...
  const frammento = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (frammento.get("error_description") || frammento.get("error")) {
    const desc = frammento.get("error_description") || frammento.get("error") || "";
    emetti({ stato: data?.session?.user ? statoSync.stato : "disconnesso", messaggio: traduci(desc.replace(/\+/g, " ")) });
  }
  // Pulisce il frammento lasciato dal link magico e torna alla vista Oggi.
  if (/access_token|refresh_token|error_description|error=/.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/oggi");
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizza(); });
  window.addEventListener("online", () => sincronizza());
  window.addEventListener("focus", () => sincronizza());
}

function impostaUtente(u) {
  utente = u;
  clearInterval(timer);
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
}

// ------------------------------- accesso -------------------------------------

export async function inviaLink(email) {
  if (!client) throw new Error("Sincronizzazione non configurata");
  const redirect = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirect, shouldCreateUser: true },
  });
  if (error) throw new Error(traduci(error.message));
}

export async function verificaCodice(email, codice) {
  if (!client) throw new Error("Sincronizzazione non configurata");
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token: codice.trim(), type: "email" });
  if (error) throw new Error(traduci(error.message));
}

export async function esci() {
  if (!client) return;
  await client.auth.signOut();
  store.aggiornaInfoSync({ utenteId: null, ultimaSyncImpegni: null, ultimaSyncChiusure: null, ultimaSyncImpostazioni: null });
}

// ---------------------- collegamento dell'app installata ----------------------
// Su iPhone l'app aggiunta alla schermata Home non condivide la sessione con
// Safari. Da Safari si genera un codice (la sessione corrente, codificata) e
// lo si incolla nell'app installata. I token di aggiornamento di Supabase
// ruotano e non possono essere usati da due parti: chi genera il codice
// viene scollegato in locale, così non prova a riusarli.

export function codificaCodice(sessione) {
  const json = JSON.stringify({ a: sessione.access_token, r: sessione.refresh_token });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodificaCodice(codice) {
  const pulito = String(codice || "").replace(/\s+/g, "");
  if (!pulito) throw new Error("Incolla il codice.");
  try {
    const b64 = pulito.replace(/-/g, "+").replace(/_/g, "/");
    const dati = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (!dati.a || !dati.r) throw new Error();
    return { access_token: dati.a, refresh_token: dati.r };
  } catch {
    throw new Error("Codice non valido: copialo per intero.");
  }
}

export async function creaCodiceCollegamento() {
  if (!client) throw new Error("Sincronizzazione non configurata");
  const { data } = await client.auth.getSession();
  if (!data?.session) throw new Error("Non sei collegato.");
  const codice = codificaCodice(data.session);
  await client.auth.signOut({ scope: "local" });
  return codice;
}

export async function usaCodiceCollegamento(codice) {
  if (!client) throw new Error("Sincronizzazione non configurata");
  const tokens = decodificaCodice(codice);
  const r1 = await client.auth.setSession(tokens);
  if (r1.error) throw new Error(traduci(r1.error.message));
  const r2 = await client.auth.refreshSession();
  if (r2.error) throw new Error(traduci(r2.error.message));
}

function traduci(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes")) return "Troppi tentativi: aspetta qualche minuto e riprova.";
  if (m.includes("invalid") && m.includes("otp")) return "Codice non valido o scaduto.";
  if (m.includes("expired") || m.includes("otp_expired")) return "Link scaduto o già usato: richiedine uno nuovo.";
  if (m.includes("already used") || m.includes("refresh token")) return "Codice già usato o non più valido: generane uno nuovo da Safari.";
  if (m.includes("invalid email")) return "Indirizzo email non valido.";
  if (m.includes("fetch")) return "Nessuna connessione.";
  return msg;
}

// --------------------------------- sync --------------------------------------

export async function sincronizza() {
  if (!client || !utente || inCorso) return;
  if (!navigator.onLine) { emetti({ stato: "offline" }); return; }
  inCorso = true;
  emetti({ stato: "in-corso" });
  try {
    await pull();
    await push();
    emetti({ stato: "collegato", messaggio: "", ultimaSync: new Date().toISOString() });
  } catch (e) {
    console.error("Sync fallita", e);
    emetti({ stato: "errore", messaggio: traduci(e.message || String(e)) });
  } finally {
    inCorso = false;
  }
}

function margine(iso) {
  // Un minuto di margine per non perdere righe con orologi leggermente sfasati.
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - 60000).toISOString();
}

async function pull() {
  const info = store.infoSync();

  let q = client.from("impegni").select("*").eq("user_id", utente.id).order("aggiornato_il", { ascending: true }).limit(2000);
  const m1 = margine(info.ultimaSyncImpegni);
  if (m1) q = q.gt("aggiornato_il", m1);
  const r1 = await q;
  if (r1.error) throw r1.error;

  let q2 = client.from("chiusure").select("*").eq("user_id", utente.id).order("aggiornato_il", { ascending: true }).limit(2000);
  const m2 = margine(info.ultimaSyncChiusure);
  if (m2) q2 = q2.gt("aggiornato_il", m2);
  const r2 = await q2;
  if (r2.error) throw r2.error;

  const r3 = await client.from("impostazioni").select("*").eq("user_id", utente.id).maybeSingle();
  if (r3.error) throw r3.error;

  const impegni = (r1.data || []).map(daRigaImpegno);
  const chiusure = (r2.data || []).map(({ user_id, ...c }) => c);
  const impostazioni = r3.data ? { ...r3.data.dati, aggiornato_il: r3.data.aggiornato_il } : null;
  store.applicaRemoto({ impegni, chiusure, impostazioni });

  const patch = {};
  if (impegni.length) patch.ultimaSyncImpegni = impegni[impegni.length - 1].aggiornato_il;
  else if (!info.ultimaSyncImpegni) patch.ultimaSyncImpegni = new Date().toISOString();
  if (chiusure.length) patch.ultimaSyncChiusure = chiusure[chiusure.length - 1].aggiornato_il;
  else if (!info.ultimaSyncChiusure) patch.ultimaSyncChiusure = new Date().toISOString();
  store.aggiornaInfoSync(patch);
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
    const righe = p.chiusure.map((c) => ({ ...c, user_id: utente.id }));
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
  return i;
}
