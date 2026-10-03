// Service worker: rende l'app installabile e utilizzabile offline.
// Strategia: i file dell'app vengono messi in cache all'installazione;
// le richieste alla stessa origine vengono servite dalla cache e aggiornate
// in sottofondo. Le chiamate verso Supabase e i font passano dritte.

const VERSIONE = "impegni-v1.0.3";
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

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // La pagina: prima la rete (per avere sempre l'ultima versione), poi la cache.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put("./index.html", copia)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Tutto il resto: cache subito, aggiornamento in sottofondo.
  e.respondWith(
    caches.match(e.request).then((inCache) => {
      const rete = fetch(e.request).then((r) => {
        if (r && r.ok) caches.open(VERSIONE).then((c) => c.put(e.request, r.clone()));
        return r;
      }).catch(() => inCache);
      return inCache || rete;
    })
  );
});
