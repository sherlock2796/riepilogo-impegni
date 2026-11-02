// Decide quali notifiche mandare "adesso" a un utente. Modulo puro, senza
// dipendenze dal browser: gira nei test (Node) e nella Edge Function di
// Supabase (Deno), che lo importa dall'indirizzo pubblicato dell'app.

import { scegliFrase } from "./frasi.js";

export const NOTIFICHE_DEFAULT = {
  mattino: true, oraMattino: "07:30",     // riepilogo della giornata
  promemoria: true, anticipo: 10,         // minuti prima di un impegno con orario
  scadenze: true, oraScadenze: "18:00",   // "ultimo giorno!" per le scadenze non fatte
  fuso: "Europe/Rome",
};

// Il controllo gira ogni minuto, ma può saltare o arrivare in ritardo:
// una notifica si manda se l'orario è passato da meno di questi minuti.
export const FINESTRA_MINUTI = 10;

const GIORNI = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Data e ora locali nel fuso dell'utente: { oggi: "YYYY-MM-DD", minuti: 0..1439, giornoSettimana: 0=lun }. */
export function oraLocale(adesso = new Date(), fuso = "Europe/Rome") {
  const opzioni = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" };
  let f;
  try { f = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, ...opzioni }); }
  catch { f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", ...opzioni }); }
  const p = Object.fromEntries(f.formatToParts(adesso).map((x) => [x.type, x.value]));
  return {
    oggi: `${p.year}-${p.month}-${p.day}`,
    minuti: (Number(p.hour) % 24) * 60 + Number(p.minute),
    giornoSettimana: GIORNI.indexOf(p.weekday),
  };
}

export function spostaGiorno(iso, n) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, g + n)).toISOString().slice(0, 10);
}

const minutiDi = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const inFinestra = (target, adesso) => adesso - target >= 0 && adesso - target < FINESTRA_MINUTI;
const ordinePriorita = { Alta: 0, Media: 1, Bassa: 2 };

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

/**
 * Notifiche da mandare in questo momento.
 * @param adesso        Date
 * @param notifiche     preferenze (vedi NOTIFICHE_DEFAULT)
 * @param impegni       impegni dell'utente (almeno quelli di ieri, oggi e gli arretrati)
 * @param inviate       Set di chiavi già inviate (per non ripetere)
 * @param impostazioni  impostazioni dell'utente (per le frasi personalizzate)
 * @returns [{ chiave, titolo, corpo, url, tag }]
 */
export function pianifica({ adesso = new Date(), notifiche = {}, impegni = [], inviate = new Set(), impostazioni = {} } = {}) {
  const n = { ...NOTIFICHE_DEFAULT, ...notifiche };
  const { oggi, minuti, giornoSettimana } = oraLocale(adesso, n.fuso);
  const ieri = spostaGiorno(oggi, -1);
  const vivi = impegni.filter((i) => !i.eliminato);
  const daFare = ordina(vivi.filter((i) => i.data === oggi && !i.fatto));
  const scadenzeOggi = daFare.filter((i) => i.scadenza);
  const arretrati = vivi.filter((i) => !i.fatto && i.data < oggi).length;
  const out = [];

  // --- riepilogo del mattino ---------------------------------------------------
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
        extra: impostazioni.frasiExtra || [], nascoste: impostazioni.frasiNascoste || [], seed: `${oggi}:notifica`,
      });
      const righe = daFare.slice(0, 4).map((i) => `${i.ora ? i.ora + " " : ""}${i.titolo}${i.scadenza ? " (entro oggi)" : ""}`);
      if (daFare.length > 4) righe.push(`+${daFare.length - 4} ${daFare.length - 4 === 1 ? "altro" : "altri"}`);
      const pezzi = [];
      if (righe.length) pezzi.push(righe.join(" · "));
      if (arretrati) pezzi.push(`${arretrati} ${arretrati === 1 ? "arretrato" : "arretrati"} da sistemare`);
      pezzi.push(frase);
      out.push({
        chiave,
        titolo: daFare.length ? `Buongiorno! ${daFare.length === 1 ? "1 impegno" : daFare.length + " impegni"} oggi` : "Buongiorno! Oggi niente in lista",
        corpo: pezzi.join("\n"),
        url: "./#/oggi", tag: "mattino",
      });
    }
  }

  // --- promemoria all'ora dell'impegno --------------------------------------------
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
        corpo: [i.ora, i.tipo].filter(Boolean).join(" · ") + (i.note ? `\n${String(i.note).slice(0, 120)}` : ""),
        url: "./#/oggi", tag: `impegno-${i.id}`,
      });
    }
  }

  // --- scadenze: ultimo giorno ---------------------------------------------------------
  if (n.scadenze && scadenzeOggi.length && inFinestra(minutiDi(n.oraScadenze), minuti)) {
    for (const i of scadenzeOggi) {
      const chiave = `scadenza:${i.id}:${oggi}`;
      if (inviate.has(chiave)) continue;
      out.push({
        chiave,
        titolo: `Ultimo giorno! ${i.titolo}`,
        corpo: "Scade oggi e non è ancora spuntato. Forza, che poi ti senti meglio.",
        url: "./#/oggi", tag: `scadenza-${i.id}`,
      });
    }
  }

  return out;
}
