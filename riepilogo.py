"""
Riepilogo mattutino v2: Notion + Meteo -> Claude -> Telegram

Ogni mattina:
  1. legge gli impegni dei prossimi 7 giorni dal database Notion "Impegni"
  2. conta come e' andata ieri (task fatti / totali)
  3. prende il meteo di Bertinoro da Open-Meteo (gratis, senza chiave)
  4. passa tutto a Claude, che scrive un buongiorno discorsivo in italiano
  5. manda il testo su Telegram
Se la chiamata a Claude fallisce per qualsiasi motivo, il messaggio parte
comunque nel vecchio formato a elenco: il riepilogo arriva sempre.

Variabili d'ambiente richieste (GitHub Secrets):
  NOTION_TOKEN         token integrazione Notion
  TELEGRAM_BOT_TOKEN   token del bot Telegram
  TELEGRAM_CHAT_ID     chat ID Telegram
  ANTHROPIC_API_KEY    chiave API da console.anthropic.com
"""

import html
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

# ----------------------------- configurazione ------------------------------

DATABASE_ID = "1e433e1789c54b1d9721c64488b5a3c0"  # database "Impegni"
NOTION_TOKEN = os.environ["NOTION_TOKEN"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

MODELLO_CLAUDE = "claude-haiku-4-5"  # veloce ed economico: perfetto qui

# Bertinoro (FC)
METEO_LAT, METEO_LON = 44.1489, 12.1352

GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
PRIORITA_EMOJI = {"Alta": "🔴", "Media": "🟡", "Bassa": "⚪"}

# Codici meteo WMO usati da Open-Meteo -> descrizione in italiano
WMO = {
    0: "sereno", 1: "quasi sereno", 2: "parzialmente nuvoloso", 3: "coperto",
    45: "nebbia", 48: "nebbia con brina",
    51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa",
    61: "pioggia leggera", 63: "pioggia", 65: "pioggia forte",
    66: "pioggia gelata", 67: "pioggia gelata forte",
    71: "neve leggera", 73: "neve", 75: "neve forte", 77: "nevischio",
    80: "rovesci leggeri", 81: "rovesci", 82: "rovesci violenti",
    85: "rovesci di neve", 86: "rovesci di neve forti",
    95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine forte",
}

# ------------------------------ lettura Notion -----------------------------

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}


def query_notion(filtro: dict, ordina: bool = True) -> list[dict]:
    """Esegue una query sul database con il filtro dato, gestendo la paginazione."""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    payload: dict = {"filter": filtro}
    if ordina:
        payload["sorts"] = [{"property": "Data", "direction": "ascending"}]
    risultati = []
    while True:
        r = requests.post(url, headers=NOTION_HEADERS, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        risultati.extend(data["results"])
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]
    return risultati


def impegni_prossimi(oggi: date, giorni: int = 7) -> list[dict]:
    """Impegni non fatti da oggi a oggi+giorni."""
    fine = oggi + timedelta(days=giorni)
    filtro = {"and": [
        {"property": "Fatto", "checkbox": {"equals": False}},
        {"property": "Data", "date": {"on_or_after": oggi.isoformat()}},
        {"property": "Data", "date": {"on_or_before": fine.isoformat()}},
    ]}
    return [estrai(p) for p in query_notion(filtro)]


def bilancio_ieri(oggi: date) -> tuple[int, int]:
    """Ritorna (fatti, totali) dei task datati ieri."""
    ieri = oggi - timedelta(days=1)
    filtro = {"and": [
        {"property": "Data", "date": {"equals": ieri.isoformat()}},
    ]}
    pagine = query_notion(filtro, ordina=False)
    totali = len(pagine)
    fatti = sum(1 for p in pagine if p["properties"]["Fatto"]["checkbox"])
    return fatti, totali


def impegni_arretrati(oggi: date, max_giorni: int = 30) -> list[dict]:
    """Impegni NON fatti con data passata (fino a max_giorni indietro).

    Il limite evita che, dopo mesi di uso, un vecchio task dimenticato
    resti in cima al messaggio per sempre: oltre i 30 giorni si presume
    che non sia piu' rilevante (resta comunque nel database).
    """
    inizio = oggi - timedelta(days=max_giorni)
    filtro = {"and": [
        {"property": "Fatto", "checkbox": {"equals": False}},
        {"property": "Data", "date": {"on_or_after": inizio.isoformat()}},
        {"property": "Data", "date": {"before": oggi.isoformat()}},
    ]}
    arretrati = [estrai(p) for p in query_notion(filtro)]
    for a in arretrati:
        a["ritardo"] = (oggi - a["giorno"]).days if a["giorno"] else None
    return arretrati


def estrai(pagina: dict) -> dict:
    """Estrae i campi utili da una pagina Notion."""
    p = pagina["properties"]
    titolo = "".join(t["plain_text"] for t in p["Nome"]["title"]) or "(senza nome)"
    d = p["Data"]["date"]
    start = d["start"] if d else None
    ora, giorno = None, None
    if start:
        if "T" in start:
            dt = datetime.fromisoformat(start)
            giorno, ora = dt.date(), dt.strftime("%H:%M")
        else:
            giorno = date.fromisoformat(start)
    sel = p["Priorità"]["select"]
    priorita = sel["name"] if sel else None
    sel = p["Tipo"]["select"]
    tipo = sel["name"] if sel else None
    note = "".join(t["plain_text"] for t in p["Note"]["rich_text"]) or None
    return {"titolo": titolo, "giorno": giorno, "ora": ora,
            "priorita": priorita, "tipo": tipo, "note": note}


# --------------------------------- meteo -----------------------------------

def meteo_bertinoro() -> str | None:
    """Meteo di oggi a Bertinoro in una riga. None se l'API non risponde."""
    try:
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": METEO_LAT,
                "longitude": METEO_LON,
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                         "precipitation_probability_max",
                "timezone": "Europe/Rome",
                "forecast_days": 1,
            },
            timeout=15,
        )
        r.raise_for_status()
        d = r.json()["daily"]
        descr = WMO.get(d["weather_code"][0], "condizioni variabili")
        tmin, tmax = round(d["temperature_2m_min"][0]), round(d["temperature_2m_max"][0])
        pioggia = d["precipitation_probability_max"][0]
        riga = f"{descr}, min {tmin}° / max {tmax}°"
        if pioggia and pioggia >= 30:
            riga += f", probabilità di pioggia {pioggia}%"
        return riga
    except Exception as e:
        print(f"Meteo non disponibile: {e}", file=sys.stderr)
        return None


# ------------------------- riepilogo scritto da Claude ----------------------

def descrivi_impegno(i: dict, oggi: date) -> str:
    """Una riga di testo semplice per impegno, da dare in pasto a Claude."""
    giorno = i["giorno"]
    if giorno == oggi:
        quando = "oggi"
    elif giorno == oggi + timedelta(days=1):
        quando = "domani"
    else:
        quando = f"{GIORNI[giorno.weekday()]} {giorno.day}"
    pezzi = [f"- {quando}: {i['titolo']}"]
    if i["ora"]:
        pezzi.append(f"alle {i['ora']}")
    if i["tipo"]:
        pezzi.append(f"[{i['tipo']}]")
    if i["priorita"]:
        pezzi.append(f"(priorità {i['priorita'].lower()})")
    if i["note"]:
        pezzi.append(f"— note: {i['note']}")
    return " ".join(pezzi)


def riepilogo_con_claude(impegni: list[dict], arretrati: list[dict], oggi: date,
                         meteo: str | None, ieri: tuple[int, int]) -> str | None:
    """Chiede a Claude un buongiorno discorsivo. None se qualcosa va storto."""
    if not ANTHROPIC_API_KEY:
        return None

    dati = [f"Data di oggi: {GIORNI[oggi.weekday()]} {oggi.day} {MESI[oggi.month-1]}"]
    if meteo:
        dati.append(f"Meteo a Bertinoro: {meteo}")
    fatti, totali = ieri
    if totali:
        dati.append(f"Bilancio di ieri: completati {fatti} impegni su {totali}")
    if arretrati:
        dati.append("Impegni ARRETRATI (scaduti e mai completati):")
        dati += [f"- {a['titolo']}: in ritardo di "
                 f"{a['ritardo']} giorn{'o' if a['ritardo'] == 1 else 'i'}"
                 for a in arretrati]
    if impegni:
        dati.append("Impegni dei prossimi 7 giorni:")
        dati += [descrivi_impegno(i, oggi) for i in impegni]
    else:
        dati.append("Nessun impegno nei prossimi 7 giorni.")

    system = (
        "Sei l'assistente personale mattutino di Leo. Scrivi SOLO l'apertura del "
        "suo messaggio di buongiorno su Telegram: subito sotto il tuo testo verrà "
        "aggiunto automaticamente l'elenco completo degli impegni, quindi NON "
        "elencare gli impegni uno per uno.\n"
        "Stile: italiano, caldo ma asciutto, come un amico sveglio. Massimo 50 "
        "parole, 2-3 frasi.\n"
        "Contenuto: un buongiorno legato al giorno o al meteo; poi UNA sola "
        "osservazione utile — la cosa più importante di oggi, un arretrato che "
        "si trascina da giorni, una priorità alta in arrivo, una nota da "
        "ricordare, o il bilancio di ieri se positivo. Scegli tu quella che "
        "merita di più, non tutte. Se citi un arretrato, fallo come promemoria "
        "pratico, senza colpevolizzare.\n"
        "Massimo 2 emoji. Non inventare dettagli non presenti nei dati. Non "
        "firmarti e non fare domande."
    )

    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODELLO_CLAUDE,
                "max_tokens": 600,
                "system": system,
                "messages": [{"role": "user", "content": "\n".join(dati)}],
            },
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("stop_reason") == "max_tokens":
            print("Risposta Claude troncata, uso il fallback", file=sys.stderr)
            return None
        testo = "".join(b.get("text", "") for b in data["content"]).strip()
        return testo or None
    except Exception as e:
        print(f"Claude non disponibile: {e}", file=sys.stderr)
        return None


# --------------------- elenco impegni (generato dal codice) ------------------

def lista_impegni(impegni: list[dict], oggi: date,
                  arretrati: list[dict] | None = None) -> str:
    """La parte a elenco: Arretrati / Oggi / Domani / Prossimi giorni."""
    domani = oggi + timedelta(days=1)

    def riga(i, con_giorno=False):
        pezzi = [PRIORITA_EMOJI.get(i["priorita"], "▫️")]
        if con_giorno and i["giorno"]:
            pezzi.append(f"{GIORNI[i['giorno'].weekday()][:3]} {i['giorno'].day}:")
        pezzi.append(f"<b>{i['titolo']}</b>")
        if i["ora"]:
            pezzi.append(f"— ore {i['ora']}")
        return " ".join(pezzi)

    testo = []
    if arretrati:
        # Ordinati dal ritardo maggiore: le cose ferme da piu' tempo in cima
        testo.append("⏳ <b>Arretrati</b>")
        for a in sorted(arretrati, key=lambda x: x["ritardo"] or 0, reverse=True):
            g = a["ritardo"]
            testo.append(f"🔺 <b>{a['titolo']}</b> — da {g} "
                         f"giorn{'o' if g == 1 else 'i'}")
        testo.append("")

    di_oggi = [i for i in impegni if i["giorno"] == oggi]
    di_domani = [i for i in impegni if i["giorno"] == domani]
    prossimi = [i for i in impegni if i["giorno"] and i["giorno"] > domani]

    testo.append("<b>Oggi</b>")
    testo += [riga(i) for i in di_oggi] if di_oggi else ["Nessun impegno 👌"]
    if di_domani:
        testo.append("\n<b>Domani</b>")
        testo += [riga(i) for i in di_domani]
    if prossimi:
        testo.append("\n<b>Prossimi giorni</b>")
        testo += [riga(i, con_giorno=True) for i in prossimi]
    return "\n".join(testo)


# ------------------- fallback: il vecchio formato completo -------------------

def riepilogo_classico(impegni: list[dict], oggi: date,
                       meteo: str | None, ieri: tuple[int, int],
                       arretrati: list[dict] | None = None) -> str:
    testo = [f"📅 <b>{GIORNI[oggi.weekday()]} {oggi.day} {MESI[oggi.month-1]}</b>"]
    if meteo:
        testo.append(f"🌤 Bertinoro: {meteo}")
    fatti, totali = ieri
    if totali:
        testo.append(f"Ieri: {fatti}/{totali} impegni completati 💪")
    testo.append("")
    testo.append(lista_impegni(impegni, oggi, arretrati))
    return "\n".join(testo)


# --------------------------------- invio ------------------------------------

def invia_telegram(testo: str, html: bool) -> None:
    payload = {"chat_id": TG_CHAT_ID, "text": testo}
    if html:
        payload["parse_mode"] = "HTML"
    r = requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json=payload, timeout=30)
    r.raise_for_status()


# ------------------------- dashboard per tablet ------------------------------
# Stile "Almanacco": cielo d'alba sopra l'orizzonte (data, meteo, frase di
# Claude), terra scura sotto (arretrati e impegni).

from string import Template

DASHBOARD_TEMPLATE = Template("""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="1800">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Impegni</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Manrope:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root{
    --notte:#252A3D; --alba1:#3D4463; --alba2:#8A6E7E; --alba3:#D9A08B; --oro:#EFC99B;
    --terra:#1C1F2B; --testo:#F4F1EC; --dim:#A8ABB8; --ambra:#E8B26A; --linea:#31364A;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{min-height:100vh;background:var(--terra);color:var(--testo);
    font-family:Manrope,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .cielo{
    background:linear-gradient(180deg,var(--notte) 0%,var(--alba1) 38%,var(--alba2) 68%,var(--alba3) 92%,var(--oro) 100%);
    padding:56px 0 46px;
  }
  .colonna{max-width:780px;margin:0 auto;padding:0 40px}
  .giorno{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;
    font-size:clamp(52px,8.5vw,80px);line-height:1.04;letter-spacing:-.015em}
  .giorno .mese{font-weight:500;color:var(--oro)}
  .meteo{margin-top:12px;font-size:20px;color:#E8E2DA;opacity:.92}
  .epigrafe{font-size:22px;line-height:1.55;margin:30px 0 0;max-width:36em;color:#F7F2EA}
  .orizzonte{height:4px;background:var(--oro);opacity:.9}
  .terra{padding:40px 0 44px}
  .etichetta{font-size:13px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;
    color:var(--dim);margin-bottom:4px}
  .blocco{margin-top:34px}
  .blocco:first-child{margin-top:0}
  .arretrati{background:rgba(232,178,106,.08);border:1px solid rgba(232,178,106,.35);
    border-radius:14px;padding:18px 22px 8px}
  .arretrati .etichetta{color:var(--ambra)}
  .riga{display:flex;justify-content:space-between;align-items:baseline;gap:18px;
    padding:14px 0;border-bottom:1px solid var(--linea)}
  .riga:last-child{border-bottom:none}
  .riga .t{font-size:24px;font-weight:600}
  .riga .ora{font-size:20px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
  .riga .giorni{font-size:18px;color:var(--ambra);white-space:nowrap}
  .minori .riga .t{font-size:19px;font-weight:400}
  .minori .riga{padding:10px 0}
  .minori .riga .ora{font-size:17px}
  .due-col{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}
  .vuoto{font-size:21px;color:var(--dim);padding:12px 0}
  @media(max-width:640px){.due-col{grid-template-columns:1fr}.colonna{padding:0 24px}}
  footer{margin-top:44px;font-size:13px;color:var(--dim);opacity:.75}
</style>
</head>
<body>
  <div class="cielo">
    <div class="colonna">
      <div class="giorno">$giorno_settimana $giorno_numero<br><span class="mese">$mese</span></div>
      $meteo_html
      $epigrafe_html
    </div>
  </div>
  <div class="orizzonte"></div>
  <div class="terra">
    <div class="colonna">
      $arretrati_html
      <section class="blocco">
        <div class="etichetta">Oggi</div>
        $oggi_html
      </section>
      $futuro_html
      <footer>Aggiornato alle $ora_agg</footer>
    </div>
  </div>
</body>
</html>
""")


def _riga_task(i: dict, mostra_giorno: bool = False) -> str:
    nome = html.escape(i["titolo"])
    if mostra_giorno and i["giorno"]:
        nome = f"{GIORNI[i['giorno'].weekday()][:3]} {i['giorno'].day} · " + nome
    ora = f'<span class="ora">{i["ora"]}</span>' if i["ora"] else ""
    return f'<div class="riga"><span class="t">{nome}</span>{ora}</div>'


def genera_dashboard(impegni: list[dict], arretrati: list[dict], oggi: date,
                     meteo: str | None, apertura: str | None,
                     percorso: str = "site/index.html") -> None:
    """Scrive la pagina HTML per il tablet (stile Almanacco)."""
    domani = oggi + timedelta(days=1)
    di_oggi = [i for i in impegni if i["giorno"] == oggi]
    di_domani = [i for i in impegni if i["giorno"] == domani]
    prossimi = [i for i in impegni if i["giorno"] and i["giorno"] > domani]

    meteo_html = (f'<div class="meteo">Bertinoro · {html.escape(meteo)}</div>'
                  if meteo else "")
    epigrafe_html = (f'<p class="epigrafe">{html.escape(apertura)}</p>'
                     if apertura else "")

    if arretrati:
        righe = "".join(
            f'<div class="riga"><span class="t">{html.escape(a["titolo"])}</span>'
            f'<span class="giorni">da {a["ritardo"]} '
            f'giorn{"o" if a["ritardo"] == 1 else "i"}</span></div>'
            for a in sorted(arretrati, key=lambda x: x["ritardo"] or 0, reverse=True))
        arretrati_html = (f'<section class="blocco arretrati">'
                          f'<div class="etichetta">Arretrati</div>{righe}</section>')
    else:
        arretrati_html = ""

    oggi_html = ("".join(_riga_task(i) for i in di_oggi)
                 or '<div class="vuoto">Nessun impegno — giornata libera</div>')

    colonne = []
    if di_domani:
        colonne.append('<div><div class="etichetta">Domani</div>'
                       + "".join(_riga_task(i) for i in di_domani) + "</div>")
    if prossimi:
        colonne.append('<div><div class="etichetta">Prossimi giorni</div>'
                       + "".join(_riga_task(i, True) for i in prossimi) + "</div>")
    futuro_html = (f'<section class="blocco minori"><div class="due-col">'
                   f'{"".join(colonne)}</div></section>' if colonne else "")

    pagina = DASHBOARD_TEMPLATE.substitute(
        giorno_settimana=GIORNI[oggi.weekday()],
        giorno_numero=oggi.day,
        mese=MESI[oggi.month - 1],
        meteo_html=meteo_html,
        epigrafe_html=epigrafe_html,
        arretrati_html=arretrati_html,
        oggi_html=oggi_html,
        futuro_html=futuro_html,
        ora_agg=datetime.now(ZoneInfo("Europe/Rome")).strftime("%H:%M"),
    )
    os.makedirs(os.path.dirname(percorso), exist_ok=True)
    with open(percorso, "w", encoding="utf-8") as f:
        f.write(pagina)
    print(f"Dashboard scritta in {percorso}")


def main() -> None:
    oggi = datetime.now(ZoneInfo("Europe/Rome")).date()
    impegni = impegni_prossimi(oggi)
    arretrati = impegni_arretrati(oggi)
    ieri = bilancio_ieri(oggi)
    meteo = meteo_bertinoro()

    apertura = riepilogo_con_claude(impegni, arretrati, oggi, meteo, ieri)

    # Dashboard per il tablet: se fallisce, il Telegram parte comunque
    try:
        genera_dashboard(impegni, arretrati, oggi, meteo, apertura)
    except Exception as e:
        print(f"Dashboard non generata: {e}", file=sys.stderr)
    if apertura:
        # Apertura discorsiva di Claude + elenco preciso generato dal codice.
        # Il testo di Claude va "escapato" perche' il messaggio usa parse_mode
        # HTML per il grassetto dell'elenco.
        testo = (f"📅 <b>{GIORNI[oggi.weekday()]} {oggi.day} {MESI[oggi.month-1]}</b>\n"
                 f"{html.escape(apertura)}\n\n"
                 f"{lista_impegni(impegni, oggi, arretrati)}")
        invia_telegram(testo, html=True)
        print(f"Inviato riepilogo combinato "
              f"({len(impegni)} impegni, {len(arretrati)} arretrati)")
    else:
        invia_telegram(riepilogo_classico(impegni, oggi, meteo, ieri, arretrati),
                       html=True)
        print(f"Inviato riepilogo classico "
              f"({len(impegni)} impegni, {len(arretrati)} arretrati)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Errore: {e}", file=sys.stderr)
        sys.exit(1)
