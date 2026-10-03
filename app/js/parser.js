// Inserimento in linguaggio naturale, senza alcun servizio esterno.
// "dentista martedì alle 15, alta" -> titolo, data, ora, priorità, tipo, ricorrenza.
//
// Si lavora su una copia normalizzata (minuscole, senza accenti) lunga
// esattamente quanto l'originale, così gli intervalli riconosciuti si
// possono togliere dal testo originale per ricavare il titolo.

import { oggiISO, aggiungiGiorni, aggiungiMesi, giornoSettimana, daISO, aISO } from "./date.js";
import { allineaData } from "./ricorrenze.js";

const GIORNI_NOME = { lunedi: 0, martedi: 1, mercoledi: 2, giovedi: 3, venerdi: 4, sabato: 5, domenica: 6 };
const MESI_NOME = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
};
const NUMERI = {
  un: 1, una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7,
  otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20, trenta: 30,
};
const G = "lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica";
const M = Object.keys(MESI_NOME).join("|");
const N = "\\d{1,2}|" + Object.keys(NUMERI).join("|");

const PAROLE_SPORT = /\b(sport|palestra|cors[ao]|correre|allenament[oi]|allenarmi|allenarsi|nuoto|piscina|bici|bicicletta|ciclismo|calci[oa]|calcetto|tennis|padel|yoga|pilates|trekking|camminata|escursione|partita|stretching|crossfit|basket|pallavolo|sci|arrampicata)\b/;
const PAROLE_CASA = /\b(casa|spesa|pulizie|pulire|lavatrice|bucato|stirare|bollett[ae]|affitto|idraulico|elettricista|giardino|cucinare|aspirapolvere|riordinare|immondizia|spazzatura|rifiuti|lavastoviglie|frigo|caldaia|condominio|manutenzione|riparare|aggiustare|lampadina|lenzuola|asciugatrice)\b/;

function numero(s) {
  if (s === undefined) return undefined;
  return /^\d+$/.test(s) ? Number(s) : NUMERI[s];
}

function normalizzaTesto(testo) {
  // Un carattere alla volta, così la lunghezza resta identica all'originale
  // (anche con emoji e altri simboli lunghi due unità).
  let out = "";
  for (const ch of testo) {
    let b = (ch.normalize("NFD")[0] || ch).toLowerCase();
    if (b.length !== ch.length) b = "\u0001".repeat(ch.length);
    out += b;
  }
  // Apostrofi tipografici -> apostrofo semplice (stessa lunghezza)
  return out.replace(/[’‘`]/g, "'");
}

export function analizza(testo, oggi = oggiISO()) {
  const originale = String(testo || "");
  const norm = normalizzaTesto(originale);
  const spans = [];
  const trovati = { data: false, ora: false, priorita: false, tipo: false, ricorrenza: false };

  const libero = (a, b) => spans.every(([x, y]) => b <= x || a >= y);
  const prendi = (re) => {
    const r = new RegExp(re.source, "gi");
    let m;
    while ((m = r.exec(norm))) {
      const a = m.index, b = a + m[0].length;
      if (libero(a, b)) { spans.push([a, b]); return m; }
    }
    return null;
  };

  let data = null, ora = null, priorita = null, tipo = null, ricorrenza = null;
  const gsOggi = giornoSettimana(oggi);
  const prossimoGiorno = (g, includiOggi = false) => {
    let avanti = (g - gsOggi + 7) % 7;
    if (avanti === 0 && !includiOggi) avanti = 7;
    return aggiungiGiorni(oggi, avanti);
  };

  // --- ricorrenze -----------------------------------------------------------
  let m;
  if ((m = prendi(new RegExp(`\\b(?:ogni|tutti i|tutte le)\\s+((?:${G})(?:\\s*(?:,|e)\\s*(?:${G}))*)\\b`)))) {
    const giorni = [...m[1].matchAll(new RegExp(G, "g"))].map((x) => GIORNI_NOME[x[0]]);
    ricorrenza = { tipo: "settimane", ogni: 1, giorniSettimana: [...new Set(giorni)].sort() };
  } else if ((m = prendi(/\b(?:ogni giorno|tutti i giorni|ogni mattina|ogni sera|giornalmente|quotidianamente)\b/))) {
    ricorrenza = { tipo: "giorni", ogni: 1 };
  } else if ((m = prendi(new RegExp(`\\bogni\\s+(${N})\\s+giorni\\b`)))) {
    ricorrenza = { tipo: "giorni", ogni: numero(m[1]) || 1 };
  } else if ((m = prendi(new RegExp(`\\bogni\\s+(?:(${N})\\s+)?settiman[ae]\\b`)))) {
    ricorrenza = { tipo: "settimane", ogni: numero(m[1]) || 1 };
  } else if ((m = prendi(/\b(?:settimanalmente|a settimana|alla settimana)\b/))) {
    ricorrenza = { tipo: "settimane", ogni: 1 };
  } else if ((m = prendi(new RegExp(`\\bogni\\s+(?:(${N})\\s+)?mes[ei]\\b`)))) {
    ricorrenza = { tipo: "mesi", ogni: numero(m[1]) || 1 };
  } else if ((m = prendi(/\b(?:mensilmente|al mese)\b/))) {
    ricorrenza = { tipo: "mesi", ogni: 1 };
  } else if ((m = prendi(/\bogni\s+(?:(\d{1,2}|due|tre)\s+)?ann[oi]\b/))) {
    ricorrenza = { tipo: "anni", ogni: numero(m[1]) || 1 };
  }
  if (ricorrenza) trovati.ricorrenza = true;

  // --- ora (con prefisso esplicito) ------------------------------------------
  const RE_ORA = new RegExp(
    `\\b(?:alle ore|alle|ore|h)\\s*(${N})(?:\\s*[:.,]\\s*(\\d{2}))?` +
    `(?:\\s+(e mezza|e mezzo|e un quarto|e tre quarti|meno un quarto))?` +
    `(?:\\s+(di mattina|del mattino|di pomeriggio|del pomeriggio|di sera|della sera|di notte))?`
  );
  const applicaOra = (h, min, frazione, parte) => {
    if (h === undefined || h > 23 || min > 59) return false;
    if (frazione === "e mezza" || frazione === "e mezzo") min = 30;
    else if (frazione === "e un quarto") min = 15;
    else if (frazione === "e tre quarti") min = 45;
    else if (frazione === "meno un quarto") { min = 45; h = (h + 23) % 24; }
    const pomeriggio = parte && /pomeriggio|sera|notte/.test(parte);
    const mattina = parte && /mattin/.test(parte);
    if (h <= 11 && pomeriggio) h += 12;
    else if (!mattina && !parte && h >= 1 && h <= 6) h += 12; // "alle 3" = 15:00
    if (h > 23) return false;
    ora = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    return true;
  };
  if ((m = prendi(RE_ORA))) {
    if (!applicaOra(numero(m[1]), Number(m[2] || 0), m[3], m[4])) spans.pop();
  }
  if (!ora && (m = prendi(/\b(?:a )?mezzogiorno\b/))) ora = "12:00";

  // --- data --------------------------------------------------------------------
  if ((m = prendi(/\bdopodomani\b/))) data = aggiungiGiorni(oggi, 2);
  else if ((m = prendi(/\bdomani\b/))) data = aggiungiGiorni(oggi, 1);
  else if ((m = prendi(/\b(?:oggi|stasera|stamattina|stanotte|stamani)\b/))) data = oggi;
  else if ((m = prendi(new RegExp(`\\b(?:fra|tra)\\s+(${N})\\s+(giorn[oi]|settiman[ae]|mes[ei])\\b`)))) {
    const n = numero(m[1]) || 1;
    data = m[2].startsWith("giorn") ? aggiungiGiorni(oggi, n)
      : m[2].startsWith("settiman") ? aggiungiGiorni(oggi, 7 * n) : aggiungiMesi(oggi, n);
  } else if ((m = prendi(/\b(?:la )?(?:settimana prossima|prossima settimana)\b/))) {
    data = aggiungiGiorni(oggi, 7);
  } else if ((m = prendi(/\b(?:il )?(?:mese prossimo|prossimo mese)\b/))) {
    data = aggiungiMesi(oggi, 1);
  } else if ((m = prendi(new RegExp(`\\b(?:il |questo |il prossimo |prossimo )?(${G})\\s+(\\d{1,2})(?:\\s+(${M}))?(?:\\s+(\\d{4}))?\\b(?!\\s*[:.]\\d)`)))) {
    // "lunedì 6" o "lunedì 6 ottobre": il numero comanda, il nome del giorno aiuta solo a leggere.
    const g = Number(m[2]);
    const o = daISO(oggi);
    let d;
    if (m[3]) {
      const anno = m[4] ? Number(m[4]) : o.getFullYear();
      d = new Date(anno, MESI_NOME[m[3]], g);
      if (!m[4] && aISO(d) < oggi) d = new Date(anno + 1, MESI_NOME[m[3]], g);
    } else {
      d = new Date(o.getFullYear(), o.getMonth(), g);
      if (d.getDate() !== g || aISO(d) < oggi) d = new Date(o.getFullYear(), o.getMonth() + 1, g);
    }
    if (d.getDate() === g) data = aISO(d); else spans.pop();
  } else if ((m = prendi(new RegExp(`\\b(?:il |l')?(\\d{1,2})\\s+(${M})(?:\\s+(\\d{4}))?\\b`)))) {
    const g = Number(m[1]), mese = MESI_NOME[m[2]];
    const anno = m[3] ? Number(m[3]) : daISO(oggi).getFullYear();
    let d = new Date(anno, mese, g);
    if (!m[3] && aISO(d) < oggi) d = new Date(anno + 1, mese, g);
    if (d.getDate() === g) data = aISO(d); else spans.pop();
  } else if ((m = prendi(/\b(?:il |l')?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/))) {
    const g = Number(m[1]), mese = Number(m[2]) - 1;
    let anno = m[3] ? Number(m[3]) : daISO(oggi).getFullYear();
    if (anno < 100) anno += 2000;
    if (mese >= 0 && mese <= 11) {
      let d = new Date(anno, mese, g);
      if (!m[3] && aISO(d) < oggi) d = new Date(anno + 1, mese, g);
      if (d.getDate() === g) data = aISO(d); else spans.pop();
    } else spans.pop();
  } else if ((m = prendi(new RegExp(`\\b(?:il |questo |il prossimo |prossimo |di )?(${G})(?:\\s+prossimo)?\\b`)))) {
    data = prossimoGiorno(GIORNI_NOME[m[1]], false);
  } else if ((m = prendi(/\bil\s+(\d{1,2})\b(?!\s*[:.]\d)/))) {
    const g = Number(m[1]);
    const o = daISO(oggi);
    let d = new Date(o.getFullYear(), o.getMonth(), g);
    if (d.getDate() !== g || aISO(d) < oggi) d = new Date(o.getFullYear(), o.getMonth() + 1, g);
    if (d.getDate() === g) data = aISO(d); else spans.pop();
  } else if ((m = prendi(/\b(?:nel |questo )?(?:weekend|fine settimana)\b/))) {
    data = prossimoGiorno(5, true);
  }
  if (data) trovati.data = true;

  // --- ora senza prefisso: "15:30" ---------------------------------------------
  if (!ora && (m = prendi(/\b(\d{1,2}):(\d{2})\b/))) {
    if (!applicaOra(Number(m[1]), Number(m[2]), undefined, "di mattina")) spans.pop();
  }
  if (ora) trovati.ora = true;

  // Se l'ora è nota, "mattina/pomeriggio/sera" accanto alla data non aggiunge nulla al titolo.
  if (ora && data) {
    while ((m = prendi(/\b(?:di |la |in |al |nel )?(?:mattina|mattino|pomeriggio|sera|serata|notte)\b/))) { /* consumato */ }
  }

  // --- priorità ---------------------------------------------------------------
  if ((m = prendi(/\b(?:urgentissim[oa]|urgente|importante|importantissim[oa]|priorita alta|alta priorita|alta|prioritario|fondamentale)\b/))) priorita = "Alta";
  else if ((m = prendi(/\b(?:priorita bassa|bassa priorita|bassa|quando posso|con calma|se riesco|prima o poi|senza fretta)\b/))) priorita = "Bassa";
  else if ((m = prendi(/\b(?:priorita media|media priorita)\b/))) priorita = "Media";
  if (priorita) trovati.priorita = true;

  // --- tipo: etichetta esplicita in coda, altrimenti si indovina ----------------
  if ((m = prendi(/(?:,|#)\s*(sport|casa|personale)\s*$/))) {
    tipo = m[1][0].toUpperCase() + m[1].slice(1);
    trovati.tipo = true;
  } else if (PAROLE_SPORT.test(norm)) tipo = "Sport";
  else if (PAROLE_CASA.test(norm)) tipo = "Casa";

  // --- titolo: tutto quello che resta --------------------------------------------
  let titolo = "";
  for (let i = 0; i < originale.length; i++) {
    if (libero(i, i + 1)) titolo += originale[i];
  }
  titolo = titolo
    .replace(/\s+/g, " ")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, "")
    .trim();
  // Preposizioni rimaste appese in coda ("dentista alle" -> "dentista")
  let prima;
  do {
    prima = titolo;
    titolo = titolo.replace(/\s+(?:alle|il|di|a|per|da|in|con|e|ogni|del|della|al|alla|nel|nella|lo|la|i|gli|le|entro|fino|fino a)$/i, "").trim();
    titolo = titolo.replace(/^(?:e|ed|poi|entro|,)\s+/i, "").trim();
    titolo = titolo.replace(/[\s,;:.\-–]+$/g, "").trim();
  } while (titolo !== prima);
  if (titolo) titolo = titolo[0].toUpperCase() + titolo.slice(1);

  // --- data di default e allineamento alla ricorrenza ----------------------------
  if (!data) data = oggi;
  if (ricorrenza) data = allineaData(data, ricorrenza) || data;

  return { titolo, data, ora, priorita: priorita || "Media", tipo: tipo || "Personale", ricorrenza, trovati };
}
