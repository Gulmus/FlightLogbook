/*******************************************************************************
 * IMPORTAZIONE VOLI DA WEGLIDE
 * -----------------------------------------------------------------------------
 * Terzo file di script del progetto legato al TUO foglio del logbook
 * (va insieme a LogbookPersonale.gs e WebLogbook.gs, di cui riusa
 * configurazione e utility). Se questo file non c'e', tutto il resto continua a
 * funzionare: la web app si accorge della sua assenza e nasconde il riquadro.
 *
 * COME FUNZIONA (sistema PULL, nessun polling)
 *   WeGlide non puo' avvisare da solo: gli accessi OAuth sono riservati alle
 *   applicazioni con almeno mille utenti, e la chiave personale ha un tetto di
 *   60 richieste al giorno. Quindi siamo noi a chiedere, e solo quando serve:
 *     1) "Cerca voli su WeGlide" scarica l'elenco dei tuoi ultimi voli
 *        (UNA richiesta, poi per mezz'ora vale la copia in cache);
 *     2) tocchi il volo che ti interessa e lo script scarica il dettaglio
 *        (UNA richiesta) per avere marche e aeroporto di atterraggio;
 *     3) il modulo del logbook si PRECOMPILA, non salva niente da solo.
 *        Gli orari arrivano dall'IGC e sono in UTC: quasi sempre differiscono
 *        di qualche minuto da quelli comunicati dall'ATC, percio' restano
 *        modificabili fino alla conferma. Il salvataggio e' il solito.
 *   La quota di sgancio NON viene proposta: il dato WeGlide (launch_gain) e'
 *   un guadagno di quota ricavato dalla traccia, non la quota di sgancio.
 *
 * COSA SERVE
 *   - il tuo Pilot ID WeGlide (si legge nell'URL del tuo profilo);
 *   - facoltativa ma consigliata, una API key: Profile > Settings > Advanced >
 *     API Key. Si incolla da menu (Logbook > WeGlide > Imposta credenziali) e
 *     finisce nelle proprieta' dello script, non nel codice.
 *   Entrambe si impostano da menu: qui sotto non va scritto nulla.
 *
 * AVVERTENZA
 *   L'API WeGlide e' dichiarata "not finalized": i nomi dei campi che usiamo
 *   sono raccolti nel blocco WG_F, cosi' se cambiano si correggono in un punto
 *   solo senza rileggere tutto il file.
 ******************************************************************************/

/* ============================ CONFIGURAZIONE ============================== */

var WG_CONFIG = {
  BASE: 'https://api.weglide.org/v1',

  /**
   * Pilot ID. Normalmente si imposta da menu (finisce nelle proprieta' dello
   * script); se preferisci tenerlo nel codice scrivilo qui e il menu non serve.
   */
  PILOT_ID: 31818,

  VOLI_DA_LEGGERE: 25,        // quanti voli chiedere nell'elenco (1 richiesta)
  GIORNI_INDIETRO: 180,       // voli piu' vecchi di cosi' non vengono proposti
  CACHE_MINUTI: 30,           // per mezz'ora l'elenco non viene richiesto di nuovo

  /**
   * Tetto di sicurezza sulle richieste giornaliere. WeGlide ne concede 60 al
   * giorno per chiave: restare sotto evita di trovarsi bloccati a meta' lavoro.
   */
  MAX_RICHIESTE_GIORNO: 45,

  MAX_IMPORT_PER_VOLTA: 8,    // voli importabili in un colpo dal menu del foglio

  // Nomi delle proprieta' di script (non modificare senza motivo)
  PROP_CHIAVE: 'WEGLIDE_API_KEY',
  PROP_PILOTA: 'WEGLIDE_PILOT_ID',
  PROP_CONTATORE: 'WEGLIDE_RICHIESTE'
};

/**
 * Nomi dei campi restituiti dall'API, tutti in un punto solo perche' l'API e'
 * ancora in evoluzione. A sinistra il nome che usiamo nel codice, a destra
 * quello di WeGlide.
 */
var WG_F = {
  ID: 'id',
  DATA: 'scoring_date',
  DECOLLO: 'takeoff_time',
  ATTERRAGGIO: 'landing_time',
  AP_DECOLLO: 'takeoff_airport',
  AP_ATTERRAGGIO: 'landing_airport',
  AP_NOME: 'name',
  AEREO: 'aircraft',
  AEREO_NOME: 'name',
  AEREO_BIPOSTO: 'double_seater',
  REGISTRAZIONE: 'registration',
  CONTEST: 'contest',
  DISTANZA: 'distance',
  UTENTE: 'user',
  NOME: 'name'
};

/* ===================== FOGLI DI SERVIZIO DELL'IMPORT ====================== */

var WG_FOGLI = { AEROPORTI: 'WeGlide aeroporti' };

/**
 * Tabella di conversione degli aeroporti. WeGlide identifica i campi con un
 * numero e un nome esteso ("Torino Aeritalia") e non espone da nessuna parte il
 * codice ICAO: la corrispondenza la teniamo noi. Le righe nascono da sole al
 * primo volo su un campo nuovo, con l'ICAO da completare a mano una volta sola.
 */
var WG_HEADER_AEROPORTI = ['ID WeGlide', 'Nome WeGlide', 'ICAO', 'Visto il'];

/* ============================== CREDENZIALI =============================== */

function wgProp_() { return PropertiesService.getScriptProperties(); }

function wgChiave_() {
  return String(wgProp_().getProperty(WG_CONFIG.PROP_CHIAVE) || '').trim();
}

function wgPilotId_() {
  var id = Number(WG_CONFIG.PILOT_ID) || Number(wgProp_().getProperty(WG_CONFIG.PROP_PILOTA)) || 0;
  if (!id) {
    throw new Error('Manca il Pilot ID WeGlide: Logbook > WeGlide > Imposta credenziali.');
  }
  return id;
}

/** Voce di menu: chiede Pilot ID e API key e li mette nelle proprieta'. */
function wgImpostaCredenziali() {
  var ui = SpreadsheetApp.getUi();

  var r1 = ui.prompt('WeGlide — Pilot ID',
    'Il numero che compare nell\'URL del tuo profilo WeGlide\n' +
    '(https://weglide.org/user/  QUESTO_NUMERO ).\n\n' +
    'Attuale: ' + (wgProp_().getProperty(WG_CONFIG.PROP_PILOTA) || '(non impostato)'),
    ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var id = String(r1.getResponseText()).replace(/[^0-9]/g, '');
  if (!id) { ui.alert('Pilot ID non valido: serve un numero.'); return; }

  var r2 = ui.prompt('WeGlide — API key',
    'Profile > Settings > Advanced > API Key (massimo due chiavi per account).\n' +
    'Puoi lasciare vuoto: i dati dei voli pubblici si leggono anche senza chiave,\n' +
    'ma con la chiave le richieste sono attribuite a te.\n\n' +
    'Attuale: ' + (wgChiave_() ? '(impostata, verra\' sostituita se scrivi qualcosa)' : '(nessuna)'),
    ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;

  wgProp_().setProperty(WG_CONFIG.PROP_PILOTA, id);
  var k = String(r2.getResponseText()).trim();
  if (k) wgProp_().setProperty(WG_CONFIG.PROP_CHIAVE, k);

  ui.alert('Credenziali salvate.\n\nPilot ID: ' + id +
           '\nAPI key: ' + (wgChiave_() ? 'presente' : 'assente') +
           '\n\nProva con Logbook > WeGlide > Prova collegamento.');
}

function wgCancellaCredenziali() {
  wgProp_().deleteProperty(WG_CONFIG.PROP_CHIAVE);
  wgProp_().deleteProperty(WG_CONFIG.PROP_PILOTA);
  lAvvisa_('Credenziali WeGlide rimosse dalle proprieta\' dello script.');
}

/* ========================= BUDGET DELLE RICHIESTE ======================== */

/** Stato del contatore giornaliero, senza consumare nulla. */
function wgBudget_() {
  var raw = String(wgProp_().getProperty(WG_CONFIG.PROP_CONTATORE) || '').split('|');
  var oggi = lOggi_();
  var usate = (raw[0] === oggi) ? (Number(raw[1]) || 0) : 0;
  return {
    giorno: oggi,
    usate: usate,
    massimo: WG_CONFIG.MAX_RICHIESTE_GIORNO,
    restanti: Math.max(0, WG_CONFIG.MAX_RICHIESTE_GIORNO - usate)
  };
}

/**
 * Prenota n richieste. Conta anche quelle finite in errore, perche' per WeGlide
 * sono comunque richieste fatte. Il contatore si azzera col cambio di giorno
 * (ora locale: WeGlide usa UTC, il margine di 15 richieste copre la differenza).
 */
function wgConsuma_(n) {
  var b = wgBudget_();
  if (b.usate + n > b.massimo) {
    throw new Error('Tetto giornaliero di richieste WeGlide raggiunto (' + b.usate + '/' + b.massimo +
      '). Riprova domani, oppure alza WG_CONFIG.MAX_RICHIESTE_GIORNO (il limite vero e\' 60).');
  }
  wgProp_().setProperty(WG_CONFIG.PROP_CONTATORE, b.giorno + '|' + (b.usate + n));
}

/* ============================== CLIENT HTTP =============================== */

function wgQuery_(par) {
  if (!par) return '';
  var pezzi = [];
  Object.keys(par).forEach(function (k) {
    if (par[k] === '' || par[k] === null || par[k] === undefined) return;
    pezzi.push(encodeURIComponent(k) + '=' + encodeURIComponent(par[k]));
  });
  return pezzi.length ? '?' + pezzi.join('&') : '';
}

/**
 * Una chiamata GET all'API. Gli errori diventano messaggi in italiano, perche'
 * finiscono sotto gli occhi dell'utente nella web app.
 */
function wgGet_(percorso, parametri) {
  wgConsuma_(1);
  var url = WG_CONFIG.BASE + percorso + wgQuery_(parametri);
  var opzioni = {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'Accept': 'application/json' }
  };
  var k = wgChiave_();
  if (k) opzioni.headers['X-API-Key'] = k;

  var risposta;
  try {
    risposta = UrlFetchApp.fetch(url, opzioni);
  } catch (err) {
    throw new Error('WeGlide non raggiungibile: ' + err.message);
  }

  var codice = risposta.getResponseCode();
  var testo = risposta.getContentText();

  if (codice === 200) {
    try {
      return JSON.parse(testo);
    } catch (err) {
      throw new Error('Risposta WeGlide non interpretabile (non e\' JSON).');
    }
  }
  if (codice === 401 || codice === 403) {
    throw new Error('WeGlide ha rifiutato la richiesta (' + codice + '): controlla la API key ' +
      'in Logbook > WeGlide > Imposta credenziali. Alcune funzioni sono riservate agli abbonati.');
  }
  if (codice === 404) throw new Error('Volo o risorsa non trovata su WeGlide.');
  if (codice === 429) throw new Error('Troppe richieste a WeGlide (limite 60 al giorno): riprova domani.');
  throw new Error('WeGlide ha risposto ' + codice + '. ' + String(testo).substring(0, 200));
}

/* ========================= UTILITY DI CONVERSIONE ======================== */

/**
 * Le date/ora WeGlide arrivano come '2026-06-14T09:32:00+00:00'. Se manca il
 * fuso le trattiamo come UTC (e' quello che WeGlide manda) invece di lasciare
 * che Apps Script le interpreti nell'ora di Roma.
 */
function wgData_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (s.indexOf('T') > -1 && !/(Z|[+\-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 'HH:MM' in UTC, come sta nella traccia IGC. */
function wgOra_(v) {
  var d = wgData_(v);
  return d ? lPad2_(d.getUTCHours()) + ':' + lPad2_(d.getUTCMinutes()) : '';
}

function wgGiorno_(v) {
  var d = wgData_(v);
  return d ? d.getUTCFullYear() + '-' + lPad2_(d.getUTCMonth() + 1) + '-' + lPad2_(d.getUTCDate()) : '';
}

function wgMinuti_(dec, att) {
  var a = wgData_(dec), b = wgData_(att);
  if (!a || !b) return 0;
  var m = Math.round((b.getTime() - a.getTime()) / 60000);
  return m > 0 ? m : 0;
}

/** I chilometri del volo: oggetto nell'elenco, array nel dettaglio. */
function wgKm_(f) {
  var c = f[WG_F.CONTEST];
  if (!c) return '';
  var d = Array.isArray(c) ? (c.length ? c[0][WG_F.DISTANZA] : null) : c[WG_F.DISTANZA];
  var n = Number(d);
  return (!n || isNaN(n)) ? '' : Math.round(n);
}

/** Confronto tollerante: via spazi, trattini e maiuscole. */
function wgNorm_(s) {
  return String(s === null || s === undefined ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ====================== TABELLA DEGLI AEROPORTI =========================== */

function wgFoglioAeroporti_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(WG_FOGLI.AEROPORTI);
  if (!sh) {
    sh = ss.insertSheet(WG_FOGLI.AEROPORTI);
    sh.appendRow(WG_HEADER_AEROPORTI);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, WG_HEADER_AEROPORTI.length).setFontWeight('bold');
    sh.getRange(2, 3, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    sh.setColumnWidth(2, 220);
  }
  return sh;
}

/** id WeGlide -> { icao, nome, riga } */
function wgLeggiAeroporti_() {
  var sh = wgFoglioAeroporti_();
  var out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, WG_HEADER_AEROPORTI.length).getValues().forEach(function (r, i) {
    var id = String(r[0]).trim();
    if (!id) return;
    out[id] = {
      id: id,
      nome: String(r[1]).trim(),
      icao: String(r[2]).trim().toUpperCase(),
      riga: i + 2
    };
  });
  return out;
}

/**
 * ICAO di un aeroporto WeGlide. Se il campo non e' in tabella lo aggiunge con
 * ICAO vuoto, cosi' basta completarlo una volta e da li' in avanti e' risolto.
 * Restituisce { icao, nuovo, nome }.
 */
function wgIcao_(ap, mappa) {
  if (!ap || !ap[WG_F.ID]) return { icao: '', nuovo: false, nome: '' };
  var id = String(ap[WG_F.ID]);
  var nome = String(ap[WG_F.AP_NOME] || '').trim();
  var riga = mappa[id];

  if (riga) {
    // Il nome puo' essere stato corretto su WeGlide: lo riallineo, e aggiorno
    // la data di ultimo utilizzo solo quando l'ICAO e' ancora da completare.
    if (!riga.icao) {
      var sh = wgFoglioAeroporti_();
      if (nome && nome !== riga.nome) sh.getRange(riga.riga, 2).setValue(nome);
      sh.getRange(riga.riga, 4).setValue(lOggi_());
    }
    return { icao: riga.icao, nuovo: false, nome: riga.nome || nome };
  }

  var sh2 = wgFoglioAeroporti_();
  sh2.appendRow([id, nome, '', lOggi_()]);
  mappa[id] = { id: id, nome: nome, icao: '', riga: sh2.getLastRow() };
  return { icao: '', nuovo: true, nome: nome };
}

/* ========================= RICONOSCIMENTO DEL MEZZO ====================== */

/**
 * Dalle informazioni WeGlide alle marche del foglio "Velivoli".
 * Ordine dei tentativi: registrazione uguale alle marche, colonna
 * "Modello WeGlide", modello dell'anagrafica, modello che inizia allo stesso
 * modo ("DG300 WL" -> "DG300").
 */
function wgMarche_(registrazione, modello, velivoli) {
  var reg = wgNorm_(registrazione), mod = wgNorm_(modello);
  var chiavi = Object.keys(velivoli);
  var i, v;

  if (reg) {
    for (i = 0; i < chiavi.length; i++) {
      if (wgNorm_(chiavi[i]) === reg) return velivoli[chiavi[i]].marche;
    }
  }
  if (mod) {
    for (i = 0; i < chiavi.length; i++) {
      v = velivoli[chiavi[i]];
      if (v.modelloWeglide && wgNorm_(v.modelloWeglide) === mod) return v.marche;
    }
    for (i = 0; i < chiavi.length; i++) {
      v = velivoli[chiavi[i]];
      if (v.modello && wgNorm_(v.modello) === mod) return v.marche;
    }
    for (i = 0; i < chiavi.length; i++) {
      v = velivoli[chiavi[i]];
      var m = wgNorm_(v.modello);
      if (m && m.length >= 4 && mod.indexOf(m) === 0) return v.marche;
    }
  }
  return '';
}

/* =========================== ELENCO DEI VOLI ============================= */

/** Solo i campi che ci servono: cosi' la copia in cache resta piccola. */
function wgCondensa_(f) {
  var ap = f[WG_F.AP_DECOLLO] || {};
  var ae = f[WG_F.AEREO] || {};
  return {
    id: f[WG_F.ID],
    data: lParseData_(f[WG_F.DATA]) || wgGiorno_(f[WG_F.DECOLLO]),
    oraDec: wgOra_(f[WG_F.DECOLLO]),
    oraAtt: wgOra_(f[WG_F.ATTERRAGGIO]),
    minuti: wgMinuti_(f[WG_F.DECOLLO], f[WG_F.ATTERRAGGIO]),
    modello: String(ae[WG_F.AEREO_NOME] || '').trim(),
    idAeroporto: ap[WG_F.ID] ? String(ap[WG_F.ID]) : '',
    aeroporto: String(ap[WG_F.AP_NOME] || '').trim(),
    km: wgKm_(f)
  };
}

/**
 * Elenco condensato degli ultimi voli del pilota. Una richiesta, poi per
 * WG_CONFIG.CACHE_MINUTI vale la copia in cache: aprire e chiudere il riquadro
 * nella web app non consuma budget.
 */
function wgElenco_(forza) {
  var cache = CacheService.getScriptCache();
  var chiave = 'WG_LISTA_' + wgPilotId_() + '_' + WG_CONFIG.VOLI_DA_LEGGERE;

  if (!forza) {
    var salvato = cache.get(chiave);
    if (salvato) {
      try { return { voli: JSON.parse(salvato), daCache: true }; } catch (err) { /* cache illeggibile */ }
    }
  }

  // date_gte / date_lte vengono ignorati dall'API senza segnalarlo: il filtro
  // sulle date si fa qui, dopo aver ricevuto i voli piu' recenti.
  var grezzi = wgGet_('/flight', { user_id_in: wgPilotId_(), limit: WG_CONFIG.VOLI_DA_LEGGERE });
  if (!Array.isArray(grezzi)) throw new Error('Risposta WeGlide inattesa: atteso un elenco di voli.');

  var voli = grezzi.map(wgCondensa_).filter(function (v) { return v.id && v.data; });
  try { cache.put(chiave, JSON.stringify(voli), WG_CONFIG.CACHE_MINUTI * 60); } catch (err) { /* troppo grande: pazienza */ }
  return { voli: voli, daCache: false };
}

/* ======================= API PER LA WEB APP ============================== */

/** Stato sintetico per il riquadro WeGlide della web app. */
function wgStatoPerApp_() {
  var pilota = Number(WG_CONFIG.PILOT_ID) || Number(wgProp_().getProperty(WG_CONFIG.PROP_PILOTA)) || 0;
  return {
    disponibile: true,
    configurato: !!pilota,
    pilotId: pilota,
    conChiave: !!wgChiave_(),
    budget: wgBudget_()
  };
}

/**
 * Elenco dei voli WeGlide da scegliere. Segna quelli gia' presenti nel logbook
 * (per ID WeGlide oppure, per i voli inseriti a mano prima di questa funzione,
 * per data + ora di decollo) cosi' non si importa due volte lo stesso volo.
 */
function wgVoliDaScegliere(forza) {
  var e = wgElenco_(!!forza);
  var limite = logAddGiorni_(lOggi_(), -WG_CONFIG.GIORNI_INDIETRO);

  var giaPresenti = {}, perOrario = {};
  logLeggiVoli_().forEach(function (v) {
    if (v.weglideId) giaPresenti[String(v.weglideId)] = true;
    perOrario[v.data + '|' + String(v.oraDec).substring(0, 5)] = true;
  });

  var voli = e.voli.filter(function (v) { return v.data >= limite; }).map(function (v) {
    var copia = {};
    Object.keys(v).forEach(function (k) { copia[k] = v[k]; });
    copia.durata = logHhmm_(v.minuti);
    copia.giaImportato = !!giaPresenti[String(v.id)] || !!perOrario[v.data + '|' + v.oraDec];
    return copia;
  });

  return {
    voli: voli,
    daCache: e.daCache,
    budget: wgBudget_(),
    giorni: WG_CONFIG.GIORNI_INDIETRO
  };
}

/**
 * Dettaglio di un volo, pronto da versare nel modulo. NON scrive niente nel
 * logbook: gli orari (UTC, presi dalla traccia) e tutto il resto restano
 * modificabili fino alla conferma.
 */
function wgPreparaVolo(idVolo) {
  var id = Number(idVolo);
  if (!id) throw new Error('Volo WeGlide non valido.');

  var d = wgGet_('/flightdetail/' + id, null);
  if (!d || !d[WG_F.ID]) throw new Error('Dettaglio del volo non disponibile.');

  var velivoli = leggiVelivoli_();
  var mappa = wgLeggiAeroporti_();
  var avvisi = [];

  var ae = d[WG_F.AEREO] || {};
  var modello = String(ae[WG_F.AEREO_NOME] || '').trim();
  var registrazione = String(d[WG_F.REGISTRAZIONE] || '').trim().toUpperCase();
  var marche = wgMarche_(registrazione, modello, velivoli);

  if (!marche) {
    marche = registrazione;   // meglio le marche grezze di WeGlide che niente
    avvisi.push('Velivolo non riconosciuto' + (modello ? ' ("' + modello + '")' : '') +
      ': controlla le marche. Per le prossime volte scrivi "' + modello +
      '" nella colonna "Modello WeGlide" del foglio Velivoli.');
  }
  if (ae[WG_F.AEREO_BIPOSTO]) {
    avvisi.push('Biposto: verifica se il volo va segnato PIC o DUAL.');
  }

  var dep = wgIcao_(d[WG_F.AP_DECOLLO], mappa);
  var arr = wgIcao_(d[WG_F.AP_ATTERRAGGIO], mappa);

  [[dep, 'partenza'], [arr, 'arrivo']].forEach(function (x) {
    var a = x[0];
    if (a.nuovo) {
      avvisi.push('Campo di ' + x[1] + ' nuovo ("' + a.nome + '"): l\'ho aggiunto al foglio "' +
        WG_FOGLI.AEROPORTI + '", scrivi l\'ICAO in quella riga e non te lo chiedera\' piu\'.');
    } else if (!a.icao && a.nome) {
      avvisi.push('Manca l\'ICAO di "' + a.nome + '" nel foglio "' + WG_FOGLI.AEROPORTI + '".');
    } else if (!a.icao && !a.nome) {
      avvisi.push('WeGlide non indica il campo di ' + x[1] + ' (atterraggio fuori campo? ZZZZ).');
    }
  });

  var data = lParseData_(d[WG_F.DATA]) || wgGiorno_(d[WG_F.DECOLLO]);
  var oraDec = wgOra_(d[WG_F.DECOLLO]);
  var oraAtt = wgOra_(d[WG_F.ATTERRAGGIO]);
  var minuti = wgMinuti_(d[WG_F.DECOLLO], d[WG_F.ATTERRAGGIO]);
  var km = wgKm_(d);

  return {
    weglideId: d[WG_F.ID],
    data: data,
    marche: marche,
    modello: modello,
    registrazione: registrazione,
    dep: dep.icao,
    arr: arr.icao,
    oraDec: oraDec,
    oraAtt: oraAtt,
    minuti: minuti,
    durata: logHhmm_(minuti),
    km: km,
    // Nota proposta: tiene la tracciabilita' anche a distanza di anni.
    note: 'WeGlide #' + d[WG_F.ID] + (km ? ' · ' + km + ' km' : ''),
    avvisi: avvisi,
    budget: wgBudget_()
  };
}

/* ==================== IMPORT DAL MENU DEL FOGLIO ========================= */

/**
 * Import senza web app: scrive le righe nel foglio "Logbook" lasciando vuota la
 * colonna "Sincronizzato il", quindi nulla finisce nel file condiviso prima che
 * tu abbia controllato gli orari e lanciato "Sincronizza voli condivisi".
 */
function wgImportaVoli() {
  var ui = SpreadsheetApp.getUi();
  var dati;
  try {
    dati = wgVoliDaScegliere(true);
  } catch (err) {
    ui.alert('WeGlide: ' + err.message);
    return;
  }

  var nuovi = dati.voli.filter(function (v) { return !v.giaImportato; });
  if (!nuovi.length) {
    ui.alert('Nessun volo nuovo su WeGlide negli ultimi ' + dati.giorni + ' giorni.\n\n' +
             'Richieste usate oggi: ' + dati.budget.usate + ' di ' + dati.budget.massimo + '.');
    return;
  }
  if (nuovi.length > WG_CONFIG.MAX_IMPORT_PER_VOLTA) nuovi = nuovi.slice(0, WG_CONFIG.MAX_IMPORT_PER_VOLTA);

  var elenco = nuovi.map(function (v) {
    return '  ' + lItDate_(v.data) + '  ' + v.oraDec + '–' + v.oraAtt + '  ' +
           v.durata + '  ' + (v.modello || '?') + '  ' + (v.aeroporto || '');
  }).join('\n');

  var risposta = ui.alert('Importare ' + nuovi.length + ' voli da WeGlide?',
    elenco + '\n\nOgni volo costa una richiesta di dettaglio (ne restano ' +
    dati.budget.restanti + ' oggi).\n\n' +
    'Gli orari arrivano dalla traccia IGC e sono in UTC: controllali nel foglio ' +
    'prima di sincronizzare con il file condiviso. La quota di sgancio resta da ' +
    'completare a mano.',
    ui.ButtonSet.YES_NO);
  if (risposta !== ui.Button.YES) return;

  var log = lFoglio_(LOG_FOGLI.LOG);
  var righe = [], errori = [];

  nuovi.forEach(function (v) {
    var p;
    try {
      p = wgPreparaVolo(v.id);
    } catch (err) {
      errori.push(lItDate_(v.data) + ': ' + err.message);
      return;
    }
    var secDec = lParseOra_(p.oraDec), secAtt = lParseOra_(p.oraAtt);
    if (secDec === null || secAtt === null || secAtt <= secDec) {
      errori.push(lItDate_(v.data) + ': orari non utilizzabili');
      return;
    }
    var dur = lDurata_(secDec, secAtt);
    var riga = new Array(HEADER_LOG.length).fill('');
    riga[LC.DATA - 1] = p.data;
    riga[LC.MARCHE - 1] = p.marche;
    riga[LC.MODELLO - 1] = p.modello;
    riga[LC.DEP - 1] = p.dep || LOG_CONFIG.ICAO_DEFAULT;
    riga[LC.ARR - 1] = p.arr || LOG_CONFIG.ICAO_DEFAULT;
    riga[LC.DEC - 1] = p.oraDec;
    riga[LC.ATT - 1] = p.oraAtt;
    riga[LC.DUR - 1] = dur.hhmm;
    riga[LC.MIN - 1] = dur.minuti;
    riga[LC.NOTE - 1] = p.note;
    riga[LC.ESITO - 1] = 'da WeGlide: controlla orari (UTC) e funzione';
    riga[LC.FUNZ - 1] = lFunzione_('');     // PIC per default, da correggere se DUAL
    riga[LC.WG - 1] = p.weglideId;
    righe.push(riga);
  });

  if (righe.length) {
    log.getRange(log.getLastRow() + 1, 1, righe.length, HEADER_LOG.length).setValues(righe);
    SpreadsheetApp.flush();
  }

  ui.alert('Importati ' + righe.length + ' voli da WeGlide.' +
    (errori.length ? '\n\nNon importati:\n' + errori.join('\n') : '') +
    '\n\nControlla orari, funzione a bordo e quota di sgancio, poi ' +
    'Logbook > Sincronizza voli condivisi per il mezzo in comproprieta\'.' +
    '\n\nRichieste usate oggi: ' + wgBudget_().usate + ' di ' + wgBudget_().massimo + '.');
}

/* ============================ DIAGNOSTICA ================================ */

function wgProvaCollegamento() {
  try {
    var e = wgElenco_(true);
    var b = wgBudget_();
    var ultimo = e.voli.length ? e.voli[0] : null;
    lAvvisa_('Collegamento a WeGlide riuscito.\n\n' +
      'Pilot ID: ' + wgPilotId_() + '\n' +
      'API key: ' + (wgChiave_() ? 'presente' : 'assente (i voli pubblici si leggono comunque)') + '\n' +
      'Voli ricevuti: ' + e.voli.length + '\n' +
      (ultimo ? 'Ultimo volo: ' + lItDate_(ultimo.data) + ' ' + ultimo.oraDec + '–' + ultimo.oraAtt +
                ' (' + ultimo.durata + ') ' + (ultimo.modello || '') + ' da ' + (ultimo.aeroporto || '?') + '\n' : '') +
      '\nRichieste usate oggi: ' + b.usate + ' di ' + b.massimo + ' (limite WeGlide: 60).');
  } catch (err) {
    lAvvisa_('WeGlide: ' + err.message);
  }
}

/* ===================== AVVISO GIORNALIERO (opzionale) ==================== */

/**
 * Attivatore giornaliero: una sola richiesta al giorno, nessuna scrittura.
 * Se su WeGlide compaiono voli che nel logbook non ci sono, arriva una mail con
 * l'elenco e il link alla web app, dove si importano con gli orari da rivedere.
 */
function wgControlloGiornaliero() {
  try {
    var dati = wgVoliDaScegliere(true);
    var nuovi = dati.voli.filter(function (v) { return !v.giaImportato; });
    if (!nuovi.length) return;

    var url = '';
    try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { /* web app non pubblicata */ }

    var testo = 'Su WeGlide ci sono ' + nuovi.length + ' voli non ancora nel logbook:\n\n' +
      nuovi.map(function (v) {
        return '• ' + lItDate_(v.data) + '  ' + v.oraDec + '–' + v.oraAtt + ' UTC  (' + v.durata + ')  ' +
               (v.modello || '') + (v.aeroporto ? ' da ' + v.aeroporto : '');
      }).join('\n') +
      '\n\nAprendo la web app del logbook, il pulsante "Cerca voli su WeGlide" li propone ' +
      'precompilati: gli orari sono quelli della traccia IGC, in UTC, e restano modificabili ' +
      'prima di confermare.' +
      (url ? '\n\n' + url : '');

    MailApp.sendEmail(mioIndirizzo_(), 'Logbook: ' + nuovi.length + ' voli da importare da WeGlide', testo);
  } catch (err) {
    console.error('wgControlloGiornaliero: ' + err.message);
  }
}

function wgAttivaControlloGiornaliero() {
  wgDisattivaControlloGiornaliero();
  ScriptApp.newTrigger('wgControlloGiornaliero')
    .timeBased().atHour(20).everyDays(1).create();
  lAvvisa_('Avviso giornaliero attivo.\n\n' +
    'Ogni sera lo script chiede a WeGlide (una sola richiesta) se ci sono voli ' +
    'nuovi e, se ne trova, ti manda una mail. Non scrive niente da solo.');
}

function wgDisattivaControlloGiornaliero() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'wgControlloGiornaliero') ScriptApp.deleteTrigger(t);
  });
}
