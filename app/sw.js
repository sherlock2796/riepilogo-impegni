// Service worker: rende l'app installabile e utilizzabile offline.
// Strategia: i file dell'app vengono messi in cache all'installazione;
// le richieste alla stessa origine vengono servite dalla cache e aggiornate
// in sottofondo. Le chiamate verso Supabase e i font passano dritte.

const VERSIONE = "impegni-v1.2.0";
const CACHE_ESTERNI = "impegni-esterni-v1";
// Libreria di sincronizzazione e caratteri: messi in cache al primo uso,
// così l'app parte anche offline (e la libreria non manca mai).
const ORIGINI_ESTERNE = ["https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
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
  "./js/notifiche-logica.js",
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
      const vecchie = chiavi.filter((k) => k !== VERSIONE && k !== CACHE_ESTERNI);
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
  if (e.request.method !== "GET") return;

  if (url.origin !== location.origin) {
    if (!ORIGINI_ESTERNE.includes(url.origin)) return;
    e.respondWith(
      caches.open(CACHE_ESTERNI).then((c) => c.match(e.request).then((inCache) => {
        const rete = fetch(e.request).then((r) => {
          if (r && r.ok) c.put(e.request, r.clone());
          return r;
        }).catch(() => inCache);
        return inCache || rete;
      }))
    );
    return;
  }

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

// ----------------------------- notifiche push --------------------------------
self.addEventListener("push", (e) => {
  let dati = {};
  try { dati = e.data ? e.data.json() : {}; } catch { dati = { corpo: e.data ? e.data.text() : "" }; }
  const titolo = dati.titolo || "Impegni";
  e.waitUntil(self.registration.showNotification(titolo, {
    body: dati.corpo || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: dati.tag || undefined,
    data: { url: dati.url || "./#/oggi" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destinazione = new URL(e.notification.data?.url || "./#/oggi", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((finestre) => {
    const aperta = finestre.find((w) => w.url.startsWith(self.registration.scope));
    if (aperta) {
      return aperta.focus().then(() => (aperta.navigate ? aperta.navigate(destinazione).catch(() => null) : null));
    }
    return self.clients.openWindow(destinazione);
  }));
});
