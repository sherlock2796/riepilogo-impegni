// Netlify Function: tutte le azioni della dashboard sul database Notion.
//
// Riceve POST con { azione: "...", ...parametri } e risponde JSON.
// Azioni: fatto | rimanda | priorita | nuovo | aggiorna
//
// Il token Notion vive nelle variabili d'ambiente di Netlify e non
// raggiunge mai il browser.

const DATABASE_ID = process.env.NOTION_DATABASE_ID
  || "1e433e1789c54b1d9721c64488b5a3c0";

const PRIORITA_VALIDE = ["Alta", "Media", "Bassa"];
const TIPI_VALIDI = ["Lavoro", "Personale", "Appuntamento", "Sport", "Casa"];

const headersNotion = () => ({
  "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});

const json = (dati, status = 200) => new Response(JSON.stringify(dati), {
  status,
  headers: { "Content-Type": "application/json" },
});

const idValido = (id) => typeof id === "string" && /^[0-9a-f-]{32,36}$/i.test(id);

// Data di oggi (+ scarto giorni) nel fuso di Roma, formato YYYY-MM-DD.
// 'sv-SE' produce proprio il formato ISO, comodo per Notion.
function dataRoma(scartoGiorni = 0) {
  const t = new Date(Date.now() + scartoGiorni * 86400000);
  return t.toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

async function patchPagina(id, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: "PATCH",
    headers: headersNotion(),
    body: JSON.stringify({ properties }),
  });
  if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
  return r.json();
}

export default async (req) => {
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);

  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return json({ errore: "Body non valido" }, 400);
  }

  const { azione } = corpo;

  try {
    // --- spunta la checkbox Fatto ---------------------------------------
    if (azione === "fatto") {
      if (!idValido(corpo.id)) return json({ errore: "id non valido" }, 400);
      await patchPagina(corpo.id, { "Fatto": { checkbox: true } });
      return json({ ok: true });
    }

    // --- sposta la data avanti di N giorni --------------------------------
    if (azione === "rimanda") {
      if (!idValido(corpo.id)) return json({ errore: "id non valido" }, 400);
      const giorni = Number(corpo.giorni);
      if (!Number.isInteger(giorni) || giorni < 1 || giorni > 60) {
        return json({ errore: "giorni fuori intervallo" }, 400);
      }
      // Sposta rispetto a OGGI, non alla data originale: un arretrato di
      // tre giorni "rimandato a domani" deve finire domani, non ieri.
      const nuova = dataRoma(giorni);
      await patchPagina(corpo.id, { "Data": { date: { start: nuova } } });
      return json({ ok: true, data: nuova });
    }

    // --- cambia la priorità ----------------------------------------------
    if (azione === "priorita") {
      if (!idValido(corpo.id)) return json({ errore: "id non valido" }, 400);
      if (!PRIORITA_VALIDE.includes(corpo.valore)) {
        return json({ errore: "priorità non valida" }, 400);
      }
      await patchPagina(corpo.id, { "Priorità": { select: { name: corpo.valore } } });
      return json({ ok: true, priorita: corpo.valore });
    }

    // --- crea un nuovo impegno -------------------------------------------
    if (azione === "nuovo") {
      const titolo = String(corpo.titolo || "").trim().slice(0, 200);
      if (!titolo) return json({ errore: "titolo mancante" }, 400);

      const scarto = Number(corpo.scartoGiorni);
      const data = dataRoma(Number.isInteger(scarto) && scarto >= 0 && scarto <= 60
        ? scarto : 0);

      const properties = {
        "Nome": { title: [{ text: { content: titolo } }] },
        "Data": { date: { start: data } },
        "Fatto": { checkbox: false },
      };
      if (PRIORITA_VALIDE.includes(corpo.priorita)) {
        properties["Priorità"] = { select: { name: corpo.priorita } };
      }
      if (TIPI_VALIDI.includes(corpo.tipo)) {
        properties["Tipo"] = { select: { name: corpo.tipo } };
      }

      const r = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: headersNotion(),
        body: JSON.stringify({
          parent: { database_id: DATABASE_ID },
          properties,
        }),
      });
      if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
      const pagina = await r.json();
      return json({ ok: true, id: pagina.id, data });
    }

    // --- rigenera la dashboard (lancia il workflow su GitHub) -------------
    if (azione === "aggiorna") {
      const token = process.env.GITHUB_TOKEN;
      const repo = process.env.GITHUB_REPO;      // es. "sherlock2796/riepilogo-impegni"
      const wf = process.env.GITHUB_WORKFLOW || "riepilogo.yml";
      if (!token || !repo) {
        return json({ errore: "rigenerazione non configurata" }, 501);
      }
      const r = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        });
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
      return json({ ok: true });
    }

    return json({ errore: "azione sconosciuta" }, 400);
  } catch (e) {
    console.error(e);
    return json({ errore: String(e.message || e) }, 502);
  }
};
