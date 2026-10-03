# Impegni

App per gestire gli impegni, pensata per il telefono ma comoda anche da PC.
Semplice, con un design curato e frasi "motivazionali" dal tono scherzoso.

Niente framework, niente compilazione: è una pagina web statica (`app/`)
che si installa come app (PWA), funziona anche offline e, se vuoi, si
sincronizza tra dispositivi tramite Supabase (gratuito) con accesso via
link magico per email.

## Cosa fa

- **Oggi**: lista del giorno, arretrati da sistemare al volo (→ oggi, → domani),
  anteprima di domani, saluto con frase scelta in base al contesto
  (giornata piena o leggera, com'è andata ieri, weekend, arretrati, ora del giorno).
- **Aggiunta in linguaggio naturale**: scrivi «dentista martedì alle 15, alta»
  e l'app compila data, ora, priorità, tipo e ricorrenza. Puoi sempre correggere
  a mano prima di salvare.
- **Modifica, cancellazione, rimando** a domani, fra 2 giorni, settimana prossima
  o a una data libera.
- **Ricorrenze**: ogni giorno, ogni N giorni, ogni settimana, in certi giorni della
  settimana, ogni mese, ogni anno. Quando spunti un impegno ricorrente nasce il successivo.
- **Settimana**: striscia di giorni sul telefono, sette colonne su PC.
- **Chiusura serale** (dalle 20, configurabile): bilancio del giorno, scelta di cosa
  spostare a domani, frase di chiusura.
- **Statistiche leggere**: serie di giorni con tutto fatto, miglior serie, percentuale
  della settimana, fatti negli ultimi 30 giorni, suddivisione per tipo.
- **Celebrazioni**: coriandoli e battuta quando spunti un impegno ad alta priorità,
  quando finisci tutto e quando chiudi una giornata perfetta.
- **Modalità concentrazione** (non attiva di default): un impegno alla volta.
- **Frasi personalizzabili**: nascondi quelle che non ti piacciono, aggiungi le tue.
- **Backup**: esporta e importa un file JSON.
- **Tema** chiaro, scuro o automatico.

Tipi disponibili: Personale, Sport, Casa. Priorità: Alta, Media, Bassa.

## Struttura

```
app/
  index.html          pagina unica
  style.css           stile (variabili per tema chiaro/scuro)
  config.js           URL e chiave Supabase (vuoti = solo locale)
  manifest.webmanifest, sw.js, icons/   installazione e offline
  js/
    main.js           interfaccia, viste, pannelli
    store.js          archivio locale e logica (ricorrenze, serie, settimana)
    sync.js           accesso e sincronizzazione Supabase
    parser.js         riconoscimento del linguaggio naturale
    frasi.js          banca delle frasi e scelta contestuale
    ricorrenze.js     calcolo della ricorrenza successiva
    date.js           utilità date
supabase/schema.sql   tabelle e regole di sicurezza da creare su Supabase
tests/                test unitari (node --test tests/parser.test.mjs)
.github/workflows/pages.yml   pubblicazione automatica su GitHub Pages
```

## Pubblicazione su GitHub Pages (gratis)

1. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Fai il merge di questo lavoro su `main` (o lancia a mano il workflow
   «Pubblica app su GitHub Pages» dalla scheda Actions).
3. L'app sarà su `https://<utente>.github.io/riepilogo-impegni/`.

Senza altro, l'app funziona già: i dati restano nel browser del dispositivo.

## Sincronizzazione tra dispositivi (Supabase, gratis)

Serve una volta sola, circa dieci minuti.

1. Crea un account su [supabase.com](https://supabase.com) e un nuovo progetto
   (piano Free, regione Europa).
2. **SQL Editor → New query**: incolla il contenuto di `supabase/schema.sql`
   ed esegui. Crea le tabelle `impegni`, `chiusure`, `impostazioni` con le
   regole per cui ogni utente vede solo le proprie righe.
3. **Authentication → Providers → Email**: lascia attivo Email, disattiva
   «Confirm email» se vuoi evitare la doppia mail. Il link magico è già abilitato.
4. **Authentication → URL Configuration**:
   - *Site URL*: l'indirizzo dell'app, es. `https://<utente>.github.io/riepilogo-impegni/`
   - *Redirect URLs*: aggiungi lo stesso indirizzo (e `http://localhost:8787/` se la provi in locale).
5. **Authentication → Email Templates → Magic Link**: aggiungi nel corpo
   una riga con il codice, così puoi accedere anche dall'app installata
   senza passare dal browser:

   ```html
   <p>Oppure inserisci questo codice nell'app: <strong>{{ .Token }}</strong></p>
   ```

6. **Project Settings → API**: copia *Project URL* e la chiave *anon public*
   e incollale in `app/config.js`:

   ```js
   window.CONFIG = {
     supabaseUrl: "https://xxxxxxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
   };
   ```

   La chiave anon è fatta per stare nel browser: i dati sono protetti dalle
   regole per riga create al punto 2.
7. Fai commit e push: alla pubblicazione successiva l'app mostrerà in
   **Impostazioni → Sincronizzazione** il campo per l'email.

Dopo il primo accesso su un dispositivo tutto il locale viene caricato sul
server; sugli altri dispositivi basta accedere con la stessa email. Offline
si continua a lavorare e le modifiche partono appena torna la rete. In caso
di modifica dello stesso impegno da due parti, vince l'ultima salvata.

Limite del piano gratuito da sapere: Supabase invia poche email di accesso
all'ora (3-4). La sessione però resta valida a lungo, quindi si accede
raramente.

## Sviluppo in locale

```
npx http-server app -p 8787 -c-1      # poi apri http://localhost:8787/
node --test tests/parser.test.mjs     # test del parser e delle ricorrenze
```

## Note

- `spese.py` e il relativo workflow riguardano un'altra funzione (riepilogo spese)
  e non c'entrano con l'app.
- Le frasi non usano servizi esterni: sono una raccolta locale scelta in base
  al contesto. Il punto in cui si potrà collegare un generatore (Claude) è
  `scegliFrase` in `js/frasi.js`.
