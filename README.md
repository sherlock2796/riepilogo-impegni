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
supabase/schema.sql   tabelle, trigger e regole di sicurezza da creare su Supabase
supabase/aggiornamento-1.sql   solo per chi aveva già creato le tabelle con la prima versione
tests/                test unitari (node --test tests/*.test.mjs) e di regressione nel browser (node tests/e2e.mjs)
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
   regole per cui ogni utente vede solo le proprie righe. Lo script è
   idempotente: rieseguirlo dopo un aggiornamento non fa danni.
   Se avevi già creato le tabelle con la prima versione, esegui
   `supabase/aggiornamento-1.sql` (o di nuovo `schema.sql`): aggiunge la
   colonna `sincronizzato_il` usata come segnalibro di sincronizzazione.
   Senza, l'app mostra "Il database Supabase va aggiornato".
3. **Authentication → Providers → Email**: lascia attivo Email, disattiva
   «Confirm email» se vuoi evitare la doppia mail. Il link magico è già abilitato.
4. **Authentication → URL Configuration**:
   - *Site URL*: l'indirizzo dell'app, es. `https://<utente>.github.io/riepilogo-impegni/`
   - *Redirect URLs*: aggiungi lo stesso indirizzo (e `http://localhost:8787/` se la provi in locale).
5. *(Facoltativo, richiede un server SMTP tuo)* **Authentication → Emails →
   Magic link**: se hai configurato un invio email personalizzato (Brevo,
   Resend...) puoi aggiungere nel corpo una riga con il codice a 6 cifre,
   che l'app accetta al posto del link:

   ```html
   <p>Oppure inserisci questo codice nell'app: <strong>{{ .Token }}</strong></p>
   ```

   Senza SMTP personalizzato Supabase non permette di modificare l'email:
   per l'app installata su iPhone usa il collegamento con codice descritto sotto.

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
   **Impostazioni → Sincronizzazione** il modulo di accesso.

### Come si accede

- **Email e password** è la via normale: funziona nel browser e nell'app
  installata, su qualunque dispositivo.
- La prima volta non hai ancora una password: usa **"Accedi con il link via
  email"**, apri il link (su iPhone si apre in Safari), poi in
  **Impostazioni → Password** salvane una. Da lì in poi usi email e password
  ovunque, app installata compresa.
- **Password dimenticata** manda un link di recupero: aprilo e salva una
  nuova password dalle Impostazioni.
- "Crea account" compare se email e password non corrispondono a nessun
  utente: serve solo per un indirizzo nuovo.

Dopo il primo accesso su un dispositivo tutto il locale viene caricato sul
server; sugli altri dispositivi basta accedere con la stessa email. Offline
si continua a lavorare e le modifiche partono appena torna la rete. In caso
di modifica dello stesso impegno da due parti, vince l'ultima salvata.

### App installata su iPhone

L'app aggiunta alla schermata Home ha una memoria separata da Safari, quindi
il link via email non può collegarla direttamente: dentro l'app usa email e
password. Su Android non serve nemmeno quello, l'app installata da Chrome
condivide già l'accesso con Chrome.

Limite del piano gratuito da sapere: Supabase invia poche email di accesso
all'ora (3-4). La sessione però resta valida a lungo, quindi si accede
raramente.

## Sviluppo in locale

```
npx http-server app -p 8787 -c-1      # poi apri http://localhost:8787/
node --test tests/*.test.mjs          # test unitari: parser, ricorrenze, archivio, sincronizzazione
node tests/e2e.mjs                    # regressione nel browser (serve playwright + Chromium)
```

I test di sincronizzazione usano un server Supabase finto in memoria e
simulano più dispositivi; quello nel browser percorre tutti i flussi
dell'interfaccia e salva le schermate in `tests/schermate/`.

### Come funziona la sincronizzazione

- Ogni dispositivo lavora sul proprio archivio locale e segna cosa va spinto.
- A ogni giro: prima scarica dal server le righe con `sincronizzato_il`
  successivo all'ultimo segnalibro (timestamp scritto dal server, quindi
  immune agli orologi dei dispositivi), poi spinge le proprie modifiche.
- In caso di modifica dello stesso impegno da due parti vince l'ultima
  (`aggiornato_il` del dispositivo). Le eliminazioni sono "soft" e si propagano.
- "Esci" scollega solo il dispositivo corrente.

## Note

- `spese.py` e il relativo workflow riguardano un'altra funzione (riepilogo spese)
  e non c'entrano con l'app.
- Le frasi non usano servizi esterni: sono una raccolta locale scelta in base
  al contesto. Il punto in cui si potrà collegare un generatore (Claude) è
  `scegliFrase` in `js/frasi.js`.
