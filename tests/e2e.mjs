// Test di regressione nel browser (Chromium via Playwright).
// Avvia da solo un piccolo server statico su app/ e percorre tutti i flussi
// dell'interfaccia: inserimento, modifica, rimando, ricorrenze, chiusura
// serale, settimana, statistiche, impostazioni, backup, routing, PWA.
//
// Esegui con:  node tests/e2e.mjs
// Richiede playwright (es. `npm i -g playwright`) e Chromium installato.
// Le schermate finiscono in tests/schermate/ (ignorata da git).

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium, devices;
try {
  ({ chromium, devices } = require("playwright"));
} catch {
  const globale = "/opt/node22/lib/node_modules/playwright/index.mjs";
  ({ chromium, devices } = await import(globale));
}

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(RADICE, "app");
const SCHERMATE = join(RADICE, "tests", "schermate");
await mkdir(SCHERMATE, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  let percorso = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (percorso.endsWith("/")) percorso += "index.html";
  try {
    const dati = await readFile(join(APP, percorso));
    res.writeHead(200, { "Content-Type": MIME[extname(percorso)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(dati);
  } catch {
    res.writeHead(404); res.end("non trovato");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_APP = `http://127.0.0.1:${server.address().port}/`;

// ------------------------------- utilità -------------------------------------
const esiti = [];
let errori = [];
function controlla(nome, condizione, dettaglio = "") {
  esiti.push({ nome, ok: !!condizione, dettaglio });
  console.log(`${condizione ? "ok " : "KO "} ${nome}${condizione || !dettaglio ? "" : "  -> " + dettaglio}`);
}
const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

// Ora fissa per avere esiti ripetibili: sabato 3 ottobre 2026, 21:15 (chiusura serale visibile)
function scriptOrologio(anno, mese, giorno, ore, minuti) {
  return `(() => {
    const Vero = Date;
    const fisso = new Vero(${anno}, ${mese}, ${giorno}, ${ore}, ${minuti}, 0);
    const scarto = Vero.now() - fisso.getTime();
    class Finta extends Vero {
      constructor(...a) { if (a.length) super(...a); else super(Vero.now() - scarto); }
      static now() { return Vero.now() - scarto; }
    }
    globalThis.Date = Finta;
  })();`;
}

const browser = await chromium.launch();
async function nuovoContesto(opzioni, orologio) {
  const ctx = await browser.newContext({ locale: "it-IT", timezoneId: "Europe/Rome", serviceWorkers: "block", ...opzioni });
  if (orologio) await ctx.addInitScript(orologio);
  const pagina = await ctx.newPage();
  pagina.on("pageerror", (e) => errori.push(`[pageerror] ${e.message}`));
  pagina.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/ERR_CERT|ERR_TUNNEL|jsdelivr|supabase|fonts\.g|net::ERR/.test(t)) errori.push(`[console] ${t}`);
  });
  pagina.on("dialog", (d) => d.accept());
  return { ctx, pagina };
}

async function vai(p, rotta) {
  await p.goto(URL_APP + rotta, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#vista .testata");
}

async function aggiungi(p, testo, { dataAttesa, oraAttesa } = {}) {
  await p.click("#fab");
  await p.waitForSelector("#f-nl");
  await p.fill("#f-nl", testo);
  const titolo = await p.inputValue("#f-titolo");
  const data = await p.inputValue("#f-data");
  const ora = await p.inputValue("#f-ora");
  if (dataAttesa) controlla(`parser: "${testo}" -> ${dataAttesa}`, data === dataAttesa, `ottenuto ${data}`);
  if (oraAttesa !== undefined) controlla(`parser: "${testo}" -> ora ${oraAttesa}`, ora === (oraAttesa || ""), `ottenuto ${ora}`);
  await p.click("#form-impegno button[type=submit]");
  await p.waitForSelector("#sheet", { state: "hidden" });
  return titolo;
}

const titoli = async (p, sel) => p.$$eval(sel + " .riga .titolo", (e) => e.map((x) => x.textContent.trim()));
const idPerTitolo = (p, t) => p.$eval(`#vista .riga:has(.titolo:text-is("${t}")) .spunta`, (e) => e.dataset.id);

// =============================== telefono ======================================
{
  const { ctx, pagina: p } = await nuovoContesto({ ...devices["iPhone 13"] }, scriptOrologio(2026, 9, 3, 21, 15));

  // --- stato vuoto
  await vai(p, "#/oggi");
  controlla("oggi: intestazione con la data", (await p.textContent("h1")).includes("Sabato 3"));
  controlla("oggi: frase per giornata vuota", (await p.textContent(".motto .saluto")).trim() === "Oggi" && (await p.textContent(".motto .frase")).length > 10);
  controlla("oggi: nessun impegno", (await p.textContent(".vuoto")).includes("Niente in programma"));
  controlla("pill sync: solo locale senza config", (await p.textContent("#stato-sync-pill")).includes("Solo locale"));
  await p.screenshot({ path: join(SCHERMATE, "01-vuoto.png"), fullPage: true });

  // --- inserimento in linguaggio naturale
  await aggiungi(p, "dentista martedì alle 15, alta", { dataAttesa: "2026-10-06", oraAttesa: "15:00" });
  await aggiungi(p, "spesa oggi", { dataAttesa: "2026-10-03", oraAttesa: "" });
  await aggiungi(p, "palestra ogni lunedì e mercoledì alle 19", { dataAttesa: "2026-10-05", oraAttesa: "19:00" });
  await aggiungi(p, "chiamare mamma stasera alle 20 e mezza", { dataAttesa: "2026-10-03", oraAttesa: "20:30" });
  await aggiungi(p, "pagare bolletta luce oggi urgente", { dataAttesa: "2026-10-03" });
  await aggiungi(p, "stretching, sport", { dataAttesa: "2026-10-03" });
  await aggiungi(p, "riordinare cantina domani con calma", { dataAttesa: "2026-10-04" });
  await aggiungi(p, "vitamine ogni giorno", { dataAttesa: "2026-10-03" });
  const oggiLista = await titoli(p, "#sezione-oggi");
  controlla("oggi: 5 impegni in lista", oggiLista.length === 5, oggiLista.join(" / "));
  controlla("oggi: ordinati con ora prima e poi per priorità", oggiLista[0] === "Chiamare mamma" && oggiLista[1] === "Pagare bolletta luce", oggiLista.join(" / "));
  controlla("oggi: contatore 0/5", (await p.textContent("#sezione-oggi .conta")).trim() === "0/5");
  controlla("oggi: sezione Domani con 1 impegno", (await titoli(p, "#sezione-domani")).join() === "Riordinare cantina");
  controlla("oggi: tipo riconosciuto (Casa) sulla spesa", await p.$(`#vista .riga:has(.titolo:text-is("Spesa")) .etichetta-tipo.Casa`) !== null);
  controlla("oggi: priorità alta evidenziata sulla bolletta", await p.$(`#vista .riga:has(.titolo:text-is("Pagare bolletta luce")) .spunta.alta`) !== null);
  await p.screenshot({ path: join(SCHERMATE, "02-oggi.png"), fullPage: true });

  // --- spunta: alta priorità -> coriandoli + frase
  await p.click(`.spunta[data-id="${await idPerTitolo(p, "Pagare bolletta luce")}"]`);
  await p.waitForSelector("#toast.visibile");
  controlla("spunta alta: frase mostrata", (await p.textContent("#toast")).length > 10, await p.textContent("#toast"));
  controlla("spunta: la riga diventa fatta e va in fondo", (await titoli(p, "#sezione-oggi")).at(-1) === "Pagare bolletta luce");
  controlla("spunta: barra di avanzamento 1 su 5", (await p.textContent(".motto .progresso span")).trim() === "1 su 5");

  // --- ricorrenza giornaliera: spuntare crea domani
  await p.click(`.spunta[data-id="${await idPerTitolo(p, "Vitamine")}"]`);
  await p.waitForSelector("#toast.visibile");
  controlla("ricorrenza: il toast annuncia la prossima volta", /Prossima volta: domani/.test(await p.textContent("#toast")), await p.textContent("#toast"));
  const domani = await titoli(p, "#sezione-domani");
  controlla("ricorrenza: domani contiene Vitamine", domani.includes("Vitamine"), domani.join(" / "));
  // togliere la spunta ritira la ricorrenza
  await p.click(`.spunta[data-id="${await idPerTitolo(p, "Vitamine")}"]`);
  await dormi(200);
  controlla("ricorrenza: senza spunta la prossima sparisce", !(await titoli(p, "#sezione-domani")).includes("Vitamine"));

  // --- modifica: titolo, rimanda a domani
  await p.click(`#vista .riga:has(.titolo:text-is("Spesa")) .corpo`);
  await p.waitForSelector("#form-impegno");
  controlla("modifica: il pannello mostra i dati", (await p.inputValue("#f-titolo")) === "Spesa" && (await p.inputValue("#f-data")) === "2026-10-03");
  await p.fill("#f-titolo", "Spesa grossa");
  await p.click(".chip[data-rimanda='1']");
  controlla("modifica: chip Domani imposta la data", (await p.inputValue("#f-data")) === "2026-10-04");
  await p.fill("#f-note", "latte, pane");
  await p.screenshot({ path: join(SCHERMATE, "03-modifica.png"), fullPage: true });
  await p.click("#form-impegno button[type=submit]");
  await p.waitForSelector("#sheet", { state: "hidden" });
  controlla("modifica: spostata a domani con nuovo titolo", (await titoli(p, "#sezione-domani")).includes("Spesa grossa"));
  controlla("modifica: icona nota presente", await p.$(`#vista .riga:has(.titolo:text-is("Spesa grossa")) .meta svg`) !== null);

  // --- eliminazione (dialog accettato automaticamente)
  await p.click(`#vista .riga:has(.titolo:text-is("Stretching")) .corpo`);
  await p.waitForSelector("[data-elimina]");
  await p.click("[data-elimina]");
  await p.waitForSelector("#sheet", { state: "hidden" });
  controlla("elimina: la riga sparisce", !(await titoli(p, "#vista")).includes("Stretching"));

  // --- arretrati: creo un impegno ieri tramite modifica data
  await aggiungi(p, "ritirare pacco");
  await p.click(`#vista .riga:has(.titolo:text-is("Ritirare pacco")) .corpo`);
  await p.waitForSelector("#f-data");
  await p.fill("#f-data", "2026-10-01");
  await p.click("#form-impegno button[type=submit]");
  await p.waitForSelector("#sheet", { state: "hidden" });
  controlla("arretrati: sezione presente con ritardo", (await p.textContent(".carta.ambra")).includes("da 2 giorni"));
  await p.click(`.carta.ambra .riga:has(.titolo:text-is("Ritirare pacco")) [data-azione=rimanda][data-giorni="0"]`);
  await dormi(200);
  controlla("arretrati: '-> Oggi' lo riporta a oggi", (await p.$(".carta.ambra")) === null && (await titoli(p, "#sezione-oggi")).includes("Ritirare pacco"));

  // --- chiusura serale (ore 21:15 > 20)
  controlla("chiusura: la card compare dopo le 20", (await p.$("[data-azione=chiudi-giornata]")) !== null);
  await p.click("[data-azione=chiudi-giornata]");
  await p.waitForSelector("#conferma-chiusura");
  const daSpostare = await p.$$("[data-sposta]");
  controlla("chiusura: elenca i non fatti (3)", daSpostare.length === 3, String(daSpostare.length));
  await p.screenshot({ path: join(SCHERMATE, "04-chiusura.png"), fullPage: true });
  await p.$eval(`.chiusura-lista .riga:has(.titolo:text-is("Chiamare mamma")) input`, (cb) => { cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.click("#conferma-chiusura");
  await p.waitForSelector(".risultato-chiusura");
  const risultato = (await p.textContent(".risultato-chiusura")).replace(/\s+/g, " ");
  controlla("chiusura: riepilogo 1/4 con 2 spostati", /1\s*\/4/.test(risultato) && /2 impegni spostati/.test(risultato), risultato);
  await p.click("[data-chiudi-sheet].bottone");
  await p.waitForSelector("#sheet", { state: "hidden" });
  controlla("chiusura: la card diventa 'Giornata chiusa'", (await p.textContent(".chiusura-card")).includes("Giornata chiusa"));
  controlla("chiusura: il motto usa i numeri della chiusura", (await p.textContent(".motto .progresso span")).trim() === "1 su 4");
  controlla("chiusura: l'impegno lasciato resta su oggi", (await titoli(p, "#sezione-oggi")).includes("Chiamare mamma"));
  await p.screenshot({ path: join(SCHERMATE, "05-oggi-chiusa.png"), fullPage: true });

  // --- settimana
  await vai(p, "#/settimana");
  controlla("settimana: intestazione 28 set – 4 ott", (await p.textContent("h1")).includes("28 set") && (await p.textContent("h1")).includes("4 ott"));
  await p.click(".giorno-pill[data-data='2026-10-04']");
  const dom = await titoli(p, ".giorno-dettaglio");
  controlla("settimana: domenica mostra gli spostati", dom.includes("Spesa grossa") && dom.includes("Ritirare pacco"), dom.join(" / "));
  await p.click("[data-azione=settimana][data-delta='1']");
  controlla("settimana: avanti di una settimana", (await p.textContent("h1")).includes("5 – 11 ottobre"));
  await p.click(".giorno-pill[data-data='2026-10-05']");
  controlla("settimana: lunedì prossimo ha Palestra", (await titoli(p, ".giorno-dettaglio")).includes("Palestra"));
  // aggiungere dal giorno selezionato rispetta quel giorno
  await p.click(".giorno-dettaglio [data-azione=nuovo]");
  await p.waitForSelector("#f-nl");
  controlla("settimana: il pannello parte dal giorno scelto", (await p.inputValue("#f-data")) === "2026-10-05");
  await p.fill("#f-nl", "revisione auto alle 9");
  controlla("settimana: il testo senza data mantiene il giorno scelto", (await p.inputValue("#f-data")) === "2026-10-05" && (await p.inputValue("#f-ora")) === "09:00");
  await p.click("#form-impegno button[type=submit]");
  await p.waitForSelector("#sheet", { state: "hidden" });
  controlla("settimana: il nuovo impegno appare nel giorno", (await titoli(p, ".giorno-dettaglio")).includes("Revisione auto"));
  await p.click("[data-azione=settimana-oggi]");
  controlla("settimana: 'Torna a oggi' funziona", (await p.textContent(".settimana-barra")).includes("Questa settimana"));
  await p.screenshot({ path: join(SCHERMATE, "06-settimana.png"), fullPage: true });

  // --- statistiche
  await vai(p, "#/statistiche");
  const tessere = await p.$$eval(".tessera", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  controlla("statistiche: 4 tessere più grafici", tessere.length === 6, String(tessere.length));
  controlla("statistiche: serie attuale 0 (giornata chiusa con slittati)", tessere[0].startsWith("0"), tessere[0]);
  controlla("statistiche: fatti ultimi 30 giorni = 1", tessere[3].startsWith("1"), tessere[3]);
  await p.screenshot({ path: join(SCHERMATE, "07-statistiche.png"), fullPage: true });

  // --- impostazioni
  await vai(p, "#/impostazioni");
  const configurato = await p.evaluate(() => !!(window.CONFIG && window.CONFIG.supabaseUrl));
  const testoImp = await p.textContent("#vista");
  controlla("impostazioni: sezione sincronizzazione coerente con config.js",
    configurato ? testoImp.includes("Collega il tuo account") : testoImp.includes("Solo su questo dispositivo"));
  await p.click("[data-azione=toggle][data-chiave=modalitaFocus]");
  await dormi(150);
  controlla("impostazioni: interruttore focus acceso", await p.$eval("[data-chiave=modalitaFocus]", (e) => e.classList.contains("on")));
  await p.selectOption("select[data-campo-impostazione=oraChiusura]", "22");
  await dormi(150);
  controlla("impostazioni: ora chiusura salvata", await p.evaluate(() => JSON.parse(localStorage.getItem("impegni.v1")).impostazioni.oraChiusura === 22));
  await p.fill("input[data-campo-impostazione=nome]", "Leo");
  await p.press("input[data-campo-impostazione=nome]", "Tab");
  await dormi(150);
  controlla("impostazioni: nome salvato", await p.evaluate(() => JSON.parse(localStorage.getItem("impegni.v1")).impostazioni.nome === "Leo"));
  // frasi: aggiungi, nascondi, ripristina
  const attivePrima = Number((await p.textContent(".sezione:has(#form-frase) .conta")).match(/\d+/)[0]);
  await p.selectOption("#frase-momento", "fatto");
  await p.fill("#frase-testo", "Frase di prova {n}");
  await p.click("#form-frase button[type=submit]");
  await dormi(150);
  const attiveDopo = Number((await p.textContent(".sezione:has(#form-frase) .conta")).match(/\d+/)[0]);
  controlla("frasi: aggiunta una frase", attiveDopo === attivePrima + 1, `${attivePrima} -> ${attiveDopo}`);
  controlla("frasi: il gruppo resta aperto e mostra 'tua'", await p.$("details[data-momento=fatto][open] .mia") !== null);
  await p.click("details[data-momento=fatto] [data-azione=frase-nascondi]");
  await dormi(150);
  controlla("frasi: nascondere riduce le attive", Number((await p.textContent(".sezione:has(#form-frase) .conta")).match(/\d+/)[0]) === attiveDopo - 1);
  await p.click("details[data-momento=fatto] [data-azione=frase-mostra]");
  await dormi(150);
  controlla("frasi: ripristinare le riporta", Number((await p.textContent(".sezione:has(#form-frase) .conta")).match(/\d+/)[0]) === attiveDopo);
  await p.click("details[data-momento=fatto] [data-azione=frase-elimina]");
  await dormi(150);
  controlla("frasi: eliminare la propria frase", Number((await p.textContent(".sezione:has(#form-frase) .conta")).match(/\d+/)[0]) === attivePrima);
  // tema
  await p.selectOption("select[data-campo-tema]", "dark");
  controlla("tema: scuro applicato", await p.evaluate(() => document.documentElement.dataset.theme === "dark"));
  await p.screenshot({ path: join(SCHERMATE, "08-impostazioni-scuro.png"), fullPage: true });
  await p.selectOption("select[data-campo-tema]", "auto");
  controlla("tema: automatico toglie l'attributo", await p.evaluate(() => !document.documentElement.dataset.theme));
  controlla("impostazioni: riga diagnostica con versione", /Impegni \d+\.\d+\.\d+ · nel browser/.test(await p.textContent("main p:last-of-type")));

  // backup: esporta e importa
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("[data-azione=esporta]")]);
  const percorsoBackup = await download.path();
  const backup = JSON.parse(await readFile(percorsoBackup, "utf8"));
  controlla("backup: file esportato con impegni", backup.formato === "impegni-backup" && backup.impegni.length >= 8, String(backup.impegni?.length));
  await p.click("[data-azione=cancella-tutto]");
  await dormi(200);
  controlla("backup: cancella tutto svuota", await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("impegni.v1")).impegni).length === 0));
  await p.setInputFiles("#file-importa", { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await p.waitForSelector("#toast.visibile");
  controlla("backup: import ripristina", /Importati \d+ impegni/.test(await p.textContent("#toast")) && await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("impegni.v1")).impegni).length >= 8));

  // --- modalità concentrazione in Oggi (la giornata è chiusa: la card non deve comparire)
  await vai(p, "#/oggi");
  controlla("focus: con giornata chiusa mostra la lista normale", (await p.$(".focus-card")) === null);
  // sblocco: riapro con orologio al mattino in un nuovo contesto più sotto

  // --- routing: hash sconosciuto -> oggi; frammento di autenticazione preservato
  await p.goto(URL_APP + "#/inesistente", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#vista .testata");
  controlla("routing: hash sconosciuto porta a Oggi", (await p.evaluate(() => location.hash)) === "#/oggi");
  await p.goto(URL_APP + "#access_token=AAA&refresh_token=BBB&type=magiclink", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#vista .testata");
  controlla("routing: il frammento del link di accesso non viene cancellato", (await p.evaluate(() => location.hash)).startsWith("#access_token"));

  // --- persistenza dopo ricarico
  await vai(p, "#/oggi");
  controlla("persistenza: gli impegni ci sono dopo il ricarico", (await titoli(p, "#vista")).length >= 2);
  await ctx.close();
}

// =============================== mattina + focus ================================
{
  const { ctx, pagina: p } = await nuovoContesto({ ...devices["Pixel 7"] }, scriptOrologio(2026, 9, 3, 9, 0));
  await vai(p, "#/oggi");
  await aggiungi(p, "primo impegno alle 10");
  await aggiungi(p, "secondo impegno");
  controlla("mattina: saluto Buongiorno", (await p.textContent(".testata .sopra")).includes("Buongiorno"));
  controlla("mattina: niente card di chiusura alle 9", (await p.$("[data-azione=chiudi-giornata]")) === null);
  await vai(p, "#/impostazioni");
  await p.click("[data-azione=toggle][data-chiave=modalitaFocus]");
  await vai(p, "#/oggi");
  controlla("focus: mostra un impegno alla volta", (await p.textContent(".focus-card .t")).trim() === "Primo impegno");
  await p.click(".focus-card [data-azione=spunta]");
  await dormi(200);
  controlla("focus: dopo Fatto passa al successivo", (await p.textContent(".focus-card .t")).trim() === "Secondo impegno");
  await p.click("[data-azione=focus-tutti]");
  controlla("focus: 'Mostra tutti' torna alla lista", (await p.$(".focus-card")) === null && (await titoli(p, "#vista")).length === 2);
  await p.click(".focus-card [data-azione=spunta], #vista .riga:not(.fatta) .spunta");
  await p.waitForSelector("#toast.visibile");
  controlla("tutto fatto: motto verde", await p.$eval(".motto", (e) => e.classList.contains("verde")));
  await p.screenshot({ path: join(SCHERMATE, "09-tutto-fatto.png"), fullPage: true });
  await ctx.close();
}

// =============================== desktop ========================================
{
  const { ctx, pagina: p } = await nuovoContesto({ viewport: { width: 1280, height: 860 } }, scriptOrologio(2026, 9, 3, 10, 15));
  await vai(p, "#/oggi");
  await aggiungi(p, "riunione alle 11");
  await aggiungi(p, "corsa domenica mattina alle 8");
  controlla("desktop: barra laterale visibile", await p.$eval(".nav", (e) => getComputedStyle(e).position === "sticky"));
  await vai(p, "#/settimana");
  controlla("desktop: sette colonne", (await p.$$(".colonna-giorno")).length === 7);
  controlla("desktop: la domenica contiene la corsa", (await p.textContent(".colonna-giorno:nth-child(7)")).includes("Corsa"));
  await p.click(".colonna-giorno:nth-child(2) .aggiungi-col");
  await p.waitForSelector("#f-nl");
  controlla("desktop: '+ Aggiungi' della colonna imposta la data", (await p.inputValue("#f-data")) === "2026-09-29");
  await p.keyboard.press("Escape");
  await p.waitForSelector("#sheet", { state: "hidden" });
  await p.screenshot({ path: join(SCHERMATE, "10-desktop-settimana.png"), fullPage: true });
  await vai(p, "#/statistiche");
  await p.screenshot({ path: join(SCHERMATE, "11-desktop-statistiche.png"), fullPage: true });
  await ctx.close();
}

// =============================== service worker / PWA ===========================
{
  const ctx = await browser.newContext({ serviceWorkers: "allow", locale: "it-IT" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errori.push(`[pageerror sw] ${e.message}`));
  await p.goto(URL_APP, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#vista .testata");
  await dormi(2500);
  const sw = await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state).catch(() => null);
  controlla("pwa: service worker attivo", sw === "activated", String(sw));
  const cache = await p.evaluate(async () => { const k = (await caches.keys()).filter((x) => x.startsWith("impegni-v")); if (!k.length) return 0; return (await (await caches.open(k[0])).keys()).length; }).catch(() => -1);
  controlla("pwa: file in cache", cache >= 15, String(cache));
  const manifest = await p.evaluate(async () => (await fetch("manifest.webmanifest")).json());
  controlla("pwa: manifest valido", manifest.name === "Impegni" && manifest.icons.length >= 3 && manifest.display === "standalone");
  for (const icona of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/maskable-512.png"]) {
    const ok = await p.evaluate(async (u) => (await fetch(u)).ok, icona);
    controlla(`pwa: ${icona} raggiungibile`, ok);
  }
  await ctx.close();
}

await browser.close();
server.close();

const ko = esiti.filter((e) => !e.ok);
console.log(`\n${esiti.length - ko.length}/${esiti.length} controlli superati`);
if (errori.length) console.log("Errori JavaScript in pagina:\n" + errori.join("\n"));
else console.log("Nessun errore JavaScript in pagina.");
process.exit(ko.length || errori.length ? 1 : 0);
