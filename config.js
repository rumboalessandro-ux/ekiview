// Configurazione del tabellone.
// Le chiavi API NON vanno qui: si inseriscono dal pulsante ⚙ nella pagina
// (restano solo nel localStorage del browser).
window.EKI_CONFIG = {
  // Righe per stazione. Ogni linea/direzione ha garantito almeno il prossimo treno.
  rows: 6,

  // Secondi tra l'alternanza giapponese / inglese (come i tabelloni veri).
  langSwitchSeconds: 6,

  // Stazioni. "ja" deve corrispondere esattamente al dc:title ODPT: serve a
  // scoprire automaticamente tutte le linee che fermano lì.
  // "walk" = minuti a piedi da casa (modificabile anche dalle impostazioni):
  // i treni che non fai in tempo a prendere vengono attenuati.
  // "stationIds" (opzionale) forza gli ID ODPT invece della ricerca per nome.
  // "exclude" (opzionale) esclude gli ID che contengono una di queste stringhe.
  stations: [
    { ja: '戸越銀座', en: 'Togoshi-ginza', walk: 0 },
    { ja: '戸越',     en: 'Togoshi',       walk: 0 },
    { ja: '大崎',     en: 'Osaki',         walk: 0 },
    { ja: '五反田',   en: 'Gotanda',       walk: 0 },
  ],

  // Codici linea per cui mostrare anche la direzione (utile per le linee ad
  // anello come la Yamanote, dove la destinazione dice poco).
  showDirectionFor: ['JY'],
};
