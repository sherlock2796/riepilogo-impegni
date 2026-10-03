// Utilità per le date. Tutto lavora in ora locale del dispositivo e con
// stringhe ISO "YYYY-MM-DD" per i giorni, così niente sorprese di fuso.

export const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
export const GIORNI_BREVI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
export const GIORNI_LETTERA = ["L", "M", "M", "G", "V", "S", "D"];
export const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu",
  "lug", "ago", "set", "ott", "nov", "dic"];

const due = (n) => String(n).padStart(2, "0");

/** Data -> "YYYY-MM-DD" in ora locale. */
export function aISO(d) {
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
}

/** "YYYY-MM-DD" -> Date a mezzanotte locale. */
export function daISO(iso) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(a, m - 1, g);
}

export function oggiISO(adesso = new Date()) {
  return aISO(adesso);
}

export function aggiungiGiorni(iso, n) {
  const d = daISO(iso);
  d.setDate(d.getDate() + n);
  return aISO(d);
}

export function aggiungiMesi(iso, n) {
  const d = daISO(iso);
  const giorno = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(giorno, ultimo));
  return aISO(d);
}

export function aggiungiAnni(iso, n) {
  const d = daISO(iso);
  const giorno = d.getDate();
  d.setDate(1);
  d.setFullYear(d.getFullYear() + n);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(giorno, ultimo));
  return aISO(d);
}

/** Giorno della settimana 0 = lunedì ... 6 = domenica. */
export function giornoSettimana(iso) {
  return (daISO(iso).getDay() + 6) % 7;
}

export function lunediDi(iso) {
  return aggiungiGiorni(iso, -giornoSettimana(iso));
}

/** Differenza in giorni b - a. */
export function differenzaGiorni(a, b) {
  return Math.round((daISO(b) - daISO(a)) / 86400000);
}

/** "Venerdì 3 ottobre" */
export function formattaLunga(iso, conAnno = false) {
  const d = daISO(iso);
  const base = `${GIORNI[giornoSettimana(iso)]} ${d.getDate()} ${MESI[d.getMonth()]}`;
  return conAnno ? `${base} ${d.getFullYear()}` : base;
}

/** "3 ott" */
export function formattaBreve(iso) {
  const d = daISO(iso);
  return `${d.getDate()} ${MESI_BREVI[d.getMonth()]}`;
}

/** "Oggi", "Domani", "Ieri", "Lunedì 6 ott", "3 ott 2027" */
export function etichettaRelativa(iso, oggi = oggiISO()) {
  const diff = differenzaGiorni(oggi, iso);
  if (diff === 0) return "Oggi";
  if (diff === 1) return "Domani";
  if (diff === -1) return "Ieri";
  if (diff === 2) return "Dopodomani";
  if (diff > 1 && diff < 7) return GIORNI[giornoSettimana(iso)];
  const d = daISO(iso);
  const stessoAnno = d.getFullYear() === daISO(oggi).getFullYear();
  return `${GIORNI_BREVI[giornoSettimana(iso)]} ${d.getDate()} ${MESI_BREVI[d.getMonth()]}${stessoAnno ? "" : " " + d.getFullYear()}`;
}

/** Quanto è in ritardo un impegno: "da ieri", "da 3 giorni". */
export function ritardo(iso, oggi = oggiISO()) {
  const n = differenzaGiorni(iso, oggi);
  if (n <= 0) return "";
  if (n === 1) return "da ieri";
  if (n < 7) return `da ${n} giorni`;
  if (n < 14) return "da una settimana";
  if (n < 30) return `da ${Math.floor(n / 7)} settimane`;
  return "da più di un mese";
}

export function oraAdesso(adesso = new Date()) {
  return `${due(adesso.getHours())}:${due(adesso.getMinutes())}`;
}

export function adessoISO() {
  return new Date().toISOString();
}

/** Momento della giornata in base all'ora. */
export function momentoDelGiorno(adesso = new Date()) {
  const h = adesso.getHours();
  if (h < 6) return "notte";
  if (h < 13) return "mattina";
  if (h < 18) return "pomeriggio";
  return "sera";
}

export function eWeekend(iso) {
  return giornoSettimana(iso) >= 5;
}
