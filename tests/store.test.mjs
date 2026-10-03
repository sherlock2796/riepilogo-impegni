// Test dell'archivio locale e della logica di dominio.
// Esegui con: node --test tests/store.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// localStorage finto, prima di importare lo store
const memoria = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
  clear: () => memoria.clear(),
};

const store = await import("../app/js/store.js");
const { oggiISO, aggiungiGiorni } = await import("../app/js/date.js");

const OGGI = oggiISO();
const IERI = aggiungiGiorni(OGGI, -1);
const DOMANI = aggiungiGiorni(OGGI, 1);
const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  memoria.clear();
  store.cancellaTutto();
});

test("crea, aggiorna, elimina e ordina", () => {
  const a = store.crea({ titolo: "  Spesa  ", data: OGGI, priorita: "Bassa", tipo: "Casa" });
  const b = store.crea({ titolo: "Call", data: OGGI, ora: "09:00", priorita: "Media" });
  const c = store.crea({ titolo: "Urgente", data: OGGI, priorita: "Alta" });
  const d = store.crea({ titolo: "Senza ora, alta", data: OGGI, priorita: "Alta" });
  assert.equal(a.titolo, "Spesa");
  assert.equal(a.tipo, "Casa");
  // con ora prima, poi per priorità, poi alfabetico
  assert.deepEqual(store.perData(OGGI).map((i) => i.titolo), ["Call", "Senza ora, alta", "Urgente", "Spesa"]);
  store.segnaFatto(b.id, true);
  assert.equal(store.perData(OGGI).at(-1).titolo, "Call", "i fatti vanno in fondo");
  store.aggiorna(c.id, { titolo: "Cambiato", tipo: "Tipo inesistente", priorita: "Boh" });
  assert.equal(store.perId(c.id).titolo, "Cambiato");
  assert.equal(store.perId(c.id).tipo, "Personale", "tipo non valido -> Personale");
  assert.equal(store.perId(c.id).priorita, "Media", "priorità non valida -> Media");
  store.elimina(d.id);
  assert.equal(store.perId(d.id), null);
  assert.equal(store.tutti().length, 3);
  assert.equal(store.getStato().impegni[d.id].eliminato, true, "eliminazione soft, per la sincronizzazione");
  assert.ok(store.pendenti().impegni.some((i) => i.id === d.id), "l'eliminato resta da spingere");
});

test("persistenza su localStorage e ricarico", () => {
  store.crea({ titolo: "Persistente", data: OGGI });
  store.aggiornaImpostazioni({ nome: "Leo", oraChiusura: 21 });
  const s = store.carica();
  assert.equal(Object.values(s.impegni)[0].titolo, "Persistente");
  assert.equal(s.impostazioni.nome, "Leo");
  assert.equal(s.impostazioni.oraChiusura, 21);
  assert.equal(s.impostazioni.frasiAdOgniSpunta, true, "i default mancanti vengono completati");
});

test("arretrati: solo non fatti con data passata, in ordine di data", () => {
  store.crea({ titolo: "Vecchio", data: aggiungiGiorni(OGGI, -5) });
  store.crea({ titolo: "Ieri", data: IERI });
  const f = store.crea({ titolo: "Ieri fatto", data: IERI });
  store.segnaFatto(f.id, true);
  store.crea({ titolo: "Troppo vecchio", data: aggiungiGiorni(OGGI, -90) });
  store.crea({ titolo: "Oggi", data: OGGI });
  assert.deepEqual(store.arretrati(OGGI).map((i) => i.titolo), ["Vecchio", "Ieri"]);
});

test("ricorrenza: spuntare crea la successiva, togliere la spunta la ritira", () => {
  const r = store.crea({ titolo: "Palestra", data: OGGI, ricorrenza: { tipo: "giorni", ogni: 2 } });
  assert.equal(r.serie_id, r.id);
  const { creato } = store.segnaFatto(r.id, true);
  assert.ok(creato);
  assert.equal(creato.data, aggiungiGiorni(OGGI, 2));
  assert.equal(creato.serie_id, r.id);
  assert.equal(creato.titolo, "Palestra");
  assert.equal(store.perId(r.id).prossimo_creato, creato.id);
  // seconda spunta non duplica
  store.segnaFatto(r.id, false);
  assert.equal(store.perId(creato.id), null, "la ricorrenza intonsa viene ritirata");
  assert.equal(store.perId(r.id).prossimo_creato, null);
  const seconda = store.segnaFatto(r.id, true).creato;
  assert.ok(seconda && seconda.id !== creato.id);
  assert.equal(store.tutti().filter((i) => i.titolo === "Palestra").length, 2);
});

test("ricorrenza arretrata: la successiva non nasce già scaduta", () => {
  const r = store.crea({ titolo: "Vitamine", data: aggiungiGiorni(OGGI, -4), ricorrenza: { tipo: "giorni", ogni: 1 } });
  const { creato } = store.segnaFatto(r.id, true);
  assert.equal(creato.data, OGGI, "giornaliera fatta in ritardo: la prossima è oggi");
  const m = store.crea({ titolo: "Affitto", data: aggiungiGiorni(OGGI, -40), ricorrenza: { tipo: "mesi", ogni: 1 } });
  const prossimo = store.segnaFatto(m.id, true).creato;
  assert.ok(prossimo.data >= OGGI, "mensile: salta avanti fino a una data non passata");
});

test("ricorrenza modificata tramite aggiorna", () => {
  const r = store.crea({ titolo: "Senza", data: OGGI });
  assert.equal(r.serie_id, null);
  store.aggiorna(r.id, { ricorrenza: { tipo: "settimane", ogni: 1, giorniSettimana: [0, 2] } });
  assert.equal(store.perId(r.id).serie_id, r.id);
  store.aggiorna(r.id, { ricorrenza: null });
  assert.equal(store.perId(r.id).ricorrenza, null);
});

test("chiusura, esito del giorno e serie", () => {
  // tre giorni fa: tutto fatto
  const g3 = aggiungiGiorni(OGGI, -3);
  const a = store.crea({ titolo: "a", data: g3 }); store.segnaFatto(a.id, true);
  // due giorni fa: nessun impegno (non interrompe)
  // ieri: tutto fatto
  const b = store.crea({ titolo: "b", data: IERI }); store.segnaFatto(b.id, true);
  // oggi: uno fatto, uno no -> oggi non conta ancora
  const c = store.crea({ titolo: "c", data: OGGI }); store.segnaFatto(c.id, true);
  const d = store.crea({ titolo: "d", data: OGGI });
  assert.equal(store.serieAttuale(OGGI), 2);
  assert.equal(store.esitoGiorno(OGGI).pieno, false);
  // completo anche oggi -> 3
  store.segnaFatto(d.id, true);
  assert.equal(store.serieAttuale(OGGI), 3);
  assert.equal(store.migliorSerie(OGGI), 3);
  // chiusura di ieri con uno slittato: ieri si rompe
  store.registraChiusura(IERI, { fatti: 1, totali: 2, slittati: 1 });
  assert.equal(store.esitoGiorno(IERI).rotto, true);
  assert.equal(store.serieAttuale(OGGI), 1);
  assert.equal(store.chiusura(IERI).slittati, 1);
  assert.ok(store.pendenti().chiusure.some((x) => x.data === IERI));
});

test("chiusura senza slittati ma impegno completato dopo: il giorno vale pieno", () => {
  const a = store.crea({ titolo: "a", data: IERI });
  store.registraChiusura(IERI, { fatti: 0, totali: 1, slittati: 0 });
  assert.equal(store.esitoGiorno(IERI).pieno, false);
  store.segnaFatto(a.id, true);
  assert.equal(store.esitoGiorno(IERI).pieno, true);
});

test("settimana: percentuale calcolata fino a oggi", () => {
  const a = store.crea({ titolo: "a", data: OGGI }); store.segnaFatto(a.id, true);
  store.crea({ titolo: "futuro", data: aggiungiGiorni(OGGI, 7) }); // settimana prossima, fuori
  const s = store.settimana(OGGI);
  assert.equal(s.giorni.length, 7);
  assert.ok(s.giorni.some((g) => g.data === OGGI && g.fatti === 1 && g.totali === 1));
  assert.equal(s.percentuale, 100);
});

test("fattiUltimi conta per data locale e per tipo", () => {
  const a = store.crea({ titolo: "a", data: OGGI, tipo: "Sport" }); store.segnaFatto(a.id, true);
  const b = store.crea({ titolo: "b", data: OGGI, tipo: "Casa" }); store.segnaFatto(b.id, true);
  const c = store.crea({ titolo: "c", data: OGGI });
  const u = store.fattiUltimi(30, OGGI);
  assert.equal(u.totale, 2);
  assert.deepEqual(u.perTipo, { Sport: 1, Casa: 1 });
  void c;
});

test("applicaRemoto: vince l'aggiornamento più recente, le pendenze si puliscono", async () => {
  const a = store.crea({ titolo: "Locale", data: OGGI });
  await dormi(3);
  const remotoVecchio = { ...a, titolo: "Remoto vecchio", aggiornato_il: new Date(Date.now() - 60000).toISOString() };
  assert.equal(store.applicaRemoto({ impegni: [remotoVecchio] }), false);
  assert.equal(store.perId(a.id).titolo, "Locale");
  assert.ok(store.pendenti().impegni.some((i) => i.id === a.id), "la modifica locale resta da spingere");
  const remotoNuovo = { ...a, titolo: "Remoto nuovo", aggiornato_il: new Date(Date.now() + 1000).toISOString() };
  assert.equal(store.applicaRemoto({ impegni: [remotoNuovo] }), true);
  assert.equal(store.perId(a.id).titolo, "Remoto nuovo");
  assert.ok(!store.pendenti().impegni.some((i) => i.id === a.id), "la versione remota sostituisce la pendenza");
  // nuovo impegno dal server
  store.applicaRemoto({ impegni: [{ ...a, id: "11111111-1111-4111-8111-111111111111", titolo: "Dal server" }] });
  assert.equal(store.perId("11111111-1111-4111-8111-111111111111").titolo, "Dal server");
  // eliminazione dal server
  store.applicaRemoto({ impegni: [{ ...a, eliminato: true, aggiornato_il: new Date(Date.now() + 2000).toISOString() }] });
  assert.equal(store.perId(a.id), null);
  // impostazioni remote più recenti
  store.aggiornaImpostazioni({ nome: "Locale" });
  await dormi(3);
  store.applicaRemoto({ impostazioni: { nome: "Remoto", aggiornato_il: new Date(Date.now() + 1000).toISOString() } });
  assert.equal(store.impostazioni().nome, "Remoto");
  assert.equal(store.impostazioni().oraChiusura, 20, "i default restano");
});

test("marcaTuttoPending e segnaSincronizzati", () => {
  const a = store.crea({ titolo: "a", data: OGGI });
  store.registraChiusura(IERI, { fatti: 1, totali: 1, slittati: 0 });
  store.segnaSincronizzati({ impegni: [a.id], chiusure: [IERI], impostazioni: true });
  assert.deepEqual(store.pendenti(), { impegni: [], chiusure: [], impostazioni: null });
  store.marcaTuttoPending();
  assert.equal(store.pendenti().impegni.length, 1);
  assert.equal(store.pendenti().chiusure.length, 1);
  assert.ok(store.pendenti().impostazioni);
});

test("esporta e importa", () => {
  const a = store.crea({ titolo: "Backup", data: OGGI, note: "nota" });
  store.registraChiusura(IERI, { fatti: 2, totali: 2, slittati: 0 });
  const json = store.esporta();
  store.cancellaTutto();
  assert.equal(store.tutti().length, 0);
  const n = store.importa(json);
  assert.equal(n, 1);
  assert.equal(store.perId(a.id).note, "nota");
  assert.equal(store.chiusura(IERI).totali, 2);
  assert.throws(() => store.importa('{"formato":"altro"}'), /non riconosciuto/);
});

test("gli eliminati vecchi e già sincronizzati vengono dimenticati al caricamento", () => {
  const a = store.crea({ titolo: "vecchio eliminato", data: OGGI });
  store.elimina(a.id);
  store.segnaSincronizzati({ impegni: [a.id] });
  const s = store.getStato();
  s.impegni[a.id].aggiornato_il = new Date(Date.now() - 90 * 86400000).toISOString();
  localStorage.setItem("impegni.v1", JSON.stringify(s));
  store.carica();
  assert.equal(store.getStato().impegni[a.id], undefined);
});

test("uuid ha il formato giusto", () => {
  assert.match(store.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("date: DST e differenze", async () => {
  const D = await import("../app/js/date.js");
  assert.equal(D.aggiungiGiorni("2026-03-28", 2), "2026-03-30"); // cambio ora legale in mezzo
  assert.equal(D.aggiungiGiorni("2026-10-24", 2), "2026-10-26"); // cambio ora solare
  assert.equal(D.differenzaGiorni("2026-03-28", "2026-03-30"), 2);
  assert.equal(D.aggiungiMesi("2026-01-31", 1), "2026-02-28");
  assert.equal(D.lunediDi("2026-10-04"), "2026-09-28"); // domenica -> lunedì precedente
  assert.equal(D.giornoSettimana("2026-10-05"), 0);
  assert.equal(D.etichettaRelativa("2026-10-04", "2026-10-03"), "Domani");
  assert.equal(D.etichettaRelativa("2026-10-02", "2026-10-03"), "Ieri");
  assert.equal(D.etichettaRelativa("2026-10-07", "2026-10-03"), "Mercoledì");
  assert.equal(D.etichettaRelativa("2027-01-02", "2026-10-03"), "Sab 2 gen 2027");
  assert.equal(D.ritardo("2026-10-02", "2026-10-03"), "da ieri");
  assert.equal(D.ritardo("2026-09-26", "2026-10-03"), "da una settimana");
});
