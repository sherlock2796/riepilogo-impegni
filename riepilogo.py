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


def riepilogo_con_claude(impegni: list[dict], oggi: date,
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
    if impegni:
        dati.append("Impegni dei prossimi 7 giorni:")
        dati += [descrivi_impegno(i, oggi) for i in impegni]
    else:
        dati.append("Nessun impegno nei prossimi 7 giorni.")

    system = (
        "Sei l'assistente personale mattutino di Leo. Ogni mattina ricevi i suoi "
        "impegni, il meteo e il bilancio di ieri, e scrivi il messaggio di "
        "buongiorno che riceve su Telegram.\n"
        "Stile: italiano, caldo ma asciutto, come un amico sveglio. Massimo 120 "
        "parole. Struttura libera, niente elenchi puntati rigidi.\n"
        "Contenuto: apri con un buongiorno legato al giorno o al meteo; di' cosa "
        "c'è oggi (se c'è un orario, citalo); segnala solo le cose davvero "
        "rilevanti dei prossimi giorni, in particolare le priorità alte; se ieri "
        "ha completato dei task, riconosciglielo in una frase, senza esagerare.\n"
        "Se non c'è nessun impegno oggi, dillo con leggerezza.\n"
        "Puoi usare 2-3 emoji al massimo. Non inventare impegni o dettagli non "
        "presenti nei dati. Non firmarti e non fare domande."
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


# ------------------- fallback: il vecchio elenco formattato ------------------

def riepilogo_classico(impegni: list[dict], oggi: date,
                       meteo: str | None, ieri: tuple[int, int]) -> str:
    domani = oggi + timedelta(days=1)
    testo = [f"📅 <b>{GIORNI[oggi.weekday()]} {oggi.day} {MESI[oggi.month-1]}</b>"]
    if meteo:
        testo.append(f"🌤 Bertinoro: {meteo}")
    fatti, totali = ieri
    if totali:
        testo.append(f"Ieri: {fatti}/{totali} impegni completati 💪")

    def riga(i, con_giorno=False):
        pezzi = [PRIORITA_EMOJI.get(i["priorita"], "▫️")]
        if con_giorno and i["giorno"]:
            pezzi.append(f"{GIORNI[i['giorno'].weekday()][:3]} {i['giorno'].day}:")
        pezzi.append(f"<b>{i['titolo']}</b>")
        if i["ora"]:
            pezzi.append(f"— ore {i['ora']}")
        return " ".join(pezzi)

    di_oggi = [i for i in impegni if i["giorno"] == oggi]
    di_domani = [i for i in impegni if i["giorno"] == domani]
    prossimi = [i for i in impegni if i["giorno"] and i["giorno"] > domani]

    testo.append("\n<b>Oggi</b>")
    testo += [riga(i) for i in di_oggi] if di_oggi else ["Nessun impegno 👌"]
    if di_domani:
        testo.append("\n<b>Domani</b>")
        testo += [riga(i) for i in di_domani]
    if prossimi:
        testo.append("\n<b>Prossimi giorni</b>")
        testo += [riga(i, con_giorno=True) for i in prossimi]
    return "\n".join(testo)


# --------------------------------- invio ------------------------------------

def invia_telegram(testo: str, html: bool) -> None:
    payload = {"chat_id": TG_CHAT_ID, "text": testo}
    if html:
        payload["parse_mode"] = "HTML"
    r = requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json=payload, timeout=30)
    r.raise_for_status()


def main() -> None:
    oggi = datetime.now(ZoneInfo("Europe/Rome")).date()
    impegni = impegni_prossimi(oggi)
    ieri = bilancio_ieri(oggi)
    meteo = meteo_bertinoro()

    testo = riepilogo_con_claude(impegni, oggi, meteo, ieri)
    if testo:
        invia_telegram(testo, html=False)
        print(f"Inviato riepilogo Claude ({len(impegni)} impegni)")
    else:
        invia_telegram(riepilogo_classico(impegni, oggi, meteo, ieri), html=True)
        print(f"Inviato riepilogo classico ({len(impegni)} impegni)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Errore: {e}", file=sys.stderr)
        sys.exit(1)
