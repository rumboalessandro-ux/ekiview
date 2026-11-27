# Ekiview — 発車案内

Tabellone in stile stazione giapponese con i prossimi treni da 戸越銀座, 戸越, 大崎 e 五反田.
È una pagina statica (HTML/CSS/JS, senza build) pensata per uno schermo o un tablet in orizzontale.

## Dati

Gli orari arrivano dall'API **ODPT** (Open Data for Public Transportation, Tokyo):

| Stazione | Linee | Dove si trovano di solito |
|---|---|---|
| 戸越銀座 | Tokyu Ikegami | API Challenge |
| 戸越 | Toei Asakusa | API pubblica |
| 大崎 | JR Yamanote / Saikyō / Shōnan-Shinjuku, Rinkai | API Challenge |
| 五反田 | JR Yamanote, Toei Asakusa, Tokyu Ikegami | entrambe |

1. Registrati su <https://developer.odpt.org/> per ottenere la chiave dell'API pubblica, e su quella
   "Challenge" se vuoi JR/Tokyu/Rinkai.
2. Apri la pagina, premi ⚙ e incolla le chiavi. Restano solo nel `localStorage` del browser
   (in alternativa: `index.html?publicKey=…&challengeKey=…`, che le salva e poi le toglie dall'URL).

Senza chiavi la pagina gira in **modalità demo** con orari finti (si può forzare con `?demo`).

Le linee di ogni stazione vengono trovate cercando il nome (`dc:title`) su ODPT, quindi non ci sono
ID da scrivere a mano. Se serve, `config.js` permette di forzare `stationIds` o di escludere linee.

### Come funziona

- Gli orari delle stazioni sono messi in cache per 24 ore, i metadati (nomi, colori, tipi di treno)
  per 7 giorni. Il pulsante ⚙ → "Svuota cache" forza il ricaricamento.
- Il tipo di giornata (平日 / 土曜 / 土休日) è calcolato con le festività giapponesi. Dal 30/12
  al 3/1 vale l'orario festivo.
- Dopo mezzanotte valgono gli orari del giorno prima, fino alle 3:00.
- Ogni linea/direzione ha garantito il suo prossimo treno; le righe che restano sono ordinate per
  orario.
- Il ticker in basso mostra 運行情報 (`odpt:TrainInformation`) e si aggiorna ogni 3 minuti.
- Con i minuti a piedi (⚙) i treni che non faresti in tempo a prendere vengono attenuati.

**Nota:** la chiave è visibile a chiunque apra la pagina, perché le chiamate partono dal browser.
Va bene per un uso personale; non pubblicare la pagina con la chiave dentro l'URL.

## Pubblicazione

Basta servire la cartella in modo statico, per esempio con GitHub Pages
(Settings → Pages → branch) o in locale:

```sh
python3 -m http.server 8000
```
