// Service worker: rende l'app installabile e utilizzabile offline.
// Strategia: i file dell'app vengono messi in cache all'installazione;
// le richieste alla stessa origine vengono servite dalla cache e aggiornate
// in sottofondo. Le chiamate verso Supabase e i font passano dritte.

const VERSIONE = "impegni-v1.0.5";
const FILE = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/store.js",
  "./js/sync.js",
  "./js/parser.js",
  "./js/frasi.js",
  "./js/ricorrenze.js",
  "./js/date.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// GitHub Pages serve i file con Cache-Control di 10 minuti: per non mettere
// in cache copie vecchie, tutte le richieste al server saltano la cache HTTP
// del browser ("reload" in installazione, "no-cache" = rivalida col server dopo).
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      .then((c) => Promise.all(FILE.map((f) => fetch(new Request(f, { cache: "reload" }))
        .then((r) => { if (!r.ok) throw new Error(f + " " + r.status); return c.put(f, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(async (chiavi) => {
      const vecchie = chiavi.filter((k) => k !== VERSIONE);
      await Promise.all(vecchie.map((k) => caches.delete(k)));
      await self.clients.claim();
      if (!vecchie.length) return; // prima installazione: niente da ricaricare
      // Aggiornamento: ricarico le pagine aperte così usano i file nuovi.
      const finestre = await self.clients.matchAll({ type: "window" });
      await Promise.all(finestre.map((w) => /access_token|refresh_token/.test(w.url) ? null : w.navigate(w.url).catch(() => null)));
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // La pagina: prima la rete (per avere sempre l'ultima versione), poi la cache.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" })
        .then((r) => { const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put("./index.html", copia)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Tutto il resto: cache subito, aggiornamento in sottofondo.
  e.respondWith(
    caches.match(e.request).then((inCache) => {
      const rete = fetch(e.request, { cache: "no-cache" }).then((r) => {
        if (r && r.ok) caches.open(VERSIONE).then((c) => c.put(e.request, r.clone()));
        return r;
      }).catch(() => inCache);
      return inCache || rete;
    })
  );
});
