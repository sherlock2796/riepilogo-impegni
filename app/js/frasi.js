// Banca delle frasi "motivazionali" (tono scherzoso) e scelta contestuale.
//
// Ogni frase ha un momento (quando viene mostrata) e, facoltativamente,
// una lista `quando` di situazioni: la frase è candidata solo se TUTTE le
// situazioni sono vere nel contesto attuale. Le frasi senza `quando` sono
// generiche e valgono sempre. Segnaposto: {n} {fatti} {totali} {rimasti} {serie}.
//
// L'utente può nascondere frasi (per id) e aggiungerne di sue dalle
// Impostazioni; le aggiunte vengono sincronizzate come il resto.

export const MOMENTI = {
  apertura: "Saluto in cima alla pagina",
  fatto: "Quando spunti un impegno",
  fatto_alta: "Quando spunti un impegno ad alta priorità",
  tutto_fatto: "Quando finisci tutto per oggi",
  vuoto: "Giornata senza impegni",
  arretrati: "Quando ci sono arretrati",
  chiusura_ok: "Chiusura serale: tutto fatto",
  chiusura_parziale: "Chiusura serale: qualcosa è rimasto",
  chiusura_zero: "Chiusura serale: zero su zero... o zero fatti",
  serie: "Serie di giorni consecutivi",
};

export const SITUAZIONI = {
  piena: "giornata piena (5 o più impegni)",
  leggera: "giornata leggera (1 o 2 impegni)",
  ieri_bene: "ieri tutto fatto",
  ieri_male: "ieri è andata così così",
  arretrati: "ci sono arretrati",
  weekend: "è weekend",
  mattina: "è mattina",
  sera: "è sera",
};

let contatore = 0;
const f = (momento, testo, quando) => ({ id: `b${++contatore}`, momento, testo, quando });

export const BASE = [
  // --- apertura: generiche -------------------------------------------------
  f("apertura", "Nuovo giorno, nuove cose da spuntare. Il caffè è facoltativo, la lista no."),
  f("apertura", "Oggi hai {n} impegni e una sola regola: uno alla volta, come le patatine. Ok, non come le patatine."),
  f("apertura", "La lista non si spunta da sola. Ci ho provato, non funziona."),
  f("apertura", "Ricorda: ogni impegno spuntato è un piccolo applauso che ti fai da solo. Nessuno ti giudica."),
  f("apertura", "Sei qui, hai aperto l'app: statisticamente già meglio della maggior parte delle persone."),
  f("apertura", "Procrastinare è un'arte, ma oggi facciamo gli artigiani: cose concrete, una dopo l'altra."),
  f("apertura", "Pensa a quanto sarà soddisfacente stasera vedere tutto spuntato. Ecco, parti da lì."),
  f("apertura", "Non devi fare tutto subito. Devi solo iniziare dalla prima riga. Il resto segue."),
  f("apertura", "Giornata nuova, scuse vecchie. Lasciamole nel cassetto e andiamo."),
  f("apertura", "Il segreto è fare il primo impegno prima di pensare al secondo. Semplice, no?"),
  // --- apertura: situazioni ---------------------------------------------------
  f("apertura", "Giornata piena: {n} impegni. Respira, prendi la lista e mangiali uno alla volta.", ["piena"]),
  f("apertura", "{n} impegni oggi. Niente panico: le liste lunghe hanno un lato buono, danno più soddisfazione a svuotarle.", ["piena"]),
  f("apertura", "Oggi si corre: {n} cose in lista. Se ne spunti anche solo metà, sei già un eroe della logistica.", ["piena"]),
  f("apertura", "Giornata leggera: {n} impegni soltanto. Finiscili presto e poi goditi il senso di superiorità.", ["leggera"]),
  f("apertura", "Solo {n} cose oggi. Più che una lista è un suggerimento. Suggerimento accettato?", ["leggera"]),
  f("apertura", "Ieri tutto fatto. Oggi hai una reputazione da difendere, sai com'è.", ["ieri_bene"]),
  f("apertura", "Ieri hai spuntato tutto. Confermo: sei in uno stato di grazia. Non sprecarlo.", ["ieri_bene"]),
  f("apertura", "Ieri non è andata benissimo, ma la lista è magnanima e perdona. Oggi si riparte.", ["ieri_male"]),
  f("apertura", "Ieri così così. Succede ai migliori, e tu sei tra i migliori. Dimostramelo oggi.", ["ieri_male"]),
  f("apertura", "Hai qualche arretrato che ti guarda storto. Fai pace con lui prima di tutto il resto.", ["arretrati"]),
  f("apertura", "Gli arretrati non si offendono, ma pesano. Uno spuntato subito e ti senti già più leggero.", ["arretrati"]),
  f("apertura", "Weekend! Gli impegni di oggi sono quelli che ti fanno sentire bene quando li finisci, non quelli che ti servono.", ["weekend"]),
  f("apertura", "È weekend, quindi facciamo le cose con calma. Ma facciamole.", ["weekend"]),
  f("apertura", "Buongiorno! Il letto era comodo, lo so. La lista però è più soddisfacente.", ["mattina"]),
  f("apertura", "È sera: vediamo cosa manca e poi chiudiamo bottega con stile.", ["sera"]),

  // --- vuoto -------------------------------------------------------------------
  f("vuoto", "Niente in lista oggi. O sei organizzatissimo o ti sei dimenticato qualcosa. Scegli tu."),
  f("vuoto", "Zero impegni. Il divano ti attende, ma se vuoi aggiungere qualcosa il tasto è lì sotto."),
  f("vuoto", "Lista vuota: oggi sei libero come un gatto. Fai quello che ti pare, con la stessa dignità."),
  f("vuoto", "Oggi niente da fare. Approfittane: domani la lista potrebbe tornare a vendicarsi."),
  f("vuoto", "Giornata libera. Se ti annoi, c'è sempre quella cosa che rimandi da settimane. Dico per dire."),

  // --- arretrati ----------------------------------------------------------------
  f("arretrati", "Questi sono rimasti indietro. Non giudicarli, spuntali o rimandali con onore."),
  f("arretrati", "Arretrati: le cose che ieri ti sembravano una buona idea. Oggi decidi tu che fine fanno."),
  f("arretrati", "Ogni arretrato rimandato con una data vera è un arretrato in meno. La matematica è dalla tua."),
  f("arretrati", "Non sono in ritardo, stanno solo aspettando il loro momento. Che potrebbe essere adesso."),

  // --- fatto -------------------------------------------------------------------
  f("fatto", "Fatto! Uno in meno, e suonava anche bene."),
  f("fatto", "Spuntato. Il tuo io di stasera ti ringrazia."),
  f("fatto", "Bravo. Ora non montarti la testa, ne restano {rimasti}."),
  f("fatto", "Eccolo lì, un altro impegno che non ti infastidirà più."),
  f("fatto", "Fatto. Senti quel piccolo click di soddisfazione? È tutto tuo."),
  f("fatto", "E via! Se continui così finisci prima del previsto."),
  f("fatto", "Un altro fuori dalla lista. La lista comincia ad averne un po' paura."),
  f("fatto", "Ottimo lavoro. Pausa di tre secondi e poi il prossimo."),
  f("fatto", "Spuntato con eleganza. Nessuno ha visto, ma io sì."),
  f("fatto", "Fatto! Ne restano {rimasti}. Non è una minaccia, è un incoraggiamento."),

  // --- fatto_alta ----------------------------------------------------------------
  f("fatto_alta", "Quello importante è fatto. Il resto della giornata è in discesa."),
  f("fatto_alta", "Priorità alta spuntata! Questo valeva doppio, lo sanno tutti."),
  f("fatto_alta", "Il pezzo grosso è andato. Puoi camminare a testa alta fino a sera."),
  f("fatto_alta", "Impegno importante archiviato. Se ci fosse una fanfara, suonerebbe adesso."),
  f("fatto_alta", "Hai fatto la cosa difficile per prima. Chi sei, un manuale di produttività?"),
  f("fatto_alta", "Alta priorità: fatta. Tutto il resto oggi è bonus."),

  // --- tutto_fatto ---------------------------------------------------------------
  f("tutto_fatto", "Tutto fatto per oggi! Ora puoi dire «sono stanco» con la coscienza pulita."),
  f("tutto_fatto", "Lista spuntata per intero. Giornata da incorniciare, o almeno da raccontare."),
  f("tutto_fatto", "Hai finito tutto. Vai pure a vantartene con qualcuno, te lo sei meritato."),
  f("tutto_fatto", "Zero impegni rimasti. La lista è vuota, tu no: sei pieno di soddisfazione."),
  f("tutto_fatto", "Fatto tutto. Il resto della giornata è ufficialmente tempo libero certificato."),
  f("tutto_fatto", "Lista completata. Se fosse un videogioco, adesso partirebbero i titoli di coda."),

  // --- chiusura serale -------------------------------------------------------------
  f("chiusura_ok", "{fatti} su {totali}: giornata perfetta. Chiudi, spegni, goditi la sera."),
  f("chiusura_ok", "Tutto fatto, tutto chiuso. Domani la lista ti troverà riposato e pericoloso."),
  f("chiusura_ok", "Giornata piena di spunte. Il tuo io di domani ha già meno lavoro, ringrazialo."),
  f("chiusura_ok", "{fatti} su {totali}. Non so cosa aggiungere, sei stato impeccabile."),
  f("chiusura_ok", "Chiusura col botto: tutto spuntato. Il divano è un diritto acquisito."),
  f("chiusura_parziale", "{fatti} su {totali} è comunque un buon bottino. Il resto va a domani, che è un giorno ottimo."),
  f("chiusura_parziale", "Non tutto, ma tanto. Ciò che slitta a domani non è una sconfitta, è pianificazione."),
  f("chiusura_parziale", "{fatti} fatti, {rimasti} rimandati. Domani li guardi con occhi nuovi e li sistemi."),
  f("chiusura_parziale", "Giornata onesta: {fatti} su {totali}. Chi fa tutto ogni giorno probabilmente mente."),
  f("chiusura_parziale", "Hai fatto quello che potevi. Quello che non hai fatto ha già una nuova data. Pace."),
  f("chiusura_zero", "Oggi zero su {totali}. Succede. Domani ti rifai, e questa frase farà meno male."),
  f("chiusura_zero", "Giornata a vuoto. Capita a tutti, tranne a quelli che non fanno le liste. Tu sei migliore."),
  f("chiusura_zero", "Niente spuntato oggi. Riposa, resetta, e domani parti dal più facile."),
  f("chiusura_zero", "Oggi la lista ha vinto. Domani è un'altra partita, e tu conosci già l'avversario."),

  // --- serie ----------------------------------------------------------------------
  f("serie", "{serie} giorni di fila con tutto fatto. Non chiamarla fortuna, chiamala abitudine."),
  f("serie", "Serie di {serie} giorni. A questo punto è una questione d'onore."),
  f("serie", "{serie} giorni consecutivi. La costanza è noiosa solo per chi non ce l'ha."),
  f("serie", "{serie} di fila! Continua così e dovremo inventare un premio."),
  f("serie", "Serie attiva: {serie} giorni. Non interromperla oggi, sarebbe un peccato."),
];

// Semplice hash per scelte deterministiche (stessa frase per tutta la giornata).
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function riempi(testo, ctx) {
  return testo.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : ""));
}

/**
 * Sceglie una frase per il momento dato.
 * @param momento   chiave di MOMENTI
 * @param ctx       { tags: [...situazioni vere], n, fatti, totali, rimasti, serie }
 * @param opzioni   { extra: [{id, momento, testo}], nascoste: [id], seed: string|null }
 */
export function scegliFrase(momento, ctx = {}, opzioni = {}) {
  const tags = new Set(ctx.tags || []);
  const nascoste = new Set(opzioni.nascoste || []);
  const tutte = [...BASE, ...(opzioni.extra || [])]
    .filter((fr) => fr.momento === momento && !nascoste.has(fr.id));
  const specifiche = tutte.filter((fr) => fr.quando && fr.quando.every((t) => tags.has(t)));
  const generiche = tutte.filter((fr) => !fr.quando);
  if (!specifiche.length && !generiche.length) return "";
  const seed = opzioni.seed ?? String(Math.random());
  const r1 = hash(seed + ":pool");
  const pool = specifiche.length && (r1 < 0.7 || !generiche.length) ? specifiche : generiche;
  const r2 = hash(seed + ":idx");
  const scelta = pool[Math.floor(r2 * pool.length)];
  return riempi(scelta.testo, ctx);
}

export function saluto(momento) {
  return { notte: "Notte fonda", mattina: "Buongiorno", pomeriggio: "Buon pomeriggio", sera: "Buonasera" }[momento] || "Ciao";
}
