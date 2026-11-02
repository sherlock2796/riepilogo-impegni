// Test della logica delle notifiche (cosa mandare e quando).
// Esegui con: node --test tests/notifiche.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pianifica, oraLocale, spostaGiorno, NOTIFICHE_DEFAULT, FINESTRA_MINUTI } from "../app/js/notifiche-logica.js";

// Istante "adesso" dato come ora locale di Roma (2 novembre 2026, lunedì).
const roma = (hhmm, giorno = "2026-11-02") => new Date(`${giorno}T${hhmm}:00+01:00`); // CET a novembre
const impegni = [
  { id: "a", titolo: "Dentista", data: "2026-11-02", ora: "12:00", tipo: "Personale", priorita: "Media", fatto: false, eliminato: false },
  { id: "b", titolo: "Aspirapolvere", data: "2026-11-02", ora: "17:00", tipo: "Casa", priorita: "Media", fatto: false, eliminato: false },
  { id: "c", titolo: "Già fatto", data: "2026-11-02", ora: "08:00", tipo: "Casa", priorita: "Media", fatto: true, eliminato: false },
  { id: "d", titolo: "Lettiera", data: "2026-11-02", ora: null, tipo: "Personale", priorita: "Media", fatto: false, eliminato: false, scadenza: true },
  { id: "e", titolo: "Domani", data: "2026-11-03", ora: "09:00", tipo: "Personale", priorita: "Media", fatto: false, eliminato: false },
  { id: "f", titolo: "Vecchio", data: "2026-10-20", ora: null, tipo: "Personale", priorita: "Media", fatto: false, eliminato: false },
  { id: "g", titolo: "Ieri fatto", data: "2026-11-01", ora: null, tipo: "Personale", priorita: "Media", fatto: true, eliminato: false },
  { id: "h", titolo: "Eliminato", data: "2026-11-02", ora: "12:00", tipo: "Personale", priorita: "Media", fatto: false, eliminato: true },
];

test("oraLocale e spostaGiorno rispettano il fuso", () => {
  const r = oraLocale(new Date("2026-11-02T06:35:00Z"), "Europe/Rome");
  assert.equal(r.oggi, "2026-11-02");
  assert.equal(r.minuti, 7 * 60 + 35);
  assert.equal(r.giornoSettimana, 0);
  const t = oraLocale(new Date("2026-11-02T23:30:00Z"), "Europe/Rome");
  assert.equal(t.oggi, "2026-11-03", "dopo mezzanotte a Roma è già domani");
  const m = oraLocale(new Date("2026-11-02T23:30:00Z"), "UTC");
  assert.equal(m.oggi, "2026-11-02");
  assert.equal(m.minuti, 23 * 60 + 30);
  assert.equal(spostaGiorno("2026-11-01", -1), "2026-10-31");
  assert.equal(spostaGiorno("2026-12-31", 1), "2027-01-01");
  const fusoSbagliato = oraLocale(new Date("2026-11-02T06:35:00Z"), "Marte/Olympus");
  assert.equal(fusoSbagliato.oggi, "2026-11-02", "fuso sconosciuto: si ripiega su Roma");
});

test("riepilogo del mattino: all'ora giusta, una volta sola, con il contenuto atteso", () => {
  let out = pianifica({ adesso: roma("07:30"), impegni });
  assert.equal(out.length, 1);
  const m = out[0];
  assert.equal(m.chiave, "mattino:2026-11-02");
  assert.equal(m.titolo, "Buongiorno! 3 impegni oggi");
  assert.match(m.corpo, /12:00 Dentista · 17:00 Aspirapolvere · Lettiera \(entro oggi\)/);
  assert.match(m.corpo, /1 arretrato da sistemare/);
  assert.ok(m.corpo.split("\n").length >= 3, "c'è anche la frase");
  // dentro la finestra di tolleranza sì, fuori no
  assert.equal(pianifica({ adesso: roma("07:39"), impegni }).length, 1);
  assert.equal(pianifica({ adesso: roma("07:40"), impegni }).length, 0);
  assert.equal(pianifica({ adesso: roma("07:29"), impegni }).length, 0);
  // già inviata: niente
  assert.equal(pianifica({ adesso: roma("07:30"), impegni, inviate: new Set(["mattino:2026-11-02"]) }).length, 0);
  // disattivata
  assert.equal(pianifica({ adesso: roma("07:30"), impegni, notifiche: { mattino: false } }).length, 0);
  // orario personalizzato
  out = pianifica({ adesso: roma("06:05"), impegni, notifiche: { oraMattino: "06:00" } });
  assert.equal(out.length, 1);
});

test("mattino senza impegni: saluto breve con la frase per la giornata vuota", () => {
  const out = pianifica({ adesso: roma("07:30"), impegni: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].titolo, "Buongiorno! Oggi niente in lista");
  assert.ok(out[0].corpo.length > 10);
});

test("promemoria con anticipo, per impegni con orario non ancora fatti", () => {
  let out = pianifica({ adesso: roma("11:50"), impegni });
  assert.equal(out.length, 1);
  assert.equal(out[0].chiave, "impegno:a:2026-11-02");
  assert.equal(out[0].titolo, "Tra 10 minuti: Dentista");
  assert.equal(out[0].corpo, "12:00 · Personale");
  // già fatto o eliminato: niente
  assert.equal(pianifica({ adesso: roma("07:50"), impegni }).length, 0, "'Già fatto' alle 8 non suona");
  // anticipo 0 -> "Adesso"
  out = pianifica({ adesso: roma("17:00"), impegni, notifiche: { anticipo: 0 } });
  assert.equal(out[0].titolo, "Adesso: Aspirapolvere");
  // promemoria spenti
  assert.equal(pianifica({ adesso: roma("11:50"), impegni, notifiche: { promemoria: false } }).length, 0);
  // in ritardo di 9 minuti il controllo manda ancora, a 10 no
  assert.equal(pianifica({ adesso: roma("11:59"), impegni }).length, 1);
  assert.equal(pianifica({ adesso: roma("12:00"), impegni }).length, 0);
});

test("scadenze: avviso dell'ultimo giorno all'ora scelta, solo se non fatte", () => {
  let out = pianifica({ adesso: roma("18:00"), impegni });
  assert.equal(out.length, 1);
  assert.equal(out[0].chiave, "scadenza:d:2026-11-02");
  assert.match(out[0].titolo, /Ultimo giorno! Lettiera/);
  const fatta = impegni.map((i) => (i.id === "d" ? { ...i, fatto: true } : i));
  assert.equal(pianifica({ adesso: roma("18:00"), impegni: fatta }).length, 0);
  out = pianifica({ adesso: roma("20:03"), impegni, notifiche: { oraScadenze: "20:00" } });
  assert.equal(out.length, 1);
  assert.equal(pianifica({ adesso: roma("18:00"), impegni, notifiche: { scadenze: false } }).length, 0);
});

test("più notifiche nello stesso minuto e nessuna fuori orario", () => {
  const due = [...impegni, { id: "z", titolo: "Riunione", data: "2026-11-02", ora: "07:40", tipo: "Personale", priorita: "Alta", fatto: false, eliminato: false }];
  const out = pianifica({ adesso: roma("07:30"), impegni: due });
  assert.deepEqual(out.map((x) => x.chiave).sort(), ["impegno:z:2026-11-02", "mattino:2026-11-02"]);
  assert.equal(pianifica({ adesso: roma("15:00"), impegni }).length, 0);
  assert.equal(FINESTRA_MINUTI, 10);
  assert.equal(NOTIFICHE_DEFAULT.oraMattino, "07:30");
});

test("fuso diverso: l'orario si valuta nel fuso dell'utente", () => {
  // 07:30 a Londra = 08:30 a Roma
  const out = pianifica({ adesso: new Date("2026-11-02T07:30:00Z"), impegni, notifiche: { fuso: "Europe/London" } });
  assert.equal(out.length, 1);
  assert.equal(out[0].chiave, "mattino:2026-11-02");
  assert.equal(pianifica({ adesso: new Date("2026-11-02T07:30:00Z"), impegni }).length, 0, "a Roma sono le 8:30");
});
