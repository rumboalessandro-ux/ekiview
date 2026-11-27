// Dati finti, usati solo quando non c'è nessuna chiave API (o con ?demo).
// Stesso formato compatto che app.js ricava dalle risposte ODPT.
window.EKI_DEMO = (() => {
  const RW = {
    IK: { id: 'demo.Railway:Ikegami', ja: '池上線', en: 'Ikegami Line', color: '#EE86A7', code: 'IK' },
    A:  { id: 'demo.Railway:Asakusa', ja: '浅草線', en: 'Asakusa Line', color: '#E85298', code: 'A' },
    JY: { id: 'demo.Railway:Yamanote', ja: '山手線', en: 'Yamanote Line', color: '#9ACD32', code: 'JY' },
    JA: { id: 'demo.Railway:Saikyo', ja: '埼京線', en: 'Saikyo Line', color: '#00AC9A', code: 'JA' },
    JS: { id: 'demo.Railway:ShonanShinjuku', ja: '湘南新宿ライン', en: 'Shonan-Shinjuku Line', color: '#E21F26', code: 'JS' },
    R:  { id: 'demo.Railway:Rinkai', ja: 'りんかい線', en: 'Rinkai Line', color: '#00418E', code: 'R' },
  };
  const ST = {
    Gotanda: ['五反田', 'Gotanda'], Kamata: ['蒲田', 'Kamata'], Yukigaya: ['雪が谷大塚', 'Yukigaya-otsuka'],
    Oshiage: ['押上', 'Oshiage'], Takasago: ['京成高砂', 'Keisei-takasago'], Aoto: ['青砥', 'Aoto'],
    Narita: ['成田空港', 'Narita Airport'], Imba: ['印旛日本医大', 'Imba-nihon-idai'],
    Nishimagome: ['西馬込', 'Nishi-magome'], Haneda: ['羽田空港', 'Haneda Airport'], Misakiguchi: ['三崎口', 'Misakiguchi'],
    Ikebukuro: ['池袋', 'Ikebukuro'], Shinagawa: ['品川・東京方面', 'Shinagawa & Tokyo'], Shibuya: ['渋谷・新宿方面', 'Shibuya & Shinjuku'],
    Kawagoe: ['川越', 'Kawagoe'], MusashiUrawa: ['武蔵浦和', 'Musashi-urawa'], Omiya: ['大宮', 'Omiya'],
    ShinKiba: ['新木場', 'Shin-kiba'], Ebina: ['海老名', 'Ebina'], Utsunomiya: ['宇都宮', 'Utsunomiya'], Takasaki: ['高崎', 'Takasaki'],
  };
  const TY = {
    Local: ['各停', 'Local'], Rapid: ['快速', 'Rapid'],
    AirportRapidLimitedExpress: ['エアポート快特', 'Airport Ltd. Exp.'], Express: ['急行', 'Express'],
  };
  const DIR = {
    North: ['押上方面', 'for Oshiage'], South: ['西馬込方面', 'for Nishi-magome'],
    Outer: ['外回り', 'Outer Loop'], Inner: ['内回り', 'Inner Loop'],
    Up: ['上り', 'Northbound'], Down: ['下り', 'Southbound'],
  };

  // [railway, direction, headway(min), offset, platform, pattern [[dest, type], ...]]
  const LINES = {
    '戸越銀座': [
      ['IK', 'Up', 6, 2, '2', [['Gotanda', 'Local']]],
      ['IK', 'Down', 6, 4, '1', [['Kamata', 'Local'], ['Kamata', 'Local'], ['Yukigaya', 'Local']]],
    ],
    '戸越': [
      ['A', 'North', 6, 1, '1', [['Oshiage', 'Local'], ['Takasago', 'Local'], ['Aoto', 'Local'], ['Narita', 'AirportRapidLimitedExpress'], ['Imba', 'Local']]],
      ['A', 'South', 6, 3, '2', [['Nishimagome', 'Local'], ['Haneda', 'AirportRapidLimitedExpress'], ['Nishimagome', 'Local'], ['Misakiguchi', 'Local']]],
    ],
    '大崎': [
      ['JY', 'Outer', 4, 1, '1', [['Shibuya', 'Local']]],
      ['JY', 'Inner', 4, 3, '4', [['Shinagawa', 'Local']]],
      ['JA', 'Up', 10, 5, '5', [['Kawagoe', 'Rapid'], ['MusashiUrawa', 'Local'], ['Omiya', 'Local']]],
      ['JA', 'Down', 10, 8, '6', [['ShinKiba', 'Local'], ['Ebina', 'Local']]],
      ['JS', 'Up', 15, 7, '3', [['Utsunomiya', 'Rapid'], ['Takasaki', 'Local']]],
      ['R', 'Down', 8, 2, '7', [['ShinKiba', 'Local']]],
    ],
    '五反田': [
      ['JY', 'Outer', 4, 2, '1', [['Shibuya', 'Local']]],
      ['JY', 'Inner', 4, 0, '2', [['Shinagawa', 'Local']]],
      ['A', 'North', 6, 2, '1', [['Oshiage', 'Local'], ['Narita', 'AirportRapidLimitedExpress'], ['Aoto', 'Local']]],
      ['A', 'South', 6, 2, '2', [['Nishimagome', 'Local'], ['Haneda', 'AirportRapidLimitedExpress']]],
      ['IK', 'Down', 6, 1, '1', [['Kamata', 'Local'], ['Yukigaya', 'Local']]],
    ],
  };

  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

  return function build(stations) {
    const titles = { st: {}, type: {}, dir: {}, rw: {}, op: {} };
    for (const k in RW) titles.rw[RW[k].id] = RW[k];
    for (const k in ST) titles.st['demo.Station:' + k] = { ja: ST[k][0], en: ST[k][1] };
    for (const k in TY) titles.type['demo.TrainType:' + k] = { ja: TY[k][0], en: TY[k][1] };
    for (const k in DIR) titles.dir['demo.RailDirection:' + k] = { ja: DIR[k][0], en: DIR[k][1] };

    const out = stations.map((cfg) => {
      const groups = (LINES[cfg.ja] || []).map(([rw, dir, hw, off, pf, pattern]) => {
        const make = (headway) => {
          const list = [];
          let i = 0;
          for (let m = 300 + off; m <= 1475; m += headway, i++) {
            const [dest, type] = pattern[i % pattern.length];
            list.push([hhmm(m), 'demo.Station:' + dest, 'demo.TrainType:' + type, pf, m + headway > 1475 ? 1 : 0]);
          }
          return list;
        };
        return {
          rw: RW[rw].id, dir: 'demo.RailDirection:' + dir, op: 'demo',
          cal: { Weekday: make(hw), SaturdayHoliday: make(Math.round(hw * 1.4)) },
        };
      });
      return { groups, errors: [] };
    });
    return { stations: out, titles, info: [{ ja: '各線 平常運転（デモデータ）', en: 'All lines operating normally (demo data)', ok: true }] };
  };
})();
