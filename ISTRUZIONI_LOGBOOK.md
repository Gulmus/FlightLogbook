# Logbook personale con travaso sull'aliante condiviso

Due file distinti, un solo punto di inserimento dati.

- **File condiviso** (quello già in uso): prenotazioni dell'aliante OE-5357 e foglio `Voli`, con la sua web app.
- **File personale** (nuovo): il tuo logbook su tutti i mezzi, con i fogli `Velivoli` e `Logbook`.

Inserisci il volo una volta sola nel logbook. Se le marche sono quelle dell'aliante in comproprietà, lo script copia la riga nel foglio `Voli` del file condiviso e chiude la prenotazione di quel giorno, così l'app non ti chiede più il rendiconto. I voli sui mezzi affittati restano solo nel logbook.

## Installazione

1. Crea un nuovo Google Sheet, per esempio "Logbook voli — tuo nome".
2. `Estensioni > Apps Script`, incolla in `Codice.gs` il contenuto di **LogbookPersonale.gs** e salva.
3. Apri il file condiviso delle prenotazioni e copia dall'URL la parte fra `/d/` e `/edit`: è l'ID del file. Incollalo in `LOG_CONFIG.ID_FILE_CONDIVISO`, in cima allo script, fra apici.
4. Nell'editor esegui `inizializzaLogbook` e autorizza lo script. Nascono i fogli `Velivoli` e `Logbook` e nel foglio compare il menu `Logbook`.
5. `Logbook > Prova collegamento al file condiviso`: deve rispondere con il nome del file, il numero di voli già presenti e l'indirizzo email con cui verranno registrati i tuoi voli. Quell'indirizzo deve comparire nel foglio `Utenti` del file condiviso, altrimenti il nome del pilota risulterà incompleto.

Nessuna condivisione aggiuntiva è necessaria: lo script gira con il tuo account, che sul file condiviso ha già accesso in modifica. Il logbook resta privato, gli altri soci non lo vedono.

## Foglio `Velivoli`

| Marche | Modello | Condiviso | Note |
|---|---|---|---|
| OE-5357 | DG300 | SI | aliante in comproprietà |
| D-1234 | ASK 21 | NO | scuola, noleggio |

La colonna `Condiviso` è l'interruttore che decide il travaso: solo `SI` fa scattare la copia nel file condiviso. Gli altri velivoli li aggiungi tu, anche in seguito. Le marche di questo foglio alimentano il menu a tendina nel logbook, che però accetta anche un valore digitato a mano per il mezzo occasionale.

## Foglio `Logbook`

Compili a mano soltanto: `Data`, `Marche` (dal menu), `ICAO partenza`, `ICAO arrivo`, `Ora decollo`, `Ora atterraggio`, `Quota sgancio (m)`, `Funzione` e le eventuali `Note`. Vengono riempite dallo script `Modello`, `Durata (hh:mm)`, `Durata (minuti)`, `Sincronizzato il` ed `Esito sincronizzazione`.

`Funzione` accetta `PIC` o `DUAL` da un menu a tendina e serve a distinguere i voli da pilota responsabile da quelli con istruttore. Se la lasci vuota il volo conta come `PIC`, valore governato da `LOG_CONFIG.FUNZIONE_DEFAULT`: per questo le righe scritte prima che la colonna esistesse restano valide senza ritoccarle. La colonna è stata aggiunta **in fondo** al foglio proprio per non far slittare quelle esistenti; se il tuo `Logbook` è già in uso basta rieseguire `Logbook > Inizializza / verifica fogli` per vederla comparire con il suo menu a tendina, e `Ricalcola modello e durate` per normalizzare le celle scritte in fretta (`p`, `d`, `doppio` diventano `PIC` e `DUAL`).

Gli orari li puoi scrivere come preferisci: `10.35.12`, `10.35`, `10:35:12`, `10:35`. Le colonne sono formattate come testo, quindi Sheets non li reinterpreta. La durata è arrotondata al minuto e le due colonne restano sempre coerenti fra loro.

## Come far partire il travaso

A comando, con `Logbook > Sincronizza voli condivisi`: elabora tutte le righe non ancora sincronizzate e scrive l'esito riga per riga. Lo puoi rilanciare quando vuoi, i voli già copiati vengono riconosciuti da data, ora di decollo e pilota e non vengono duplicati.

In automatico, con `Logbook > Attiva sincronizzazione automatica`: installa un trigger che, appena la riga è completa, calcola la durata e copia il volo se il velivolo è quello condiviso. Serve un trigger installabile, perché il semplice `onEdit` non ha il permesso di scrivere su un altro file; per questo va attivato dal menu una volta sola. Si disattiva dalla voce successiva.

Nella colonna `Esito sincronizzazione` trovi cosa è successo: `copiato nel file condiviso`, con l'indicazione se la prenotazione del giorno è stata chiusa o se non ne esisteva nessuna a tuo nome, oppure `DA CORREGGERE` con il motivo (data illeggibile, orari incoerenti, ICAO non valido). Correggi la cella e rilancia.

## Quota di sgancio nel file condiviso

Il foglio `Voli` condiviso riceve tre colonne aggiuntive create automaticamente al primo travaso: `Quota sgancio (m)`, `Origine` — che vale `LOGBOOK` per le righe arrivate da qui, `STORICO` per quelle importate e vuota per quelle inserite dagli altri soci con la web app — e `Funzione`, con il `PIC` o `DUAL` del tuo logbook. Il modulo a quattro campi dell'app resta invariato: gli altri soci continuano a compilare solo decollo, atterraggio e orari, e la colonna della quota per loro resta vuota.

## Se registri un volo dall'app invece che dal logbook

Succederà, prima o poi. `Logbook > Importa voli dal file condiviso` recupera i voli a tuo nome presenti nel file condiviso e assenti dal logbook, assegnandoli alle marche del mezzo condiviso; ti restano da completare la quota di sgancio e, se il volo era con istruttore, la funzione (l'import assegna `PIC`, perché il file condiviso non registra quel dato per le righe inserite dagli altri soci). Le righe nate nel logbook vengono riconosciute dalla colonna `Origine` e non tornano indietro, quindi non si creano anelli.

## Riepilogo ore

`Logbook > Riepilogo ore di volo` mostra il totale generale con il dettaglio delle sole ore PIC, la suddivisione per anno e quella per velivolo, calcolate sulla colonna dei minuti. Utile per tenere d'occhio l'esperienza recente senza costruire pivot a mano.

## Web app del logbook

Nello stesso progetto aggiungi due file: `+` > `Script` con nome **WebLogbook** dove incolli **WebLogbook.gs**, e `+` > `HTML` con nome esatto **Logbook** (senza `.html`) dove incolli **Logbook.html**. Salva e ricarica il foglio: nel menu compare `Mostra URL web app`.

Pubblicazione: `Distribuisci > Nuova distribuzione > Tipo: App web`, con **Esegui come: Me** e **Chi ha accesso: Solo me**. È un archivio personale, quindi non serve nessuna schermata di accesso: Google controlla che sia tu e lo script gira col tuo account, lo stesso che ha accesso in modifica al file condiviso. L'URL `…/exec` lo metti sulla schermata Home del telefono come per l'app delle prenotazioni. Vale anche qui la regola d'oro: **ogni modifica al codice diventa visibile solo dopo `Gestisci distribuzioni` > matita > `Versione: Nuova versione`**.

Il modulo chiede data, velivolo, funzione a bordo, ICAO di partenza e arrivo, orari, quota di sgancio e note. La funzione è un selettore a due pulsanti, `PIC` o `DUAL`, con `PIC` preselezionato. La data è preimpostata a oggi ma si può cambiare, per caricare il volo il giorno dopo; le date future sono rifiutate. Il velivolo arriva dal foglio `Velivoli` con l'aliante in comproprietà in testa, e la voce "Altro…" permette di annotare un mezzo occasionale digitando le marche. I codici ICAO proposti sono quelli del foglio `Aeroporti` del file condiviso più tutti quelli già usati nel logbook, con `LIMA` preselezionato e "Altro…" per i casi nuovi. La durata compare mentre digiti gli orari, ma quella che finisce nel foglio è ricalcolata dal server.

Al salvataggio la riga viene scritta nel foglio `Logbook` e, se il velivolo è quello condiviso, parte subito il travaso nel file di prenotazione con la chiusura della prenotazione del giorno: non serve né aprire i fogli né lanciare la sincronizzazione dal menu. Se il travaso non riesce (rete, permessi, ID sbagliato) il volo resta comunque salvato nel logbook e l'app te lo dice in chiaro, così lo recuperi poi con `Logbook > Sincronizza voli condivisi`. Un secondo invio dello stesso volo — stessa data e stessa ora di decollo — viene rifiutato, quindi il doppio tap sul pulsante non crea duplicati. Dopo il salvataggio data, velivolo e funzione restano come li hai impostati e si svuotano solo orari, quota e note: comodo nei giorni con più voli di seguito, ma se il volo seguente cambia ruolo ricordati di spostare il selettore.

In basso l'elenco degli ultimi dodici voli, con l'etichetta `condiviso` sulle righe già copiate nel file dell'aliante, `da correggere` su quelle che la sincronizzazione ha scartato e `DUAL` sui voli con istruttore.

## Il pannello recency

In cima all'app quattro riquadri, verdi o rossi rispetto ai minimi: ore totali, ore negli ultimi 24 mesi (minimo 5), voli negli ultimi 24 mesi (minimo 15) e voli negli ultimi 90 giorni (minimo 3, il requisito per il trasporto di passeggeri). Sotto ogni numero, se il requisito è soddisfatto, c'è la data fino alla quale regge: è il giorno in cui il volo che oggi lo sostiene esce dalla finestra temporale, cioè il primo giorno in cui scenderai sotto la soglia se non voli più. Se invece il requisito non è soddisfatto, leggi quanto manca — ore e minuti oppure numero di voli.

I tre requisiti contano **solo i voli con funzione `PIC`**, e le etichette lo ricordano con la sigla fra parentesi. I voli `DUAL` restano nel logbook e nelle ore totali — il primo riquadro mostra il totale generale e, sotto, quanto di quel totale è PIC — ma non entrano nei conteggi di recency. Se preferisci il comportamento opposto metti `SOLO_PIC: false` nel blocco `RECENCY` in cima a `WebLogbook.gs`, dove stanno anche le soglie (5 ore, 15 voli, 3 voli in 90 giorni) e l'ampiezza della finestra breve.

Resta un limite voluto: il pannello non conta i lanci, che nei requisiti compaiono a parte, e non distingue i tipi di lancio. È un promemoria personale, non la verifica formale dei requisiti.

## Gli interruttori

In cima a `LogbookPersonale.gs`: `CHIUDI_PRENOTAZIONE` (predefinito `true`) decide se il travaso segna anche la prenotazione come `CONCLUSA`; mettilo a `false` se preferisci chiudere il rendiconto a mano dall'app. `QUOTA_OBBLIGATORIA` (predefinito `false`) impedisce la sincronizzazione dei voli senza quota di sgancio, utile se vuoi essere sicuro di non dimenticarla. `FUNZIONE_DEFAULT` (predefinito `'PIC'`) è il valore attribuito alle celle `Funzione` lasciate vuote.

In cima a `WebLogbook.gs`: il blocco `RECENCY` con le tre soglie, l'ampiezza della finestra breve e `SOLO_PIC`.
