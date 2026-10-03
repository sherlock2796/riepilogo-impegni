// Interfaccia: viste, pannelli, azioni. Un solo modulo, niente framework.

import * as store from "./store.js";
import * as sync from "./sync.js";
import { analizza } from "./parser.js";
import { scegliFrase, saluto, BASE, MOMENTI } from "./frasi.js";
import { descrivi as descriviRicorrenza, allineaData } from "./ricorrenze.js";
import * as D from "./date.js";

const VERSIONE_APP = "1.0.6";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ICONE = {
  spunta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  ripeti: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  nota: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12l-4 4H4z"/><path d="M8 9h8M8 13h5"/></svg>',
  sinistra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  destra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
};

const oggi = () => D.oggiISO();
const ui = {
  vista: "oggi",
  oggi: oggi(),
  settimanaLunedi: D.lunediDi(oggi()),
  giornoSelezionato: oggi(),
  focusMostraTutti: false,
  installPrompt: null,
  login: { email: "", inviato: false, errore: "", inCorso: false, ok: "" },
  codice: { generato: "", errore: "", inCorso: false, mostraIncolla: false, incollato: "" },
  frasiMomentoAperto: null,
};

// ============================== avvio =========================================

function avvia() {
  store.carica();
  applicaTema(localStorage.getItem("tema") || "auto");
  window.addEventListener("hashchange", instrada);
  instrada();
  store.subscribe(() => render());
  sync.subscribe(aggiornaStatoSync);
  sync.init();

  $("#fab").addEventListener("click", () => apriFormImpegno({ dataIniziale: ui.vista === "settimana" ? ui.giornoSelezionato : ui.oggi }));
  $("#vista").addEventListener("click", gestisciClick);
  $("#vista").addEventListener("change", gestisciChange);
  $("#vista").addEventListener("input", (e) => { if (e.target.id === "codice-incolla") ui.codice.incollato = e.target.value; });
  $("#vista").addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.matches?.("details[data-momento]")) ui.frasiMomentoAperto = d.open ? d.dataset.momento : null;
  }, true);
  $("#sheet").addEventListener("click", (e) => { if (e.target.closest("[data-chiudi-sheet]")) chiudiSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiSheet(); });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); ui.installPrompt = e; if (ui.vista === "impostazioni") render(); });

  // Ogni minuto: cambio giorno e comparsa della chiusura serale.
  setInterval(() => {
    const attivo = document.activeElement;
    if (attivo && $("#vista").contains(attivo) && /INPUT|TEXTAREA|SELECT/.test(attivo.tagName)) return;
    if (!$("#sheet").hidden) return;
    render();
  }, 60000);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const avevaControllo = !!navigator.serviceWorker.controller;
    let ricaricato = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Nuova versione installata: ricarico una volta così la pagina usa i file aggiornati.
      if (avevaControllo && !ricaricato && !eFrammentoAuth()) { ricaricato = true; location.reload(); }
    });
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW non registrato", e));
  }
}

// Il link di accesso di Supabase torna qui con i token nel frammento
// (#access_token=...). Quel frammento non va toccato finché sync.js non lo ha letto.
const eFrammentoAuth = () => /(^|[#&?])(access_token|refresh_token|error_description|error_code|type=magiclink|code)=/.test(location.hash + location.search);

function instrada() {
  const m = location.hash.match(/^#\/(oggi|settimana|statistiche|impostazioni)/);
  ui.vista = m ? m[1] : "oggi";
  if (!m && location.hash && location.hash !== "#/" && !eFrammentoAuth()) history.replaceState(null, "", "#/oggi");
  render();
  window.scrollTo({ top: 0 });
}

function applicaTema(tema) {
  if (tema === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = tema;
  localStorage.setItem("tema", tema);
}

// ============================== render ========================================

const VISTE = { oggi: vistaOggi, settimana: vistaSettimana, statistiche: vistaStatistiche, impostazioni: vistaImpostazioni };

function render() {
  const adesso = oggi();
  if (ui.oggi !== adesso) {
    ui.oggi = adesso;
    ui.settimanaLunedi = D.lunediDi(adesso);
    ui.giornoSelezionato = adesso;
  }
  $("#vista").innerHTML = VISTE[ui.vista]();
  $$(".nav a").forEach((a) => a.classList.toggle("attiva", a.dataset.vista === ui.vista));
  aggiornaStatoSync(sync.statoSync);
}

function pillSync() {
  return `<a href="#/impostazioni" class="stato-sync-pill" id="stato-sync-pill"><span class="pallino"></span><span class="testo"></span></a>`;
}

let ultimoStatoSync = "";
function aggiornaStatoSync(s) {
  // Se cambia lo stato (collegato, scollegato, errore) le viste che lo mostrano vanno ridisegnate.
  const firma = `${s.stato}|${s.utente?.email || ""}`;
  if (firma !== ultimoStatoSync) {
    ultimoStatoSync = firma;
    const attivo = document.activeElement;
    const digitando = attivo && $("#vista")?.contains(attivo) && /INPUT|TEXTAREA/.test(attivo.tagName);
    if ((ui.vista === "impostazioni" || ui.vista === "oggi") && !digitando && $("#sheet").hidden) { render(); return; }
  }
  const testo = {
    "non-configurato": "Solo locale", disconnesso: "Non collegato", "in-corso": "Sincronizzo…",
    collegato: s.ultimaSync ? `Sincronizzato ${D.oraAdesso(new Date(s.ultimaSync))}` : "Collegato",
    offline: "Offline", errore: "Errore sync",
  }[s.stato] || "";
  const classe = { collegato: "ok", errore: "ko", "in-corso": "lavoro", offline: "ko" }[s.stato] || "";
  const pill = $("#stato-sync-pill");
  if (pill) { pill.className = `stato-sync-pill ${classe}`; $(".testo", pill).textContent = testo; }
  const nav = $("#stato-sync-nav");
  if (nav) nav.textContent = s.utente ? `${s.utente.email} · ${testo}` : testo;
}

function opzioniFrasi(seed) {
  const imp = store.impostazioni();
  return { extra: imp.frasiExtra, nascoste: imp.frasiNascoste, seed };
}

function contestoFrasi(giorno, lista, arretrati) {
  const n = lista.length, fatti = lista.filter((i) => i.fatto).length;
  const tags = [];
  if (n >= 5) tags.push("piena");
  if (n >= 1 && n <= 2) tags.push("leggera");
  const ieri = store.esitoGiorno(D.aggiungiGiorni(giorno, -1));
  if (ieri.totali && ieri.pieno) tags.push("ieri_bene");
  if (ieri.totali && ieri.fatti / ieri.totali < 0.5) tags.push("ieri_male");
  if (arretrati.length) tags.push("arretrati");
  if (D.eWeekend(giorno)) tags.push("weekend");
  tags.push(D.momentoDelGiorno());
  return { tags, n, fatti, totali: n, rimasti: n - fatti, serie: store.serieAttuale(giorno) };
}

// ------------------------------ vista: oggi -----------------------------------

function vistaOggi() {
  const g = ui.oggi;
  const imp = store.impostazioni();
  const lista = store.perData(g);
  const arr = store.arretrati(g);
  const n = lista.length, fatti = lista.filter((i) => i.fatto).length;
  const momento = D.momentoDelGiorno();
  const ctx = contestoFrasi(g, lista, arr);
  const chiusa = store.chiusura(g);
  const d = D.daISO(g);

  let tipoFrase = "apertura", classe = "";
  if (chiusa) {
    tipoFrase = chiusa.totali === 0 || chiusa.fatti === 0 ? "chiusura_zero" : chiusa.fatti >= chiusa.totali ? "chiusura_ok" : "chiusura_parziale";
    classe = "notte";
    Object.assign(ctx, { fatti: chiusa.fatti, totali: chiusa.totali, rimasti: chiusa.slittati });
  } else if (n === 0 && !arr.length) tipoFrase = "vuoto";
  else if (n > 0 && fatti === n) { tipoFrase = "tutto_fatto"; classe = "verde"; }
  else if (momento === "sera" || momento === "notte") classe = "notte";
  const frase = scegliFrase(tipoFrase, ctx, opzioniFrasi(`${g}:${momento}:${tipoFrase}:${ctx.tags.join()}`));

  const pf = chiusa ? chiusa.fatti : fatti, pt = chiusa ? chiusa.totali : n;
  const progresso = pt ? `<div class="progresso"><div class="barra"><i style="width:${Math.round((pf / pt) * 100)}%"></i></div><span>${pf} su ${pt}</span></div>` : "";

  let html = `
    <header class="testata">
      <div>
        <div class="sopra">${h(saluto(momento))}${imp.nome ? ", " + h(imp.nome) : ""}</div>
        <h1>${D.GIORNI[D.giornoSettimana(g)]} ${d.getDate()} <span class="mese">${D.MESI[d.getMonth()]}</span></h1>
      </div>
      ${pillSync()}
    </header>
    <section class="motto ${classe}">
      <div class="saluto">${chiusa ? "Giornata chiusa" : tipoFrase === "tutto_fatto" ? "Tutto fatto" : "Oggi"}</div>
      <p class="frase">${h(frase)}</p>
      ${progresso}
    </section>`;

  if (sync.configurato() && sync.statoSync.stato === "disconnesso") {
    html += `<div class="avviso banner-sync"><span>Non sei collegato: i dati restano su questo dispositivo.</span><a class="link" href="#/impostazioni">Collega</a></div>`;
  } else if (sync.statoSync.utente && eIOS() && !eInstallata() && !localStorage.getItem("bannerIosVisto")) {
    html += `<div class="avviso banner-sync"><span>Usi l'app installata in Home? Da Impostazioni puoi generare il codice per collegarla.</span><span style="display:flex;gap:12px;flex:none"><a class="link" href="#/impostazioni">Vai</a><button class="link muto" data-azione="banner-ios-chiudi">Chiudi</button></span></div>`;
  }

  if (arr.length) {
    const fraseArr = scegliFrase("arretrati", ctx, opzioniFrasi(`${g}:arretrati`));
    html += `<section class="sezione" id="sezione-arretrati">
      <div class="intestazione"><h2>Arretrati</h2><span class="conta">${arr.length}</span></div>
      <div class="carta ambra">
        <p class="nota-carta">${h(fraseArr)}</p>
        ${arr.map((i) => rigaImpegno(i, { mostraRitardo: true, rapide: `
          <div class="azioni-rapide">
            <button class="bottone-mini" data-azione="rimanda" data-id="${i.id}" data-giorni="0">Oggi</button>
            <button class="bottone-mini" data-azione="rimanda" data-id="${i.id}" data-giorni="1">Domani</button>
          </div>` })).join("")}
      </div>
    </section>`;
  }

  html += `<section class="sezione" id="sezione-oggi"><div class="intestazione"><h2>Oggi</h2><span class="conta">${n ? `${fatti}/${n}` : ""}</span></div>`;
  if (!n) {
    html += `<div class="carta"><div class="vuoto"><strong>Niente in programma</strong>Tocca + per aggiungere qualcosa, o goditi il vuoto.</div></div>`;
  } else if (imp.modalitaFocus && !ui.focusMostraTutti && fatti < n && !chiusa) {
    const prossimo = lista.find((i) => !i.fatto);
    html += `<div class="focus-card">
      <div class="e">Una cosa alla volta</div>
      <div class="t">${h(prossimo.titolo)}</div>
      <div class="m">${[prossimo.ora, prossimo.tipo, prossimo.priorita === "Alta" ? "priorità alta" : ""].filter(Boolean).join(" · ")}</div>
      <button class="bottone verde" data-azione="spunta" data-id="${prossimo.id}">Fatto!</button>
      <div style="margin-top:14px"><button class="link" data-azione="focus-tutti">Mostra tutti (${n - fatti} rimasti)</button>
      · <button class="link" data-azione="modifica" data-id="${prossimo.id}">Modifica</button></div>
    </div>`;
  } else {
    html += `<div class="carta">${lista.map((i) => rigaImpegno(i)).join("")}</div>`;
    if (imp.modalitaFocus && !chiusa && fatti < n) html += `<div style="margin-top:10px;text-align:center"><button class="link" data-azione="focus-uno">Torna a una cosa alla volta</button></div>`;
  }
  html += `</section>`;

  const ora = new Date().getHours();
  if (chiusa) {
    html += `<div class="chiusura-card fatta"><span class="luna">🌙</span><div><div class="t">Giornata chiusa</div><div class="d">${chiusa.fatti} su ${chiusa.totali} fatti${chiusa.slittati ? `, ${chiusa.slittati} ${chiusa.slittati === 1 ? "spostato" : "spostati"} a domani` : ""}. A domani!</div></div></div>`;
  } else if (ora >= imp.oraChiusura) {
    html += `<button class="chiusura-card" data-azione="chiudi-giornata"><span class="luna">🌙</span><div><div class="t">Chiudi la giornata</div><div class="d">Bilancio di oggi, cosa slitta a domani, e buonanotte.</div></div><span class="freccia">${ICONE.destra}</span></button>`;
  }

  const domani = store.perData(D.aggiungiGiorni(g, 1));
  if (domani.length) {
    html += `<section class="sezione" id="sezione-domani"><div class="intestazione"><h2>Domani</h2><a class="link" href="#/settimana">Settimana</a></div>
      <div class="carta">${domani.map((i) => rigaImpegno(i, { compatta: true })).join("")}</div></section>`;
  }
  return html;
}

function rigaImpegno(i, { compatta = false, mostraRitardo = false, mostraData = false, rapide = "" } = {}) {
  const meta = [];
  if (mostraData) meta.push(`<span>${h(D.etichettaRelativa(i.data, ui.oggi))}</span>`);
  if (i.ora) meta.push(`<span class="ora">${h(i.ora)}</span>`);
  if (mostraRitardo) meta.push(`<span class="ritardo">${h(D.ritardo(i.data, ui.oggi))}</span>`);
  meta.push(`<span class="pri ${i.priorita}" title="Priorità ${i.priorita}"></span>`);
  meta.push(`<span class="etichetta-tipo ${i.tipo}">${h(i.tipo)}</span>`);
  if (i.ricorrenza) meta.push(`<span title="${h(descriviRicorrenza(i.ricorrenza))}">${ICONE.ripeti}${compatta ? "" : h(descriviRicorrenza(i.ricorrenza))}</span>`);
  if (i.note) meta.push(`<span title="${h(i.note)}">${ICONE.nota}</span>`);
  return `<div class="riga ${i.fatto ? "fatta" : ""} ${compatta ? "compatta" : ""}" data-id="${i.id}">
    <button class="spunta ${i.priorita === "Alta" && !i.fatto ? "alta" : ""}" data-azione="spunta" data-id="${i.id}" aria-label="${i.fatto ? "Togli la spunta" : "Segna come fatto"}">${ICONE.spunta}</button>
    <button class="corpo" data-azione="modifica" data-id="${i.id}">
      <div class="titolo">${h(i.titolo)}</div>
      <div class="meta">${meta.join("")}</div>
    </button>${rapide}</div>`;
}

// ------------------------------ vista: settimana ------------------------------

function vistaSettimana() {
  const lun = ui.settimanaLunedi;
  const giorni = Array.from({ length: 7 }, (_, k) => D.aggiungiGiorni(lun, k));
  const dom = giorni[6];
  const dl = D.daISO(lun), dd = D.daISO(dom);
  const titolo = dl.getMonth() === dd.getMonth()
    ? `${dl.getDate()} – ${dd.getDate()} ${D.MESI[dd.getMonth()]}`
    : `${dl.getDate()} ${D.MESI_BREVI[dl.getMonth()]} – ${dd.getDate()} ${D.MESI_BREVI[dd.getMonth()]}`;
  const eCorrente = lun === D.lunediDi(ui.oggi);
  const per = Object.fromEntries(giorni.map((g) => [g, store.perData(g)]));
  const tot = giorni.reduce((s, g) => s + per[g].length, 0);
  const fat = giorni.reduce((s, g) => s + per[g].filter((i) => i.fatto).length, 0);

  let html = `
    <header class="testata"><div><div class="sopra">Settimana</div><h1>${h(titolo)}</h1>
      <p class="muto piccolo" style="margin-top:4px">${tot ? `${fat} su ${tot} fatti` : "Nessun impegno in questa settimana"}</p></div>${pillSync()}</header>
    <div class="settimana-barra">
      <button class="freccia" data-azione="settimana" data-delta="-1" aria-label="Settimana precedente">${ICONE.sinistra}</button>
      ${eCorrente ? `<span class="titolo-sett">Questa settimana</span>` : `<button class="bottone-mini" data-azione="settimana-oggi">Torna a oggi</button>`}
      <button class="freccia" data-azione="settimana" data-delta="1" aria-label="Settimana successiva">${ICONE.destra}</button>
    </div>`;

  // Telefono: striscia + dettaglio del giorno scelto
  html += `<div class="striscia">${giorni.map((g, k) => {
    const l = per[g];
    const punti = l.slice(0, 4).map((i) => `<i class="${i.fatto ? "f" : i.priorita === "Alta" ? "a" : ""}"></i>`).join("");
    return `<button class="giorno-pill ${g === ui.oggi ? "oggi" : ""} ${g === ui.giornoSelezionato ? "selezionato" : ""} ${g < ui.oggi ? "passato" : ""}" data-azione="seleziona-giorno" data-data="${g}">
      <div class="l">${D.GIORNI_BREVI[k]}</div><div class="n">${D.daISO(g).getDate()}</div><div class="puntini">${punti}</div></button>`;
  }).join("")}</div>`;
  const sel = ui.giornoSelezionato;
  const listaSel = per[sel] || store.perData(sel);
  html += `<section class="giorno-dettaglio">
    <div class="sezione" style="margin-top:0"><div class="intestazione"><h2>${h(D.etichettaRelativa(sel, ui.oggi))}</h2><span class="conta">${h(D.formattaLunga(sel))}</span></div>
    <div class="carta">${listaSel.length ? listaSel.map((i) => rigaImpegno(i)).join("") : `<div class="vuoto">Niente in programma.</div>`}</div>
    <div style="margin-top:10px"><button class="bottone secondario blocco" data-azione="nuovo" data-data="${sel}">+ Aggiungi per ${h(D.etichettaRelativa(sel, ui.oggi).toLowerCase())}</button></div></div>
  </section>`;

  // Schermo largo: sette colonne
  html += `<div class="colonne-settimana">${giorni.map((g, k) => {
    const l = per[g];
    return `<div class="colonna-giorno ${g === ui.oggi ? "oggi" : ""}">
      <div class="testa"><span class="l">${D.GIORNI_BREVI[k].toUpperCase()}</span><span class="n">${D.daISO(g).getDate()}</span>${l.length ? `<span class="conta">${l.filter((i) => i.fatto).length}/${l.length}</span>` : ""}</div>
      ${l.map((i) => rigaImpegno(i, { compatta: true })).join("")}
      <button class="aggiungi-col" data-azione="nuovo" data-data="${g}">+ Aggiungi</button>
    </div>`;
  }).join("")}</div>`;
  return html;
}

// ------------------------------ vista: statistiche ----------------------------

function vistaStatistiche() {
  const g = ui.oggi;
  const serie = store.serieAttuale(g);
  const migliore = store.migliorSerie(g);
  const sett = store.settimana(g);
  const ultimi = store.fattiUltimi(30, g);
  const ctx = { serie, tags: [] };
  let html = `<header class="testata"><div><div class="sopra">Statistiche</div><h1>Come sta andando</h1></div>${pillSync()}</header>`;
  if (serie >= 2) {
    html += `<section class="motto verde"><div class="saluto">Serie attiva</div><p class="frase">${h(scegliFrase("serie", ctx, opzioniFrasi(`${g}:serie:${serie}`)))}</p></section>`;
  }
  html += `<div class="tessere">
    <div class="tessera"><div class="v">${serie}<small>${serie === 1 ? "giorno" : "giorni"}</small></div><div class="e">Serie attuale</div></div>
    <div class="tessera"><div class="v">${migliore}<small>${migliore === 1 ? "giorno" : "giorni"}</small></div><div class="e">Miglior serie</div></div>
    <div class="tessera"><div class="v">${sett.percentuale}<small>%</small></div><div class="e">Settimana finora · ${sett.fattiFinora}/${sett.totaliFinora}</div></div>
    <div class="tessera"><div class="v">${ultimi.totale}</div><div class="e">Fatti negli ultimi 30 giorni</div></div>
    <div class="tessera larga">
      <div class="e" style="margin-top:0">Settimana giorno per giorno</div>
      <div class="barre">${sett.giorni.map((d, k) => {
        const perc = d.totali ? Math.round((d.fatti / d.totali) * 100) : 0;
        return `<div class="b ${d.data === g ? "oggi" : ""}"><span class="q">${d.totali ? `${d.fatti}/${d.totali}` : "–"}</span><div class="colonna"><i style="height:${perc}%"></i></div><span class="l">${D.GIORNI_LETTERA[k]}</span></div>`;
      }).join("")}</div>
      <p class="muto piccolo" style="margin-top:10px">Ogni barra è la quota di impegni fatti quel giorno. I giorni futuri mostrano quanto c'è in programma.</p>
    </div>
    <div class="tessera larga">
      <div class="e" style="margin-top:0">Per tipo, ultimi 30 giorni</div>
      <div class="lista-tipi">${store.TIPI.map((t) => `<span class="etichetta-tipo ${t}">${t} · ${ultimi.perTipo[t] || 0}</span>`).join("")}</div>
    </div>
  </div>
  <p class="muto piccolo" style="margin-top:18px">La serie conta i giorni consecutivi in cui hai fatto tutto. I giorni senza impegni non la interrompono. Una chiusura serale con cose spostate a domani sì.</p>`;
  return html;
}

// ------------------------------ vista: impostazioni ---------------------------

const eInstallata = () => matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
const eIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function interruttore(chiave, on) {
  return `<button class="interruttore ${on ? "on" : ""}" role="switch" aria-checked="${on}" data-azione="toggle" data-chiave="${chiave}"></button>`;
}

function vistaImpostazioni() {
  const imp = store.impostazioni();
  const s = sync.statoSync;
  const tema = localStorage.getItem("tema") || "auto";
  let html = `<header class="testata"><div><div class="sopra">Impostazioni</div><h1>Come la vuoi</h1></div>${pillSync()}</header>`;

  // --- sincronizzazione
  html += `<section class="sezione" style="margin-top:0"><div class="intestazione"><h2>Sincronizzazione</h2></div><div class="carta">`;
  if (ui.codice.generato && s.stato !== "non-configurato") {
    html += `<div class="voce" style="display:block">
      <div class="t">Codice per l'app installata</div>
      <div class="d">Questo browser è stato scollegato. Copia il codice e incollalo nell'app installata in Impostazioni → Sincronizzazione.</div>
      <div class="campo"><textarea id="codice-generato" rows="5" readonly style="font-size:13px;font-family:ui-monospace,monospace">${h(ui.codice.generato)}</textarea></div>
      <div class="form-azioni"><button class="bottone" data-azione="codice-copia">Copia il codice</button><button class="bottone secondario" data-azione="codice-chiudi">Fatto</button></div>
      <p class="muto piccolo" style="margin-top:10px">Il codice vale come la tua sessione: non condividerlo e usalo entro poco.</p>
    </div>`;
  } else if (s.stato === "non-configurato") {
    html += `<div class="voce" style="display:block"><div class="t">Solo su questo dispositivo</div>
      <div class="d">La sincronizzazione tra telefono e computer non è ancora configurata. Le istruzioni sono nel file README del progetto (sezione Supabase): servono due valori in <code>config.js</code>.</div></div>`;
  } else if (!s.utente) {
    const l = ui.login;
    if (s.stato === "errore") html += `<div class="voce" style="display:block"><div class="avviso ko">Sincronizzazione non disponibile: ${h(s.messaggio || "errore di rete")}. Controlla la connessione e ricarica.</div></div>`;
    else if (s.messaggio) html += `<div class="voce" style="display:block"><div class="avviso ko">${h(s.messaggio)}</div></div>`;
    html += `<div class="voce" style="display:block">
      <div class="t">Collega il tuo account</div>
      <div class="d">Niente password: ti arriva un'email con un link, lo apri e sei dentro.</div>
      <form id="form-login" style="margin-top:12px">
        <div class="campo" style="margin-top:0"><label for="login-email">Email</label><input type="email" id="login-email" required autocomplete="email" inputmode="email" value="${h(l.email)}" placeholder="tu@esempio.it" ${l.inviato ? "readonly" : ""}></div>
        ${l.inviato ? `<div class="campo"><label for="login-codice">Se l'email contiene anche un codice, incollalo qui (facoltativo)</label><input type="text" id="login-codice" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="8"></div>` : ""}
        ${l.errore ? `<div class="avviso ko" style="margin-top:12px">${h(l.errore)}</div>` : ""}
        ${l.ok ? `<div class="avviso ok" style="margin-top:12px">${h(l.ok)}</div>` : ""}
        <div class="form-azioni">
          ${l.inviato
            ? `<button class="bottone" type="submit" ${l.inCorso ? "disabled" : ""}>Conferma codice</button><button class="bottone secondario" type="button" data-azione="login-reset">Cambia email</button>`
            : `<button class="bottone" type="submit" ${l.inCorso ? "disabled" : ""}>${l.inCorso ? "Invio…" : "Inviami il link"}</button>`}
        </div>
      </form></div>
      <div class="voce" style="display:block">
        <div class="t">Hai un codice da Safari?</div>
        <div class="d">${eInstallata() ? "Sei nell'app installata: incolla qui il codice generato da Safari in Impostazioni → Sincronizzazione." : "Serve per collegare l'app installata in Home su iPhone, dove il link via email non arriva."}</div>
        ${ui.codice.mostraIncolla || eInstallata() ? `<form id="form-codice" style="margin-top:10px">
          <div class="campo" style="margin-top:0"><textarea id="codice-incolla" rows="4" placeholder="Incolla qui il codice" style="font-size:13px;font-family:ui-monospace,monospace">${h(ui.codice.incollato || "")}</textarea></div>
          ${ui.codice.errore ? `<div class="avviso ko" style="margin-top:10px">${h(ui.codice.errore)}</div>` : ""}
          ${ui.codice.inCorso ? `<div class="avviso ok" style="margin-top:10px">Collego… un attimo.</div>` : ""}
          <div class="form-azioni">
            ${navigator.clipboard?.readText ? `<button class="bottone secondario" type="button" data-azione="codice-incolla-appunti" ${ui.codice.inCorso ? "disabled" : ""}>Incolla dagli appunti</button>` : ""}
            <button class="bottone" type="submit" ${ui.codice.inCorso ? "disabled" : ""}>${ui.codice.inCorso ? "Collego…" : "Collega con il codice"}</button>
          </div>
        </form>` : `<div style="margin-top:10px"><button class="link" data-azione="codice-mostra-incolla">Incolla un codice</button></div>`}
      </div>`;
  } else {
    html += `<div class="voce"><div><div class="t">${h(s.utente?.email || "")}</div><div class="d">${s.stato === "errore" ? "Errore: " + h(s.messaggio) : s.stato === "offline" ? "Offline: sincronizzo appena torna la rete" : s.ultimaSync ? "Ultima sincronizzazione alle " + D.oraAdesso(new Date(s.ultimaSync)) : "Collegato"}</div></div>
      <button class="bottone-mini" data-azione="sync-ora">Sincronizza ora</button></div>
      <div class="voce"><div><div class="t">Esci da questo dispositivo</div><div class="d">Gli altri dispositivi restano collegati. I dati restano sia qui sia sul server.</div></div><button class="bottone-mini" data-azione="esci">Esci</button></div>`;
    if (!eInstallata()) {
      html += `<div class="voce" style="display:block">
        <div class="t">Collega l'app installata (iPhone)</div>
        <div class="d">Il link via email apre Safari, ma l'app aggiunta alla schermata Home non vede quell'accesso. Genera un codice qui, copialo e incollalo nell'app installata in Impostazioni → Sincronizzazione. Attenzione: questo browser verrà scollegato, continuerai dall'app installata.</div>
        ${ui.codice.generato ? `
          <div class="campo"><textarea id="codice-generato" rows="5" readonly style="font-size:13px;font-family:ui-monospace,monospace">${h(ui.codice.generato)}</textarea></div>
          <div class="form-azioni"><button class="bottone" data-azione="codice-copia">Copia il codice</button></div>
          <p class="muto piccolo" style="margin-top:10px">Ora apri l'app installata, vai in Impostazioni → Sincronizzazione e incolla il codice. Il codice vale come la tua sessione: non condividerlo e usalo entro poco.</p>`
        : `${ui.codice.errore ? `<div class="avviso ko" style="margin-top:10px">${h(ui.codice.errore)}</div>` : ""}
          <div style="margin-top:10px"><button class="bottone secondario" data-azione="codice-genera" ${ui.codice.inCorso ? "disabled" : ""}>Genera codice</button></div>`}
      </div>`;
    }
  }
  html += `</div></section>`;

  // --- preferenze
  html += `<section class="sezione"><div class="intestazione"><h2>Preferenze</h2></div><div class="carta">
    <div class="voce"><div><div class="t">Modalità concentrazione</div><div class="d">In Oggi vedi un impegno alla volta.</div></div>${interruttore("modalitaFocus", imp.modalitaFocus)}</div>
    <div class="voce"><div><div class="t">Frase ad ogni spunta</div><div class="d">Una battuta ogni volta che fai qualcosa. Quelle importanti restano comunque.</div></div>${interruttore("frasiAdOgniSpunta", imp.frasiAdOgniSpunta)}</div>
    <div class="voce"><div><div class="t">Chiusura serale</div><div class="d">Da che ora proporre il bilancio della giornata.</div></div>
      <select data-campo-impostazione="oraChiusura">${[17, 18, 19, 20, 21, 22, 23].map((o) => `<option value="${o}" ${o === Number(imp.oraChiusura) ? "selected" : ""}>${o}:00</option>`).join("")}</select></div>
    <div class="voce"><div><div class="t">Tema</div><div class="d">Chiaro, scuro o come il sistema.</div></div>
      <select data-campo-tema>${[["auto", "Automatico"], ["light", "Chiaro"], ["dark", "Scuro"]].map(([v, t]) => `<option value="${v}" ${v === tema ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="voce"><div><div class="t">Come ti chiamo</div><div class="d">Facoltativo, per il saluto in cima.</div></div>
      <input type="text" class="input" style="max-width:150px;min-height:40px;padding:8px 10px" data-campo-impostazione="nome" value="${h(imp.nome || "")}" placeholder="Nome" maxlength="30"></div>
  </div></section>`;

  // --- frasi
  const extra = imp.frasiExtra || [], nascoste = new Set(imp.frasiNascoste || []);
  html += `<section class="sezione"><div class="intestazione"><h2>Frasi</h2><span class="conta">${BASE.length + extra.length - nascoste.size} attive</span></div>
    <div class="carta">
      <div class="voce" style="display:block">
        <div class="t">Aggiungi una frase tua</div>
        <div class="d">Puoi usare {n} {fatti} {totali} {rimasti} {serie} come segnaposto.</div>
        <form id="form-frase" style="margin-top:10px">
          <div class="campo" style="margin-top:0"><select id="frase-momento">${Object.entries(MOMENTI).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></div>
          <div class="campo"><input type="text" id="frase-testo" placeholder="La tua frase" maxlength="200" required></div>
          <div class="form-azioni"><button class="bottone secondario" type="submit">Aggiungi</button></div>
        </form>
      </div>
      ${Object.entries(MOMENTI).map(([k, v]) => {
        const lista = [...BASE.filter((f) => f.momento === k), ...extra.filter((f) => f.momento === k)];
        return `<details class="dettagli" ${ui.frasiMomentoAperto === k ? "open" : ""} data-momento="${k}"><summary><div class="voce"><div><div class="t">${h(v)}</div><div class="d">${lista.filter((f) => !nascoste.has(f.id)).length} di ${lista.length} attive</div></div><span class="freccetta">${ICONE.destra}</span></div></summary>
          ${lista.map((f) => `<div class="frase-voce ${nascoste.has(f.id) ? "nascosta" : ""}"><span class="testo">${f.id.startsWith("u") ? '<span class="mia">tua</span>' : ""}${h(f.testo)}</span>
            ${f.id.startsWith("u") ? `<button class="bottone-mini" data-azione="frase-elimina" data-id="${f.id}">Elimina</button>`
              : nascoste.has(f.id) ? `<button class="bottone-mini" data-azione="frase-mostra" data-id="${f.id}">Ripristina</button>`
              : `<button class="bottone-mini" data-azione="frase-nascondi" data-id="${f.id}">Nascondi</button>`}</div>`).join("")}
        </details>`;
      }).join("")}
    </div></section>`;

  // --- installazione
  html += `<section class="sezione"><div class="intestazione"><h2>Sul telefono</h2></div><div class="carta">
    ${eInstallata() ? `<div class="voce"><div><div class="t">App installata</div><div class="d">Si apre a schermo intero e funziona anche offline.</div></div></div>`
      : ui.installPrompt ? `<div class="voce"><div><div class="t">Installa l'app</div><div class="d">Icona in home, schermo intero, funziona offline.</div></div><button class="bottone-mini" data-azione="installa">Installa</button></div>`
      : eIOS() ? `<div class="voce" style="display:block"><div class="t">Installa su iPhone</div><div class="d">In Safari tocca Condividi, poi «Aggiungi alla schermata Home».</div></div>`
      : `<div class="voce" style="display:block"><div class="t">Installa l'app</div><div class="d">Dal menu del browser scegli «Installa app» o «Aggiungi a schermata Home».</div></div>`}
  </div></section>`;

  // --- backup
  html += `<section class="sezione"><div class="intestazione"><h2>Backup</h2></div><div class="carta">
    <div class="voce"><div><div class="t">Esporta</div><div class="d">Scarica tutti i dati in un file.</div></div><button class="bottone-mini" data-azione="esporta">Scarica</button></div>
    <div class="voce"><div><div class="t">Importa</div><div class="d">Carica un file esportato in precedenza. Si somma a quello che c'è.</div></div><label class="bottone-mini" style="cursor:pointer">Scegli file<input type="file" accept="application/json,.json" id="file-importa" hidden></label></div>
    <div class="voce"><div><div class="t">Cancella tutto</div><div class="d">Svuota i dati su questo dispositivo.</div></div><button class="bottone-mini" style="color:var(--alta)" data-azione="cancella-tutto">Cancella</button></div>
  </div></section>
  <p class="muto piccolo" style="margin-top:22px;text-align:center">Impegni ${VERSIONE_APP} · ${eInstallata() ? "app installata" : "nel browser"} · sync: ${h(sync.statoSync.stato)}${sync.statoSync.messaggio ? " (" + h(sync.statoSync.messaggio) + ")" : ""}</p>`;
  return html;
}

function conTimeout(promessa, ms, messaggio) {
  return Promise.race([promessa, new Promise((_, rifiuta) => setTimeout(() => rifiuta(new Error(messaggio)), ms))]);
}

// ============================== azioni ========================================

function gestisciClick(e) {
  const el = e.target.closest("[data-azione]");
  if (!el) return;
  const { azione, id } = el.dataset;
  const g = ui.oggi;
  switch (azione) {
    case "spunta": return spunta(id);
    case "modifica": return apriFormImpegno({ impegno: store.perId(id) });
    case "nuovo": return apriFormImpegno({ dataIniziale: el.dataset.data || g });
    case "rimanda": {
      const nuova = D.aggiungiGiorni(g, Number(el.dataset.giorni));
      store.rimanda(id, nuova);
      return avvisa(`Spostato a ${D.etichettaRelativa(nuova, g).toLowerCase()}.`);
    }
    case "focus-tutti": ui.focusMostraTutti = true; return render();
    case "focus-uno": ui.focusMostraTutti = false; return render();
    case "chiudi-giornata": return apriChiusura();
    case "settimana": ui.settimanaLunedi = D.aggiungiGiorni(ui.settimanaLunedi, 7 * Number(el.dataset.delta)); ui.giornoSelezionato = ui.settimanaLunedi === D.lunediDi(g) ? g : ui.settimanaLunedi; return render();
    case "settimana-oggi": ui.settimanaLunedi = D.lunediDi(g); ui.giornoSelezionato = g; return render();
    case "seleziona-giorno": ui.giornoSelezionato = el.dataset.data; return render();
    case "toggle": { const k = el.dataset.chiave; store.aggiornaImpostazioni({ [k]: !store.impostazioni()[k] }); return; }
    case "sync-ora": return sync.sincronizza();
    case "esci": return sync.esci().then(() => avvisa("Sei uscito. I dati restano qui."));
    case "login-reset": ui.login = { email: ui.login.email, inviato: false, errore: "", inCorso: false, ok: "" }; return render();
    case "codice-mostra-incolla": ui.codice.mostraIncolla = true; render(); return $("#codice-incolla")?.focus();
    case "codice-genera":
      ui.codice.inCorso = true; ui.codice.errore = ""; render();
      return sync.creaCodiceCollegamento()
        .then((c) => { ui.codice.generato = c; })
        .catch((err) => { ui.codice.errore = err.message || String(err); })
        .finally(() => { ui.codice.inCorso = false; render(); });
    case "codice-copia": {
      const ta = $("#codice-generato");
      ta?.select();
      return navigator.clipboard?.writeText(ui.codice.generato)
        .then(() => avvisa("Codice copiato. Ora incollalo nell'app installata."))
        .catch(() => { document.execCommand?.("copy"); avvisa("Codice selezionato: tieni premuto e scegli Copia."); });
    }
    case "codice-chiudi": ui.codice = { generato: "", errore: "", inCorso: false, mostraIncolla: false, incollato: "" }; return render();
    case "codice-incolla-appunti":
      return navigator.clipboard.readText()
        .then((t) => { const ta = $("#codice-incolla"); if (ta) ta.value = t; ui.codice.incollato = t; if (t.trim()) $("#form-codice")?.requestSubmit(); else avvisa("Gli appunti sono vuoti: copia prima il codice da Safari.", true); })
        .catch(() => avvisa("Non riesco a leggere gli appunti: incolla il codice a mano nel campo.", true));
    case "banner-ios-chiudi": localStorage.setItem("bannerIosVisto", "1"); return render();
    case "installa": return ui.installPrompt?.prompt().then(() => { ui.installPrompt = null; render(); });
    case "esporta": return esporta();
    case "cancella-tutto":
      if (confirm("Cancellare tutti i dati su questo dispositivo? Se sei collegato, al prossimo accesso tornano dal server.")) { store.cancellaTutto(); avvisa("Tutto cancellato. Tabula rasa."); }
      return;
    case "frase-nascondi": ui.frasiMomentoAperto = el.closest("details")?.dataset.momento; return store.aggiornaImpostazioni({ frasiNascoste: [...new Set([...(store.impostazioni().frasiNascoste || []), id])] });
    case "frase-mostra": ui.frasiMomentoAperto = el.closest("details")?.dataset.momento; return store.aggiornaImpostazioni({ frasiNascoste: (store.impostazioni().frasiNascoste || []).filter((x) => x !== id) });
    case "frase-elimina": ui.frasiMomentoAperto = el.closest("details")?.dataset.momento; return store.aggiornaImpostazioni({ frasiExtra: (store.impostazioni().frasiExtra || []).filter((f) => f.id !== id) });
  }
}

function gestisciChange(e) {
  const t = e.target;
  if (t.matches("[data-campo-impostazione]")) {
    const k = t.dataset.campoImpostazione;
    store.aggiornaImpostazioni({ [k]: t.type === "number" || k === "oraChiusura" ? Number(t.value) : t.value.trim() });
  } else if (t.matches("[data-campo-tema]")) {
    applicaTema(t.value);
  } else if (t.id === "file-importa" && t.files[0]) {
    t.files[0].text().then((testo) => {
      try { const n = store.importa(testo); avvisa(`Importati ${n} impegni.`); }
      catch (err) { avvisa(err.message || "File non valido", true); }
    });
  }
}

document.addEventListener("submit", async (e) => {
  if (e.target.id === "form-login") {
    e.preventDefault();
    const l = ui.login;
    l.email = $("#login-email").value.trim();
    const codiceOtp = $("#login-codice")?.value.trim() || "";
    l.errore = ""; l.ok = ""; l.inCorso = true; render();
    try {
      if (!l.inviato) {
        await sync.inviaLink(l.email);
        l.inviato = true; l.ok = "Email inviata. Apri il link dal messaggio: al ritorno qui sarai collegato.";
      } else {
        const codice = codiceOtp;
        if (!codice) throw new Error("Inserisci il codice ricevuto per email.");
        await sync.verificaCodice(l.email, codice);
        ui.login = { email: "", inviato: false, errore: "", inCorso: false, ok: "" };
        avvisa("Collegato! Sincronizzo i dati.");
      }
    } catch (err) {
      l.errore = err.message || String(err);
    } finally {
      l.inCorso = false; render();
      const c = $("#login-codice"); if (c) c.focus();
    }
  } else if (e.target.id === "form-codice") {
    e.preventDefault();
    const incollato = $("#codice-incolla")?.value || "";
    ui.codice.incollato = incollato;
    ui.codice.inCorso = true; ui.codice.errore = ""; render();
    try {
      await conTimeout(sync.usaCodiceCollegamento(incollato), 20000, "Nessuna risposta dal server: controlla la connessione e riprova.");
      ui.codice = { generato: "", errore: "", inCorso: false, mostraIncolla: false, incollato: "" };
      avvisa("Collegato! Sincronizzo i dati.");
    } catch (err) {
      ui.codice.errore = err.message || String(err);
      avvisa(ui.codice.errore, true);
    } finally {
      ui.codice.inCorso = false; render();
    }
  } else if (e.target.id === "form-frase") {
    e.preventDefault();
    const momento = $("#frase-momento").value, testo = $("#frase-testo").value.trim();
    if (!testo) return;
    ui.frasiMomentoAperto = momento;
    store.aggiornaImpostazioni({ frasiExtra: [...(store.impostazioni().frasiExtra || []), { id: "u" + store.uuid(), momento, testo }] });
    avvisa("Frase aggiunta. Ottimo gusto.");
  }
});

function spunta(id) {
  const i = store.perId(id);
  if (!i) return;
  const nuovo = !i.fatto;
  const r = store.segnaFatto(id, nuovo);
  if (!nuovo) return;
  const lista = store.perData(i.data);
  const rimasti = lista.filter((x) => !x.fatto).length;
  const ctx = { n: lista.length, fatti: lista.length - rimasti, totali: lista.length, rimasti, tags: [] };
  const imp = store.impostazioni();
  let testo = "";
  if (i.data === ui.oggi && rimasti === 0) { festeggia(); testo = scegliFrase("tutto_fatto", ctx, opzioniFrasi()); }
  else if (i.priorita === "Alta") { festeggia(); testo = scegliFrase("fatto_alta", ctx, opzioniFrasi()); }
  else if (imp.frasiAdOgniSpunta) testo = scegliFrase("fatto", ctx, opzioniFrasi());
  if (r.creato) testo += `${testo ? " " : ""}↻ Prossima volta: ${D.etichettaRelativa(r.creato.data, ui.oggi).toLowerCase()}.`;
  if (testo) avvisa(testo);
}

function esporta() {
  const blob = new Blob([store.esporta()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `impegni-${ui.oggi}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ============================== sheet =========================================

function apriSheet(html) {
  const s = $("#sheet");
  $("#sheet-corpo").innerHTML = `<div class="maniglia"></div>${html}`;
  s.hidden = false;
  document.body.style.overflow = "hidden";
}

function chiudiSheet() {
  const s = $("#sheet");
  if (s.hidden) return;
  s.hidden = true;
  $("#sheet-corpo").innerHTML = "";
  document.body.style.overflow = "";
}

// ------------------------------ form impegno ----------------------------------

function tipoRicorrenzaUI(r) {
  if (!r) return "nessuna";
  if (r.tipo === "settimane" && r.giorniSettimana?.length) return "settimane-giorni";
  return r.tipo;
}

function apriFormImpegno({ impegno = null, dataIniziale = ui.oggi } = {}) {
  const nuovo = !impegno;
  const v = impegno || { titolo: "", data: dataIniziale, ora: null, priorita: "Media", tipo: "Personale", note: "", ricorrenza: null };
  const ricUI = tipoRicorrenzaUI(v.ricorrenza);
  const giorniSel = new Set(v.ricorrenza?.giorniSettimana || [D.giornoSettimana(v.data)]);

  apriSheet(`
    <h2>${nuovo ? "Nuovo impegno" : "Modifica"}</h2>
    <form id="form-impegno" autocomplete="off">
      ${nuovo ? `<div class="campo nl" style="margin-top:12px"><label for="f-nl">Scrivi come parli</label>
        <input type="text" id="f-nl" placeholder="Es. dentista martedì alle 15, alta" enterkeyhint="done">
        <div class="interpretazione" id="f-interpretazione"></div></div>` : ""}
      <div class="campo"><label for="f-titolo">Titolo</label><input type="text" id="f-titolo" required maxlength="200" value="${h(v.titolo)}" placeholder="Cosa c'è da fare?"></div>
      <div class="campo"><div class="due">
        <div><label for="f-data">Quando</label><input type="date" id="f-data" required value="${h(v.data)}"></div>
        <div><label for="f-ora">Ora</label><input type="time" id="f-ora" value="${h(v.ora || "")}"></div>
      </div></div>
      ${nuovo ? "" : `<div class="campo"><span class="lab">Rimanda</span><div class="chips">
        <button type="button" class="chip" data-rimanda="1">Domani</button>
        <button type="button" class="chip" data-rimanda="2">Fra 2 giorni</button>
        <button type="button" class="chip" data-rimanda="7">Settimana prossima</button>
        <button type="button" class="chip" data-rimanda="scegli">Scegli data</button></div></div>`}
      <div class="campo"><span class="lab">Priorità</span><div class="chips" data-gruppo="priorita">
        ${store.PRIORITA.map((p) => `<button type="button" class="chip ${p === v.priorita ? "attivo" : ""}" data-val="${p}"><span class="pri ${p}"></span>${p}</button>`).join("")}</div></div>
      <div class="campo"><span class="lab">Tipo</span><div class="chips" data-gruppo="tipo">
        ${store.TIPI.map((t) => `<button type="button" class="chip ${t === v.tipo ? "attivo" : ""}" data-val="${t}">${t}</button>`).join("")}</div></div>
      <div class="campo"><label for="f-ric">Si ripete</label>
        <select id="f-ric">
          <option value="nessuna">Mai</option>
          <option value="giorni">Ogni giorno (o ogni N giorni)</option>
          <option value="settimane">Ogni settimana, stesso giorno</option>
          <option value="settimane-giorni">In certi giorni della settimana</option>
          <option value="mesi">Ogni mese</option>
          <option value="anni">Ogni anno</option>
        </select>
        <div id="f-ric-dettagli" style="margin-top:10px">
          <div class="tre" id="f-ric-ogni-box"><span class="muto">ogni</span><input type="number" id="f-ric-ogni" min="1" max="365" value="${v.ricorrenza?.ogni || 1}"><span class="muto" id="f-ric-unita">giorni</span></div>
          <div class="chips" id="f-ric-giorni" style="margin-top:10px">${D.GIORNI_BREVI.map((n, k) => `<button type="button" class="chip g ${giorniSel.has(k) ? "attivo" : ""}" data-g="${k}">${n}</button>`).join("")}</div>
        </div>
      </div>
      <div class="campo"><label for="f-note">Note</label><textarea id="f-note" maxlength="2000" placeholder="Dettagli, indirizzo, cose da non dimenticare…">${h(v.note || "")}</textarea></div>
      <div class="form-azioni">
        ${nuovo ? "" : `<button type="button" class="bottone pericolo" data-elimina>Elimina</button>`}
        <button type="submit" class="bottone">${nuovo ? "Aggiungi" : "Salva"}</button>
      </div>
    </form>`);

  const form = $("#form-impegno");
  const sel = $("#f-ric", form);
  sel.value = ricUI;
  const toccati = new Set();

  const aggiornaRicUI = () => {
    const t = sel.value;
    $("#f-ric-dettagli", form).hidden = t === "nessuna";
    $("#f-ric-ogni-box", form).hidden = t === "settimane-giorni";
    $("#f-ric-giorni", form).hidden = t !== "settimane-giorni";
    $("#f-ric-unita", form).textContent = { giorni: "giorni", settimane: "settimane", mesi: "mesi", anni: "anni" }[t] || "";
  };
  aggiornaRicUI();
  sel.addEventListener("change", () => { toccati.add("ricorrenza"); aggiornaRicUI(); });

  form.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.dataset.g !== undefined) { chip.classList.toggle("attivo"); toccati.add("ricorrenza"); return; }
    if (chip.dataset.rimanda) {
      const dataInput = $("#f-data", form);
      if (chip.dataset.rimanda === "scegli") { dataInput.focus(); dataInput.showPicker?.(); return; }
      dataInput.value = D.aggiungiGiorni(ui.oggi, Number(chip.dataset.rimanda));
      return;
    }
    const gruppo = chip.closest("[data-gruppo]");
    if (gruppo) {
      $$(".chip", gruppo).forEach((c) => c.classList.toggle("attivo", c === chip));
      toccati.add(gruppo.dataset.gruppo);
    }
  });
  ["f-titolo", "f-data", "f-ora"].forEach((id) => $("#" + id, form).addEventListener("input", () => toccati.add(id.slice(2))));

  if (nuovo) {
    const nl = $("#f-nl", form);
    const interp = $("#f-interpretazione", form);
    nl.addEventListener("input", () => {
      const r = analizza(nl.value, ui.oggi);
      // Se il testo non dice quando, vale il giorno da cui si è aperto il pannello.
      if (!r.trovati.data) r.data = r.ricorrenza ? (allineaData(dataIniziale, r.ricorrenza) || dataIniziale) : dataIniziale;
      if (!toccati.has("titolo")) $("#f-titolo", form).value = r.titolo;
      if (!toccati.has("data")) $("#f-data", form).value = r.data;
      if (!toccati.has("ora")) $("#f-ora", form).value = r.ora || "";
      if (!toccati.has("priorita")) $$("[data-gruppo=priorita] .chip", form).forEach((c) => c.classList.toggle("attivo", c.dataset.val === r.priorita));
      if (!toccati.has("tipo")) $$("[data-gruppo=tipo] .chip", form).forEach((c) => c.classList.toggle("attivo", c.dataset.val === r.tipo));
      if (!toccati.has("ricorrenza")) {
        sel.value = tipoRicorrenzaUI(r.ricorrenza);
        $("#f-ric-ogni", form).value = r.ricorrenza?.ogni || 1;
        const gs = new Set(r.ricorrenza?.giorniSettimana || [D.giornoSettimana(r.data)]);
        $$("#f-ric-giorni .chip", form).forEach((c) => c.classList.toggle("attivo", gs.has(Number(c.dataset.g))));
        aggiornaRicUI();
      }
      const pezzi = [];
      if (nl.value.trim()) {
        pezzi.push(`<span class="tag">${h(D.etichettaRelativa(r.data, ui.oggi))}</span>`);
        if (r.ora) pezzi.push(`<span class="tag">${h(r.ora)}</span>`);
        if (r.trovati.priorita) pezzi.push(`<span class="tag">${h(r.priorita)}</span>`);
        if (r.tipo !== "Personale" || r.trovati.tipo) pezzi.push(`<span class="tag">${h(r.tipo)}</span>`);
        if (r.ricorrenza) pezzi.push(`<span class="tag">↻ ${h(descriviRicorrenza(r.ricorrenza))}</span>`);
      }
      interp.innerHTML = pezzi.join("");
    });
    setTimeout(() => nl.focus(), 50);
  } else {
    setTimeout(() => $("#f-titolo", form).focus(), 50);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = sel.value;
    let ricorrenza = null;
    if (t !== "nessuna") {
      ricorrenza = { tipo: t === "settimane-giorni" ? "settimane" : t, ogni: Number($("#f-ric-ogni", form).value) || 1 };
      if (t === "settimane-giorni") {
        ricorrenza.giorniSettimana = $$("#f-ric-giorni .chip.attivo", form).map((c) => Number(c.dataset.g));
        if (!ricorrenza.giorniSettimana.length) { avvisa("Scegli almeno un giorno della settimana.", true); return; }
      }
    }
    let data = $("#f-data", form).value || ui.oggi;
    if (ricorrenza) data = allineaData(data, ricorrenza) || data;
    const campi = {
      titolo: $("#f-titolo", form).value,
      data,
      ora: $("#f-ora", form).value || null,
      priorita: $("[data-gruppo=priorita] .chip.attivo", form)?.dataset.val || "Media",
      tipo: $("[data-gruppo=tipo] .chip.attivo", form)?.dataset.val || "Personale",
      note: $("#f-note", form).value,
      ricorrenza,
    };
    if (!campi.titolo.trim()) { $("#f-titolo", form).focus(); return; }
    if (nuovo) {
      store.crea(campi);
      avvisa(`Aggiunto per ${D.etichettaRelativa(data, ui.oggi).toLowerCase()}${campi.ora ? " alle " + campi.ora : ""}.`);
    } else {
      store.aggiorna(impegno.id, campi);
      avvisa("Salvato.");
    }
    chiudiSheet();
  });

  const del = $("[data-elimina]", form);
  if (del) del.addEventListener("click", () => {
    const msg = impegno.ricorrenza
      ? `Eliminare «${impegno.titolo}»? È ricorrente: si ferma anche la serie.`
      : `Eliminare «${impegno.titolo}»? Non c'è un cestino, sparisce davvero.`;
    if (!confirm(msg)) return;
    store.elimina(impegno.id);
    chiudiSheet();
    avvisa("Eliminato. Come se non fosse mai esistito.");
  });
}

// ------------------------------ chiusura serale -------------------------------

function apriChiusura() {
  const g = ui.oggi;
  const lista = store.perData(g);
  const fatti = lista.filter((i) => i.fatto).length;
  const nonFatti = lista.filter((i) => !i.fatto);
  const domani = D.aggiungiGiorni(g, 1);
  apriSheet(`
    <h2>Chiudi la giornata</h2>
    <p class="muto">${lista.length ? `Hai fatto <b>${fatti} su ${lista.length}</b>.` : "Oggi non c'era niente in lista."} ${nonFatti.length ? "Scegli cosa spostare a domani." : ""}</p>
    ${nonFatti.length ? `<div class="carta chiusura-lista" style="margin-top:14px">${nonFatti.map((i) => `
      <label class="riga"><input type="checkbox" class="sr-only" data-sposta="${i.id}" checked><span class="spunta" aria-hidden="true">${ICONE.spunta}</span>
        <span class="corpo"><span class="titolo">${h(i.titolo)}</span><span class="meta"><span class="muto">sposta a domani</span></span></span></label>`).join("")}</div>
      <p class="muto piccolo" style="margin-top:8px">Quelli deselezionati restano su oggi, tra gli arretrati.</p>` : ""}
    <div class="form-azioni"><button class="bottone" id="conferma-chiusura">Chiudi la giornata</button></div>`);

  const corpo = $("#sheet-corpo");
  corpo.querySelectorAll("[data-sposta]").forEach((cb) => {
    const riga = cb.closest(".riga");
    const agg = () => riga.classList.toggle("fatta", cb.checked);
    cb.addEventListener("change", agg); agg();
  });
  $("#conferma-chiusura").addEventListener("click", () => {
    const daSpostare = [...corpo.querySelectorAll("[data-sposta]:checked")].map((cb) => cb.dataset.sposta);
    daSpostare.forEach((id) => store.rimanda(id, domani));
    store.registraChiusura(g, { fatti, totali: lista.length, slittati: daSpostare.length });
    const momento = lista.length === 0 || fatti === 0 ? "chiusura_zero" : fatti === lista.length ? "chiusura_ok" : "chiusura_parziale";
    const ctx = { fatti, totali: lista.length, rimasti: daSpostare.length, serie: store.serieAttuale(g), tags: [] };
    const frase = scegliFrase(momento, ctx, opzioniFrasi());
    if (momento === "chiusura_ok") festeggia();
    apriSheet(`<div class="risultato-chiusura">
      <div class="grande">${fatti}<span class="muto" style="font-size:24px">/${lista.length}</span></div>
      <div class="muto piccolo" style="margin-top:4px">${daSpostare.length ? `${daSpostare.length} ${daSpostare.length === 1 ? "impegno spostato" : "impegni spostati"} a domani` : "niente da spostare"}</div>
      <p class="frase">${h(frase)}</p>
      ${ctx.serie >= 2 ? `<p class="muto" style="margin-top:10px">Serie: ${ctx.serie} giorni di fila.</p>` : ""}
      <div class="form-azioni"><button class="bottone blocco" data-chiudi-sheet>Buonanotte</button></div>
    </div>`);
  });
}

// ============================== toast e coriandoli ============================

let timerToast;
function avvisa(testo, errore = false) {
  const t = $("#toast");
  t.textContent = testo;
  t.className = "visibile" + (errore ? " ko" : "");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.className = ""; }, Math.min(6000, 2200 + testo.length * 35));
}

function festeggia() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("#coriandoli");
  const ctx = c.getContext("2d");
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colori = ["#E0633D", "#F0B429", "#4F8A62", "#6A5A80", "#F08A5D", "#FFF4E8"];
  const p = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * 0.55,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 6,
    r: 4 + Math.random() * 5, col: colori[(Math.random() * colori.length) | 0],
    rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
  }));
  const inizio = performance.now();
  (function passo(t) {
    const el = t - inizio;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const q of p) {
      q.vy += .45; q.x += q.vx; q.y += q.vy; q.vx *= .985; q.rot += q.vr;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.globalAlpha = Math.max(0, 1 - el / 1700);
      ctx.fillStyle = q.col; ctx.fillRect(-q.r / 2, -q.r / 2, q.r, q.r * .6);
      ctx.restore();
    }
    if (el < 1700) requestAnimationFrame(passo); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(inizio);
}

avvia();
