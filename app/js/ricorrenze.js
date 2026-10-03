// Impegni ricorrenti. Una ricorrenza è un oggetto:
//   { tipo: "giorni"|"settimane"|"mesi"|"anni", ogni: n, giorniSettimana?: [0..6] }
// con 0 = lunedì. Quando un impegno ricorrente viene spuntato, l'app crea
// la ricorrenza successiva a partire dalla data dell'impegno.

import { aggiungiGiorni, aggiungiMesi, aggiungiAnni, giornoSettimana, lunediDi, GIORNI } from "./date.js";

export function normalizza(r) {
  if (!r || !r.tipo) return null;
  const ogni = Math.max(1, Math.min(365, Number(r.ogni) || 1));
  const out = { tipo: r.tipo, ogni };
  if (r.tipo === "settimane" && Array.isArray(r.giorniSettimana) && r.giorniSettimana.length) {
    out.giorniSettimana = [...new Set(r.giorniSettimana.map(Number))].filter((g) => g >= 0 && g <= 6).sort();
  }
  return out;
}

/** Data della ricorrenza successiva a `data`. */
export function prossimaData(data, r) {
  r = normalizza(r);
  if (!r) return null;
  switch (r.tipo) {
    case "giorni":
      return aggiungiGiorni(data, r.ogni);
    case "settimane": {
      if (!r.giorniSettimana || !r.giorniSettimana.length) return aggiungiGiorni(data, 7 * r.ogni);
      const gs = giornoSettimana(data);
      const dopo = r.giorniSettimana.find((g) => g > gs);
      if (dopo !== undefined) return aggiungiGiorni(data, dopo - gs);
      const lunedi = aggiungiGiorni(lunediDi(data), 7 * r.ogni);
      return aggiungiGiorni(lunedi, r.giorniSettimana[0]);
    }
    case "mesi":
      return aggiungiMesi(data, r.ogni);
    case "anni":
      return aggiungiAnni(data, r.ogni);
    default:
      return null;
  }
}

/** Prima data valida uguale o successiva a `data` per la ricorrenza. */
export function allineaData(data, r) {
  r = normalizza(r);
  if (!r || r.tipo !== "settimane" || !r.giorniSettimana?.length) return data;
  const gs = giornoSettimana(data);
  if (r.giorniSettimana.includes(gs)) return data;
  return prossimaData(data, r);
}

/** Descrizione in italiano: "ogni lunedì e giovedì", "ogni 2 settimane". */
export function descrivi(r) {
  r = normalizza(r);
  if (!r) return "";
  const n = r.ogni;
  switch (r.tipo) {
    case "giorni":
      return n === 1 ? "ogni giorno" : `ogni ${n} giorni`;
    case "settimane": {
      if (r.giorniSettimana?.length) {
        const nomi = r.giorniSettimana.map((g) => GIORNI[g].toLowerCase());
        const lista = nomi.length === 1 ? nomi[0]
          : nomi.slice(0, -1).join(", ") + " e " + nomi[nomi.length - 1];
        return n === 1 ? `ogni ${lista}` : `ogni ${n} settimane, ${lista}`;
      }
      return n === 1 ? "ogni settimana" : `ogni ${n} settimane`;
    }
    case "mesi":
      return n === 1 ? "ogni mese" : `ogni ${n} mesi`;
    case "anni":
      return n === 1 ? "ogni anno" : `ogni ${n} anni`;
    default:
      return "";
  }
}
