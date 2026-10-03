// Archivio locale (localStorage) e logica di dominio.
// L'app è "local-first": tutto funziona senza rete; la sincronizzazione
// (sync.js) legge e scrive qui, marcando ciò che va spinto sul server.

import { oggiISO, aggiungiGiorni, adessoISO, lunediDi, differenzaGiorni, aISO } from "./date.js";
import { prossimaData, normalizza as normalizzaRicorrenza } from "./ricorrenze.js";

const CHIAVE = "impegni.v1";
export const PRIORITA = ["Alta", "Media", "Bassa"];
export const TIPI = ["Personale", "Sport", "Casa"];

export const IMPOSTAZIONI_DEFAULT = {
  oraChiusura: 20,          // da quest'ora compare "Chiudi la giornata"
  modalitaFocus: false,     // un impegno alla volta (non di default)
  frasiAdOgniSpunta: true,
  frasiExtra: [],           // [{id, momento, testo}]
  frasiNascoste: [],        // [id]
  nome: "",
};

function statoVuoto() {
  return {
    versione: 1,
    impegni: {},
    chiusure: {},
    impostazioni: { ...IMPOSTAZIONI_DEFAULT },
    sync: {
      pendingImpegni: [], pendingChiusure: [], pendingImpostazioni: false,
      ultimaSyncImpegni: null, ultimaSyncChiusure: null, ultimaSyncImpostazioni: null,
      utenteId: null,
    },
  };
}

let stato = statoVuoto();
const ascoltatori = new Set();

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ------------------------------- persistenza ---------------------------------

export function carica() {
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    if (grezzo) {
      const s = JSON.parse(grezzo);
      stato = { ...statoVuoto(), ...s };
      stato.impostazioni = { ...IMPOSTAZIONI_DEFAULT, ...(s.impostazioni || {}) };
      stato.sync = { ...statoVuoto().sync, ...(s.sync || {}) };
      pulisciEliminati();
    }
  } catch (e) {
    console.warn("Archivio locale illeggibile, riparto da zero", e);
    stato = statoVuoto();
  }
  return stato;
}

/** Dimentica gli impegni eliminati da più di 60 giorni e già sincronizzati. */
function pulisciEliminati() {
  const soglia = new Date(Date.now() - 60 * 86400000).toISOString();
  for (const [id, i] of Object.entries(stato.impegni)) {
    if (i.eliminato && (i.aggiornato_il || "") < soglia && !stato.sync.pendingImpegni.includes(id)) delete stato.impegni[id];
  }
}

function salva() {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify(stato));
  } catch (e) {
    console.error("Impossibile salvare", e);
  }
}

export function subscribe(fn) {
  ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
}

function notifica() {
  salva();
  for (const fn of ascoltatori) fn(stato);
}

export const getStato = () => stato;

// --------------------------------- letture -----------------------------------

export function tutti() {
  return Object.values(stato.impegni).filter((i) => !i.eliminato);
}

export function perId(id) {
  const i = stato.impegni[id];
  return i && !i.eliminato ? i : null;
}

const ordinePriorita = { Alta: 0, Media: 1, Bassa: 2 };

/** Ordina: prima i non fatti (per ora, poi priorità), poi i fatti. */
export function ordina(lista) {
  return [...lista].sort((a, b) => {
    if (a.fatto !== b.fatto) return a.fatto ? 1 : -1;
    if ((a.ora || "") !== (b.ora || "")) {
      if (!a.ora) return 1;
      if (!b.ora) return -1;
      return a.ora < b.ora ? -1 : 1;
    }
    const p = ordinePriorita[a.priorita] - ordinePriorita[b.priorita];
    if (p) return p;
    return a.titolo.localeCompare(b.titolo, "it");
  });
}

export function perData(iso) {
  return ordina(tutti().filter((i) => i.data === iso));
}

export function arretrati(oggi = oggiISO(), maxGiorni = 60) {
  const inizio = aggiungiGiorni(oggi, -maxGiorni);
  return ordina(tutti().filter((i) => !i.fatto && i.data < oggi && i.data >= inizio))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

export function inIntervallo(da, a) {
  return tutti().filter((i) => i.data >= da && i.data <= a);
}

// --------------------------------- scritture ---------------------------------

function segnaPending(id) {
  if (!stato.sync.pendingImpegni.includes(id)) stato.sync.pendingImpegni.push(id);
}

function pulisciCampi(campi) {
  const out = {};
  if (campi.titolo !== undefined) out.titolo = String(campi.titolo).trim().slice(0, 200) || "(senza titolo)";
  if (campi.data !== undefined) out.data = campi.data;
  if (campi.ora !== undefined) out.ora = campi.ora || null;
  if (campi.priorita !== undefined) out.priorita = PRIORITA.includes(campi.priorita) ? campi.priorita : "Media";
  if (campi.tipo !== undefined) out.tipo = TIPI.includes(campi.tipo) ? campi.tipo : "Personale";
  if (campi.note !== undefined) out.note = String(campi.note || "").trim().slice(0, 2000) || null;
  if (campi.ricorrenza !== undefined) out.ricorrenza = normalizzaRicorrenza(campi.ricorrenza);
  return out;
}

export function crea(campi) {
  const ora = adessoISO();
  const i = {
    id: uuid(),
    titolo: "(senza titolo)", data: oggiISO(), ora: null, priorita: "Media", tipo: "Personale",
    note: null, ricorrenza: null, serie_id: null, prossimo_creato: null,
    fatto: false, fatto_il: null, eliminato: false,
    creato_il: ora, aggiornato_il: ora,
    ...pulisciCampi(campi),
  };
  if (i.ricorrenza) i.serie_id = i.id;
  stato.impegni[i.id] = i;
  segnaPending(i.id);
  notifica();
  return i;
}

export function aggiorna(id, patch) {
  const i = stato.impegni[id];
  if (!i) return null;
  Object.assign(i, pulisciCampi(patch));
  if (i.ricorrenza && !i.serie_id) i.serie_id = i.id;
  i.aggiornato_il = adessoISO();
  segnaPending(id);
  notifica();
  return i;
}

export function elimina(id) {
  const i = stato.impegni[id];
  if (!i) return;
  i.eliminato = true;
  i.aggiornato_il = adessoISO();
  segnaPending(id);
  notifica();
}

/** Spunta (o toglie la spunta). Per i ricorrenti crea la prossima ricorrenza. */
export function segnaFatto(id, fatto = true) {
  const i = stato.impegni[id];
  if (!i) return null;
  const adesso = adessoISO();
  i.fatto = !!fatto;
  i.fatto_il = fatto ? adesso : null;
  i.aggiornato_il = adesso;
  segnaPending(id);

  let creato = null;
  if (fatto && i.ricorrenza && !i.prossimo_creato) {
    // Se l'impegno era arretrato, la ricorrenza successiva non deve nascere già scaduta.
    const oggi = oggiISO();
    let data = prossimaData(i.data, i.ricorrenza);
    for (let k = 0; data && data < oggi && k < 5000; k++) data = prossimaData(data, i.ricorrenza);
    if (data) {
      creato = {
        ...i, id: uuid(), data, fatto: false, fatto_il: null, prossimo_creato: null,
        serie_id: i.serie_id || i.id, creato_il: adesso, aggiornato_il: adesso, eliminato: false,
      };
      stato.impegni[creato.id] = creato;
      i.prossimo_creato = creato.id;
      segnaPending(creato.id);
    }
  }
  if (!fatto && i.prossimo_creato) {
    // Annulla la spunta: se la ricorrenza creata è ancora intonsa, la ritiro.
    const p = stato.impegni[i.prossimo_creato];
    if (p && !p.fatto && !p.eliminato && p.creato_il === p.aggiornato_il) {
      p.eliminato = true;
      p.aggiornato_il = adesso;
      segnaPending(p.id);
    }
    i.prossimo_creato = null;
  }
  notifica();
  return { impegno: i, creato };
}

export function rimanda(id, nuovaData) {
  return aggiorna(id, { data: nuovaData });
}

// --------------------------------- chiusure ----------------------------------

export function chiusura(data) {
  return stato.chiusure[data] || null;
}

export function registraChiusura(data, { fatti, totali, slittati }) {
  const adesso = adessoISO();
  stato.chiusure[data] = { data, fatti, totali, slittati, chiusa_il: adesso, aggiornato_il: adesso };
  if (!stato.sync.pendingChiusure.includes(data)) stato.sync.pendingChiusure.push(data);
  notifica();
  return stato.chiusure[data];
}

// -------------------------------- impostazioni -------------------------------

export function impostazioni() {
  return stato.impostazioni;
}

export function aggiornaImpostazioni(patch) {
  stato.impostazioni = { ...stato.impostazioni, ...patch, aggiornato_il: adessoISO() };
  stato.sync.pendingImpostazioni = true;
  notifica();
  return stato.impostazioni;
}

// --------------------------------- statistiche -------------------------------

export function esitoGiorno(iso) {
  const lista = tutti().filter((i) => i.data === iso);
  const c = stato.chiusure[iso];
  const totali = Math.max(lista.length, c?.totali || 0);
  if (!totali) return { totali: 0, fatti: 0, pieno: false, rotto: false };
  const fatti = lista.filter((i) => i.fatto).length;
  // Se la giornata è stata chiusa con cose slittate, la serie si interrompe
  // anche se gli impegni rimandati non compaiono più su quel giorno.
  const rotto = (c && c.slittati > 0) || fatti < lista.length;
  return { totali, fatti, pieno: !rotto, rotto };
}

/** Giorni consecutivi (fino a oggi o ieri) con tutti gli impegni fatti. */
export function serieAttuale(oggi = oggiISO()) {
  let serie = 0;
  let giorno = oggi;
  const eOggi = esitoGiorno(oggi);
  if (eOggi.totali && !eOggi.pieno) giorno = aggiungiGiorni(oggi, -1); // oggi ancora in corso
  for (let k = 0; k < 400; k++) {
    const e = esitoGiorno(giorno);
    if (e.totali) {
      if (e.pieno) serie++; else break;
    }
    giorno = aggiungiGiorni(giorno, -1);
  }
  return serie;
}

export function migliorSerie(oggi = oggiISO()) {
  const giorni = new Set(tutti().map((i) => i.data).concat(Object.keys(stato.chiusure)))
  const inizio = [...giorni].sort()[0];
  if (!inizio) return 0;
  const n = Math.min(730, differenzaGiorni(inizio, oggi));
  let migliore = 0, corrente = 0;
  for (let k = n; k >= 0; k--) {
    const e = esitoGiorno(aggiungiGiorni(oggi, -k));
    if (!e.totali) continue;
    if (e.pieno) { corrente++; migliore = Math.max(migliore, corrente); } else corrente = 0;
  }
  return Math.max(migliore, serieAttuale(oggi));
}

/** Riepilogo settimana (lun-dom) che contiene `oggi`. */
export function settimana(oggi = oggiISO()) {
  const lunedi = lunediDi(oggi);
  const giorni = [];
  let fatti = 0, totali = 0, fattiFinora = 0, totaliFinora = 0;
  for (let k = 0; k < 7; k++) {
    const iso = aggiungiGiorni(lunedi, k);
    const lista = tutti().filter((i) => i.data === iso);
    const f = lista.filter((i) => i.fatto).length;
    giorni.push({ data: iso, fatti: f, totali: lista.length });
    fatti += f; totali += lista.length;
    if (iso <= oggi) { fattiFinora += f; totaliFinora += lista.length; }
  }
  return {
    lunedi, giorni, fatti, totali, fattiFinora, totaliFinora,
    percentuale: totaliFinora ? Math.round((fattiFinora / totaliFinora) * 100) : 0,
  };
}

export function fattiUltimi(giorniIndietro = 30, oggi = oggiISO()) {
  const da = aggiungiGiorni(oggi, -giorniIndietro);
  const lista = tutti().filter((i) => i.fatto && i.fatto_il && aISO(new Date(i.fatto_il)) >= da);
  const perTipo = {};
  for (const i of lista) perTipo[i.tipo] = (perTipo[i.tipo] || 0) + 1;
  return { totale: lista.length, perTipo };
}

// --------------------------------- sync hooks --------------------------------

export function pendenti() {
  return {
    impegni: stato.sync.pendingImpegni.map((id) => stato.impegni[id]).filter(Boolean),
    chiusure: stato.sync.pendingChiusure.map((d) => stato.chiusure[d]).filter(Boolean),
    impostazioni: stato.sync.pendingImpostazioni ? stato.impostazioni : null,
  };
}

export function segnaSincronizzati({ impegni = [], chiusure = [], impostazioni = false } = {}) {
  stato.sync.pendingImpegni = stato.sync.pendingImpegni.filter((id) => !impegni.includes(id));
  stato.sync.pendingChiusure = stato.sync.pendingChiusure.filter((d) => !chiusure.includes(d));
  if (impostazioni) stato.sync.pendingImpostazioni = false;
  salva();
}

/** Marca tutto come da spingere (primo accesso con dati locali già presenti). */
export function marcaTuttoPending() {
  stato.sync.pendingImpegni = Object.keys(stato.impegni);
  stato.sync.pendingChiusure = Object.keys(stato.chiusure);
  stato.sync.pendingImpostazioni = true;
  salva();
}

export function infoSync() {
  return stato.sync;
}

export function aggiornaInfoSync(patch) {
  stato.sync = { ...stato.sync, ...patch };
  salva();
}

/** Applica righe arrivate dal server: vince chi ha aggiornato_il più recente. */
export function applicaRemoto({ impegni = [], chiusure = [], impostazioni = null }) {
  let cambiato = false;
  for (const r of impegni) {
    const loc = stato.impegni[r.id];
    if (!loc || (r.aggiornato_il || "") > (loc.aggiornato_il || "")) {
      stato.impegni[r.id] = { ...r };
      stato.sync.pendingImpegni = stato.sync.pendingImpegni.filter((id) => id !== r.id);
      cambiato = true;
    }
  }
  for (const r of chiusure) {
    const loc = stato.chiusure[r.data];
    if (!loc || (r.aggiornato_il || "") > (loc.aggiornato_il || "")) {
      stato.chiusure[r.data] = { ...r };
      stato.sync.pendingChiusure = stato.sync.pendingChiusure.filter((d) => d !== r.data);
      cambiato = true;
    }
  }
  if (impostazioni && (impostazioni.aggiornato_il || "") > (stato.impostazioni.aggiornato_il || "")) {
    stato.impostazioni = { ...IMPOSTAZIONI_DEFAULT, ...impostazioni };
    stato.sync.pendingImpostazioni = false;
    cambiato = true;
  }
  if (cambiato) notifica(); else salva();
  return cambiato;
}

// -------------------------------- backup -------------------------------------

export function esporta() {
  return JSON.stringify({
    formato: "impegni-backup", versione: 1, esportato_il: adessoISO(),
    impegni: Object.values(stato.impegni), chiusure: Object.values(stato.chiusure),
    impostazioni: stato.impostazioni,
  }, null, 2);
}

export function importa(testo) {
  const d = JSON.parse(testo);
  if (d.formato !== "impegni-backup" || !Array.isArray(d.impegni)) throw new Error("File non riconosciuto");
  const n = d.impegni.length;
  applicaRemoto({ impegni: d.impegni, chiusure: d.chiusure || [], impostazioni: d.impostazioni || null });
  // Dopo un import, tutto va rispinto sul server se collegato.
  for (const i of d.impegni) segnaPending(i.id);
  for (const c of d.chiusure || []) if (!stato.sync.pendingChiusure.includes(c.data)) stato.sync.pendingChiusure.push(c.data);
  stato.sync.pendingImpostazioni = true;
  notifica();
  return n;
}

export function cancellaTutto() {
  stato = statoVuoto();
  notifica();
}
