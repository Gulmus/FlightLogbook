/*******************************************************************************
 * PRENOTAZIONE ALIANTE CONDIVISO — Web App Google Apps Script
 * -----------------------------------------------------------------------------
 * Backend. Incollare in "Codice.gs" del progetto Apps Script legato al Google
 * Sheet (Estensioni > Apps Script). L'interfaccia sta nel file HTML "Index".
 *
 * MODELLO DEI DATI
 *   Foglio "Prenotazioni" : una riga = un giorno di volo assegnato a un socio.
 *                           Tipo PRENOTAZIONE = creata dall'app.
 *                           Tipo ASSEGNAZIONE = precaricata a mano una volta
 *                           l'anno direttamente nel foglio.
 *                           Tipo RETROATTIVA  = creata insieme al volo per un
 *                           giorno passato che non era stato prenotato.
 *   Foglio "Utenti"       : elenco dei comproprietari abilitati.
 *   Foglio "Aeroporti"    : codici ICAO proposti nel rendiconto (modificabile).
 *   Foglio "Voli"         : rendiconto dei voli effettuati, con durata calcolata.
 *
 * REGOLE IMPLEMENTATE
 *   - Prenotazione su base giornaliera: un giorno, un solo titolare.
 *   - Qualsiasi socio puo' rimuovere o sovrascrivere la prenotazione di un
 *     altro socio (la conferma viene chiesta dall'interfaccia). Ogni operazione
 *     lascia traccia nel foglio e genera una email agli interessati.
 *   - Il rendiconto del volo si puo' compilare in qualsiasi momento a partire
 *     dal giorno stesso del volo.
 *   - Tocco su un giorno del calendario: se e' oggi o nel futuro si prenota,
 *     se e' nel passato ed e' libero si registra direttamente un volo gia'
 *     effettuato (Tipo RETROATTIVA, stato CONCLUSA in un colpo solo).
 *
 * ORARI
 *   Le ore di decollo e atterraggio del foglio "Voli" sono in UTC (ora zulu),
 *   come nella traccia IGC e nel fonogramma ATC. E' una convenzione condivisa
 *   con il logbook personale, non una conversione: nessuna funzione tocca gli
 *   orari inseriti. Il modulo mostra accanto l'ora locale corrispondente solo
 *   come aiuto alla lettura. CONFIG.TZ serve a sapere che giorno e' oggi, non a
 *   spostare le ore.
 ******************************************************************************/

/* ============================ CONFIGURAZIONE ============================== */

var CONFIG = {
  NOME_BENE: 'DG300',                   // compare nel titolo e nelle email
  TZ: 'Europe/Rome',                    // fuso usato per sapere che giorno e' "oggi"
  /**
   * true = le ore di decollo e atterraggio si inseriscono e si leggono in UTC,
   * come nel logbook personale, nella traccia IGC e nel fonogramma ATC.
   * Non e' una conversione: nessuna funzione modifica l'orario scritto. La
   * bandiera serve alle etichette dell'app, alle note sulle celle e alle email.
   * Mettendola a false l'app torna a parlare di ora locale, ma il foglio "Voli"
   * resterebbe pieno di orari UTC: cambiarla non converte lo storico.
   */
  ORARI_UTC: true,
  MAX_GIORNI_FUTURO: 400,               // quanto in avanti si puo' prenotare
  GIORNI_STORICO_VISIBILI: 60,          // giorni passati mostrati in app
  PREAVVISO_MINIMO_GIORNI: 0,           // 0 = si puo' prenotare anche per oggi
  MAX_PRENOTAZIONI_FUTURE: 0,           // limite per socio; 0 = nessun limite
  NOTIFICA_EMAIL: true,                 // email agli altri soci a ogni modifica
  ICAO_DEFAULT: 'LIMA',                 // campo base proposto nel rendiconto
  CONSENTI_ICAO_LIBERO: true,           // true = si puo' digitare un ICAO non in elenco
  /**
   * URL pubblico di un PNG quadrato (consigliato 192x192 o 512x512) usato come
   * icona della pagina e, di norma, anche dalla scorciatoia sulla schermata
   * Home di Android. Lascia stringa vuota per non impostarla.
   *
   * ATTENZIONE: setFaviconUrl() controlla l'ESTENSIONE nell'URL. Sono accettati
   * indirizzi che terminano con .png .ico .gif .jpg; sono rifiutati con
   * "tipo di immagine non supportato" i link di Drive e di
   * lh3.googleusercontent.com, che non hanno estensione, e i formati .svg/.webp.
   * Esempio valido (repository GitHub pubblico):
   *   'https://raw.githubusercontent.com/utente/repo/main/icona.png'
   */
  ICONA_URL: 'https://raw.githubusercontent.com/Gulmus/FlightLogbook/main/OE-5357/88_512.png'
};

/**
 * Elenco ICAO usato SOLO per creare il foglio "Aeroporti" la prima volta.
 * Dopo l'inizializzazione si modifica direttamente nel foglio, senza codice.
 * ZZZZ e' la convenzione ICAO per l'atterraggio fuori campo.
 */
var AEROPORTI_INIZIALI = [
  ['LIMA', 'Torino Aeritalia'],
  ['LILE', 'Biella Cerrione'],
  ['LILH', 'Rivanazzano Terme'],
  ['LIMW', 'Aosta'],
  ['LIMZ', 'Cuneo Levaldigi'],
  ['LIMF', 'Torino Caselle'],
  ['LILN', 'Varese Venegono'],
  ['ZZZZ', 'Fuori campo / campo non codificato']
];

/* ======================= COSTANTI STRUTTURA FOGLI ========================= */

var FOGLI = { PREN: 'Prenotazioni', UTENTI: 'Utenti', AERO: 'Aeroporti', VOLI: 'Voli' };

// Posizione delle colonne nel foglio "Prenotazioni" (1 = colonna A)
var COL = { ID: 1, TIPO: 2, DATA: 3, EMAIL: 4, NOME: 5, STATO: 6, NOTE: 7, CREATO: 8, MODIFICATO: 9, RENDICONTATO: 10 };

var HEADER_PREN   = ['ID', 'Tipo', 'Data', 'Email', 'Pilota', 'Stato', 'Note', 'Creato il', 'Modificato il', 'Rendicontato il'];
var HEADER_UTENTI = ['Email', 'Nome', 'Ruolo', 'PIN', 'Colore', 'Attivo'];
var HEADER_AERO   = ['ICAO', 'Aeroporto'];
var HEADER_VOLI   = ['Timestamp', 'ID Prenotazione', 'Data volo', 'Email', 'Pilota',
                     'ICAO decollo', 'ICAO atterraggio', 'Ora decollo', 'Ora atterraggio',
                     'Durata (hh:mm)', 'Durata (minuti)'];

// Stati che rendono il giorno indisponibile. Gli altri stati (ANNULLATA,
// RILASCIATA, SOSTITUITA) sono storici e liberano il giorno.
var STATI_BLOCCANTI = ['ATTIVA', 'CONCLUSA'];

// Tipi riconosciuti nella colonna "Tipo"; qualunque altro valore viene letto
// come PRENOTAZIONE, cosi' una svista nel foglio non rompe nulla.
var TIPI_NOTI = ['PRENOTAZIONE', 'ASSEGNAZIONE', 'RETROATTIVA'];

var PALETTE = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2'];

/* =========================== ENTRY POINT WEB APP ========================== */

/** Servita quando un socio apre l'URL della web app. */
function doGet(e) {
  var out = HtmlService.createHtmlOutputFromFile('Index')
    // Il titolo e' anche il nome proposto quando si crea la scorciatoia sulla Home
    .setTitle('Voli ' + CONFIG.NOME_BENE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  // Icona della pagina (scheda del browser e, in genere, scorciatoia Android).
  // Se l'URL non e' raggiungibile pubblicamente il browser la ignora.
  if (CONFIG.ICONA_URL) out.setFaviconUrl(CONFIG.ICONA_URL);

  return out;
}

/**
 * Menu di servizio dentro il foglio.
 * Le ultime due voci funzionano solo se nel progetto e' presente anche il file
 * "Importa.gs" (importazione dello storico voli).
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Aliante')
    .addItem('Inizializza / verifica fogli', 'inizializzaFogli')
    .addItem('Mostra URL web app', 'mostraUrl')
    .addSeparator()
    .addItem('Crea foglio Import storico', 'creaFoglioImport')
    .addItem('Importa storico voli', 'importaStoricoVoli')
    .addToUi();
}

function mostraUrl() {
  var url = ScriptApp.getService().getUrl() || '(non ancora pubblicata: Distribuisci > Nuova distribuzione)';
  SpreadsheetApp.getUi().alert('URL web app:\n\n' + url);
}

/* ============================== SETUP FOGLI =============================== */

/**
 * Crea (o allinea) i quattro fogli di lavoro. Eseguibile piu' volte senza
 * danni: non cancella dati, si limita a sistemare intestazioni e formati.
 */
function inizializzaFogli() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Prenotazioni ---
  var pren = ss.getSheetByName(FOGLI.PREN) || ss.insertSheet(FOGLI.PREN);
  if (pren.getLastRow() === 0) pren.appendRow(HEADER_PREN);
  else pren.getRange(1, 1, 1, HEADER_PREN.length).setValues([HEADER_PREN]);
  pren.setFrozenRows(1);
  pren.getRange(1, 1, 1, HEADER_PREN.length).setFontWeight('bold');
  // La data e' salvata come TESTO "yyyy-mm-dd": evita gli slittamenti di un
  // giorno che i valori data di Sheets possono produrre cambiando fuso orario.
  pren.getRange(2, COL.DATA, Math.max(pren.getMaxRows() - 1, 1), 1).setNumberFormat('@');

  // --- Utenti ---
  var ut = ss.getSheetByName(FOGLI.UTENTI) || ss.insertSheet(FOGLI.UTENTI);
  if (ut.getLastRow() === 0) {
    ut.appendRow(HEADER_UTENTI);
    ut.appendRow([Session.getEffectiveUser().getEmail(), 'Amministratore', 'admin', '', PALETTE[0], 'SI']);
  }
  ut.setFrozenRows(1);
  ut.getRange(1, 1, 1, HEADER_UTENTI.length).setFontWeight('bold');
  ut.getRange(2, 4, Math.max(ut.getMaxRows() - 1, 1), 1).setNumberFormat('@'); // PIN come testo

  // --- Aeroporti ---
  var ae = ss.getSheetByName(FOGLI.AERO) || ss.insertSheet(FOGLI.AERO);
  if (ae.getLastRow() === 0) {
    ae.appendRow(HEADER_AERO);
    ae.getRange(2, 1, AEROPORTI_INIZIALI.length, 2).setValues(AEROPORTI_INIZIALI);
  }
  ae.setFrozenRows(1);
  ae.getRange(1, 1, 1, HEADER_AERO.length).setFontWeight('bold');

  // --- Voli ---
  var vo = ss.getSheetByName(FOGLI.VOLI) || ss.insertSheet(FOGLI.VOLI);
  if (vo.getLastRow() === 0) vo.appendRow(HEADER_VOLI);
  else vo.getRange(1, 1, 1, HEADER_VOLI.length).setValues([HEADER_VOLI]);
  vo.setFrozenRows(1);
  vo.getRange(1, 1, 1, HEADER_VOLI.length).setFontWeight('bold');
  // Date e orari come testo, durata (minuti) come numero: cosi' le somme e i
  // report per pilota funzionano senza sorprese di formattazione.
  var righeVoli = Math.max(vo.getMaxRows() - 1, 1);
  vo.getRange(2, 3, righeVoli, 1).setNumberFormat('@');  // Data volo
  vo.getRange(2, 8, righeVoli, 3).setNumberFormat('@');  // Ore e durata hh:mm
  vo.getRange(2, 11, righeVoli, 1).setNumberFormat('0'); // Durata minuti

  // Nota sulle due intestazioni degli orari: chi apre il foglio deve sapere in
  // che fuso sono i numeri che legge, senza dover cercare la documentazione.
  var notaOre = CONFIG.ORARI_UTC
    ? 'Orario in UTC (ora zulu), come nella traccia IGC e nel fonogramma ATC.\n' +
      'Non in ora locale: d\'estate due ore in meno, d\'inverno una.'
    : 'Orario in ora locale (' + CONFIG.TZ + ').';
  vo.getRange(1, 8).setNote(notaOre);   // Ora decollo
  vo.getRange(1, 9).setNote(notaOre);   // Ora atterraggio

  SpreadsheetApp.getUi().alert(
    'Fogli pronti.\n\n' +
    '1) Compila "Utenti" con i comproprietari.\n' +
    '2) Verifica l\'elenco in "Aeroporti".\n' +
    (CONFIG.ORARI_UTC
      ? '   Ricorda: in "Voli" gli orari di decollo e atterraggio sono in UTC.\n'
      : '') +
    '3) Inserisci le assegnazioni annuali in "Prenotazioni" con Tipo = ASSEGNAZIONE.\n' +
    '4) Distribuisci la web app (vedi istruzioni).');
}

/** Restituisce un foglio obbligatorio, con messaggio chiaro se manca. */
function foglio_(nome) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sh) throw new Error('Foglio "' + nome + '" mancante: esegui Aliante > Inizializza fogli.');
  return sh;
}

/* ============================ UTILITY DATE/ORE ============================ */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Data -> 'yyyy-MM-dd' nel fuso configurato. */
function iso_(d) { return Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd'); }

function oggi_() { return iso_(new Date()); }

/** Normalizza in 'yyyy-mm-dd' quello che trova nel foglio: Date, ISO, gg/mm/aaaa. */
function parseData_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return iso_(v);
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return m[3] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[1]);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return iso_(d);
  return '';
}

/** Confronti e differenze fatti in UTC: nessun effetto di ora legale. */
function utc_(isoStr) {
  var p = isoStr.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function diffGiorni_(a, b) { return Math.round((utc_(b) - utc_(a)) / 86400000); }

function addGiorni_(isoStr, n) {
  var d = new Date(utc_(isoStr) + n * 86400000);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

/** 'yyyy-mm-dd' -> 'gg/mm/aaaa' per messaggi ed email. */
function itDate_(isoStr) {
  var p = String(isoStr).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(isoStr);
}

/**
 * Converte 'HH:MM' in minuti dalla mezzanotte.
 * Accetta anche 'H:M' e 'HH.MM'. Restituisce null se non valido.
 * L'orario viene preso per quello che e': se CONFIG.ORARI_UTC e' true quei
 * minuti sono minuti UTC, e nessuno li sposta.
 */
function parseOra_(v) {
  if (v === null || v === undefined) return null;
  // Se arriva un oggetto Date (foglio formattato come ora) estrae ore e minuti.
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getHours() * 60 + v.getMinutes();
  }
  var m = String(v).trim().match(/^(\d{1,2})[:.,](\d{2})$/);
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** minuti -> 'HH:MM' */
function formattaOra_(min) { return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60); }

/** ' UTC' da attaccare a un orario nei messaggi e nelle email, o '' se no. */
function utc_suffisso_() { return CONFIG.ORARI_UTC ? ' UTC' : ''; }

/* ========================= UTENTI E AUTENTICAZIONE ======================== */

/** Legge il foglio "Utenti" e restituisce gli oggetti socio. */
function leggiUtenti_() {
  var sh = foglio_(FOGLI.UTENTI);
  if (sh.getLastRow() < 2) return [];
  var righe = sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_UTENTI.length).getValues();
  var out = [];
  righe.forEach(function (r, i) {
    var email = String(r[0]).trim().toLowerCase();
    if (!email) return;
    var attivo = String(r[5]).trim().toUpperCase();
    out.push({
      email: email,
      nome: String(r[1]).trim() || email.split('@')[0],
      ruolo: String(r[2]).trim().toLowerCase() === 'admin' ? 'admin' : 'socio',
      pin: String(r[3]).trim(),
      colore: String(r[4]).trim() || PALETTE[i % PALETTE.length],
      // Colonna vuota = socio attivo, per non obbligare a compilarla
      attivo: (attivo === '' || attivo === 'SI' || attivo === 'SÌ' || attivo === 'TRUE' || attivo === 'VERO' || attivo === 'X')
    });
  });
  return out;
}

function trovaUtente_(email) {
  var em = String(email || '').trim().toLowerCase();
  return leggiUtenti_().filter(function (u) { return u.attivo && u.email === em; })[0] || null;
}

/**
 * Identifica chi sta usando la web app.
 * Percorso primario: l'account Google del visitatore (richiede distribuzione
 * "Esegui come: utente che accede all'app web").
 * Percorso di riserva: email + PIN presi dal foglio "Utenti", usato quando
 * Google non comunica l'identita' del visitatore.
 */
function risolviUtente_(auth) {
  var attivi = leggiUtenti_().filter(function (u) { return u.attivo; });

  var email = '';
  try { email = (Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (err) { email = ''; }

  if (email) {
    var trovato = attivi.filter(function (u) { return u.email === email; })[0];
    if (!trovato) {
      var e1 = new Error('L\'account ' + email + ' non e\' tra i soci autorizzati.');
      e1.codice = 'NON_AUTORIZZATO';
      throw e1;
    }
    return trovato;
  }

  if (auth && auth.email) {
    var em = String(auth.email).trim().toLowerCase();
    var u2 = attivi.filter(function (u) { return u.email === em; })[0];
    if (u2 && u2.pin && String(auth.pin || '').trim() === u2.pin) return u2;
    var e2 = new Error('Email o PIN non validi.');
    e2.codice = 'LOGIN_NECESSARIO';
    throw e2;
  }

  var e3 = new Error('Accesso non riconosciuto.');
  e3.codice = 'LOGIN_NECESSARIO';
  throw e3;
}

/* =========================== LETTURA PRENOTAZIONI ========================= */

/**
 * Legge tutte le righe valide di "Prenotazioni".
 * Conserva il numero di riga: serve per scrivere l'aggiornamento al posto giusto.
 */
function leggiPrenotazioni_() {
  var sh = foglio_(FOGLI.PREN);
  if (sh.getLastRow() < 2) return [];
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_PREN.length).getValues();
  var out = [];
  valori.forEach(function (r, i) {
    var data = parseData_(r[COL.DATA - 1]);
    if (!data) return; // riga vuota o data illeggibile: ignorata
    out.push({
      riga: i + 2,
      id: String(r[COL.ID - 1]).trim(),
      tipo: TIPI_NOTI.indexOf(String(r[COL.TIPO - 1]).trim().toUpperCase()) > -1
        ? String(r[COL.TIPO - 1]).trim().toUpperCase() : 'PRENOTAZIONE',
      data: data,
      email: String(r[COL.EMAIL - 1]).trim().toLowerCase(),
      nome: String(r[COL.NOME - 1]).trim(),
      stato: String(r[COL.STATO - 1]).trim().toUpperCase() || 'ATTIVA',
      note: String(r[COL.NOTE - 1]).trim(),
      rendicontato: !!r[COL.RENDICONTATO - 1]
    });
  });
  return out;
}

/** Righe che occupano effettivamente un dato giorno. */
function occupantiDelGiorno_(data, tutte) {
  return (tutte || leggiPrenotazioni_()).filter(function (p) {
    return p.data === data && STATI_BLOCCANTI.indexOf(p.stato) > -1;
  });
}

function trovaPerId_(id, tutte) {
  var elenco = tutte || leggiPrenotazioni_();
  for (var i = 0; i < elenco.length; i++) if (elenco[i].id === id) return elenco[i];
  throw new Error('Prenotazione non trovata: potrebbe essere stata modificata da un altro socio. Ricarica la pagina.');
}

/** Controlli comuni a prenotazione e sovrascrittura. */
function validaData_(data) {
  if (!data) throw new Error('Data non indicata.');
  var minimo = addGiorni_(oggi_(), CONFIG.PREAVVISO_MINIMO_GIORNI);
  if (data < minimo) throw new Error('Non e\' possibile prenotare prima del ' + itDate_(minimo) + '.');
  if (diffGiorni_(oggi_(), data) > CONFIG.MAX_GIORNI_FUTURO) {
    throw new Error('Si puo\' prenotare al massimo ' + CONFIG.MAX_GIORNI_FUTURO + ' giorni in avanti.');
  }
}

/* =========================== AEROPORTI (ICAO) ============================= */

function leggiAeroporti_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(FOGLI.AERO);
  // Se il foglio non c'e' ancora si usa l'elenco iniziale del codice.
  if (!sh || sh.getLastRow() < 2) {
    return AEROPORTI_INIZIALI.map(function (a) { return { icao: a[0], nome: a[1] }; });
  }
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .map(function (r) { return { icao: String(r[0]).trim().toUpperCase(), nome: String(r[1]).trim() }; })
    .filter(function (a) { return a.icao; });
}

/** Valida un ICAO: 4 lettere, e se richiesto anche presenza in elenco. */
function validaIcao_(valore, etichetta) {
  var v = String(valore || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(v)) throw new Error(etichetta + ': inserisci un codice ICAO di 4 lettere (es. LIMA).');
  if (!CONFIG.CONSENTI_ICAO_LIBERO) {
    var ok = leggiAeroporti_().some(function (a) { return a.icao === v; });
    if (!ok) throw new Error(etichetta + ': ' + v + ' non e\' in elenco. Aggiungilo al foglio "Aeroporti".');
  }
  return v;
}

/* ============================ API PER IL CLIENT =========================== */
/* Tutte le funzioni chiamate da google.script.run ricevono come primo
   argomento l'oggetto auth {email, pin}, usato solo dal percorso di riserva. */

/** Primo caricamento: identifica l'utente e restituisce tutto lo stato. */
function getBootstrap(auth) {
  var utente;
  try {
    utente = risolviUtente_(auth);
  } catch (err) {
    return { ok: false, codice: err.codice || 'ERRORE', messaggio: err.message, nomeBene: CONFIG.NOME_BENE };
  }
  return { ok: true, dati: statoCompleto_(utente) };
}

/**
 * Fotografia completa restituita al client dopo ogni operazione: evita
 * ricariche e tiene tutti i soci allineati.
 */
function statoCompleto_(utente) {
  var tutte = leggiPrenotazioni_();
  var oggi = oggi_();
  var da = addGiorni_(oggi, -CONFIG.GIORNI_STORICO_VISIBILI);

  // Prenotazioni visibili in app: storico recente + tutto il futuro.
  var visibili = tutte.filter(function (p) { return p.data >= da; })
    .sort(function (a, b) { return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0); })
    .map(function (p) {
      return {
        id: p.id, tipo: p.tipo, data: p.data, email: p.email, nome: p.nome,
        stato: p.stato, note: p.note, rendicontato: p.rendicontato,
        mia: (p.email === utente.email)
      };
    });

  // Voli da rendicontare: giorno del volo <= oggi (quindi anche OGGI stesso),
  // ancora in stato ATTIVA e non ancora compilati. Ognuno vede i propri;
  // un admin vede anche quelli degli altri, per sistemare le dimenticanze.
  var daRendicontare = tutte.filter(function (p) {
    return p.stato === 'ATTIVA' && !p.rendicontato && p.data <= oggi &&
      (p.email === utente.email || utente.ruolo === 'admin');
  }).sort(function (a, b) { return a.data > b.data ? -1 : 1 })
    .map(function (p) { return { id: p.id, data: p.data, email: p.email, nome: p.nome, tipo: p.tipo }; });

  // Statistiche dell'anno in corso: giorni occupati e ore volate per socio.
  var anno = oggi.substring(0, 4);
  var giorni = {};
  tutte.forEach(function (p) {
    if (STATI_BLOCCANTI.indexOf(p.stato) === -1) return;
    if (p.data.substring(0, 4) !== anno) return;
    var k = p.email || '(non assegnato)';
    giorni[k] = (giorni[k] || 0) + 1;
  });

  return {
    utente: { email: utente.email, nome: utente.nome, ruolo: utente.ruolo, colore: utente.colore },
    config: {
      nomeBene: CONFIG.NOME_BENE,
      maxFuturo: CONFIG.MAX_GIORNI_FUTURO,
      preavviso: CONFIG.PREAVVISO_MINIMO_GIORNI,
      icaoDefault: CONFIG.ICAO_DEFAULT,
      icaoLibero: CONFIG.CONSENTI_ICAO_LIBERO,
      // Etichette degli orari nei moduli del rendiconto e fuso su cui l'app
      // calcola l'ora locale mostrata come promemoria.
      orariUtc: CONFIG.ORARI_UTC,
      fusoLocale: CONFIG.TZ,
      oggi: oggi,
      anno: anno
    },
    utenti: leggiUtenti_().filter(function (u) { return u.attivo; })
      .map(function (u) { return { email: u.email, nome: u.nome, colore: u.colore }; }),
    aeroporti: leggiAeroporti_(),
    prenotazioni: visibili,
    daRendicontare: daRendicontare,
    giorniPerUtente: giorni,
    minutiPerUtente: minutiVolatiPerUtente_(anno)
  };
}

/** Somma i minuti di volo dell'anno per ogni pilota, leggendo il foglio "Voli". */
function minutiVolatiPerUtente_(anno) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FOGLI.VOLI);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  // Colonne lette: 3 = Data volo, 4 = Email, 11 = Durata (minuti)
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_VOLI.length).getValues();
  v.forEach(function (r) {
    var data = parseData_(r[2]);
    if (!data || data.substring(0, 4) !== anno) return;
    var email = String(r[3]).trim().toLowerCase();
    var min = Number(r[10]) || 0;
    if (!email || !min) return;
    out[email] = (out[email] || 0) + min;
  });
  return out;
}

/**
 * Crea una prenotazione per un singolo giorno.
 * payload = { data:'yyyy-mm-dd', email:'socio@…' (facoltativo), note:'' }
 * Se il giorno risulta gia' occupato la funzione rifiuta: per prendere il
 * posto di un altro socio si usa sovrascriviGiorno().
 */
function prenotaGiorno(auth, payload) {
  var utente = risolviUtente_(auth);
  var data = parseData_(payload.data);
  validaData_(data);

  // Si puo' prenotare per se' o, per comodita', a nome di un altro socio.
  var titolare = payload.email ? trovaUtente_(payload.email) : utente;
  if (!titolare) throw new Error('Socio non riconosciuto.');

  // Il lock serializza le scritture: due soci che toccano lo stesso giorno
  // nello stesso istante non possono creare una doppia prenotazione.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema occupato, riprova tra qualche secondo.');
  try {
    var tutte = leggiPrenotazioni_();
    var occupanti = occupantiDelGiorno_(data, tutte);
    if (occupanti.length) {
      throw new Error('Il ' + itDate_(data) + ' e\' gia\' assegnato a ' +
        (occupanti[0].nome || occupanti[0].email) + '. Usa "Sovrascrivi" se vuoi subentrare.');
    }
    // Limite opzionale di prenotazioni future per socio.
    if (CONFIG.MAX_PRENOTAZIONI_FUTURE > 0) {
      var future = tutte.filter(function (p) {
        return p.email === titolare.email && p.stato === 'ATTIVA' && p.data >= oggi_();
      }).length;
      if (future >= CONFIG.MAX_PRENOTAZIONI_FUTURE) {
        throw new Error('Limite raggiunto: massimo ' + CONFIG.MAX_PRENOTAZIONI_FUTURE +
          ' giorni prenotati contemporaneamente.');
      }
    }
    scriviNuovaPrenotazione_(data, titolare, payload.note, utente);
  } finally {
    lock.releaseLock();
  }

  notifica_('nuova', utente, { data: data, nome: titolare.nome, note: payload.note }, [titolare.email]);
  return statoCompleto_(utente);
}

/** Append della riga. Chiamata sempre dentro il lock. */
function scriviNuovaPrenotazione_(data, titolare, note, autore) {
  var ora = new Date();
  var nota = String(note || '').substring(0, 500);
  // Se un socio prenota per un altro, la cosa resta scritta nelle note.
  if (autore && autore.email !== titolare.email) {
    nota = (nota ? nota + ' — ' : '') + 'inserita da ' + autore.nome;
  }
  foglio_(FOGLI.PREN).appendRow([
    Utilities.getUuid().substring(0, 8).toUpperCase(), // ID
    'PRENOTAZIONE', data, titolare.email, titolare.nome, 'ATTIVA', nota, ora, ora, ''
  ]);
  SpreadsheetApp.flush();
}

/**
 * Libera un giorno: chiunque puo' rimuovere la prenotazione di chiunque.
 * La riga non viene cancellata, cambia stato (ANNULLATA per le prenotazioni,
 * RILASCIATA per le assegnazioni annuali) e resta come traccia.
 */
function rimuoviPrenotazione(auth, id) {
  var utente = risolviUtente_(auth);
  var p;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema occupato, riprova tra qualche secondo.');
  try {
    p = trovaPerId_(id);
    if (p.stato === 'CONCLUSA' || p.rendicontato) {
      throw new Error('Il volo del ' + itDate_(p.data) + ' e\' gia\' rendicontato: non puo\' essere rimosso dall\'app.');
    }
    if (STATI_BLOCCANTI.indexOf(p.stato) === -1) throw new Error('Giorno gia\' libero.');
    var sh = foglio_(FOGLI.PREN);
    sh.getRange(p.riga, COL.STATO).setValue(p.tipo === 'ASSEGNAZIONE' ? 'RILASCIATA' : 'ANNULLATA');
    sh.getRange(p.riga, COL.MODIFICATO).setValue(new Date());
    // Chi rimuove la prenotazione di un altro lascia il proprio nome nelle note.
    if (p.email !== utente.email) {
      sh.getRange(p.riga, COL.NOTE).setValue(
        (p.note ? p.note + ' — ' : '') + 'rimossa da ' + utente.nome + ' il ' + itDate_(oggi_()));
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  notifica_('rimozione', utente, p, [p.email]);
  return statoCompleto_(utente);
}

/**
 * Sostituisce il titolare di un giorno (o ne aggiorna le note).
 * Tutte le righe attive di quel giorno passano a SOSTITUITA e ne viene
 * creata una nuova. Anche le assegnazioni annuali possono essere sovrascritte:
 * l'interfaccia chiede una conferma esplicita e piu' severa.
 * payload = { data, email (nuovo titolare, default: chi opera), note }
 */
function sovrascriviGiorno(auth, payload) {
  var utente = risolviUtente_(auth);
  var data = parseData_(payload.data);
  validaData_(data);

  var titolare = payload.email ? trovaUtente_(payload.email) : utente;
  if (!titolare) throw new Error('Socio non riconosciuto.');

  var precedenti = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema occupato, riprova tra qualche secondo.');
  try {
    var tutte = leggiPrenotazioni_();
    var occupanti = occupantiDelGiorno_(data, tutte);
    var sh = foglio_(FOGLI.PREN);

    occupanti.forEach(function (p) {
      if (p.stato === 'CONCLUSA' || p.rendicontato) {
        throw new Error('Il volo del ' + itDate_(p.data) + ' e\' gia\' rendicontato: non si puo\' sovrascrivere.');
      }
      precedenti.push(p);
      sh.getRange(p.riga, COL.STATO).setValue('SOSTITUITA');
      sh.getRange(p.riga, COL.MODIFICATO).setValue(new Date());
      sh.getRange(p.riga, COL.NOTE).setValue(
        (p.note ? p.note + ' — ' : '') + 'sostituita da ' + utente.nome + ' il ' + itDate_(oggi_()));
    });

    scriviNuovaPrenotazione_(data, titolare, payload.note, utente);
  } finally {
    lock.releaseLock();
  }

  // Avvisa sia il nuovo titolare sia chi e' stato sostituito.
  var interessati = [titolare.email].concat(precedenti.map(function (p) { return p.email; }));
  notifica_('sovrascrittura', utente, {
    data: data,
    nome: titolare.nome,
    note: payload.note,
    precedente: precedenti.length ? (precedenti[0].nome || precedenti[0].email) : ''
  }, interessati);

  return statoCompleto_(utente);
}

/**
 * Rendiconto del volo: quattro dati richiesti, durata calcolata dal server.
 * payload = { id, icaoDecollo, icaoAtterraggio, oraDecollo:'HH:MM', oraAtterraggio:'HH:MM' }
 * Compilabile in qualunque momento del giorno stesso del volo o nei giorni
 * successivi; mai per una data futura.
 * Gli orari arrivano dall'app gia' in UTC (vedi CONFIG.ORARI_UTC) e vengono
 * scritti nel foglio cosi' come sono: la durata e' una semplice differenza,
 * quindi non c'e' nessun fuso di mezzo.
 */
function salvaVolo(auth, payload) {
  var utente = risolviUtente_(auth);

  // --- validazione dei quattro campi ---
  var dep = validaIcao_(payload.icaoDecollo, 'ICAO decollo');
  var arr = validaIcao_(payload.icaoAtterraggio, 'ICAO atterraggio');
  var tDec = parseOra_(payload.oraDecollo);
  var tAtt = parseOra_(payload.oraAtterraggio);
  if (tDec === null) throw new Error('Ora di decollo non valida (formato HH:MM).');
  if (tAtt === null) throw new Error('Ora di atterraggio non valida (formato HH:MM).');
  if (tAtt <= tDec) throw new Error('L\'ora di atterraggio deve essere successiva a quella di decollo.');

  var durata = tAtt - tDec;                 // minuti di volo
  var durataHHMM = formattaOra_(durata);    // stessa durata in hh:mm

  var p;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema occupato, riprova tra qualche secondo.');
  try {
    p = trovaPerId_(payload.id);
    if (p.email !== utente.email && utente.ruolo !== 'admin') {
      throw new Error('Puoi rendicontare solo i tuoi voli.');
    }
    if (p.rendicontato || p.stato === 'CONCLUSA') throw new Error('Volo gia\' rendicontato.');
    if (p.data > oggi_()) throw new Error('Il rendiconto si compila dal giorno del volo in poi.');

    // Riga nel registro voli, nello stesso ordine di HEADER_VOLI.
    foglio_(FOGLI.VOLI).appendRow([
      new Date(), p.id, p.data, p.email, p.nome,
      dep, arr, formattaOra_(tDec), formattaOra_(tAtt), durataHHMM, durata
    ]);

    // La prenotazione passa a CONCLUSA: il giorno resta occupato nello storico.
    var sh = foglio_(FOGLI.PREN);
    sh.getRange(p.riga, COL.STATO).setValue('CONCLUSA');
    sh.getRange(p.riga, COL.RENDICONTATO).setValue(new Date());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  notificaVolo_(utente, p, dep, arr, formattaOra_(tDec), formattaOra_(tAtt), durataHHMM);
  return statoCompleto_(utente);
}

/**
 * Volo su un giorno PASSATO che non era stato prenotato: si registra tutto in
 * una volta, senza passare dalla prenotazione. Nasce una riga in "Prenotazioni"
 * di Tipo RETROATTIVA e stato CONCLUSA (cosi' il giorno resta occupato nello
 * storico e compare con la spunta nel calendario) e la riga del volo in "Voli".
 *
 * payload = { data, email (pilota, default: chi opera), note,
 *             icaoDecollo, icaoAtterraggio, oraDecollo:'HH:MM', oraAtterraggio:'HH:MM' }
 * Come nel rendiconto normale, gli orari sono in UTC e non vengono convertiti.
 */
function registraVoloPassato(auth, payload) {
  var utente = risolviUtente_(auth);
  var data = parseData_(payload.data);
  if (!data) throw new Error('Data non indicata.');
  if (data > oggi_()) {
    throw new Error('Il ' + itDate_(data) + ' e\' nel futuro: usa la prenotazione, non la registrazione del volo.');
  }

  // Si registra per se' o per un altro socio (per le dimenticanze altrui).
  var titolare = payload.email ? trovaUtente_(payload.email) : utente;
  if (!titolare) throw new Error('Socio non riconosciuto.');

  // Stessi quattro campi del rendiconto normale, stesse regole.
  var dep = validaIcao_(payload.icaoDecollo, 'ICAO decollo');
  var arr = validaIcao_(payload.icaoAtterraggio, 'ICAO atterraggio');
  var tDec = parseOra_(payload.oraDecollo);
  var tAtt = parseOra_(payload.oraAtterraggio);
  if (tDec === null) throw new Error('Ora di decollo non valida (formato HH:MM).');
  if (tAtt === null) throw new Error('Ora di atterraggio non valida (formato HH:MM).');
  if (tAtt <= tDec) throw new Error('L\'ora di atterraggio deve essere successiva a quella di decollo.');

  var durata = tAtt - tDec;
  var durataHHMM = formattaOra_(durata);
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema occupato, riprova tra qualche secondo.');
  try {
    // Il controllo guarda TUTTE le prenotazioni, anche quelle piu' vecchie della
    // finestra visibile in app: se il giorno risulta assegnato si passa dal
    // rendiconto normale, non da qui.
    var occupanti = occupantiDelGiorno_(data);
    if (occupanti.length) {
      var o = occupanti[0];
      throw new Error('Il ' + itDate_(data) + ' risulta gia\' assegnato a ' + (o.nome || o.email) +
        (o.rendicontato ? ' con volo gia\' registrato.' : ': apri il giorno e compila il rendiconto.'));
    }

    var ora = new Date();
    var nota = String(payload.note || '').substring(0, 500);
    nota = (nota ? nota + ' — ' : '') + 'volo registrato a posteriori il ' + itDate_(oggi_());
    if (utente.email !== titolare.email) nota += ' da ' + utente.nome;

    // Giorno e volo nascono insieme: il giorno e' subito CONCLUSA e rendicontato.
    foglio_(FOGLI.PREN).appendRow([
      id, 'RETROATTIVA', data, titolare.email, titolare.nome, 'CONCLUSA', nota, ora, ora, ora
    ]);
    foglio_(FOGLI.VOLI).appendRow([
      ora, id, data, titolare.email, titolare.nome,
      dep, arr, formattaOra_(tDec), formattaOra_(tAtt), durataHHMM, durata
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  notificaVolo_(utente, { data: data, nome: titolare.nome, email: titolare.email },
                dep, arr, formattaOra_(tDec), formattaOra_(tAtt), durataHHMM);
  return statoCompleto_(utente);
}

/* ================================ NOTIFICHE =============================== */

function urlApp_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/**
 * Email agli altri soci. 'interessati' e' l'elenco di chi va avvisato in ogni
 * caso (nuovo titolare, socio sostituito), anche se coincide con l'autore.
 */
function notifica_(azione, autore, p, interessati) {
  if (!CONFIG.NOTIFICA_EMAIL) return;
  try {
    var soci = leggiUtenti_().filter(function (u) { return u.attivo; }).map(function (u) { return u.email; });
    var dest = soci.filter(function (em) {
      return em !== autore.email || (interessati || []).indexOf(em) > -1;
    });
    if (!dest.length) return;

    var titoli = {
      nuova: 'Giorno prenotato',
      rimozione: 'Prenotazione rimossa',
      sovrascrittura: 'Prenotazione sovrascritta'
    };
    var testa = titoli[azione] || 'Aggiornamento';
    var corpo = testa + ' — ' + itDate_(p.data) + '\n\n' +
      'Operazione eseguita da: ' + autore.nome + ' (' + autore.email + ')\n' +
      (azione === 'rimozione'
        ? 'Giorno liberato (era di ' + (p.nome || p.email) + ').\n'
        : 'Titolare: ' + (p.nome || p.email) + '\n') +
      (p.precedente ? 'Al posto di: ' + p.precedente + '\n' : '') +
      (p.note ? 'Note: ' + p.note + '\n' : '') +
      (urlApp_() ? '\nCalendario: ' + urlApp_() + '\n' : '');

    MailApp.sendEmail(dest.join(','), '[' + CONFIG.NOME_BENE + '] ' + testa + ' ' + itDate_(p.data), corpo);
  } catch (err) {
    // Una notifica non inviata non deve far fallire l'operazione principale.
    console.warn('Notifica non inviata: ' + err.message);
  }
}

function notificaVolo_(autore, p, dep, arr, oraDec, oraAtt, durata) {
  if (!CONFIG.NOTIFICA_EMAIL) return;
  try {
    var dest = leggiUtenti_().filter(function (u) { return u.attivo; }).map(function (u) { return u.email; });
    MailApp.sendEmail(dest.join(','),
      '[' + CONFIG.NOME_BENE + '] Volo del ' + itDate_(p.data) + ' — ' + durata,
      'Pilota: ' + (p.nome || p.email) + '\n' +
      'Tratta: ' + dep + ' → ' + arr + '\n' +
      'Decollo: ' + oraDec + utc_suffisso_() + '   Atterraggio: ' + oraAtt + utc_suffisso_() + '\n' +
      'Durata: ' + durata + ' (hh:mm)\n' +
      (urlApp_() ? '\nRegistro: ' + urlApp_() + '\n' : ''));
  } catch (err) {
    console.warn('Notifica volo non inviata: ' + err.message);
  }
}

/* ======================= PROMEMORIA (trigger opzionale) =================== */

/**
 * Da collegare a un trigger giornaliero serale (Attivatori > Aggiungi
 * attivatore > promemoriaRendiconti, Timer giornaliero, fascia 20:00-21:00).
 * Ricorda di compilare il rendiconto per i giorni prenotati di oggi e di ieri
 * ancora in sospeso.
 */
function promemoriaRendiconti() {
  var oggi = oggi_();
  var ieri = addGiorni_(oggi, -1);
  var utenti = leggiUtenti_();

  leggiPrenotazioni_().forEach(function (p) {
    if (p.stato !== 'ATTIVA' || p.rendicontato) return;
    if (p.data !== oggi && p.data !== ieri) return;
    var u = utenti.filter(function (x) { return x.email === p.email; })[0];
    if (!u) return;
    try {
      MailApp.sendEmail(u.email,
        '[' + CONFIG.NOME_BENE + '] Registra il volo del ' + itDate_(p.data),
        'Ciao ' + u.nome + ',\n\nrisulta prenotato il ' + itDate_(p.data) +
        ' senza rendiconto.\nInserisci decollo, atterraggio e orari' +
        (CONFIG.ORARI_UTC ? ' (in UTC)' : '') + ' qui:\n' + urlApp_() +
        '\n\n(Se non hai volato, rimuovi la prenotazione dal calendario.)\n');
    } catch (err) {
      console.warn(err.message);
    }
  });
}
