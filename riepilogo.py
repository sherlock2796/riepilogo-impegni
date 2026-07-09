"""
Riepilogo mattutino impegni: Notion -> Telegram
Legge il database "Impegni" e manda un messaggio con gli impegni
di oggi, domani e del resto della settimana (7 giorni).

Variabili d'ambiente richieste (GitHub Secrets):
  NOTION_TOKEN        token dell'integrazione Notion (ntn_... o secret_...)
  TELEGRAM_BOT_TOKEN  token del bot creato con @BotFather
  TELEGRAM_CHAT_ID    chat ID a cui inviare il messaggio
"""

import os
import sys
from datetime import date, timedelta
from zoneinfo import ZoneInfo
from datetime import datetime

import requests

DATABASE_ID = "1e433e1789c54b1d9721c64488b5a3c0"  # database "Impegni"
NOTION_TOKEN = os.environ["NOTION_TOKEN"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
PRIORITA_EMOJI = {"Alta": "🔴", "Media": "🟡", "Bassa": "⚪"}
TIPO_EMOJI = {"Lavoro": "💼", "Personale": "🙂", "Appuntamento": "📌",
              "Sport": "🏃", "Casa": "🏠"}


def query_notion(oggi: date, fine: date) -> list[dict]:
    """Impegni non fatti con Data tra oggi e fine (inclusi), ordinati per data."""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    payload = {
        "filter": {
            "and": [
                {"property": "Fatto", "checkbox": {"equals": False}},
                {"property": "Data", "date": {"on_or_after": oggi.isoformat()}},
                {"property": "Data", "date": {"on_or_before": fine.isoformat()}},
            ]
        },
        "sorts": [{"property": "Data", "direction": "ascending"}],
    }

    risultati = []
    while True:
        r = requests.post(url, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        risultati.extend(data["results"])
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]
    return risultati


def estrai(pagina: dict) -> dict:
    """Estrae i campi utili da una pagina Notion."""
    p = pagina["properties"]
    titolo = "".join(t["plain_text"] for t in p["Nome"]["title"]) or "(senza nome)"
    d = p["Data"]["date"]
    start = d["start"] if d else None
    ora = None
    giorno = None
    if start:
        if "T" in start:  # datetime -> estraggo l'ora
            dt = datetime.fromisoformat(start)
            giorno = dt.date()
            ora = dt.strftime("%H:%M")
        else:
            giorno = date.fromisoformat(start)
    sel = p["Priorità"]["select"]
    priorita = sel["name"] if sel else None
    sel = p["Tipo"]["select"]
    tipo = sel["name"] if sel else None
    return {"titolo": titolo, "giorno": giorno, "ora": ora,
            "priorita": priorita, "tipo": tipo}


def riga(imp: dict, con_giorno: bool = False) -> str:
    pezzi = [PRIORITA_EMOJI.get(imp["priorita"], "▫️")]
    if con_giorno and imp["giorno"]:
        pezzi.append(f"{GIORNI[imp['giorno'].weekday()][:3]} {imp['giorno'].day}:")
    pezzi.append(f"<b>{imp['titolo']}</b>")
    if imp["ora"]:
        pezzi.append(f"— ore {imp['ora']}")
    if imp["tipo"]:
        pezzi.append(TIPO_EMOJI.get(imp["tipo"], ""))
    return " ".join(x for x in pezzi if x)


def componi_messaggio(impegni: list[dict], oggi: date) -> str:
    domani = oggi + timedelta(days=1)
    di_oggi = [i for i in impegni if i["giorno"] == oggi]
    di_domani = [i for i in impegni if i["giorno"] == domani]
    prossimi = [i for i in impegni if i["giorno"] and i["giorno"] > domani]

    testo = [f"📅 <b>{GIORNI[oggi.weekday()]} {oggi.day} {MESI[oggi.month - 1]}</b>"]

    testo.append("\n<b>Oggi</b>")
    if di_oggi:
        testo += [riga(i) for i in di_oggi]
    else:
        testo.append("Nessun impegno 👌")

    if di_domani:
        testo.append("\n<b>Domani</b>")
        testo += [riga(i) for i in di_domani]

    if prossimi:
        testo.append("\n<b>Prossimi giorni</b>")
        testo += [riga(i, con_giorno=True) for i in prossimi]

    alta = sum(1 for i in impegni if i["priorita"] == "Alta")
    testo.append(f"\nTotale settimana: {len(impegni)} impegni"
                 + (f", {alta} ad alta priorità" if alta else ""))
    return "\n".join(testo)


def invia_telegram(testo: str) -> None:
    url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    r = requests.post(url, json={
        "chat_id": TG_CHAT_ID,
        "text": testo,
        "parse_mode": "HTML",
    }, timeout=30)
    r.raise_for_status()


def main() -> None:
    oggi = datetime.now(ZoneInfo("Europe/Rome")).date()
    fine = oggi + timedelta(days=7)
    pagine = query_notion(oggi, fine)
    impegni = [estrai(p) for p in pagine]
    messaggio = componi_messaggio(impegni, oggi)
    invia_telegram(messaggio)
    print(f"Inviato: {len(impegni)} impegni")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Errore: {e}", file=sys.stderr)
        sys.exit(1)
