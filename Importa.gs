/*******************************************************************************
 * IMPORTAZIONE STORICO VOLI — modulo aggiuntivo
 * -----------------------------------------------------------------------------
 * Terzo file del progetto Apps Script (Nuovo > Script, nome "Importa").
 * Richiede "Codice.gs" nello stesso progetto: ne riusa CONFIG, FOGLI, COL,
 * parseData_(), leggiUtenti_(), foglio_(), itDate_().
 *
 * COME SI USA
 *   1) Menu Aliante > "Crea foglio Import storico": nasce il foglio "Import".
 *   2) Incolla i dati storici, una riga per volo, senza preoccuparti del
 *      formato degli orari: "10.35.12", "10.35", "10:35:12" vanno tutti bene.
 *   3) Menu Aliante > "Importa storico voli".
 *      Ogni riga viene scritta in "Voli" con la durata calcolata e nella
 *      colonna "Esito" compare OK oppure il motivo dello scarto.
 *   4) Le righe con esito OK vengono ignorate se rilanci l'importazione,
 *      quindi puoi correggere gli errori e ripetere senza creare duplicati.
 ******************************************************************************/

/* ============================ CONFIGURAZIONE ============================== */

var FOGLIO_IMPORT = 'Import';

var HEADER_IMPORT = ['Data volo', 'Pilota (email o nome)', 'ICAO decollo',
                     'ICAO atterraggio', 'Ora decollo', 'Ora atterraggio', 'Esito'];

/**
 * false = importa solo i voli nel foglio "Voli" (scelta consigliata).
 * true  = crea anche, per ogni volo, la prenotazione corrispondente nel foglio
 *         "Prenotazioni" con stato CONCLUSA, cosi' i giorni passati appaiono
 *         colorati nel calendario. Utile solo per lo storico recente.
 */
var IMPORT_CREA_PRENOTAZIONI = false;

/** true = tiene i secondi negli orari importati; false = arrotonda al minuto. */
var IMPORT_TIENI_SECONDI = true;

/* ========================= FOGLIO DI APPOGGIO ============================= */

function creaFoglioImport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(FOGLIO_IMPORT);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_IMPORT);
    sh.appendRow(HEADER_IMPORT);
    // Riga di esempio, da sovrascrivere con i dati veri.
    sh.appendRow(['2025-04-19', 'anna@gmail.com', 'LIMA', 'LIMA', '10.35.12', '13.07.48', '']);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADER_IMPORT.length).setFontWeight('bold');
  // Tutto testo: evita che Sheets reinterpreti date e orari durante l'incolla.
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 6).setNumberFormat('@');
  sh.activate();

  SpreadsheetApp.getUi().alert(
    'Foglio "Import" pronto.\n\n' +
    'Incolla una riga per volo. La data accetta 2025-04-19 o 19/04/2025.\n' +
    'Il pilota puo\' essere l\'email oppure il nome come scritto nel foglio "Utenti".\n' +
    'Gli orari accettano hh.mm.ss, hh.mm, hh:mm:ss, hh:mm.\n' +
    'Poi: Aliante > Importa storico voli.');
}

/* ============================ ORARI E DURATE ============================== */

/**
 * Normalizza un orario in SECONDI dalla mezzanotte, accettando i formati che
 * si trovano di solito negli storici.
 *   - testo   'hh.mm.ss' / 'hh.mm' / 'hh:mm:ss' / 'hh:mm' / con virgola
 *   - Date    (celle che Sheets ha interpretato come ora)
 *   - numero  frazione di giorno (0,4411) oppure decimale tipo 10.35 = 10h35m
 * Restituisce null se non interpretabile.
 */
function parseOrarioStorico_(v) {
  if (v === '' || v === null || v === undefined) return null;

  // Cella riconosciuta da Sheets come data/ora
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
  }

  if (typeof v === 'number') {
    // Frazione di giorno: 0,5 = 12:00:00
    if (v > 0 && v < 1) return Math.round(v * 86400);
    // Decimale "ore.minuti": 10.35 -> 10:35:00 (i secondi non ci sono piu')
    var h = Math.floor(v), mi = Math.round((v - h) * 100);
    if (h > 23 || mi > 59) return null;
    return h * 3600 + mi * 60;
  }

  var s = String(v).trim().replace(/,/g, '.');
  // Un solo pattern per tutti i separatori: punto o due punti, secondi opzionali
  var m = s.match(/^(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?$/);
  if (!m) return null;
  var hh = +m[1], mm = +m[2], ss = m[3] ? +m[3] : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

/** secondi -> 'HH:MM:SS' oppure 'HH:MM' secondo IMPORT_TIENI_SECONDI */
function formattaOrarioStorico_(sec) {
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return IMPORT_TIENI_SECONDI
    ? pad2_(h) + ':' + pad2_(m) + ':' + pad2_(s)
    : pad2_(h) + ':' + pad2_(m);
}

/**
 * Durata fra due orari espressi in secondi.
 * I minuti sono arrotondati al minuto piu' vicino e hh:mm deriva dallo stesso
 * numero arrotondato, cosi' le due colonne sono sempre coerenti fra loro.
 */
function calcolaDurata_(secDec, secAtt) {
  var minuti = Math.round((secAtt - secDec) / 60);
  return { minuti: minuti, hhmm: pad2_(Math.floor(minuti / 60)) + ':' + pad2_(minuti % 60) };
}

/* ============================== ANAGRAFICA ================================ */

/** Accetta email oppure nome (anche solo il nome di battesimo) e trova il socio. */
function risolviPilota_(valore) {
  var v = String(valore || '').trim().toLowerCase();
  if (!v) return null;
  var utenti = leggiUtenti_();
  var trovato = utenti.filter(function (u) { return u.email === v; })[0];
  if (trovato) return trovato;
  trovato = utenti.filter(function (u) { return u.nome.toLowerCase() === v; })[0];
  if (trovato) return trovato;
  // Ultimo tentativo: confronto sul solo nome di battesimo, se non e' ambiguo
  var candidati = utenti.filter(function (u) { return u.nome.toLowerCase().split(' ')[0] === v; });
  return candidati.length === 1 ? candidati[0] : null;
}

/** Nome colonna -> indice (base 0), per scrivere senza dipendere dall'ordine. */
function mappaHeader_(sh) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v).trim(); });
  var map = {};
  header.forEach(function (h, i) { map[h] = i; });
  return { map: map, larghezza: header.length };
}

/** Garantisce la presenza della colonna "Origine" in "Voli" per tracciare l'import. */
function assicuraColonnaOrigine_(sh) {
  var h = mappaHeader_(sh);
  if (h.map['Origine'] === undefined) {
    sh.getRange(1, h.larghezza + 1).setValue('Origine').setFontWeight('bold');
  }
  return mappaHeader_(sh);
}

/* ============================ IMPORTAZIONE ================================ */

function importaStoricoVoli() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var imp = ss.getSheetByName(FOGLIO_IMPORT);
  if (!imp || imp.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Foglio "Import" vuoto o assente. Usa prima "Crea foglio Import storico".');
    return;
  }

  var voli = foglio_(FOGLI.VOLI);
  var h = assicuraColonnaOrigine_(voli);
  var iOrigine = h.map['Origine'];

  // Chiavi dei voli gia' presenti (data + ora decollo al minuto + email):
  // serve per poter rilanciare l'import senza duplicare nulla.
  var esistenti = {};
  if (voli.getLastRow() > 1) {
    voli.getRange(2, 1, voli.getLastRow() - 1, voli.getLastColumn()).getValues().forEach(function (r) {
      var k = parseData_(r[h.map['Data volo']]) + '|' +
              String(r[h.map['Ora decollo']]).trim().substring(0, 5) + '|' +
              String(r[h.map['Email']]).trim().toLowerCase();
      esistenti[k] = true;
    });
  }

  var dati = imp.getRange(2, 1, imp.getLastRow() - 1, HEADER_IMPORT.length).getValues();
  var nuoveRighe = [];      // righe da scrivere in "Voli"
  var nuovePren = [];       // righe da scrivere in "Prenotazioni" (opzionale)
  var esiti = [];           // colonna Esito, una per riga di input
  var ok = 0, saltate = 0, errori = 0;
  var icaoIgnoti = {};
  var elencoIcao = {};
  leggiAeroporti_().forEach(function (a) { elencoIcao[a.icao] = true; });
  var adesso = new Date();

  dati.forEach(function (r) {
    // Riga completamente vuota: si tiene l'esito vuoto e si passa avanti.
    if (String(r.join('')).trim() === '') { esiti.push(['']); return; }
    // Riga gia' importata in una passata precedente.
    if (String(r[6]).trim().toUpperCase().indexOf('OK') === 0) { esiti.push([r[6]]); saltate++; return; }

    var data = parseData_(r[0]);
    if (!data) { esiti.push(['ERRORE: data non valida']); errori++; return; }

    var pilota = risolviPilota_(r[1]);
    if (!pilota) { esiti.push(['ERRORE: pilota non trovato in "Utenti"']); errori++; return; }

    var dep = String(r[2] || CONFIG.ICAO_DEFAULT).trim().toUpperCase();
    var arr = String(r[3] || CONFIG.ICAO_DEFAULT).trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(dep) || !/^[A-Z]{4}$/.test(arr)) {
      esiti.push(['ERRORE: codice ICAO non valido']); errori++; return;
    }
    if (!elencoIcao[dep]) icaoIgnoti[dep] = true;
    if (!elencoIcao[arr]) icaoIgnoti[arr] = true;

    var secDec = parseOrarioStorico_(r[4]);
    var secAtt = parseOrarioStorico_(r[5]);
    if (secDec === null) { esiti.push(['ERRORE: ora decollo non interpretabile']); errori++; return; }
    if (secAtt === null) { esiti.push(['ERRORE: ora atterraggio non interpretabile']); errori++; return; }
    if (secAtt <= secDec) { esiti.push(['ERRORE: atterraggio non successivo al decollo']); errori++; return; }

    var oraDec = formattaOrarioStorico_(secDec);
    var chiave = data + '|' + oraDec.substring(0, 5) + '|' + pilota.email;
    if (esistenti[chiave]) { esiti.push(['OK (era gia\' presente)']); saltate++; return; }
    esistenti[chiave] = true;

    var d = calcolaDurata_(secDec, secAtt);

    // Riga per "Voli", costruita seguendo la mappa delle intestazioni.
    var riga = new Array(Math.max(h.larghezza, HEADER_VOLI.length + 1)).fill('');
    riga[h.map['Timestamp']] = adesso;
    riga[h.map['ID Prenotazione']] = '';   // storico senza prenotazione collegata
    riga[h.map['Data volo']] = data;
    riga[h.map['Email']] = pilota.email;
    riga[h.map['Pilota']] = pilota.nome;
    riga[h.map['ICAO decollo']] = dep;
    riga[h.map['ICAO atterraggio']] = arr;
    riga[h.map['Ora decollo']] = oraDec;
    riga[h.map['Ora atterraggio']] = formattaOrarioStorico_(secAtt);
    riga[h.map['Durata (hh:mm)']] = d.hhmm;
    riga[h.map['Durata (minuti)']] = d.minuti;
    if (iOrigine !== undefined) riga[iOrigine] = 'STORICO';

    // Prenotazione corrispondente, solo se richiesto dall'interruttore.
    if (IMPORT_CREA_PRENOTAZIONI) {
      var id = Utilities.getUuid().substring(0, 8).toUpperCase();
      riga[h.map['ID Prenotazione']] = id;
      nuovePren.push([id, 'PRENOTAZIONE', data, pilota.email, pilota.nome,
                      'CONCLUSA', 'storico importato', adesso, adesso, adesso]);
    }

    nuoveRighe.push(riga);
    esiti.push(['OK ' + d.hhmm]);
    ok++;
  });

  // Scritture in blocco: una sola chiamata per foglio, molto piu' rapida.
  if (nuoveRighe.length) {
    voli.getRange(voli.getLastRow() + 1, 1, nuoveRighe.length, nuoveRighe[0].length).setValues(nuoveRighe);
  }
  if (nuovePren.length) {
    var pren = foglio_(FOGLI.PREN);
    pren.getRange(pren.getLastRow() + 1, 1, nuovePren.length, nuovePren[0].length).setValues(nuovePren);
  }
  if (esiti.length) {
    imp.getRange(2, 7, esiti.length, 1).setValues(esiti);
  }
  SpreadsheetApp.flush();

  var ignoti = Object.keys(icaoIgnoti);
  SpreadsheetApp.getUi().alert(
    'Importazione completata.\n\n' +
    'Voli importati: ' + ok + '\n' +
    'Righe saltate (gia\' presenti): ' + saltate + '\n' +
    'Righe con errore: ' + errori + (errori ? '  → vedi colonna "Esito"' : '') + '\n' +
    (nuovePren.length ? 'Prenotazioni storiche create: ' + nuovePren.length + '\n' : '') +
    (ignoti.length ? '\nICAO non presenti nel foglio "Aeroporti": ' + ignoti.join(', ') +
                     '\n(importati comunque; aggiungili se li usi spesso)' : ''));
}

/* ============================ VERIFICA RAPIDA ============================= */

/**
 * Utile prima di importare: mostra nel log come vengono interpretati alcuni
 * orari di esempio. Esegui questa funzione e apri Visualizza > Log.
 */
function provaInterpretazioneOrari() {
  ['10.35.12', '10.35', '9.7.3', '10:35:12', '0,4411', '24.00', 'pippo'].forEach(function (v) {
    var s = parseOrarioStorico_(v);
    console.log(v + '  ->  ' + (s === null ? 'NON INTERPRETABILE' : formattaOrarioStorico_(s)));
  });
}
