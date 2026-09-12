#!/usr/bin/env python3
"""
spese.py — riepiloghi spese da Notion (settimanale e mensile).

Uso:
    python spese.py settimanale              # settimana lun-dom corrente
    python spese.py mensile                  # mese corrente
    python spese.py mensile precedente       # mese appena chiuso
    python spese.py mensile 2026-08          # mese specifico
    python spese.py settimanale --stdout     # stampa senza inviare su Telegram

Da dentro la retrospettiva domenicale:
    from spese import blocco_settimanale
    testo_spese = blocco_settimanale()       # ritorna la stringa gia' formattata

Variabili d'ambiente richieste:
    NOTION_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
"""

import os
import re
import sys
import html
import calendar
from datetime import date, timedelta
from collections import defaultdict

import requests

# ---------------------------------------------------------------- configurazione

# ATTENZIONE: questi sono gli ID di *database*, quelli che vuole /v1/databases/{id}/query.
# Non vanno confusi con gli ID di data source (collection) che Notion espone altrove:
# con quelli l'API risponde 404, identico a quando il database non e' condiviso.
DB_SPESE = "20270316-fc02-8148-9dad-cef4d5c96a99"        # Expenses
DB_CATEGORIE = "20270316-fc02-81f5-ba85-eec38cd4b311"    # Expenses Catigories

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT = os.environ.get("TELEGRAM_CHAT_ID")

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

# Riconosce i blocchi mensili caricati il giorno 1: "Weed 1-31/09", "Tabacchi 1-31/08".
# I tre gruppi catturano giorno iniziale, giorno finale e mese, cioe' il periodo
# che la voce copre: serve per ripartirla sui giorni.
# Se in futuro aggiungi una checkbox "Ricorrente" in Notion, sostituisci questa
# euristica leggendo direttamente quella proprieta' (vedi e_ricorrente()).
RICORRENTE = re.compile(r"(\d{1,2})\s*-\s*(\d{1,2})\s*/\s*(\d{1,2})")

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


# ---------------------------------------------------------------- accesso a Notion

def query_db(db_id, filtro=None):
    """Scarica tutte le righe di un database, gestendo la paginazione."""
    url = f"https://api.notion.com/v1/databases/{db_id}/query"
    risultati, cursore = [], None
    while True:
        payload = {"page_size": 100}
        if filtro:
            payload["filter"] = filtro
        if cursore:
            payload["start_cursor"] = cursore
        r = requests.post(url, headers=HEADERS, json=payload, timeout=30)
        if r.status_code == 404:
            raise RuntimeError(
                f"Notion risponde 404 sul database {db_id}. Due cause possibili: "
                f"l'ID non e' quello del database (magari e' un ID di data source), "
                f"oppure il database non e' condiviso con l'integrazione "
                f"(••• → Connections)."
            )
        r.raise_for_status()
        dati = r.json()
        risultati.extend(dati["results"])
        if not dati.get("has_more"):
            return risultati
        cursore = dati["next_cursor"]


def carica_categorie():
    """id pagina -> {nome, budget}. Attenzione: la proprieta' titolo si chiama
    'Catigories' (refuso originale nel workspace, va lasciato cosi')."""
    mappa = {}
    for p in query_db(DB_CATEGORIE):
        props = p["properties"]
        titolo = props["Catigories"]["title"]
        mappa[p["id"]] = {
            "nome": titolo[0]["plain_text"] if titolo else "(senza nome)",
            "budget": props["Budget"]["number"] or 0,
        }
    return mappa


def carica_spese(inizio, fine):
    """Movimenti con Date compresa fra inizio e fine (estremi inclusi)."""
    filtro = {"and": [
        {"property": "Date", "date": {"on_or_after": inizio.isoformat()}},
        {"property": "Date", "date": {"on_or_before": fine.isoformat()}},
    ]}
    voci = []
    for p in query_db(DB_SPESE, filtro):
        props = p["properties"]
        titolo = props["Transaction"]["title"]
        data = props["Date"]["date"]
        relazione = props["Category"]["relation"]
        if not data or not data.get("start"):
            continue
        voci.append({
            "titolo": titolo[0]["plain_text"] if titolo else "(senza titolo)",
            "importo": props["Amount"]["number"] or 0.0,
            "data": date.fromisoformat(data["start"][:10]),
            "categoria": relazione[0]["id"] if relazione else None,
            # None se la proprieta' non esiste ancora nel database
            "ricorrente": props["Ricorrente"]["checkbox"] if "Ricorrente" in props else None,
        })
    return voci


def e_ricorrente(voce):
    """Se in Notion esiste la checkbox 'Ricorrente' comanda quella, cosi' anche
    affitto, rata auto e abbonamenti vengono ripartiti sul mese che coprono.
    Finche' la checkbox non c'e', si ripiega sul periodo scritto nel titolo."""
    if voce.get("ricorrente") is not None:
        return voce["ricorrente"]
    return bool(RICORRENTE.search(voce["titolo"]))


# ---------------------------------------------------------------- formattazione

def euro(x):
    """1234.5 -> '1.234,50 €'"""
    s = f"{x:,.2f}".replace(",", "§").replace(".", ",").replace("§", ".")
    return f"{s} €"


def esc(s):
    return html.escape(str(s))


def nome_cat(voce, categorie):
    if not voce["categoria"]:
        return "(senza categoria)"
    return categorie.get(voce["categoria"], {}).get("nome", "(sconosciuta)")


def totale(voci):
    return sum(v["importo"] for v in voci)


# ---------------------------------------------------------------- riepilogo settimanale

def periodo_ricorrente(voce):
    """Dal titolo 'Weed 1-31/09' ricava il periodo che la voce copre.
    Se il titolo non e' leggibile ripiega sull'intero mese della data."""
    trovato = RICORRENTE.search(voce["titolo"])
    anno = voce["data"].year
    if trovato:
        primo, ultimo, mese = (int(trovato.group(1)),
                               int(trovato.group(2)),
                               int(trovato.group(3)))
    else:
        primo, mese = 1, voce["data"].month
        ultimo = calendar.monthrange(anno, mese)[1]
    fine_mese = calendar.monthrange(anno, mese)[1]
    primo = max(1, min(primo, fine_mese))
    ultimo = max(primo, min(ultimo, fine_mese))
    return date(anno, mese, primo), date(anno, mese, ultimo)


def quota_ricorrenti(blocchi, da, a):
    """Ripartisce i blocchi mensili sui giorni che coprono e restituisce la quota
    che cade nell'intervallo [da, a], come totale e come dettaglio per categoria.

    La divisione e' giornaliera e non 'per numero di settimane': una settimana a
    cavallo di due mesi altrimenti si prenderebbe due quote intere, e i mesi da
    28 o 31 giorni non contengono un numero intero di settimane."""
    totale_quota = 0.0
    per_categoria = defaultdict(float)
    for v in blocchi:
        inizio, fine = periodo_ricorrente(v)
        giorni_coperti = (fine - inizio).days + 1
        giorni_dentro = (min(fine, a) - max(inizio, da)).days + 1
        if giorni_dentro <= 0:
            continue
        quota = v["importo"] / giorni_coperti * giorni_dentro
        totale_quota += quota
        per_categoria[v["categoria"]] += quota
    return totale_quota, per_categoria


def blocco_settimanale(oggi=None):
    """Ritorna il testo (HTML Telegram) del riepilogo della settimana lun-dom
    che contiene 'oggi'. I blocchi mensili non pesano tutti sulla settimana in cui
    li carichi: ogni settimana porta la sua quota di spesa fissa, cosi' il totale
    e' un livello reale e il confronto fra settimane resta pulito."""
    oggi = oggi or date.today()
    lunedi = oggi - timedelta(days=oggi.weekday())
    domenica = lunedi + timedelta(days=6)
    lunedi_prec = lunedi - timedelta(days=7)
    domenica_prec = lunedi - timedelta(days=1)

    categorie = carica_categorie()
    # Si parte dal primo del mese della settimana precedente: i blocchi mensili
    # sono datati il giorno 1 e servono anche alle settimane successive.
    voci = carica_spese(lunedi_prec.replace(day=1), domenica)

    def effettive(da, a):
        return [v for v in voci if da <= v["data"] <= a and not e_ricorrente(v)]

    blocchi = [v for v in voci if e_ricorrente(v)]
    questa = effettive(lunedi, domenica)
    scorsa = effettive(lunedi_prec, domenica_prec)

    quota, quota_cat = quota_ricorrenti(blocchi, lunedi, domenica)
    quota_prec, _ = quota_ricorrenti(blocchi, lunedi_prec, domenica_prec)

    spesa_viva = totale(questa)
    tot = spesa_viva + quota
    tot_prec = totale(scorsa) + quota_prec
    delta = tot - tot_prec

    righe = [
        f"<b>💶 Spese {lunedi.strftime('%d/%m')} – {domenica.strftime('%d/%m')}</b>",
        f"<b>{euro(tot)}</b> = {euro(spesa_viva)} su {len(questa)} movimenti "
        f"+ {euro(quota)} di ricorrenti",
    ]
    if scorsa or quota_prec:
        segno = "+" if delta >= 0 else "−"
        righe.append(f"Settimana precedente: {euro(tot_prec)} ({segno}{euro(abs(delta))})")

    # ripartizione per categoria, dalla piu' pesante, quote ricorrenti incluse
    per_cat = defaultdict(float)
    for v in questa:
        per_cat[nome_cat(v, categorie)] += v["importo"]
    for id_cat, importo in quota_cat.items():
        nome = categorie.get(id_cat, {}).get("nome", "(sconosciuta)") if id_cat \
            else "(senza categoria)"
        per_cat[nome] += importo
    if per_cat:
        righe.append("")
        for nome, importo in sorted(per_cat.items(), key=lambda x: -x[1])[:5]:
            quota = importo / tot * 100 if tot else 0
            righe.append(f"• {esc(nome)}: {euro(importo)} ({quota:.0f}%)")

    # le voci singole piu' grosse, per dare un appiglio concreto
    grosse = sorted(questa, key=lambda v: -v["importo"])[:3]
    if grosse:
        righe.append("")
        righe.append("Voci maggiori: " + ", ".join(
            f"{esc(v['titolo'])} {euro(v['importo'])}" for v in grosse))

    if quota:
        nomi = sorted({nome_cat(v, categorie) for v in blocchi
                       if quota_ricorrenti([v], lunedi, domenica)[0] > 0})
        righe.append("")
        righe.append(f"<i>Quota ricorrenti ({', '.join(esc(n) for n in nomi)}) "
                     f"ripartita sui giorni coperti.</i>")

    return "\n".join(righe)


# ---------------------------------------------------------------- riepilogo mensile

def intervallo_mese(spec, oggi=None):
    oggi = oggi or date.today()
    if spec in (None, "corrente"):
        anno, mese = oggi.year, oggi.month
    elif spec == "precedente":
        primo = oggi.replace(day=1)
        ultimo_prec = primo - timedelta(days=1)
        anno, mese = ultimo_prec.year, ultimo_prec.month
    else:
        anno, mese = int(spec[:4]), int(spec[5:7])
    ultimo_giorno = calendar.monthrange(anno, mese)[1]
    return date(anno, mese, 1), date(anno, mese, ultimo_giorno)


def blocco_mensile(spec=None, oggi=None):
    """Riepilogo del mese con confronto budget. Separa quanto e' gia' registrato
    da quanto e' solo datato in avanti (ricorrenti inserite in anticipo)."""
    oggi = oggi or date.today()
    inizio, fine = intervallo_mese(spec, oggi)

    # mese precedente, per il confronto
    fine_prec = inizio - timedelta(days=1)
    inizio_prec = fine_prec.replace(day=1)

    categorie = carica_categorie()
    voci = carica_spese(inizio_prec, fine)

    mese = [v for v in voci if v["data"] >= inizio]
    mese_prec = [v for v in voci if v["data"] < inizio]
    registrate = [v for v in mese if v["data"] <= oggi]
    pianificate = [v for v in mese if v["data"] > oggi]

    chiuso = fine <= oggi
    righe = [
        f"<b>📊 Spese {MESI[inizio.month - 1]} {inizio.year}</b>",
        f"Registrate: {euro(totale(registrate))} su {len(registrate)} movimenti",
    ]
    if pianificate:
        righe.append(f"Pianificate (data futura): {euro(totale(pianificate))} "
                     f"su {len(pianificate)} movimenti")
        righe.append(f"Totale mese: {euro(totale(mese))}")
    if mese_prec:
        etichetta = "Mese precedente" if chiuso else "Stesso periodo mese precedente"
        confronto = mese_prec if chiuso else [v for v in mese_prec
                                              if v["data"].day <= oggi.day]
        righe.append(f"{etichetta}: {euro(totale(confronto))}")

    # aggregazione per categoria su TUTTO il mese (registrate + pianificate):
    # il budget e' un impegno di spesa mensile, non un consuntivo a oggi.
    per_cat = defaultdict(float)
    for v in mese:
        per_cat[v["categoria"]] += v["importo"]

    con_budget, senza_budget = [], []
    for id_cat, info in categorie.items():
        speso = per_cat.get(id_cat, 0.0)
        if info["budget"] > 0:
            con_budget.append((info["nome"], speso, info["budget"]))
        elif speso > 0:
            senza_budget.append((info["nome"], speso))

    con_budget.sort(key=lambda r: -(r[1] - r[2]))  # gli sforamenti in cima
    larghezza = max((len(n) for n, _, _ in con_budget), default=10)

    righe.append("")
    righe.append("<b>Budget</b>")
    tabella = []
    for nome, speso, budget in con_budget:
        scarto = speso - budget
        marcatore = "⚠" if scarto > 0 else " "
        tabella.append(f"{marcatore} {nome:<{larghezza}} {speso:>8.2f} /{budget:>6.0f}")
    righe.append("<pre>" + esc("\n".join(tabella)) + "</pre>")

    tot_budget = sum(b for _, _, b in con_budget)
    tot_speso_budget = sum(s for _, s, _ in con_budget)
    residuo = tot_budget - tot_speso_budget
    verbo = "residuo" if residuo >= 0 else "sforamento"
    righe.append(f"Totale a budget: {euro(tot_speso_budget)} su {euro(tot_budget)} "
                 f"({verbo} {euro(abs(residuo))})")

    if senza_budget:
        senza_budget.sort(key=lambda r: -r[1])
        tot_senza = sum(s for _, s in senza_budget)
        dettaglio = ", ".join(f"{esc(n)} {euro(s)}" for n, s in senza_budget)
        quota = tot_senza / totale(mese) * 100 if mese else 0
        righe.append("")
        righe.append(f"<b>Fuori budget</b>: {euro(tot_senza)} ({quota:.0f}% del mese)")
        righe.append(dettaglio)

    return "\n".join(righe)


# ---------------------------------------------------------------- consegna

def invia_telegram(testo):
    if not (TELEGRAM_TOKEN and TELEGRAM_CHAT):
        raise RuntimeError("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID mancanti")
    r = requests.post(
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
        json={"chat_id": TELEGRAM_CHAT, "text": testo,
              "parse_mode": "HTML", "disable_web_page_preview": True},
        timeout=30,
    )
    r.raise_for_status()


def main():
    argomenti = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_stdout = "--stdout" in sys.argv
    modo = argomenti[0] if argomenti else "settimanale"

    if modo == "settimanale":
        testo = blocco_settimanale()
    elif modo == "mensile":
        testo = blocco_mensile(argomenti[1] if len(argomenti) > 1 else None)
    else:
        print(f"Modo non riconosciuto: {modo}", file=sys.stderr)
        sys.exit(1)

    if solo_stdout:
        print(testo)
    else:
        invia_telegram(testo)


if __name__ == "__main__":
    main()
