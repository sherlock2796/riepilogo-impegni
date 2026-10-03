// Test della sincronizzazione con un server Supabase finto in memoria.
// Simula due o tre dispositivi che condividono lo stesso server ma hanno
// archivi locali separati (si scambia il contenuto del localStorage).
// Esegui con: node --test tests/sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

// ----------------------------- ambiente finto --------------------------------
const memoria = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
  clear: () => memoria.clear(),
};
globalThis.CONFIG = { supabaseUrl: "https://finto.supabase.co", supabaseAnonKey: "chiave" };
globalThis.document = { addEventListener() {}, hidden: false };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.location = { hash: "", pathname: "/", search: "", origin: "https://app.test" };
globalThis.history = { replaceState() {} };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });

const store = await import("../app/js/store.js");
const sync = await import("../app/js/sync.js");
const { oggiISO, aggiungiGiorni } = await import("../app/js/date.js");
const OGGI = oggiISO();
const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

/** Server finto: tre tabelle, trigger su sincronizzato_il, auth con token che ruotano. */
function creaServer() {
  const tabelle = { impegni: new Map(), chiusure: new Map(), impostazioni: new Map() };
  const stato = { colonnaSync: true, tabelleCreate: true };
  let tick = Date.now();
  const adesso = () => new Date(tick++).toISOString();
  const chiave = (t, r) => (t === "impegni" ? r.id : t === "chiusure" ? `${r.user_id}|${r.data}` : r.user_id);
  const revocati = new Set();
  const utenti = new Map(); // email -> password

  class Query {
    constructor(t) { this.t = t; this.filtri = []; this.ord = null; this.lim = Infinity; this.single = false; }
    select() { return this; }
    eq(c, v) { this.filtri.push((r) => r[c] === v); return this; }
    gt(c, v) { this.filtri.push((r) => r[c] > v); return this; }
    gte(c, v) { this.filtri.push((r) => r[c] >= v); return this; }
    order(c, { ascending = true } = {}) { this.ord = { c, asc: ascending }; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single = true; return this; }
    then(ok, ko) { return Promise.resolve().then(() => this.esegui()).then(ok, ko); }
    esegui() {
      if (!stato.tabelleCreate) return { data: null, error: { message: `relation "public.${this.t}" does not exist` } };
      if (this.ord?.c === "sincronizzato_il" && !stato.colonnaSync) {
        return { data: null, error: { message: `column ${this.t}.sincronizzato_il does not exist` } };
      }
      let righe = [...tabelle[this.t].values()].filter((r) => this.filtri.every((f) => f(r)));
      if (this.ord) {
        const { c, asc } = this.ord;
        righe.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
      righe = righe.slice(0, this.lim).map((r) => JSON.parse(JSON.stringify(r)));
      return this.single ? { data: righe[0] || null, error: null } : { data: righe, error: null };
    }
    async upsert(righe) {
      if (!stato.tabelleCreate) return { error: { message: `relation "public.${this.t}" does not exist` } };
      for (const r of Array.isArray(righe) ? righe : [righe]) {
        const k = chiave(this.t, r);
        const prima = tabelle[this.t].get(k) || {};
        tabelle[this.t].set(k, { ...prima, ...JSON.parse(JSON.stringify(r)), sincronizzato_il: adesso() });
      }
      return { error: null };
    }
  }

  function creaClient() {
    const auth = {
      sessione: null,
      callbacks: [],
      onAuthStateChange(cb) { this.callbacks.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session: this.sessione }, error: null }; },
      _notifica(evento) { for (const cb of this.callbacks) cb(evento, this.sessione); },
      _accedi(email) {
        this.sessione = { access_token: "at-" + email, refresh_token: "rt-" + Math.random(), user: { id: "uid-" + email, email } };
        this._notifica("SIGNED_IN");
      },
      async signOut() { this.sessione = null; this._notifica("SIGNED_OUT"); return { error: null }; },
      async signInWithOtp({ email }) { this.ultimaOtp = email; return { error: null }; },
      async signInWithPassword({ email, password }) {
        if (!utenti.has(email) || utenti.get(email) !== password) return { data: {}, error: { message: "Invalid login credentials" } };
        this._accedi(email);
        return { data: { session: this.sessione }, error: null };
      },
      async signUp({ email, password }) {
        if (utenti.has(email)) return { data: { user: { id: "uid-" + email }, session: null }, error: null }; // utente fittizio, come Supabase con conferma attiva
        utenti.set(email, password);
        this._accedi(email);
        return { data: { session: this.sessione }, error: null };
      },
      async updateUser({ password }) {
        if (!this.sessione) return { data: {}, error: { message: "Auth session missing!" } };
        utenti.set(this.sessione.user.email, password);
        return { data: { user: this.sessione.user }, error: null };
      },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async verifyOtp() { return { error: null }; },
      async setSession({ access_token, refresh_token }) {
        if (revocati.has(refresh_token)) return { data: {}, error: { message: "Invalid Refresh Token: Already Used" } };
        const email = access_token.replace("at-", "");
        this.sessione = { access_token, refresh_token, user: { id: "uid-" + email, email } };
        this._notifica("SIGNED_IN");
        return { data: { session: this.sessione }, error: null };
      },
      async refreshSession() {
        if (!this.sessione) return { data: {}, error: { message: "Auth session missing" } };
        revocati.add(this.sessione.refresh_token);
        this.sessione = { ...this.sessione, refresh_token: "rt-" + Math.random() };
        this._notifica("TOKEN_REFRESHED");
        return { data: { session: this.sessione }, error: null };
      },
    };
    return { auth, from: (t) => new Query(t) };
  }
  return { tabelle, stato, creaClient };
}

// Un "dispositivo" = un client finto + un localStorage proprio.
const dispositivi = {};
async function usaDispositivo(nome, server) {
  // salva l'archivio del dispositivo corrente
  if (usaDispositivo.corrente) dispositivi[usaDispositivo.corrente].archivio = memoria.get("impegni.v1") || null;
  usaDispositivo.corrente = nome;
  if (!dispositivi[nome]) dispositivi[nome] = { client: server.creaClient(), archivio: null };
  memoria.clear();
  if (dispositivi[nome].archivio) memoria.set("impegni.v1", dispositivi[nome].archivio);
  store.carica();
  if (!dispositivi[nome].archivio) store.cancellaTutto();
  sync._resetPerTest();
  sync._usaClientPerTest(() => dispositivi[nome].client);
  await sync.init();
  await dormi(5);
  await sync._attendiSync();
  return dispositivi[nome].client;
}

async function accedi(client, email) {
  client.auth._accedi(email);
  await dormi(5); // il callback rinvia al tick successivo
  await sync._attendiSync();
}

// ------------------------------------ test ----------------------------------

test("primo accesso: il locale sale sul server, un secondo dispositivo lo scarica", async () => {
  const server = creaServer();
  const A = await usaDispositivo("A", server);
  assert.equal(sync.statoSync.stato, "disconnesso");

  const a1 = store.crea({ titolo: "Dentista", data: OGGI, ora: "15:00", priorita: "Alta" });
  const a2 = store.crea({ titolo: "Spesa", data: OGGI, tipo: "Casa" });
  store.crea({ titolo: "Palestra", data: aggiungiGiorni(OGGI, 2), ricorrenza: { tipo: "settimane", ogni: 1, giorniSettimana: [0, 2] } });
  store.registraChiusura(aggiungiGiorni(OGGI, -1), { fatti: 2, totali: 3, slittati: 1 });
  store.aggiornaImpostazioni({ nome: "Leo", frasiExtra: [{ id: "u1", momento: "fatto", testo: "Grande {n}" }] });

  await accedi(A, "leo@test.it");
  assert.equal(sync.statoSync.stato, "collegato");
  assert.equal(sync.statoSync.utente.email, "leo@test.it");
  assert.equal(server.tabelle.impegni.size, 3);
  assert.equal(server.tabelle.chiusure.size, 1);
  assert.equal(server.tabelle.impostazioni.get("uid-leo@test.it").dati.nome, "Leo");
  assert.ok([...server.tabelle.impegni.values()].every((r) => r.user_id === "uid-leo@test.it" && r.sincronizzato_il));
  assert.deepEqual(store.pendenti(), { impegni: [], chiusure: [], impostazioni: null });
  await sync.sincronizza(); // il giro successivo scarica le proprie righe e fissa il segnalibro
  assert.ok(store.infoSync().ultimaSyncImpegni, "segnalibro impostato");
  assert.equal(store.tutti().length, 3, "le proprie righe riscaricate non si duplicano");

  // dispositivo B, vuoto
  const B = await usaDispositivo("B", server);
  assert.equal(store.tutti().length, 0);
  await accedi(B, "leo@test.it");
  assert.equal(store.tutti().length, 3);
  assert.equal(store.perId(a1.id).ora, "15:00");
  assert.equal(store.perId(a2.id).tipo, "Casa");
  assert.equal(store.chiusura(aggiungiGiorni(OGGI, -1)).slittati, 1);
  assert.equal(store.impostazioni().nome, "Leo");
  assert.equal(store.impostazioni().frasiExtra[0].testo, "Grande {n}");
  assert.equal(store.impostazioni().oraChiusura, 20);

  // B spunta e modifica, A riceve
  store.segnaFatto(a1.id, true);
  await dormi(3);
  store.aggiorna(a2.id, { titolo: "Spesa grossa" });
  await sync.sincronizza();
  await usaDispositivo("A", server);
  assert.equal(store.perId(a1.id).fatto, true);
  assert.equal(store.perId(a2.id).titolo, "Spesa grossa");

  // conflitto: A modifica per prima, B dopo; vince B (ultima modifica)
  store.aggiorna(a2.id, { titolo: "Versione A" });
  await sync.sincronizza();
  await dormi(3);
  await usaDispositivo("B", server);
  // B non ha ancora scaricato: modifica localmente (più tardi di A) e poi sincronizza
  store.aggiorna(a2.id, { titolo: "Versione B" });
  await sync.sincronizza();
  assert.equal(store.perId(a2.id).titolo, "Versione B");
  await usaDispositivo("A", server);
  assert.equal(store.perId(a2.id).titolo, "Versione B", "A riceve la versione più recente");

  // eliminazione propagata
  store.elimina(a1.id);
  await sync.sincronizza();
  await usaDispositivo("B", server);
  assert.equal(store.perId(a1.id), null);
  assert.equal(store.tutti().length, 2);

  // ricorrenza spuntata su B: la successiva arriva anche ad A
  const pal = store.tutti().find((i) => i.titolo === "Palestra");
  const { creato } = store.segnaFatto(pal.id, true);
  await sync.sincronizza();
  await usaDispositivo("A", server);
  assert.ok(store.perId(creato.id), "la nuova ricorrenza è arrivata");
  assert.equal(store.perId(pal.id).fatto, true);

  // offline: niente errori, stato offline, poi riprende
  navigator.onLine = false;
  store.crea({ titolo: "Offline", data: OGGI });
  await sync.sincronizza();
  assert.equal(sync.statoSync.stato, "offline");
  assert.equal(store.pendenti().impegni.length, 1);
  navigator.onLine = true;
  await sync.sincronizza();
  assert.equal(sync.statoSync.stato, "collegato");
  assert.equal(store.pendenti().impegni.length, 0);
  assert.equal(server.tabelle.impegni.size, 5);
});

test("formati del server: timestamp con offset vengono normalizzati, nessun falso conflitto", async () => {
  const server = creaServer();
  const A = await usaDispositivo("A2", server);
  await accedi(A, "x@test.it");
  const a = store.crea({ titolo: "Orari", data: OGGI });
  await sync.sincronizza();
  // il server (Postgres) restituisce "+00:00" e microsecondi
  const riga = server.tabelle.impegni.get(a.id);
  riga.aggiornato_il = riga.aggiornato_il.replace("Z", "000+00:00");
  riga.fatto_il = null;
  riga.sincronizzato_il = new Date(Date.now() + 1000).toISOString();
  store.aggiorna(a.id, { titolo: "Modificato dopo" });
  await sync.sincronizza();
  assert.equal(store.perId(a.id).titolo, "Modificato dopo", "la modifica locale più recente non viene sovrascritta");
  assert.match(store.perId(a.id).aggiornato_il, /Z$/);
});

test("database non aggiornato: messaggio chiaro", async () => {
  const server = creaServer();
  server.stato.colonnaSync = false;
  const A = await usaDispositivo("A3", server);
  await accedi(A, "y@test.it");
  assert.equal(sync.statoSync.stato, "errore");
  assert.match(sync.statoSync.messaggio, /aggiornamento-1\.sql/);
  server.stato.tabelleCreate = false;
  await sync.sincronizza();
  assert.match(sync.statoSync.messaggio, /schema\.sql/);
});

test("password: errore, registrazione, impostazione e accesso da un altro dispositivo", async () => {
  const server = creaServer();
  const A = await usaDispositivo("P1", server);
  await assert.rejects(() => sync.accediConPassword("nuovo@test.it", "segreta1"), /non corretti/);
  const reg = await sync.registraConPassword("nuovo@test.it", "segreta1");
  assert.equal(reg.confermaRichiesta, false);
  await dormi(5); await sync._attendiSync();
  assert.equal(sync.statoSync.stato, "collegato");
  store.crea({ titolo: "Con password", data: OGGI });
  await sync.sincronizza();

  // registrarsi di nuovo con la stessa email non imposta la password (comportamento Supabase)
  const reg2 = await sync.registraConPassword("nuovo@test.it", "altra1234");
  assert.equal(reg2.confermaRichiesta, true);

  // cambio password da collegati
  await assert.rejects(() => sync.impostaPassword("corta"), /almeno 8/);
  await sync.impostaPassword("nuovissima8");

  // altro dispositivo: entra con la nuova password e scarica tutto
  await usaDispositivo("P2", server);
  await assert.rejects(() => sync.accediConPassword("nuovo@test.it", "segreta1"), /non corretti/);
  await sync.accediConPassword("nuovo@test.it", "nuovissima8");
  await dormi(5); await sync._attendiSync();
  assert.equal(store.tutti()[0].titolo, "Con password");
  await assert.doesNotReject(() => sync.inviaRecupero("nuovo@test.it"));
  void A;
});

test("esci: solo locale, i dati restano e al rientro si riallinea", async () => {
  const server = creaServer();
  const A = await usaDispositivo("A5", server);
  await accedi(A, "z@test.it");
  store.crea({ titolo: "Resto", data: OGGI });
  await sync.sincronizza();
  await sync.esci();
  await dormi(5);
  assert.equal(sync.statoSync.stato, "disconnesso");
  assert.equal(store.tutti().length, 1, "i dati locali restano");
  assert.equal(store.infoSync().utenteId, null);
  store.crea({ titolo: "Mentre ero fuori", data: OGGI });
  await accedi(A, "z@test.it");
  assert.equal(server.tabelle.impegni.size, 2, "al rientro tutto il locale viene rispinto");
});

test("sincronizzazioni sovrapposte: la seconda si accoda, non si perde", async () => {
  const server = creaServer();
  const A = await usaDispositivo("A6", server);
  await accedi(A, "w@test.it");
  const p1 = sync.sincronizza();
  store.crea({ titolo: "Durante", data: OGGI });
  const p2 = sync.sincronizza();
  assert.equal(p1, p2, "stessa promessa mentre è in corso");
  await p1;
  await dormi(10);
  await sync._attendiSync();
  assert.equal(server.tabelle.impegni.size, 1, "la creazione avvenuta durante la sync è stata spinta dal giro accodato");
});
