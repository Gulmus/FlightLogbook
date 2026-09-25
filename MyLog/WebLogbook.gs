/*******************************************************************************
 * WEB APP DEL LOGBOOK PERSONALE
 * -----------------------------------------------------------------------------
 * Secondo file di script del progetto legato al TUO foglio del logbook
 * (va insieme a LogbookPersonale.gs, di cui riusa configurazione e funzioni).
 * L'interfaccia sta nel file HTML "Logbook".
 *
 * COSA FA
 *   - Inserimento di un volo da telefono: data (preimpostata a oggi ma
 *     modificabile), velivolo, ICAO di partenza e arrivo, orari, quota di
 *     sgancio, note. La durata e' calcolata dal server.
 *   - Se il velivolo e' quello in comproprieta', subito dopo il salvataggio
 *     parte il travaso nel file di prenotazione (stessa logica del menu).
 *   - Pannello "recency" con i totali e il confronto con i minimi.
 *   - Riquadro "Importa da WeGlide" (solo se c'e' anche WeGlideImport.gs): i
 *     voli scaricati precompilano il modulo, che resta interamente modificabile
 *     fino alla conferma.
 *
 * ORARI
 *   Decollo e atterraggio si inseriscono in UTC, come nel foglio e come nella
 *   traccia IGC. Il modulo mostra sotto i campi l'ora locale corrispondente,
 *   calcolata sulla data del volo, solo come aiuto alla lettura: nessuna
 *   conversione viene applicata a cio' che finisce nel foglio.
 *
 * DISTRIBUZIONE
 *   Distribuisci > Nuova distribuzione > App web
 *     Esegui come: Me
 *     Chi ha accesso: Solo me
 *   E' un archivio personale: non serve nessuna gestione di utenti.
 ******************************************************************************/

/* ===================== SOGLIE DI RECENCY (modificabili) =================== */

/**
 * Valori usati SOLO come promemoria personale. Non sostituiscono la normativa
 * applicabile ne' il controllo dell'istruttore o dell'ente di appartenenza.
 */
var RECENCY = {
  ORE_24M: 5,        // ore di volo minime negli ultimi 24 mesi
  VOLI_24M: 15,      // voli minimi negli ultimi 24 mesi
  VOLI_90G: 3,       // voli minimi negli ultimi 90 giorni per il trasporto passeggeri
  GIORNI_BREVE: 90,  // ampiezza della finestra breve

  /**
   * true  = i tre requisiti sopra contano SOLO i voli con Funzione = PIC,
   *         come previsto per l'esperienza recente da pilota responsabile.
   * false = conta tutto, PIC e DUAL insieme.
   * Le ore totali in cima al pannello restano comunque il totale generale,
   * con il dettaglio delle sole PIC.
   */
  SOLO_PIC: true
};

/* ============================== ENTRY POINT ============================== */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Logbook')
    .setTitle('Logbook voli')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Voce di menu per recuperare l'indirizzo della web app. */
function logMostraUrl() {
  var url = ScriptApp.getService().getUrl() || '(non ancora pubblicata: Distribuisci > Nuova distribuzione)';
  lAvvisa_('URL web app logbook:\n\n' + url);
}

/* ============================ UTILITY DATE =============================== */

function logAddGiorni_(iso, n) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + lPad2_(d.getUTCMonth() + 1) + '-' + lPad2_(d.getUTCDate());
}

function logAddAnni_(iso, n) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(+p[0] + n, +p[1] - 1, +p[2]));
  return d.getUTCFullYear() + '-' + lPad2_(d.getUTCMonth() + 1) + '-' + lPad2_(d.getUTCDate());
}

/** minuti -> 'h:mm' senza zero iniziale sulle ore (es. 127 -> '2:07') */
function logHhmm_(min) {
  var m = Math.round(min);
  return Math.floor(m / 60) + ':' + lPad2_(m % 60);
}

/* ========================= LETTURA DEI VOLI ============================== */

/**
 * Tutti i voli del logbook, ordinati dal piu' recente.
 * Se la colonna dei minuti e' vuota la durata viene ricalcolata al volo dagli
 * orari, cosi' il riepilogo e' corretto anche su righe scritte a mano.
 */
function logLeggiVoli_() {
  var sh = lFoglio_(LOG_FOGLI.LOG);
  var out = [];
  if (sh.getLastRow() < 2) return out;

  sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_LOG.length).getValues().forEach(function (r, i) {
    var data = lParseData_(r[LC.DATA - 1]);
    if (!data) return;

    var minuti = Number(r[LC.MIN - 1]) || 0;
    if (!minuti) {
      var a = lParseOra_(r[LC.DEC - 1]), b = lParseOra_(r[LC.ATT - 1]);
      if (a !== null && b !== null && b > a) minuti = Math.round((b - a) / 60);
    }

    out.push({
      riga: i + 2,
      data: data,
      marche: String(r[LC.MARCHE - 1]).trim().toUpperCase(),
      modello: String(r[LC.MODELLO - 1]).trim(),
      dep: String(r[LC.DEP - 1]).trim().toUpperCase(),
      arr: String(r[LC.ARR - 1]).trim().toUpperCase(),
      oraDec: String(r[LC.DEC - 1]).trim(),
      oraAtt: String(r[LC.ATT - 1]).trim(),
      minuti: minuti,
      quota: r[LC.QUOTA - 1] === '' ? '' : Number(r[LC.QUOTA - 1]),
      funzione: lFunzione_(r[LC.FUNZ - 1]),   // vuoto -> LOG_CONFIG.FUNZIONE_DEFAULT
      note: String(r[LC.NOTE - 1]).trim(),
      sincronizzato: !!r[LC.SYNC - 1],
      esito: String(r[LC.ESITO - 1]).trim(),
      // Vuoto per i voli inseriti a mano; per gli altri e' l'ID del volo su
      // WeGlide, usato per non importare due volte lo stesso volo.
      weglideId: String(r[LC.WG - 1] || '').trim()
    });
  });

  out.sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0); });
  return out;
}

/* ============================== RECENCY ================================== */

/**
 * Calcola i quattro indicatori richiesti e, quando la soglia e' raggiunta, la
 * data indicativa entro cui va rifatto qualcosa: e' il giorno in cui il volo
 * che oggi "regge" il requisito esce dalla finestra temporale.
 */
function logRecency_(voli) {
  var oggi = lOggi_();
  var lim24 = logAddAnni_(oggi, -2);
  var limBreve = logAddGiorni_(oggi, -RECENCY.GIORNI_BREVE);

  // Totali generali: comprendono sia PIC sia DUAL.
  var totMin = 0, totMinPic = 0, totVoliPic = 0;
  voli.forEach(function (v) {
    totMin += v.minuti;
    if (v.funzione === 'PIC') { totMinPic += v.minuti; totVoliPic++; }
  });

  // Base di calcolo dei requisiti: di norma i soli voli da pilota responsabile.
  var validi = RECENCY.SOLO_PIC
    ? voli.filter(function (v) { return v.funzione === 'PIC'; })
    : voli;

  var min24 = 0, voli24 = 0, voliBreve = 0;
  validi.forEach(function (v) {
    if (v.data >= lim24) { min24 += v.minuti; voli24++; }
    if (v.data >= limBreve) voliBreve++;
  });

  // validi[] e' ordinato dal piu' recente: l'n-esimo elemento e' il volo che
  // sostiene il requisito "almeno n voli".
  function scadenzaConteggio(soglia, giorniFinestra, anniFinestra) {
    if (validi.length < soglia) return '';
    var v = validi[soglia - 1];
    return anniFinestra ? logAddAnni_(v.data, anniFinestra) : logAddGiorni_(v.data, giorniFinestra);
  }

  // Per le ore: si risale indietro nel tempo finche' si raggiunge la soglia.
  function scadenzaOre(soglieMinuti) {
    var acc = 0;
    for (var i = 0; i < validi.length; i++) {
      acc += validi[i].minuti;
      if (acc >= soglieMinuti) return logAddAnni_(validi[i].data, 2);
    }
    return '';
  }

  return {
    oggi: oggi,
    finestra24: lim24,
    finestraBreve: limBreve,
    soloPic: RECENCY.SOLO_PIC,
    totale: {
      minuti: totMin, testo: logHhmm_(totMin), voli: voli.length,
      minutiPic: totMinPic, testoPic: logHhmm_(totMinPic), voliPic: totVoliPic
    },
    ore24: {
      minuti: min24, testo: logHhmm_(min24),
      minimo: RECENCY.ORE_24M, minimoTesto: RECENCY.ORE_24M + ':00',
      ok: min24 >= RECENCY.ORE_24M * 60,
      mancante: Math.max(0, RECENCY.ORE_24M * 60 - min24),
      scadenza: min24 >= RECENCY.ORE_24M * 60 ? scadenzaOre(RECENCY.ORE_24M * 60) : ''
    },
    voli24: {
      valore: voli24, minimo: RECENCY.VOLI_24M,
      ok: voli24 >= RECENCY.VOLI_24M,
      mancante: Math.max(0, RECENCY.VOLI_24M - voli24),
      scadenza: voli24 >= RECENCY.VOLI_24M ? scadenzaConteggio(RECENCY.VOLI_24M, 0, 2) : ''
    },
    voliBreve: {
      valore: voliBreve, minimo: RECENCY.VOLI_90G, giorni: RECENCY.GIORNI_BREVE,
      ok: voliBreve >= RECENCY.VOLI_90G,
      mancante: Math.max(0, RECENCY.VOLI_90G - voliBreve),
      scadenza: voliBreve >= RECENCY.VOLI_90G ? scadenzaConteggio(RECENCY.VOLI_90G, RECENCY.GIORNI_BREVE, 0) : ''
    }
  };
}

/* ======================== ELENCO ICAO PROPOSTI =========================== */

/**
 * Suggerimenti per i campi ICAO: l'anagrafica del file condiviso (se
 * raggiungibile) piu' tutti i codici gia' usati nel logbook. Si puo' comunque
 * digitare un codice nuovo.
 */
function logListaIcao_(voli) {
  var visti = {}, out = [];

  function aggiungi(icao, nome) {
    var v = String(icao || '').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(v) || visti[v]) return;
    visti[v] = true;
    out.push({ icao: v, nome: nome || '' });
  }

  aggiungi(LOG_CONFIG.ICAO_DEFAULT, 'campo base');

  try {
    var sh = apriFileCondiviso_().getSheetByName('Aeroporti');
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
        aggiungi(r[0], String(r[1] || '').trim());
      });
    }
  } catch (err) {
    // File condiviso non configurato o non raggiungibile: si prosegue.
    console.log('Anagrafica aeroporti non disponibile: ' + err.message);
  }

  (voli || []).forEach(function (v) { aggiungi(v.dep); aggiungi(v.arr); });
  return out;
}

/* ========================= API PER IL CLIENT ============================= */

/** Dati iniziali e, dopo ogni salvataggio, stato aggiornato. */
function logBootstrap() {
  var voli = logLeggiVoli_();
  var velivoli = leggiVelivoli_();

  var elencoVelivoli = Object.keys(velivoli).map(function (k) {
    return { marche: velivoli[k].marche, modello: velivoli[k].modello, condiviso: velivoli[k].condiviso };
  }).sort(function (a, b) {
    // Prima il mezzo in comproprieta', poi gli altri in ordine alfabetico.
    if (a.condiviso !== b.condiviso) return a.condiviso ? -1 : 1;
    return a.marche < b.marche ? -1 : 1;
  });

  // Il riquadro WeGlide compare solo se WeGlideImport.gs e' nel progetto e il
  // Pilot ID e' stato impostato: senza il terzo file l'app resta identica a prima.
  var weglide = { disponibile: false, configurato: false };
  if (typeof wgStatoPerApp_ === 'function') {
    try {
      weglide = wgStatoPerApp_();
    } catch (err) {
      weglide = { disponibile: true, configurato: false, motivo: err.message };
    }
  }

  return {
    oggi: lOggi_(),
    icaoDefault: LOG_CONFIG.ICAO_DEFAULT,
    // Dicono al modulo come etichettare gli orari e su quale fuso calcolare
    // l'ora locale mostrata come promemoria sotto i campi.
    orariUtc: LOG_CONFIG.ORARI_UTC,
    fusoLocale: LOG_CONFIG.TZ,
    funzioni: FUNZIONI,                              // ['PIC','DUAL']
    funzioneDefault: lFunzione_(''),                 // preselezionata nel modulo
    velivoli: elencoVelivoli,
    aeroporti: logListaIcao_(voli),
    recency: logRecency_(voli),
    ultimi: voli.slice(0, 12),
    fileCondivisoConfigurato: String(LOG_CONFIG.ID_FILE_CONDIVISO || '').indexOf('INCOLLA') !== 0,
    weglide: weglide
  };
}

/**
 * Salva un volo nel logbook e, se il velivolo e' condiviso, lo travasa nel
 * file di prenotazione riusando la funzione del menu (che si occupa anche di
 * chiudere la prenotazione del giorno ed evitare i doppioni).
 * payload = { data, marche, dep, arr, oraDec, oraAtt, quota, funzione, note,
 *             weglideId }
 * oraDec e oraAtt arrivano gia' in UTC: il modulo non converte niente, si limita
 * a mostrare accanto l'ora locale corrispondente.
 * weglideId c'e' solo quando il modulo e' stato precompilato da WeGlide: resta
 * scritto nel logbook e impedisce di importare due volte lo stesso volo, anche
 * se nel frattempo ne hai corretto gli orari.
 */
function logSalvaVolo(payload) {
  var data = lParseData_(payload.data);
  if (!data) throw new Error('Data non valida.');
  if (data > lOggi_()) throw new Error('Non si registra un volo con data futura.');

  var marche = String(payload.marche || '').trim().toUpperCase();
  if (!marche) throw new Error('Scegli il velivolo.');
  var velivoli = leggiVelivoli_();
  var v = velivoli[marche];   // puo' essere assente: mezzo occasionale

  var dep = String(payload.dep || LOG_CONFIG.ICAO_DEFAULT).trim().toUpperCase();
  var arr = String(payload.arr || LOG_CONFIG.ICAO_DEFAULT).trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(dep)) throw new Error('ICAO di partenza non valido (4 lettere).');
  if (!/^[A-Z]{4}$/.test(arr)) throw new Error('ICAO di arrivo non valido (4 lettere).');

  var secDec = lParseOra_(payload.oraDec);
  var secAtt = lParseOra_(payload.oraAtt);
  if (secDec === null) throw new Error('Ora di decollo non valida.');
  if (secAtt === null) throw new Error('Ora di atterraggio non valida.');
  if (secAtt <= secDec) throw new Error('L\'atterraggio deve essere successivo al decollo.');

  var quota = (payload.quota === '' || payload.quota === null || payload.quota === undefined)
    ? '' : Number(payload.quota);
  if (quota !== '' && (isNaN(quota) || quota < 0)) throw new Error('Quota di sgancio non valida.');

  var d = lDurata_(secDec, secAtt);
  var oraDec = lFormattaOra_(secDec);

  // Solo cifre: se il client manda qualcosa di strano viene semplicemente ignorato.
  var weglideId = String(payload.weglideId || '').replace(/[^0-9]/g, '');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Operazione in corso, riprova.');
  try {
    // Doppio invio o volo gia' presente: si blocca qui. Il confronto tollera
    // qualche minuto di differenza sul decollo (lStessoVolo_), perche' lo stesso
    // volo puo' essere stato scritto con l'orario IGC invece di quello ATC.
    var esistenti = logLeggiVoli_();
    var duplicato = esistenti.some(function (x) {
      return lStessoVolo_(data, secDec, x.data, lParseOra_(x.oraDec));
    });
    if (duplicato) {
      throw new Error('Un volo del ' + lItDate_(data) + ' con decollo intorno alle ' +
        oraDec + lUtc_() + ' e\' gia\' registrato.');
    }

    // Stesso volo WeGlide gia' importato, magari con orari corretti a mano:
    // il controllo su data + ora non lo intercetterebbe.
    if (weglideId && esistenti.some(function (x) { return x.weglideId === weglideId; })) {
      throw new Error('Il volo WeGlide #' + weglideId + ' e\' gia\' nel logbook.');
    }

    var riga = new Array(HEADER_LOG.length).fill('');
    riga[LC.DATA - 1] = data;
    riga[LC.MARCHE - 1] = marche;
    riga[LC.MODELLO - 1] = v ? v.modello : '';
    riga[LC.DEP - 1] = dep;
    riga[LC.ARR - 1] = arr;
    riga[LC.DEC - 1] = oraDec;
    riga[LC.ATT - 1] = lFormattaOra_(secAtt);
    riga[LC.DUR - 1] = d.hhmm;
    riga[LC.MIN - 1] = d.minuti;
    riga[LC.QUOTA - 1] = quota;
    riga[LC.NOTE - 1] = String(payload.note || '').substring(0, 500);
    riga[LC.FUNZ - 1] = lFunzione_(payload.funzione);   // PIC o DUAL, mai vuoto
    riga[LC.WG - 1] = weglideId ? Number(weglideId) : '';

    lFoglio_(LOG_FOGLI.LOG).appendRow(riga);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Travaso sul file condiviso: l'eventuale errore non annulla il salvataggio
  // locale, viene solo riportato all'utente.
  var funzione = lFunzione_(payload.funzione);
  var messaggio = 'Volo registrato: ' + d.hhmm + ' come ' + funzione + '.' +
    (funzione === 'DUAL' && RECENCY.SOLO_PIC ? ' Come volo DUAL non conta per la recency.' : '');
  if (v && v.condiviso) {
    try {
      sincronizzaVoliCondivisi();
      messaggio += ' Copiato anche nel file dell\'aliante condiviso.';
    } catch (err) {
      messaggio += ' ATTENZIONE: travaso nel file condiviso non riuscito (' + err.message +
        '). Riprova con Logbook > Sincronizza voli condivisi.';
    }
  }

  var stato = logBootstrap();
  stato.messaggio = messaggio;
  return stato;
}
