// Esegui con: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { analizza } from "../app/js/parser.js";
import { prossimaData, descrivi } from "../app/js/ricorrenze.js";

// Sabato 3 ottobre 2026
const OGGI = "2026-10-03";

test("dentista martedì alle 15, alta", () => {
  const r = analizza("dentista martedì alle 15, alta", OGGI);
  assert.equal(r.titolo, "Dentista");
  assert.equal(r.data, "2026-10-06");
  assert.equal(r.ora, "15:00");
  assert.equal(r.priorita, "Alta");
  assert.equal(r.tipo, "Personale");
  assert.equal(r.ricorrenza, null);
});

test("domani e dopodomani", () => {
  assert.equal(analizza("chiamare mamma domani", OGGI).data, "2026-10-04");
  assert.equal(analizza("dopodomani spesa", OGGI).data, "2026-10-05");
  assert.equal(analizza("dopodomani spesa", OGGI).tipo, "Casa");
  assert.equal(analizza("dopodomani spesa", OGGI).titolo, "Spesa");
});

test("orari in forme diverse", () => {
  assert.equal(analizza("riunione alle 9:30", OGGI).ora, "09:30");
  assert.equal(analizza("riunione alle 9 e mezza", OGGI).ora, "09:30");
  assert.equal(analizza("riunione ore 18.15", OGGI).ora, "18:15");
  assert.equal(analizza("riunione alle tre del pomeriggio", OGGI).ora, "15:00");
  assert.equal(analizza("riunione alle 3", OGGI).ora, "15:00");
  assert.equal(analizza("riunione alle 8", OGGI).ora, "08:00");
  assert.equal(analizza("pranzo a mezzogiorno", OGGI).ora, "12:00");
  assert.equal(analizza("call 16:45 con Luca", OGGI).ora, "16:45");
  assert.equal(analizza("call 16:45 con Luca", OGGI).titolo, "Call con Luca");
});

test("date numeriche e con il mese", () => {
  assert.equal(analizza("compleanno Anna il 12/10", OGGI).data, "2026-10-12");
  assert.equal(analizza("compleanno Anna 12/10", OGGI).data, "2026-10-12");
  assert.equal(analizza("visita il 2 gennaio", OGGI).data, "2027-01-02");
  assert.equal(analizza("visita 5 novembre 2027", OGGI).data, "2027-11-05");
  assert.equal(analizza("bolletta il 15", OGGI).data, "2026-10-15");
  assert.equal(analizza("bolletta il 15", OGGI).tipo, "Casa");
  assert.equal(analizza("bolletta il 1", OGGI).data, "2026-11-01");
  assert.equal(analizza("fra 3 giorni", OGGI).data, "2026-10-06");
  assert.equal(analizza("tra una settimana revisione", OGGI).data, "2026-10-10");
  assert.equal(analizza("settimana prossima dentista", OGGI).data, "2026-10-10");
});

test("giorno della settimana uguale a oggi va alla settimana dopo", () => {
  assert.equal(analizza("venerdì aperitivo", OGGI).data, "2026-10-09");
  assert.equal(analizza("sabato corsa", OGGI).data, "2026-10-10");
  assert.equal(analizza("sabato corsa", OGGI).tipo, "Sport");
});

test("ricorrenze", () => {
  let r = analizza("palestra ogni lunedì e mercoledì alle 19", OGGI);
  assert.deepEqual(r.ricorrenza, { tipo: "settimane", ogni: 1, giorniSettimana: [0, 2] });
  assert.equal(r.data, "2026-10-05"); // lunedì prossimo
  assert.equal(r.ora, "19:00");
  assert.equal(r.titolo, "Palestra");
  assert.equal(r.tipo, "Sport");

  r = analizza("innaffiare le piante ogni 3 giorni", OGGI);
  assert.deepEqual(r.ricorrenza, { tipo: "giorni", ogni: 3 });
  assert.equal(r.titolo, "Innaffiare le piante");

  r = analizza("affitto ogni mese il 1", OGGI);
  assert.deepEqual(r.ricorrenza, { tipo: "mesi", ogni: 1 });
  assert.equal(r.data, "2026-11-01");

  r = analizza("pulizie tutti i sabati", OGGI);
  assert.equal(r.ricorrenza, null); // plurale non supportato: resta nel titolo
  r = analizza("pulizie ogni sabato", OGGI);
  assert.deepEqual(r.ricorrenza.giorniSettimana, [5]);
  assert.equal(r.data, "2026-10-03"); // oggi è sabato: vale già oggi

  r = analizza("backup ogni 2 settimane", OGGI);
  assert.deepEqual(r.ricorrenza, { tipo: "settimane", ogni: 2 });
});

test("priorità e tipo esplicito", () => {
  assert.equal(analizza("rinnovare passaporto urgente", OGGI).priorita, "Alta");
  assert.equal(analizza("riordinare cantina con calma", OGGI).priorita, "Bassa");
  assert.equal(analizza("riordinare cantina con calma", OGGI).titolo, "Riordinare cantina");
  const r = analizza("stretching serale, sport", OGGI);
  assert.equal(r.tipo, "Sport");
  assert.equal(r.titolo, "Stretching serale");
  assert.equal(analizza("leggere un libro, personale", OGGI).tipo, "Personale");
});

test("testo senza indizi", () => {
  const r = analizza("Comprare il regalo per Giulia", OGGI);
  assert.equal(r.titolo, "Comprare il regalo per Giulia");
  assert.equal(r.data, OGGI);
  assert.equal(r.ora, null);
  assert.equal(r.priorita, "Media");
  assert.equal(r.trovati.data, false);
});

test("prossimaData per ricorrenze", () => {
  assert.equal(prossimaData("2026-10-05", { tipo: "settimane", ogni: 1, giorniSettimana: [0, 2] }), "2026-10-07");
  assert.equal(prossimaData("2026-10-07", { tipo: "settimane", ogni: 1, giorniSettimana: [0, 2] }), "2026-10-12");
  assert.equal(prossimaData("2026-10-07", { tipo: "settimane", ogni: 2, giorniSettimana: [0, 2] }), "2026-10-19");
  assert.equal(prossimaData("2026-01-31", { tipo: "mesi", ogni: 1 }), "2026-02-28");
  assert.equal(prossimaData("2026-10-03", { tipo: "giorni", ogni: 3 }), "2026-10-06");
  assert.equal(prossimaData("2024-02-29", { tipo: "anni", ogni: 1 }), "2025-02-28");
  assert.equal(descrivi({ tipo: "settimane", ogni: 1, giorniSettimana: [0, 3] }), "ogni lunedì e giovedì");
  assert.equal(descrivi({ tipo: "mesi", ogni: 2 }), "ogni 2 mesi");
});

test("casi limite: emoji, giorno con numero, tag con virgola, parole simili", () => {
  let r = analizza("🦷 dentista martedì alle 15", OGGI);
  assert.equal(r.titolo, "🦷 dentista");
  assert.equal(r.data, "2026-10-06");
  assert.equal(r.ora, "15:00");

  r = analizza("lunedì 6 alle 9 riunione", OGGI);
  assert.equal(r.data, "2026-10-06");
  assert.equal(r.ora, "09:00");
  assert.equal(r.titolo, "Riunione");

  r = analizza("venerdì 16 ottobre cena", OGGI);
  assert.equal(r.data, "2026-10-16");
  assert.equal(r.titolo, "Cena");

  r = analizza("tornare a casa alle 18", OGGI);
  assert.equal(r.titolo, "Tornare a casa");
  assert.equal(r.tipo, "Casa");
  assert.equal(r.ora, "18:00");

  r = analizza("post sui social media domani", OGGI);
  assert.equal(r.titolo, "Post sui social media");
  assert.equal(r.priorita, "Media");

  r = analizza("consegnare relazione entro venerdì", OGGI);
  assert.equal(r.titolo, "Consegnare relazione");
  assert.equal(r.data, "2026-10-09");

  r = analizza("Marta alle 10", OGGI);
  assert.equal(r.titolo, "Marta");
  assert.equal(r.priorita, "Media");

  r = analizza("alle 24 festa", OGGI);
  assert.equal(r.ora, null, "ora impossibile ignorata");

  r = analizza("", OGGI);
  assert.equal(r.titolo, "");
  assert.equal(r.data, OGGI);

  r = analizza("ogni lunedì e mercoledì e venerdì corsa alle 7", OGGI);
  assert.deepEqual(r.ricorrenza.giorniSettimana, [0, 2, 4]);
  assert.equal(r.ora, "07:00");
  assert.equal(r.tipo, "Sport");
});

test("parte del giorno: tolta dal titolo solo se l'ora è nota", () => {
  let r = analizza("corsa domenica mattina alle 8", OGGI);
  assert.equal(r.titolo, "Corsa");
  assert.equal(r.data, "2026-10-04");
  assert.equal(r.ora, "08:00");
  r = analizza("cena domani sera alle 20", OGGI);
  assert.equal(r.titolo, "Cena");
  r = analizza("chiamare mamma domani mattina", OGGI);
  assert.equal(r.titolo, "Chiamare mamma mattina", "senza ora resta, perché è informazione utile");
  r = analizza("Serata cinema", OGGI);
  assert.equal(r.titolo, "Serata cinema");
});
