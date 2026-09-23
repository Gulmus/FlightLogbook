# Web app prenotazione aliante condiviso — installazione e uso

Prenotazione a giorno singolo, modificabile da tutti i soci, con registro voli.
Tempo di installazione: 15–20 minuti. Costo: zero.

## 1. Prepara lo Sheet e il progetto

1. Apri il Google Sheet condiviso (o creane uno nuovo).
2. `Estensioni > Apps Script`.
3. Nel file `Codice.gs` cancella tutto e incolla il contenuto di **Codice.gs**.
4. `+` accanto a "File" > `HTML`, nome esatto **Index** (senza `.html`), cancella il contenuto predefinito e incolla **Index.html**.
5. In cima a `Codice.gs` regola il blocco `CONFIG`: `NOME_BENE` (es. `'Aliante DG-505 I-ABCD'`), eventualmente `PREAVVISO_MINIMO_GIORNI`, `MAX_PRENOTAZIONI_FUTURE` e `ICAO_DEFAULT` (preimpostato `LIMA`).
6. Salva.

## 2. Crea i fogli

Seleziona la funzione `inizializzaFogli`, premi `Esegui` e autorizza lo script (compare "app non verificata": `Avanzate > Vai a … (non sicuro)`, è il tuo stesso script). Nello Sheet compaiono quattro fogli — `Prenotazioni`, `Utenti`, `Aeroporti`, `Voli` — e il menu `Aliante`.

## 3. Compila `Utenti`

| Email | Nome | Ruolo | PIN | Colore | Attivo |
|---|---|---|---|---|---|
| anna@gmail.com | Anna Rossi | admin | 1234 | #2563eb | SI |
| bruno@gmail.com | Bruno Bianchi | socio | 5678 | #059669 | SI |

`Ruolo` = `admin` serve solo per compilare il rendiconto di un volo altrui (utile per le dimenticanze). Prenotare, rimuovere e sovrascrivere sono azioni permesse a tutti i soci. `PIN` serve solo per l'accesso di riserva (punto 6). `Colore` è il codice esadecimale usato nel calendario.

## 4. Verifica `Aeroporti`

Due colonne, `ICAO` e `Aeroporto`. Il foglio nasce con un elenco di partenza da adattare al vostro caso. `ZZZZ` è la convenzione ICAO per l'atterraggio fuori campo: conviene tenerla. L'elenco alimenta i menu del rendiconto, quindi si aggiorna qui senza toccare il codice. Se `CONSENTI_ICAO_LIBERO` è `true` (predefinito), nel modulo compare anche la voce "Altro…" per digitare un ICAO non in elenco.

## 5. Carica le assegnazioni annuali

Una volta all'anno, nel foglio `Prenotazioni`, una riga per ogni giorno già assegnato d'ufficio:

| ID | Tipo | Data | Email | Pilota | Stato | Note |
|---|---|---|---|---|---|---|
| A27-001 | ASSEGNAZIONE | 2027-05-01 | anna@gmail.com | Anna Rossi | ATTIVA | turno primaverile |
| A27-002 | ASSEGNAZIONE | 2027-05-08 | bruno@gmail.com | Bruno Bianchi | ATTIVA | |

`ID` qualsiasi testo purché unico, `Data` nel formato `2027-05-01` (accettato anche `01/05/2027`), `Stato` deve essere `ATTIVA` perché il giorno risulti occupato. La colonna `Tipo` riconosce tre valori: `PRENOTAZIONE` (inserita dall'app), `ASSEGNAZIONE` (caricata a mano qui) e `RETROATTIVA` (volo registrato a posteriori su un giorno passato); qualunque altro testo viene letto come `PRENOTAZIONE`. Le assegnazioni compaiono nel calendario con un pallino bianco e si distinguono nelle liste, ma restano rimovibili e sovrascrivibili dall'app come le altre prenotazioni: la conferma richiesta è solo più esplicita.

## 6. Pubblica la web app

`Distribuisci > Nuova distribuzione > Tipo: App web`:

- **Esegui come**: *Utente che accede all'app web*
- **Chi ha accesso**: *Chiunque abbia un account Google*

Copia l'URL `…/exec` e mandalo ai soci; lo ritrovi da `Aliante > Mostra URL web app`. Con questa impostazione lo Sheet va condiviso **in modifica** con gli indirizzi dei soci, perché lo script scrive a nome di chi lo usa, e ognuno autorizza lo script una volta al primo accesso.

Se preferisci che nessuno abbia accesso al foglio, distribuisci con **Esegui come: Me**. In quel caso Google in genere non comunica allo script l'identità del visitatore: l'app mostra la schermata di accesso e si entra con email e PIN presi dal foglio `Utenti`.

Da telefono, aprendo l'URL e scegliendo "Aggiungi a schermata Home" si ottiene un'icona che apre direttamente l'app. Non è una vera PWA installabile — una web app Apps Script vive dentro un iframe e non può avere manifest né service worker — quindi la voce "Installa app" non compare in nessun browser. In Brave la scorciatoia sta nel menu `⋮`; se gli Shields bloccano i cookie di Google la pagina può restare bianca, in quel caso si disattivano per quel sito dall'icona del leone.

Per personalizzare l'icona della scorciatoia scrivi in `CONFIG.ICONA_URL` l'indirizzo di un PNG quadrato (192×192 o 512×512). L'URL deve terminare con un'estensione riconosciuta — `.png`, `.ico`, `.gif`, `.jpg` — altrimenti Apps Script risponde "tipo di immagine per l'icona favicon non supportato": i link di Drive e di `lh3.googleusercontent.com` non hanno estensione e vengono sempre rifiutati, così come `.svg` e `.webp`. La soluzione gratuita più stabile è un repository GitHub pubblico, con indirizzo nella forma `https://raw.githubusercontent.com/utente/repo/main/icona.png`.

Dopo la ridistribuzione l'icona compare nella scheda del browser e viene di norma usata anche dalla scorciatoia; se il telefono mostra ancora la vecchia immagine, cancella la scorciatoia, ricarica la pagina e ricreala. Un'immagine troppo piccola (una favicon da 32 pixel) spinge Android a disegnare da sé una piastrella con l'iniziale.

**Ogni modifica a `Codice.gs` o `Index.html` diventa visibile solo dopo una nuova versione**: `Distribuisci > Gestisci distribuzioni`, matita, `Versione: Nuova versione`, `Distribuisci`. L'URL resta lo stesso. L'indirizzo che termina con `/dev`, raggiungibile da `Distribuisci > Prova distribuzioni`, esegue invece sempre l'ultimo codice salvato ed è comodo per provare le modifiche.

## 7. Promemoria automatico (opzionale)

Editor > icona orologio (`Attivatori`) > `Aggiungi attivatore`: funzione `promemoriaRendiconti`, origine `In base al tempo`, `Timer giornaliero`, fascia serale. Chi ha un giorno prenotato oggi o ieri senza rendiconto riceve una mail con il link.

## 8. Importazione dello storico voli (opzionale)

Aggiungi al progetto un terzo file di script (`+` > `Script`, nome **Importa**) e incolla il contenuto di **Importa.gs**. Ricarica lo Sheet: nel menu `Aliante` compaiono due voci nuove.

`Crea foglio Import storico` genera il foglio `Import` con sette colonne: data del volo, pilota (email oppure nome come scritto in `Utenti`), ICAO di decollo, ICAO di atterraggio, ora di decollo, ora di atterraggio, esito. Le colonne sono formattate come testo, così l'incolla non altera nulla. Gli orari vengono accettati in `hh.mm.ss`, `hh.mm`, `hh:mm:ss`, `hh:mm`, come frazione di giorno o come cella oraria di Sheets.

`Importa storico voli` interpreta ogni riga, calcola la durata e scrive in `Voli`, marcando le righe con `STORICO` in una colonna `Origine` aggiunta in fondo. Nella colonna `Esito` trovi `OK` con la durata, oppure il motivo dello scarto (data illeggibile, pilota non in anagrafica, ICAO non valido, atterraggio non successivo al decollo). Le righe già importate vengono riconosciute da data, ora di decollo e pilota, quindi puoi correggere gli errori e rilanciare senza creare duplicati.

Due interruttori in cima a `Importa.gs`: `IMPORT_TIENI_SECONDI` decide se conservare i secondi negli orari importati, e `IMPORT_CREA_PRENOTAZIONI` (predefinito `false`) genera anche le prenotazioni passate corrispondenti, con stato `CONCLUSA`. Non è necessario per le statistiche: serve solo se vuoi vedere quei giorni colorati nello storico del calendario. Prima di importare puoi eseguire `provaInterpretazioneOrari` e guardare il log, per verificare come vengono letti i tuoi formati.

Attenzione a un dettaglio: il riepilogo in app conteggia solo l'anno in corso, quindi uno storico di annate precedenti resta visibile nel foglio `Voli` (dove si presta a tabelle pivot per pilota e per anno) ma non compare nel riquadro delle ore volate.

## Come si usa

Il calendario mostra il mese con i giorni colorati per socio e il nome di battesimo del titolare. Il tap su un giorno fa la cosa sensata per quel giorno: se è oggi o una data futura e nessuno lo ha preso, apre il pannello di prenotazione; si conferma e il giorno è scritto sullo Sheet. Si può anche prenotare a nome di un altro socio scegliendolo dal menu "Pilota"; in quel caso nelle note resta scritto chi ha inserito la riga.

Se il giorno è **nel passato e libero** non c'è niente da prenotare, quindi l'app apre direttamente la registrazione di un volo già effettuato: pilota, ICAO di decollo e atterraggio, orari, note. È il caso del volo fatto senza passare dall'app. Al salvataggio nascono in un colpo solo la riga del volo nel foglio `Voli` e una riga in `Prenotazioni` di Tipo `RETROATTIVA` e stato `CONCLUSA`, così il giorno risulta occupato nello storico e compare con la spunta nel calendario, con l'etichetta "a posteriori" nelle liste. Come ogni volo registrato, la riga non è più modificabile dall'app: le correzioni si fanno nel foglio. Se il giorno risultava assegnato a qualcuno — anche a una data più vecchia della finestra mostrata in app — il server rifiuta e rimanda al rendiconto normale, quindi non si creano doppioni.

Un tap su un giorno già occupato apre il pannello con il nome del titolare e due possibilità: **Rimuovi e libera il giorno**, oppure **Sovrascrivi** assegnandolo a un socio scelto dal menu. Entrambe chiedono una conferma esplicita, e per le assegnazioni annuali l'avviso è più marcato. Nulla viene cancellato: la riga precedente resta nel foglio con stato `ANNULLATA`, `RILASCIATA` o `SOSTITUITA`, e chi è stato rimosso o sostituito riceve una email insieme agli altri soci. La stessa cosa si può fare dalla scheda `Giorni` con il pulsante "Modifica giorno".

Nella scheda `Voli` compaiono i giorni prenotati da registrare. Il rendiconto chiede quattro dati — ICAO di decollo, ICAO di atterraggio (entrambi con default `LIMA`), ora di decollo e ora di atterraggio — e mostra subito la durata calcolata. È compilabile in qualsiasi momento del giorno stesso del volo, e anche nei giorni successivi se ci si dimentica; mai in anticipo. Al salvataggio la riga finisce nel foglio `Voli` con durata in `hh:mm` e in minuti, il giorno passa a stato `CONCLUSA` e nel calendario compare una spunta. Un volo registrato non è più rimovibile né sovrascrivibile dall'app: eventuali correzioni si fanno nel foglio. Qui compaiono solo i giorni che erano stati prenotati: per un volo fatto su un giorno che nessuno aveva preso si parte dal calendario, toccando quel giorno.

Il riepilogo sotto il calendario mostra, per l'anno in corso, i giorni occupati e le ore volate da ciascun socio.

## Note tecniche

Le date sono salvate come testo `yyyy-mm-dd` e gli orari come testo `HH:MM`, così nessun valore si sposta al cambio di fuso o di ora legale; la colonna `Durata (minuti)` è numerica e si presta a somme e tabelle pivot. Ogni scrittura passa da un `LockService`: se due soci toccano lo stesso giorno nello stesso istante, il secondo riceve un messaggio di conflitto invece di creare una doppia prenotazione. Dopo ogni operazione il server restituisce lo stato completo, quindi l'interfaccia resta allineata senza ricaricare la pagina. Le email sfruttano la quota gratuita Gmail di 100 invii al giorno, ampiamente sufficiente; se preferite silenzio, `NOTIFICA_EMAIL: false`.
