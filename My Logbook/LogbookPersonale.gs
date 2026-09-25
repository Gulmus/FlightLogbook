/*******************************************************************************
 * LOGBOOK PERSONALE VOLI A VELA — con travaso sull'aliante condiviso
 * -----------------------------------------------------------------------------
 * PROGETTO SEPARATO: va incollato nell'Apps Script del TUO file personale
 * (Estensioni > Apps Script del foglio del logbook), NON nel progetto del file
 * di prenotazione. I due file restano indipendenti: e' questo script che, a
 * comando o automaticamente, scrive nel file condiviso tramite openById().
 *
 * COME FUNZIONA
 *   Foglio "Velivoli" : marche, modello e flag "Condiviso" dei mezzi su cui voli.
 *                       OE-5357 / DG300 e' precaricato come condiviso.
 *   Foglio "Logbook"  : una riga per volo. Inserisci data, marche, ICAO di
 *                       partenza e arrivo, orari e quota di sgancio; modello e
 *                       durata vengono compilati dallo script.
 *   Se le marche del volo risultano condivise, la riga viene copiata nel foglio
 *   "Voli" del file di prenotazione e la prenotazione di quel giorno viene
 *   chiusa (stato CONCLUSA), cosi' l'app non ti chiede piu' il rendiconto.
 *   Il dato lo inserisci una volta sola, qui.
 *
 * ORARI
 *   Decollo e atterraggio sono in UTC (ora zulu), come nelle tracce IGC, nei
 *   fonogrammi ATC e nel foglio "Voli" del file condiviso. E' una convenzione,
 *   non una conversione: nessuna funzione tocca gli orari che scrivi. Il fuso
 *   LOG_CONFIG.TZ serve solo a sapere che giorno e' oggi.
 ******************************************************************************/

/* ============================ CONFIGURAZIONE ============================== */

var LOG_CONFIG = {
  /**
   * ID del file di prenotazione dell'aliante condiviso. Si legge nell'URL:
   * https://docs.google.com/spreadsheets/d/  QUESTO_PEZZO  /edit
   */
  ID_FILE_CONDIVISO: '1FUBPEEFgMBsbnEcz4P6sQuRa5ov-TGd4dRavtNcvHQY',

  MIA_EMAIL: '',              // vuoto = l'account con cui esegui lo script
  MIO_NOME: '',               // usato solo se non ti trova nel foglio "Utenti" condiviso

  /**
   * Fuso usato SOLO per sapere che giorno e' oggi: data predefinita nel modulo,
   * finestre della recency, rifiuto delle date future. Gli orari dei voli non lo
   * usano mai (vedi ORARI_UTC).
   */
  TZ: 'Europe/Rome',

  /**
   * Convenzione oraria: "Ora decollo" e "Ora atterraggio" sono in UTC (ora
   * zulu), come nelle tracce IGC e nei fonogrammi ATC. Non e' una conversione:
   * quello che scrivi e' quello che viene salvato. Messo a false toglie solo la
   * dicitura "UTC" dalle interfacce e dai messaggi.
   */
  ORARI_UTC: true,

  /**
   * Tolleranza in minuti dei confronti fra voli (doppioni, travaso nel file
   * condiviso, import da WeGlide). Lo stesso volo puo' avere orari diversi di
   * qualche minuto secondo la fonte: la traccia IGC parte dal primo punto
   * valido, l'ATC arrotonda. Due decolli dello stesso pilota a meno di questi
   * minuti l'uno dall'altro non possono esistere, quindi la tolleranza non
   * nasconde voli veri. Mettendo 0 il confronto torna a essere esatto.
   */
  TOLLERANZA_CONFRONTO_MIN: 10,

  ICAO_DEFAULT: 'LIMA',       // proposto quando lasci vuoto partenza o arrivo
  CHIUDI_PRENOTAZIONE: true,  // segna come CONCLUSA la prenotazione del giorno
  QUOTA_OBBLIGATORIA: false,  // true = senza quota di sgancio il volo non si sincronizza

  /**
   * Funzione a bordo attribuita quando la colonna "Funzione" e' vuota.
   * Le righe scritte prima dell'introduzione della colonna restano quindi
   * conteggiate come PIC, senza bisogno di riempirle a mano.
   */
  FUNZIONE_DEFAULT: 'PIC'     // 'PIC' (pilota responsabile) oppure 'DUAL'
};

/* ====================== STRUTTURA DEL FILE PERSONALE ====================== */

var LOG_FOGLI = { LOG: 'Logbook', VELIVOLI: 'Velivoli' };

/**
 * "Funzione" e "WeGlide ID" sono in coda di proposito: aggiungendole in fondo,
 * un foglio "Logbook" gia' compilato non va toccato e le colonne esistenti non
 * slittano. Basta rieseguire "Inizializza / verifica fogli" per farle comparire.
 */
var HEADER_LOG = ['Data', 'Marche', 'Modello', 'ICAO partenza', 'ICAO arrivo',
                  'Ora decollo', 'Ora atterraggio', 'Durata (hh:mm)', 'Durata (minuti)',
                  'Quota sgancio (m)', 'Note', 'Sincronizzato il', 'Esito sincronizzazione',
                  'Funzione', 'WeGlide ID'];

// Posizione delle colonne del foglio "Logbook" (1 = colonna A)
var LC = { DATA:1, MARCHE:2, MODELLO:3, DEP:4, ARR:5, DEC:6, ATT:7,
           DUR:8, MIN:9, QUOTA:10, NOTE:11, SYNC:12, ESITO:13, FUNZ:14, WG:15 };

// Valori ammessi nella colonna "Funzione".
var FUNZIONI = ['PIC', 'DUAL'];

/**
 * "Modello WeGlide" serve solo all'import da WeGlide (WeGlideImport.gs): e' il
 * nome esatto con cui WeGlide chiama il modello, che non coincide con il nostro
 * ("DG300 WL" invece di "DG300"). Lasciata vuota, l'import prova comunque a
 * indovinare dal modello.
 */
var HEADER_VELIVOLI = ['Marche', 'Modello', 'Condiviso', 'Note', 'Modello WeGlide'];

// Velivolo precaricato: l'aliante in comproprieta'. Gli altri li aggiungi a mano.
var VELIVOLI_INIZIALI = [
  ['OE-5357', 'DG300', 'SI', 'aliante in comproprieta\'', 'DG300 WL'],
  ['', '', 'NO', 'aggiungi qui i mezzi affittati', '']
];

/* ==================== STRUTTURA DEL FILE CONDIVISO ======================== */
/* Devono corrispondere ai nomi usati dal progetto delle prenotazioni.        */

var COND = {
  VOLI: 'Voli',
  PREN: 'Prenotazioni',
  UTENTI: 'Utenti',
  // Colonne del foglio "Prenotazioni" del file condiviso
  PC: { ID:1, TIPO:2, DATA:3, EMAIL:4, NOME:5, STATO:6, NOTE:7, CREATO:8, MODIFICATO:9, RENDICONTATO:10 },
  // Colonne opzionali che questo script aggiunge al foglio "Voli" se mancano
  COL_QUOTA: 'Quota sgancio (m)',
  COL_ORIGINE: 'Origine',
  COL_FUNZIONE: 'Funzione'
};

/* ================================= MENU ================================== */

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  // Sottomenu dell'import da WeGlide. Le funzioni stanno in WeGlideImport.gs:
  // se quel file non e' stato aggiunto al progetto le voci danno errore, il
  // resto del menu funziona comunque.
  var weglide = ui.createMenu('WeGlide')
    .addItem('Imposta credenziali', 'wgImpostaCredenziali')
    .addItem('Prova collegamento', 'wgProvaCollegamento')
    .addItem('Importa voli recenti', 'wgImportaVoli')
    .addSeparator()
    .addItem('Attiva avviso giornaliero', 'wgAttivaControlloGiornaliero')
    .addItem('Disattiva avviso giornaliero', 'wgDisattivaControlloGiornaliero')
    .addItem('Cancella credenziali', 'wgCancellaCredenziali');

  ui.createMenu('Logbook')
    .addItem('Inizializza / verifica fogli', 'inizializzaLogbook')
    // Definita in WebLogbook.gs: se quel file non c'e' la voce da' errore.
    .addItem('Mostra URL web app', 'logMostraUrl')
    .addSeparator()
    .addItem('Ricalcola modello e durate', 'ricalcolaLogbook')
    .addItem('Sincronizza voli condivisi', 'sincronizzaVoliCondivisi')
    .addItem('Importa voli dal file condiviso', 'importaDaFileCondiviso')
    .addItem('Riepilogo ore di volo', 'riepilogoOre')
    .addSeparator()
    .addSubMenu(weglide)
    .addSeparator()
    .addItem('Attiva sincronizzazione automatica', 'attivaSincronizzazioneAutomatica')
    .addItem('Disattiva sincronizzazione automatica', 'disattivaSincronizzazioneAutomatica')
    .addItem('Prova collegamento al file condiviso', 'provaCollegamento')
    .addToUi();
}

/* ============================== UTILITY ================================== */

function lPad2_(n) { return (n < 10 ? '0' : '') + n; }

function lIso_(d) { return Utilities.formatDate(d, LOG_CONFIG.TZ, 'yyyy-MM-dd'); }

function lOggi_() { return lIso_(new Date()); }

/** Normalizza date scritte come Date, 'yyyy-mm-dd' o 'gg/mm/aaaa'. */
function lParseData_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return lIso_(v);
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + lPad2_(+m[2]) + '-' + lPad2_(+m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return m[3] + '-' + lPad2_(+m[2]) + '-' + lPad2_(+m[1]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : lIso_(d);
}

function lItDate_(iso) {
  var p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
}

/**
 * Orario -> secondi dalla mezzanotte. Accetta 'hh.mm.ss', 'hh.mm', 'hh:mm:ss',
 * 'hh:mm', celle orarie di Sheets e frazioni di giorno. null se illeggibile.
 */
function lParseOra_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
  }
  if (typeof v === 'number') {
    if (v > 0 && v < 1) return Math.round(v * 86400);
    var h = Math.floor(v), mi = Math.round((v - h) * 100);
    return (h > 23 || mi > 59) ? null : h * 3600 + mi * 60;
  }
  var m = String(v).trim().replace(/,/g, '.').match(/^(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?$/);
  if (!m) return null;
  var hh = +m[1], mm = +m[2], ss = m[3] ? +m[3] : 0;
  return (hh > 23 || mm > 59 || ss > 59) ? null : hh * 3600 + mm * 60 + ss;
}

/** secondi -> 'HH:MM' (i secondi restano nel dato originale, non nel formato). */
function lFormattaOra_(sec) {
  return lPad2_(Math.floor(sec / 3600)) + ':' + lPad2_(Math.floor((sec % 3600) / 60));
}

/** Durata coerente fra minuti interi e hh:mm. */
function lDurata_(secDec, secAtt) {
  var minuti = Math.round((secAtt - secDec) / 60);
  return { minuti: minuti, hhmm: lPad2_(Math.floor(minuti / 60)) + ':' + lPad2_(minuti % 60) };
}

/* ========================= CONVENZIONE ORARIA ============================= */

/** ' UTC' da attaccare a un orario nei messaggi, o '' se la convenzione cambia. */
function lUtc_() { return LOG_CONFIG.ORARI_UTC ? ' UTC' : ''; }

/**
 * Stesso volo? Unico punto in cui si decide, usato dal controllo dei doppioni
 * della web app, dal travaso nel file condiviso, dall'import in senso opposto e
 * dall'import da WeGlide.
 *
 * Il confronto e' su data e ora di DECOLLO, con la tolleranza di
 * LOG_CONFIG.TOLLERANZA_CONFRONTO_MIN: tutti gli orari sono in UTC, ma la stessa
 * ora arriva da fonti diverse (traccia IGC, fonogramma ATC, dito sul telefono) e
 * puo' differire di qualche minuto. L'atterraggio non entra nel confronto: se il
 * decollo coincide, il volo e' quello.
 *
 * secA/secB = secondi dalla mezzanotte (null = orario illeggibile: mai uguale).
 */
function lStessoVolo_(dataA, secA, dataB, secB) {
  if (!dataA || !dataB || dataA !== dataB) return false;
  if (secA === null || secA === undefined || secB === null || secB === undefined) return false;
  var scarto = Math.abs(Math.round((secA - secB) / 60));
  return scarto <= (Number(LOG_CONFIG.TOLLERANZA_CONFRONTO_MIN) || 0);
}

/**
 * Normalizza la funzione a bordo: accetta 'pic', 'p', 'PIC', 'dual', 'd',
 * 'doppio', 'istruzione' e simili. Vuoto -> valore predefinito, cosi' le righe
 * scritte prima dell'introduzione della colonna contano come PIC.
 */
function lFunzione_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!s) return LOG_CONFIG.FUNZIONE_DEFAULT;
  if (s.charAt(0) === 'D' || s.indexOf('ISTR') === 0) return 'DUAL';
  return 'PIC';
}

/** Avvisi che funzionano sia da menu sia da trigger (dove la UI non esiste). */
function lAvvisa_(testo) {
  try { SpreadsheetApp.getUi().alert(testo); } catch (e) { console.log(testo); }
}

function lFoglio_(nome) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sh) throw new Error('Foglio "' + nome + '" mancante: esegui Logbook > Inizializza fogli.');
  if (nome === LOG_FOGLI.LOG) assicuraColonneLog_(sh);
  if (nome === LOG_FOGLI.VELIVOLI) assicuraColonneVelivoli_(sh);
  return sh;
}

/**
 * Compatibilita' con i fogli creati prima delle colonne aggiunte in coda
 * ("Funzione", "WeGlide ID"): allarga il foglio se necessario e scrive le
 * intestazioni mancanti. Cosi' tutte le funzioni possono leggere
 * HEADER_LOG.length colonne senza errori. Le colonne gia' presenti con
 * l'intestazione giusta non vengono toccate.
 */
function assicuraColonneLog_(sh) {
  if (sh.getMaxColumns() < HEADER_LOG.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADER_LOG.length - sh.getMaxColumns());
  }
  [LC.FUNZ, LC.WG].forEach(function (c) {
    if (String(sh.getRange(1, c).getValue()).trim() !== HEADER_LOG[c - 1]) {
      sh.getRange(1, c).setValue(HEADER_LOG[c - 1]).setFontWeight('bold');
    }
  });
}

/** Stessa cosa per "Velivoli", dove in coda e' comparsa "Modello WeGlide". */
function assicuraColonneVelivoli_(sh) {
  if (sh.getMaxColumns() < HEADER_VELIVOLI.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADER_VELIVOLI.length - sh.getMaxColumns());
  }
  var ultima = HEADER_VELIVOLI.length;
  if (String(sh.getRange(1, ultima).getValue()).trim() !== HEADER_VELIVOLI[ultima - 1]) {
    sh.getRange(1, ultima).setValue(HEADER_VELIVOLI[ultima - 1]).setFontWeight('bold');
  }
}

function mioIndirizzo_() {
  return (LOG_CONFIG.MIA_EMAIL || Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
}

/* ============================ SETUP DEI FOGLI ============================= */

function inizializzaLogbook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Velivoli ---
  var vel = ss.getSheetByName(LOG_FOGLI.VELIVOLI) || ss.insertSheet(LOG_FOGLI.VELIVOLI);
  if (vel.getLastRow() === 0) {
    vel.appendRow(HEADER_VELIVOLI);
    vel.getRange(2, 1, VELIVOLI_INIZIALI.length, HEADER_VELIVOLI.length).setValues(VELIVOLI_INIZIALI);
  } else {
    // Un foglio nato prima di "Modello WeGlide" ha meno colonne: si allarga
    // invece di far fallire la scrittura delle intestazioni.
    assicuraColonneVelivoli_(vel);
    vel.getRange(1, 1, 1, HEADER_VELIVOLI.length).setValues([HEADER_VELIVOLI]);
  }
  vel.setFrozenRows(1);
  vel.getRange(1, 1, 1, HEADER_VELIVOLI.length).setFontWeight('bold');

  // --- Logbook ---
  var log = ss.getSheetByName(LOG_FOGLI.LOG) || ss.insertSheet(LOG_FOGLI.LOG);
  // Il foglio potrebbe essere nato con meno colonne (prima che esistesse
  // "Funzione"): si allarga invece di far fallire la scrittura delle intestazioni.
  if (log.getMaxColumns() < HEADER_LOG.length) {
    log.insertColumnsAfter(log.getMaxColumns(), HEADER_LOG.length - log.getMaxColumns());
  }
  if (log.getLastRow() === 0) log.appendRow(HEADER_LOG);
  else log.getRange(1, 1, 1, HEADER_LOG.length).setValues([HEADER_LOG]);
  log.setFrozenRows(1);
  log.getRange(1, 1, 1, HEADER_LOG.length).setFontWeight('bold');

  var righe = Math.max(log.getMaxRows() - 1, 1);
  // Testo per data, orari e durata hh:mm: nessuna reinterpretazione da parte
  // di Sheets, e gli orari scritti come 10.35.12 restano leggibili.
  log.getRange(2, LC.DATA, righe, 1).setNumberFormat('@');
  log.getRange(2, LC.DEC, righe, 3).setNumberFormat('@');   // decollo, atterraggio, hh:mm
  log.getRange(2, LC.MIN, righe, 1).setNumberFormat('0');
  log.getRange(2, LC.QUOTA, righe, 1).setNumberFormat('0');
  // Identificativo del volo su WeGlide: numero intero, senza separatore delle
  // migliaia. Lo scrive l'import, si legge solo per riconoscere i doppioni.
  log.getRange(2, LC.WG, righe, 1).setNumberFormat('0');

  // Convenzione oraria scritta anche nel foglio: la nota compare sfiorando
  // l'intestazione, cosi' non la si ricorda a memoria (ne' la si sbaglia).
  var notaOre = LOG_CONFIG.ORARI_UTC
    ? 'Orario in UTC (ora zulu), come nella traccia IGC e nel fonogramma ATC.\n' +
      'Non in ora locale: d\'estate due ore in meno, d\'inverno una.'
    : 'Orario in ora locale (' + LOG_CONFIG.TZ + ').';
  log.getRange(1, LC.DEC).setNote(notaOre);
  log.getRange(1, LC.ATT).setNote(notaOre);

  // Menu a tendina sulle marche, alimentato dal foglio "Velivoli".
  var regola = SpreadsheetApp.newDataValidation()
    .requireValueInRange(vel.getRange('A2:A200'), true)
    .setAllowInvalid(true)   // consente di annotare un mezzo occasionale
    .build();
  log.getRange(2, LC.MARCHE, righe, 1).setDataValidation(regola);

  // Menu a tendina PIC / DUAL. La cella vuota resta ammessa e viene letta come
  // LOG_CONFIG.FUNZIONE_DEFAULT; i valori diversi da questi due sono rifiutati.
  var regolaFunz = SpreadsheetApp.newDataValidation()
    .requireValueInList(FUNZIONI, true)
    .setAllowInvalid(false)
    .setHelpText('PIC = pilota responsabile, DUAL = volo con istruttore. Vuoto = ' +
                 LOG_CONFIG.FUNZIONE_DEFAULT + '.')
    .build();
  log.getRange(2, LC.FUNZ, righe, 1).setDataValidation(regolaFunz);

  // Foglio di conversione degli aeroporti WeGlide, se l'import e' installato.
  if (typeof wgFoglioAeroporti_ === 'function') wgFoglioAeroporti_();

  lAvvisa_('Fogli pronti.\n\n' +
    '1) Completa "Velivoli" con gli altri mezzi (colonna Condiviso = NO).\n' +
    '2) Incolla in LOG_CONFIG.ID_FILE_CONDIVISO l\'ID del file di prenotazione.\n' +
    '3) Prova con Logbook > Prova collegamento al file condiviso.\n\n' +
    (LOG_CONFIG.ORARI_UTC
      ? 'Gli orari di decollo e atterraggio si scrivono in UTC, qui e nella web ' +
        'app, come nella traccia IGC e nel fonogramma ATC.\n'
      : '') +
    'La colonna "Funzione" accetta PIC o DUAL: se la lasci vuota il volo conta ' +
    'come ' + LOG_CONFIG.FUNZIONE_DEFAULT + '.\n' +
    'Le colonne "WeGlide ID" del logbook e "Modello WeGlide" dei velivoli le ' +
    'usa l\'import da WeGlide: non serve scriverci nulla a mano.');
}

/* ============================== ANAGRAFICA =============================== */

/** Legge il foglio "Velivoli": marche -> {modello, condiviso, modelloWeglide}. */
function leggiVelivoli_() {
  var sh = lFoglio_(LOG_FOGLI.VELIVOLI);
  var out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_VELIVOLI.length).getValues().forEach(function (r) {
    var marche = String(r[0]).trim().toUpperCase();
    if (!marche) return;
    var flag = String(r[2]).trim().toUpperCase();
    out[marche] = {
      marche: marche,
      modello: String(r[1]).trim(),
      condiviso: (flag === 'SI' || flag === 'SÌ' || flag === 'X' || flag === 'TRUE' || flag === 'VERO'),
      // Usato solo dall'import da WeGlide per riconoscere il mezzo.
      modelloWeglide: String(r[4] || '').trim()
    };
  });
  return out;
}

/* ===================== CALCOLO MODELLO E DURATE =========================== */

/**
 * Ricalcola modello e durata su tutte le righe del logbook.
 * Non toccare nulla di quello che hai scritto: riempie solo le colonne derivate.
 */
function ricalcolaLogbook() {
  var log = lFoglio_(LOG_FOGLI.LOG);
  if (log.getLastRow() < 2) { lAvvisa_('Nessun volo da elaborare.'); return; }

  var velivoli = leggiVelivoli_();
  var n = log.getLastRow() - 1;
  var dati = log.getRange(2, 1, n, HEADER_LOG.length).getValues();
  var modelli = [], durate = [], funzioni = [];
  var sistemate = 0;

  dati.forEach(function (r) {
    // Funzione a bordo: la cella vuota viene riempita con il valore predefinito,
    // le abbreviazioni ('p', 'd', 'doppio') vengono normalizzate.
    funzioni.push([lFunzione_(r[LC.FUNZ - 1])]);

    var marche = String(r[LC.MARCHE - 1]).trim().toUpperCase();
    var v = velivoli[marche];
    var modello = v ? v.modello : String(r[LC.MODELLO - 1]).trim();

    var secDec = lParseOra_(r[LC.DEC - 1]);
    var secAtt = lParseOra_(r[LC.ATT - 1]);
    if (secDec !== null && secAtt !== null && secAtt > secDec) {
      var d = lDurata_(secDec, secAtt);
      durate.push([d.hhmm, d.minuti]);
      sistemate++;
    } else {
      durate.push([r[LC.DUR - 1], r[LC.MIN - 1]]);
    }
    modelli.push([modello]);
  });

  log.getRange(2, LC.MODELLO, n, 1).setValues(modelli);
  log.getRange(2, LC.DUR, n, 2).setValues(durate);
  log.getRange(2, LC.FUNZ, n, 1).setValues(funzioni);
  SpreadsheetApp.flush();
  lAvvisa_('Ricalcolo eseguito su ' + sistemate + ' voli.');
}

/* ======================= SINCRONIZZAZIONE IN USCITA ====================== */

/** Apre il file condiviso, con messaggio chiaro se ID o permessi sono sbagliati. */
function apriFileCondiviso_() {
  var id = String(LOG_CONFIG.ID_FILE_CONDIVISO || '').trim();
  if (!id || id.indexOf('INCOLLA') === 0) {
    throw new Error('Manca l\'ID del file condiviso: compila LOG_CONFIG.ID_FILE_CONDIVISO.');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('File condiviso non raggiungibile: verifica l\'ID e di avere accesso in modifica.\n(' + err.message + ')');
  }
}

/** Nome colonna -> indice base 0, per scrivere senza dipendere dall'ordine. */
function mappaHeaderCond_(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
  var map = {};
  h.forEach(function (x, i) { map[x] = i; });
  return { map: map, larghezza: h.length };
}

/**
 * Scrive un valore nella colonna individuata dal nome dell'intestazione.
 * Se la colonna non esiste si ferma con un messaggio chiaro, invece di perdere
 * il dato in silenzio: vuol dire che nel file condiviso l'intestazione e' stata
 * rinominata rispetto a quella attesa.
 */
function setCol_(riga, h, nome, valore) {
  var i = h.map[nome];
  if (i === undefined) {
    throw new Error('Nel foglio "Voli" del file condiviso manca la colonna "' + nome +
      '". Controlla la riga di intestazione (Aliante > Inizializza fogli nel file condiviso).');
  }
  riga[i] = valore;
}

/** Aggiunge in coda a "Voli" le colonne che il file condiviso non ha ancora. */
function assicuraColonneVoli_(sh) {
  var h = mappaHeaderCond_(sh);
  [COND.COL_QUOTA, COND.COL_ORIGINE, COND.COL_FUNZIONE].forEach(function (nome) {
    if (h.map[nome] === undefined) {
      sh.getRange(1, h.larghezza + 1).setValue(nome).setFontWeight('bold');
      h = mappaHeaderCond_(sh);
    }
  });
  return h;
}

function provaCollegamento() {
  try {
    var ss = apriFileCondiviso_();
    var voli = ss.getSheetByName(COND.VOLI);
    var pren = ss.getSheetByName(COND.PREN);
    var io = mioIndirizzo_();
    lAvvisa_('Collegamento riuscito.\n\n' +
      'File: ' + ss.getName() + '\n' +
      'Foglio "Voli": ' + (voli ? (voli.getLastRow() - 1) + ' voli registrati' : 'ASSENTE') + '\n' +
      'Foglio "Prenotazioni": ' + (pren ? 'presente' : 'ASSENTE') + '\n' +
      'Scrivero\' i voli come: ' + io);
  } catch (err) {
    lAvvisa_('Errore: ' + err.message);
  }
}

/**
 * Copia nel file condiviso i voli sull'aliante in comproprieta' non ancora
 * sincronizzati, e chiude la prenotazione corrispondente.
 * Rilanciabile a piacere: le righe con "Sincronizzato il" pieno sono ignorate, e
 * in ogni caso un volo dello stesso pilota nello stesso giorno con un decollo
 * quasi uguale (vedi lStessoVolo_) viene riconosciuto come doppione.
 * Gli orari passano cosi' come sono: UTC nel logbook, UTC nel file condiviso.
 */
function sincronizzaVoliCondivisi() {
  var log = lFoglio_(LOG_FOGLI.LOG);
  if (log.getLastRow() < 2) { lAvvisa_('Nessun volo nel logbook.'); return; }

  var velivoli = leggiVelivoli_();
  var io = mioIndirizzo_();
  var n = log.getLastRow() - 1;
  var dati = log.getRange(2, 1, n, HEADER_LOG.length).getValues();

  // Prima di aprire il file condiviso verifico che ci sia qualcosa da fare.
  var daFare = dati.some(function (r) {
    var v = velivoli[String(r[LC.MARCHE - 1]).trim().toUpperCase()];
    return v && v.condiviso && !r[LC.SYNC - 1];
  });
  if (!daFare) { lAvvisa_('Nessun volo condiviso da sincronizzare.'); return; }

  var ssCond = apriFileCondiviso_();
  var shVoli = ssCond.getSheetByName(COND.VOLI);
  if (!shVoli) throw new Error('Nel file condiviso manca il foglio "Voli".');
  var shPren = ssCond.getSheetByName(COND.PREN);
  var h = assicuraColonneVoli_(shVoli);

  // Il mio nome come risulta nell'anagrafica del file condiviso.
  var mioNome = LOG_CONFIG.MIO_NOME || io.split('@')[0];
  var shUt = ssCond.getSheetByName(COND.UTENTI);
  if (shUt && shUt.getLastRow() > 1) {
    shUt.getRange(2, 1, shUt.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (String(r[0]).trim().toLowerCase() === io && String(r[1]).trim()) mioNome = String(r[1]).trim();
    });
  }

  // Voli condivisi gia' presenti. Non una chiave esatta ma un elenco, perche' il
  // confronto sull'orario ha la tolleranza di lStessoVolo_: gli orari sono in UTC
  // in entrambi i file, ma la stessa ora puo' arrivare dall'IGC o dall'ATC.
  var esistenti = [];
  if (shVoli.getLastRow() > 1) {
    shVoli.getRange(2, 1, shVoli.getLastRow() - 1, shVoli.getLastColumn()).getValues().forEach(function (r) {
      esistenti.push({
        data: lParseData_(r[h.map['Data volo']]),
        sec: lParseOra_(r[h.map['Ora decollo']]),
        email: String(r[h.map['Email']]).trim().toLowerCase()
      });
    });
  }

  // Prenotazioni del file condiviso, per chiudere quella del giorno.
  var prenotazioni = [];
  if (shPren && shPren.getLastRow() > 1) {
    shPren.getRange(2, 1, shPren.getLastRow() - 1, COND.PC.RENDICONTATO).getValues().forEach(function (r, i) {
      prenotazioni.push({
        riga: i + 2,
        id: String(r[COND.PC.ID - 1]).trim(),
        data: lParseData_(r[COND.PC.DATA - 1]),
        email: String(r[COND.PC.EMAIL - 1]).trim().toLowerCase(),
        stato: String(r[COND.PC.STATO - 1]).trim().toUpperCase(),
        rendicontato: !!r[COND.PC.RENDICONTATO - 1]
      });
    });
  }

  var nuove = [], aggiornamentiLog = [];
  var ok = 0, errori = 0, saltati = 0;
  var adesso = new Date();

  dati.forEach(function (r, i) {
    var riga = i + 2;
    var marche = String(r[LC.MARCHE - 1]).trim().toUpperCase();
    var v = velivoli[marche];

    // Non condiviso o gia' sincronizzato: niente da fare, esito invariato.
    if (!v || !v.condiviso) { aggiornamentiLog.push([r[LC.SYNC - 1], r[LC.ESITO - 1]]); return; }
    if (r[LC.SYNC - 1]) { aggiornamentiLog.push([r[LC.SYNC - 1], r[LC.ESITO - 1]]); saltati++; return; }

    var data = lParseData_(r[LC.DATA - 1]);
    var secDec = lParseOra_(r[LC.DEC - 1]);
    var secAtt = lParseOra_(r[LC.ATT - 1]);
    var dep = String(r[LC.DEP - 1] || LOG_CONFIG.ICAO_DEFAULT).trim().toUpperCase();
    var arr = String(r[LC.ARR - 1] || LOG_CONFIG.ICAO_DEFAULT).trim().toUpperCase();
    var quota = r[LC.QUOTA - 1] === '' ? '' : Number(r[LC.QUOTA - 1]);

    // Controlli: chi sbaglia qualcosa resta nel logbook con il motivo scritto.
    var errore = '';
    if (!data) errore = 'data non valida';
    else if (secDec === null) errore = 'ora decollo non leggibile';
    else if (secAtt === null) errore = 'ora atterraggio non leggibile';
    else if (secAtt <= secDec) errore = 'atterraggio non successivo al decollo';
    else if (!/^[A-Z]{4}$/.test(dep) || !/^[A-Z]{4}$/.test(arr)) errore = 'codice ICAO non valido';
    else if (LOG_CONFIG.QUOTA_OBBLIGATORIA && quota === '') errore = 'quota di sgancio mancante';

    if (errore) { aggiornamentiLog.push(['', 'DA CORREGGERE: ' + errore]); errori++; return; }

    var oraDec = lFormattaOra_(secDec);

    // Doppione: stesso pilota, stesso giorno, decollo entro la tolleranza.
    var gia = esistenti.some(function (x) {
      return x.email === io && lStessoVolo_(data, secDec, x.data, x.sec);
    });
    if (gia) {
      aggiornamentiLog.push([adesso, 'era gia\' presente nel file condiviso']);
      saltati++;
      return;
    }
    esistenti.push({ data: data, sec: secDec, email: io });

    var d = lDurata_(secDec, secAtt);

    // Prenotazione del giorno a mio nome: la chiudo e ne riporto l'ID.
    var idPren = '', notaPren = '';
    var p = prenotazioni.filter(function (x) {
      return x.data === data && x.email === io && x.stato === 'ATTIVA' && !x.rendicontato;
    })[0];
    if (p) {
      idPren = p.id;
      if (LOG_CONFIG.CHIUDI_PRENOTAZIONE && shPren) {
        shPren.getRange(p.riga, COND.PC.STATO).setValue('CONCLUSA');
        shPren.getRange(p.riga, COND.PC.RENDICONTATO).setValue(adesso);
        p.stato = 'CONCLUSA';
        notaPren = ', prenotazione chiusa';
      }
    } else {
      notaPren = ', nessuna prenotazione trovata per quel giorno';
    }

    // Riga per il foglio "Voli" del file condiviso.
    var out = new Array(h.larghezza).fill('');
    setCol_(out, h, 'Timestamp', adesso);
    setCol_(out, h, 'ID Prenotazione', idPren);
    setCol_(out, h, 'Data volo', data);
    setCol_(out, h, 'Email', io);
    setCol_(out, h, 'Pilota', mioNome);
    setCol_(out, h, 'ICAO decollo', dep);
    setCol_(out, h, 'ICAO atterraggio', arr);
    // Orari in UTC, gli stessi del logbook: il foglio "Voli" condiviso usa la
    // medesima convenzione, quindi non c'e' nulla da convertire.
    setCol_(out, h, 'Ora decollo', oraDec);
    setCol_(out, h, 'Ora atterraggio', lFormattaOra_(secAtt));
    setCol_(out, h, 'Durata (hh:mm)', d.hhmm);
    setCol_(out, h, 'Durata (minuti)', d.minuti);
    setCol_(out, h, COND.COL_QUOTA, quota);
    setCol_(out, h, COND.COL_ORIGINE, 'LOGBOOK');
    setCol_(out, h, COND.COL_FUNZIONE, lFunzione_(r[LC.FUNZ - 1]));
    nuove.push(out);

    aggiornamentiLog.push([adesso, 'copiato nel file condiviso' + notaPren]);
    ok++;
  });

  if (nuove.length) {
    shVoli.getRange(shVoli.getLastRow() + 1, 1, nuove.length, nuove[0].length).setValues(nuove);
  }
  log.getRange(2, LC.SYNC, aggiornamentiLog.length, 2).setValues(aggiornamentiLog);
  SpreadsheetApp.flush();

  lAvvisa_('Sincronizzazione completata.\n\n' +
    'Voli copiati: ' + ok + '\n' +
    'Righe saltate: ' + saltati + '\n' +
    'Righe da correggere: ' + errori + (errori ? '  → vedi colonna "Esito sincronizzazione"' : ''));
}

/* ==================== SINCRONIZZAZIONE AUTOMATICA ======================== */

/**
 * Trigger installabile: si attiva quando modifichi una cella del logbook.
 * Ricalcola modello e durata della riga toccata e, se la riga e' completa e il
 * velivolo e' quello condiviso, lancia la sincronizzazione.
 * Serve un trigger INSTALLABILE (non il semplice onEdit) perche' solo quello
 * ha i permessi per scrivere su un altro file.
 */
function onEditLogbook(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== LOG_FOGLI.LOG) return;
    var riga = e.range.getRow();
    if (riga < 2) return;
    // Interviene solo sulle colonne dei dati inseriti a mano ("Funzione"
    // compresa, anche se sta in fondo al foglio).
    var colonna = e.range.getColumn();
    if (colonna > LC.NOTE && colonna !== LC.FUNZ) return;

    var valori = sh.getRange(riga, 1, 1, HEADER_LOG.length).getValues()[0];

    // Normalizzazione della funzione a bordo ('p' -> PIC, 'd' -> DUAL, vuoto ->
    // predefinito). Le scritture dello script non riattivano il trigger.
    var funzione = lFunzione_(valori[LC.FUNZ - 1]);
    if (String(valori[LC.FUNZ - 1]).trim() !== funzione) {
      sh.getRange(riga, LC.FUNZ).setValue(funzione);
      valori[LC.FUNZ - 1] = funzione;
    }
    var velivoli = leggiVelivoli_();
    var marche = String(valori[LC.MARCHE - 1]).trim().toUpperCase();
    var v = velivoli[marche];

    // Modello dall'anagrafica velivoli.
    if (v && v.modello && String(valori[LC.MODELLO - 1]).trim() !== v.modello) {
      sh.getRange(riga, LC.MODELLO).setValue(v.modello);
    }
    // Durata, appena ci sono due orari coerenti.
    var secDec = lParseOra_(valori[LC.DEC - 1]);
    var secAtt = lParseOra_(valori[LC.ATT - 1]);
    if (secDec !== null && secAtt !== null && secAtt > secDec) {
      var d = lDurata_(secDec, secAtt);
      sh.getRange(riga, LC.DUR, 1, 2).setValues([[d.hhmm, d.minuti]]);
    } else {
      return; // riga ancora incompleta: niente sincronizzazione
    }

    // Travaso solo per il mezzo condiviso, e solo se non gia' fatto.
    if (!v || !v.condiviso || valori[LC.SYNC - 1]) return;
    if (!lParseData_(valori[LC.DATA - 1])) return;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return;   // un'altra esecuzione sta gia' lavorando
    try {
      sincronizzaVoliCondivisi();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Un errore nel trigger non deve bloccare la digitazione nel foglio.
    console.error('onEditLogbook: ' + err.message);
  }
}

function attivaSincronizzazioneAutomatica() {
  disattivaSincronizzazioneAutomatica();
  ScriptApp.newTrigger('onEditLogbook')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  lAvvisa_('Sincronizzazione automatica attiva.\n\n' +
    'Completando una riga con le marche dell\'aliante condiviso, il volo viene ' +
    'copiato subito nel file di prenotazione.');
}

function disattivaSincronizzazioneAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditLogbook') ScriptApp.deleteTrigger(t);
  });
}

/* ====================== IMPORTAZIONE IN ENTRATA ========================== */

/**
 * Rete di sicurezza per il senso opposto: porta nel logbook i voli
 * sull'aliante condiviso che risultano a tuo nome nel file di prenotazione ma
 * che nel logbook non ci sono (per esempio se li hai registrati dall'app).
 * La quota di sgancio, se assente nel file condiviso, resta da completare.
 */
function importaDaFileCondiviso() {
  var log = lFoglio_(LOG_FOGLI.LOG);
  var ssCond = apriFileCondiviso_();
  var shVoli = ssCond.getSheetByName(COND.VOLI);
  if (!shVoli || shVoli.getLastRow() < 2) { lAvvisa_('Nessun volo nel file condiviso.'); return; }

  var h = mappaHeaderCond_(shVoli);
  var io = mioIndirizzo_();

  // Marche del mezzo condiviso: la prima riga con Condiviso = SI.
  var velivoli = leggiVelivoli_();
  var marcheCondivise = Object.keys(velivoli).filter(function (k) { return velivoli[k].condiviso; })[0];
  if (!marcheCondivise) { lAvvisa_('Nel foglio "Velivoli" non c\'e\' nessun mezzo marcato come condiviso.'); return; }

  // Voli gia' presenti nel logbook: elenco, non chiave esatta, perche' il
  // confronto passa da lStessoVolo_ (data + decollo entro la tolleranza).
  var presenti = [];
  if (log.getLastRow() > 1) {
    log.getRange(2, 1, log.getLastRow() - 1, HEADER_LOG.length).getValues().forEach(function (r) {
      presenti.push({ data: lParseData_(r[LC.DATA - 1]), sec: lParseOra_(r[LC.DEC - 1]) });
    });
  }

  var nuove = [];
  shVoli.getRange(2, 1, shVoli.getLastRow() - 1, shVoli.getLastColumn()).getValues().forEach(function (r) {
    if (String(r[h.map['Email']]).trim().toLowerCase() !== io) return;
    if (String(r[h.map[COND.COL_ORIGINE]] || '').trim().toUpperCase() === 'LOGBOOK') return; // arrivato da qui
    var data = lParseData_(r[h.map['Data volo']]);
    var secDec = lParseOra_(r[h.map['Ora decollo']]);
    var secAtt = lParseOra_(r[h.map['Ora atterraggio']]);
    if (!data || secDec === null || secAtt === null) return;
    if (presenti.some(function (x) { return lStessoVolo_(data, secDec, x.data, x.sec); })) return;
    presenti.push({ data: data, sec: secDec });

    var d = lDurata_(secDec, secAtt);
    var riga = new Array(HEADER_LOG.length).fill('');
    riga[LC.DATA - 1] = data;
    riga[LC.MARCHE - 1] = marcheCondivise;
    riga[LC.MODELLO - 1] = velivoli[marcheCondivise].modello;
    riga[LC.DEP - 1] = String(r[h.map['ICAO decollo']]).trim().toUpperCase();
    riga[LC.ARR - 1] = String(r[h.map['ICAO atterraggio']]).trim().toUpperCase();
    riga[LC.DEC - 1] = lFormattaOra_(secDec);
    riga[LC.ATT - 1] = lFormattaOra_(secAtt);
    riga[LC.DUR - 1] = d.hhmm;
    riga[LC.MIN - 1] = d.minuti;
    riga[LC.QUOTA - 1] = h.map[COND.COL_QUOTA] !== undefined ? r[h.map[COND.COL_QUOTA]] : '';
    // Se il file condiviso non registra la funzione (voli inseriti dagli altri
    // soci o storico importato) vale il valore predefinito: controlla tu le
    // eventuali righe da marcare come DUAL.
    riga[LC.FUNZ - 1] = lFunzione_(h.map[COND.COL_FUNZIONE] !== undefined ? r[h.map[COND.COL_FUNZIONE]] : '');
    riga[LC.SYNC - 1] = new Date();
    riga[LC.ESITO - 1] = 'importato dal file condiviso';
    nuove.push(riga);
  });

  if (!nuove.length) { lAvvisa_('Nessun volo da importare: il logbook e\' allineato.'); return; }

  // Ordinamento per data, poi scrittura in coda.
  nuove.sort(function (a, b) { return a[LC.DATA - 1] < b[LC.DATA - 1] ? -1 : 1; });
  log.getRange(log.getLastRow() + 1, 1, nuove.length, HEADER_LOG.length).setValues(nuove);
  SpreadsheetApp.flush();
  lAvvisa_('Importati ' + nuove.length + ' voli dal file condiviso.\nControlla la quota di sgancio, dove manca.');
}

/* ============================== RIEPILOGHI =============================== */

/**
 * Ore di volo per velivolo e per anno, stampate nel log di esecuzione.
 * Comodo per il rinnovo delle abilitazioni senza costruire pivot a mano.
 */
function riepilogoOre() {
  var log = lFoglio_(LOG_FOGLI.LOG);
  if (log.getLastRow() < 2) { lAvvisa_('Logbook vuoto.'); return; }
  var dati = log.getRange(2, 1, log.getLastRow() - 1, HEADER_LOG.length).getValues();
  var perAnno = {}, perVelivolo = {}, totale = 0, totalePic = 0, voliPic = 0;

  dati.forEach(function (r) {
    var min = Number(r[LC.MIN - 1]) || 0;
    if (!min) return;
    var anno = String(lParseData_(r[LC.DATA - 1])).substring(0, 4) || '?';
    var marche = String(r[LC.MARCHE - 1]).trim().toUpperCase() || '?';
    perAnno[anno] = (perAnno[anno] || 0) + min;
    perVelivolo[marche] = (perVelivolo[marche] || 0) + min;
    totale += min;
    if (lFunzione_(r[LC.FUNZ - 1]) === 'PIC') { totalePic += min; voliPic++; }
  });

  function hhmm(m) { return Math.floor(m / 60) + ':' + lPad2_(m % 60); }
  var testo = 'TOTALE: ' + hhmm(totale) + ' in ' + dati.length + ' voli\n' +
              'di cui PIC: ' + hhmm(totalePic) + ' in ' + voliPic + ' voli\n\nPer anno:\n';
  Object.keys(perAnno).sort().forEach(function (a) { testo += '  ' + a + ': ' + hhmm(perAnno[a]) + '\n'; });
  testo += '\nPer velivolo:\n';
  Object.keys(perVelivolo).sort().forEach(function (v) { testo += '  ' + v + ': ' + hhmm(perVelivolo[v]) + '\n'; });
  lAvvisa_(testo);
}
