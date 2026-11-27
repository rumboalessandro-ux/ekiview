'use strict';
(() => {
  const CFG = window.EKI_CONFIG;
  const DAY = 86400000;
  const EP = {
    public: 'https://api.odpt.org/api/v4',
    challenge: 'https://api-challenge.odpt.org/api/v4',
  };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eki.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('eki.' + k, JSON.stringify(v)); } catch { /* quota / privato */ } },
    clearCache() {
      try { Object.keys(localStorage).filter((k) => k.startsWith('eki.c:')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
    },
  };

  function loadSettings() {
    const s = Object.assign({ publicKey: '', challengeKey: '', rows: CFG.rows, walk: {} }, store.get('settings', {}));
    const q = new URLSearchParams(location.search);
    let changed = false;
    for (const k of ['publicKey', 'challengeKey']) {
      if (q.has(k)) { s[k] = q.get(k).trim(); changed = true; }
    }
    if (changed) {
      store.set('settings', s);
      q.delete('publicKey'); q.delete('challengeKey');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    }
    s.demo = q.has('demo') || (!s.publicKey && !s.challengeKey);
    return s;
  }
  const S = loadSettings();
  const walkOf = (st) => Number(S.walk[st.ja] ?? st.walk ?? 0) || 0;

  // ------------------------------------------------------------ Tokyo time
  const TZ = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  function tokyoParts() {
    const p = {};
    for (const x of TZ.formatToParts(new Date())) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  // La "giornata di servizio" va dalle 3:00 alle 3:00: i treni dopo mezzanotte
  // appartengono all'orario del giorno prima.
  function serviceClock() {
    const p = tokyoParts();
    let day = Date.UTC(p.y, p.m - 1, p.d);
    let min = p.h * 60 + p.mi + p.s / 60;
    if (p.h < 3) { day -= DAY; min += 1440; }
    return { p, day, min };
  }

  // ------------------------------------------------------- Japanese holidays
  const holidayCache = {};
  const firstMonday = (y, m) => 1 + ((8 - new Date(Date.UTC(y, m - 1, 1)).getUTCDay()) % 7);
  const nthMonday = (y, m, n) => firstMonday(y, m) + (n - 1) * 7;
  const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const md = [
      [1, 1], [1, nthMonday(y, 1, 2)], [2, 11], [2, 23], [3, equinox(y, 20.8431)], [4, 29],
      [5, 3], [5, 4], [5, 5], [7, nthMonday(y, 7, 3)], [8, 11], [9, nthMonday(y, 9, 3)],
      [9, equinox(y, 23.2488)], [10, nthMonday(y, 10, 2)], [11, 3], [11, 23],
    ];
    const set = new Set(md.map(([m, d]) => Date.UTC(y, m - 1, d)));
    for (const t of [...set].sort((a, b) => a - b)) { // 振替休日
      if (new Date(t).getUTCDay() === 0) { let n = t + DAY; while (set.has(n)) n += DAY; set.add(n); }
    }
    for (const t of [...set]) { // 国民の休日
      if (set.has(t + 2 * DAY) && !set.has(t + DAY) && new Date(t + DAY).getUTCDay() !== 0) set.add(t + DAY);
    }
    return (holidayCache[y] = set);
  }
  function dayType(dayMs) {
    const d = new Date(dayMs);
    const m = d.getUTCMonth() + 1, dd = d.getUTCDate(), dow = d.getUTCDay();
    if ((m === 12 && dd >= 30) || (m === 1 && dd <= 3)) return 'Holiday'; // 年末年始は土休日ダイヤ
    if (dow === 0 || holidays(d.getUTCFullYear()).has(dayMs)) return 'Holiday';
    return dow === 6 ? 'Saturday' : 'Weekday';
  }
  const CAL_PREF = {
    Weekday: ['Weekday'],
    Saturday: ['Saturday', 'SaturdayHoliday'],
    Holiday: ['Holiday', 'SundayHoliday', 'SaturdayHoliday', 'Sunday'],
  };
  const DAYTYPE_LABEL = {
    Weekday: ['平日ダイヤ', 'Weekday'], Saturday: ['土曜ダイヤ', 'Saturday'], Holiday: ['土休日ダイヤ', 'Holiday'],
  };
  function pickCalendar(cal, type) {
    for (const c of CAL_PREF[type]) if (cal[c]) return cal[c];
    return null;
  }

  // -------------------------------------------------------------------- API
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const keyFor = (ep) => (ep === 'public' ? S.publicKey : S.challengeKey);

  async function api(ep, type, params = {}) {
    const qs = Object.entries({ ...params, 'acl:consumerKey': keyFor(ep) })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const r = await fetch(`${EP[ep]}/${type}?${qs}`);
    if (!r.ok) throw new ApiError(r.status, `${type} (${ep}): HTTP ${r.status}`);
    return r.json();
  }
  async function cached(key, ttl, fn) {
    const c = store.get('c:' + key);
    if (c && Date.now() - c.t < ttl) return c.v;
    try {
      const v = await fn();
      store.set('c:' + key, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (c) return c.v; // meglio un dato vecchio che niente
      throw e;
    }
  }
  const tl = (o, ja) => ({ ja: o?.ja || ja || o?.en || '', en: o?.en || o?.ja || ja || '' });

  // ----------------------------------------------------------------- titles
  const T = { st: {}, type: {}, dir: {}, rw: {}, op: {} };

  const DEST_JA = {
    Aoto: '青砥', KeiseiTakasago: '京成高砂', Oshiage: '押上', ImbaNihonIdai: '印旛日本医大',
    NaritaAirportTerminal1: '成田空港', NaritaAirport: '成田空港', ShibayamaChiyoda: '芝山千代田',
    KeiseiNarita: '京成成田', KeiseiSakura: '京成佐倉', Nishimagome: '西馬込', NishiMagome: '西馬込',
    HanedaAirportTerminal1and2: '羽田空港', HanedaAirportTerminal3: '羽田空港第3', Misakiguchi: '三崎口',
    KeikyuKurihama: '京急久里浜', Uraga: '浦賀', KanazawaBunko: '金沢文庫', Sengakuji: '泉岳寺',
    Kamata: '蒲田', Gotanda: '五反田', Yukigayaotsuka: '雪が谷大塚', YukigayaOtsuka: '雪が谷大塚',
    Kawagoe: '川越', MusashiUrawa: '武蔵浦和', Omiya: '大宮', Akabane: '赤羽', Ikebukuro: '池袋',
    Shinjuku: '新宿', ShinKiba: '新木場', Shinkiba: '新木場', TokyoTeleport: '東京テレポート',
    Ebina: '海老名', ShinYokohama: '新横浜', Utsunomiya: '宇都宮', Takasaki: '高崎', Koganei: '小金井',
    Kagohara: '籠原', Zushi: '逗子', Odawara: '小田原', Hiratsuka: '平塚', Kozu: '国府津', Ofuna: '大船',
    Osaki: '大崎', Shinagawa: '品川', Tokyo: '東京', Ueno: '上野', Shibuya: '渋谷',
  };
  const TYPE_FALLBACK = {
    Local: ['各停', 'Local'], Rapid: ['快速', 'Rapid'], CommuterRapid: ['通勤快速', 'Comm. Rapid'],
    Express: ['急行', 'Express'], LimitedExpress: ['特急', 'Ltd. Exp.'], RapidLimitedExpress: ['快特', 'Rapid Ltd. Exp.'],
    AirportRapidLimitedExpress: ['エアポート快特', 'Airport Ltd. Exp.'], AccessExpress: ['アクセス特急', 'Access Exp.'],
    SpecialRapid: ['特別快速', 'Special Rapid'], CommuterLimitedExpress: ['通勤特急', 'Comm. Ltd. Exp.'],
  };
  const LINE_FALLBACK = {
    Asakusa: ['#E85298', 'A'], Ikegami: ['#EE86A7', 'IK'], Yamanote: ['#9ACD32', 'JY'],
    SaikyoKawagoe: ['#00AC9A', 'JA'], Saikyo: ['#00AC9A', 'JA'], ShonanShinjuku: ['#E21F26', 'JS'],
    Rinkai: ['#00418E', 'R'], SotetsuDirect: ['#00AC9A', 'JA'],
  };
  const seg = (id) => String(id || '').split(/[.:]/).pop();
  const spaced = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

  function stTitle(id) {
    if (T.st[id]) return T.st[id];
    const s = seg(id);
    return { ja: DEST_JA[s] || spaced(s), en: spaced(s) };
  }
  function typeTitle(id) {
    if (T.type[id]) return T.type[id];
    const f = TYPE_FALLBACK[seg(id)];
    return f ? { ja: f[0], en: f[1] } : { ja: spaced(seg(id)), en: spaced(seg(id)) };
  }
  function rwInfo(id) {
    const r = T.rw[id] || {};
    const f = LINE_FALLBACK[seg(id)] || [];
    return { ja: r.ja || spaced(seg(id)), en: r.en || spaced(seg(id)), color: r.color || f[0] || '#888', code: r.code || f[1] || seg(id).slice(0, 2).toUpperCase() };
  }
  function typeClass(id) {
    const s = seg(id);
    if (/Airport|Access/.test(s)) return 't-orange';
    if (/Rapid/.test(s)) return 't-orange';
    if (/Express/.test(s)) return 't-red';
    if (/Local|Ordinary/.test(s)) return 't-green';
    return 't-white';
  }

  async function loadRailway(ep, rw) {
    const v = await cached(`${ep}:rw:${rw}`, 7 * DAY, async () => {
      const [info, stations] = await Promise.all([
        api(ep, 'odpt:Railway', { 'owl:sameAs': rw }),
        api(ep, 'odpt:Station', { 'odpt:railway': rw }),
      ]);
      const r = info[0] || {};
      return {
        rw: { ...tl(r['odpt:railwayTitle'], r['dc:title']), color: r['odpt:color'] || '', code: r['odpt:lineCode'] || '' },
        st: Object.fromEntries(stations.map((s) => [s['owl:sameAs'], tl(s['odpt:stationTitle'], s['dc:title'])])),
      };
    });
    T.rw[rw] = v.rw;
    Object.assign(T.st, v.st);
  }
  async function loadTypes(ep, op) {
    const v = await cached(`${ep}:ty:${op}`, 7 * DAY, async () => {
      const a = await api(ep, 'odpt:TrainType', { 'odpt:operator': op });
      return Object.fromEntries(a.map((t) => [t['owl:sameAs'], tl(t['odpt:trainTypeTitle'], t['dc:title'])]));
    });
    Object.assign(T.type, v);
  }
  async function loadDirs(ep) {
    const v = await cached(`${ep}:dir`, 7 * DAY, async () => {
      const a = await api(ep, 'odpt:RailDirection');
      return Object.fromEntries(a.map((d) => [d['owl:sameAs'], tl(d['odpt:railDirectionTitle'], d['dc:title'])]));
    });
    Object.assign(T.dir, v);
  }

  // Riduce la StationTimetable ODPT a un formato compatto (sta nel localStorage).
  function compactTimetables(arr) {
    const groups = {};
    for (const tt of arr) {
      const rw = tt['odpt:railway'], dir = tt['odpt:railDirection'];
      const key = rw + '|' + dir;
      const g = (groups[key] ||= { rw, dir, op: tt['odpt:operator'], cal: {} });
      const cal = seg(tt['odpt:calendar']);
      const list = (g.cal[cal] ||= []);
      for (const o of tt['odpt:stationTimetableObject'] || []) {
        if (!o['odpt:departureTime']) continue; // capolinea: solo arrivo
        const dest = (o['odpt:destinationStation'] || [])[0] || '';
        list.push([o['odpt:departureTime'], dest, o['odpt:trainType'] || '', o['odpt:platformNumber'] || '', o['odpt:isLast'] ? 1 : 0]);
      }
    }
    return Object.values(groups);
  }

  async function loadStation(cfg) {
    const eps = Object.keys(EP).filter(keyFor);
    const found = new Map();
    const errors = [];
    const exclude = cfg.exclude || [];

    if (cfg.stationIds) {
      for (const x of cfg.stationIds) {
        const [ep, id] = x.includes('|') ? x.split('|') : [eps[0], x];
        found.set(id, { id, ep, rw: id.split(':')[1].split('.').slice(0, 2).join('.').replace(/^/, 'odpt.Railway:'), op: 'odpt.Operator:' + id.split(':')[1].split('.')[0] });
      }
    } else {
      for (const ep of eps) {
        try {
          const list = await cached(`${ep}:find:${cfg.ja}`, 7 * DAY, async () =>
            (await api(ep, 'odpt:Station', { 'dc:title': cfg.ja })).map((s) => ({
              id: s['owl:sameAs'], rw: s['odpt:railway'], op: s['odpt:operator'],
            })));
          for (const s of list) {
            if (!found.has(s.id) && !exclude.some((x) => s.id.includes(x))) found.set(s.id, { ...s, ep });
          }
        } catch (e) { errors.push(e); }
      }
    }

    const groups = [];
    const ops = new Map();
    await Promise.all([...found.values()].map(async (s) => {
      try {
        await Promise.all([
          loadRailway(s.ep, s.rw).catch(() => {}),
          loadTypes(s.ep, s.op).catch(() => {}),
          loadDirs(s.ep).catch(() => {}),
        ]);
        const gs = await cached(`${s.ep}:tt:${s.id}`, DAY, async () =>
          compactTimetables(await api(s.ep, 'odpt:StationTimetable', { 'odpt:station': s.id })));
        if (gs.length) ops.set(s.op, s.ep);
        groups.push(...gs);
      } catch (e) { errors.push(e); }
    }));
    groups.sort((a, b) => (a.rw + a.dir).localeCompare(b.rw + b.dir));
    return { groups, errors, ops, foundCount: found.size };
  }

  async function loadInfo(opsMap, railways) {
    const out = [];
    await Promise.all([...opsMap].map(async ([op, ep]) => {
      try {
        const a = await api(ep, 'odpt:TrainInformation', { 'odpt:operator': op });
        for (const i of a) {
          const rw = i['odpt:railway'];
          if (rw && !railways.has(rw)) continue;
          const text = tl(i['odpt:trainInformationText']);
          if (!text.ja) continue;
          const status = tl(i['odpt:trainInformationStatus']);
          const ok = !status.ja || /平常/.test(status.ja + text.ja);
          const name = rw ? rwInfo(rw) : { ja: seg(op), en: seg(op) };
          out.push({ ja: `${name.ja}：${text.ja}`, en: `${name.en}: ${text.en}`, ok });
        }
      } catch { /* l'informazione di servizio è opzionale */ }
    }));
    return out;
  }

  // ----------------------------------------------------------------- state
  let DATA = CFG.stations.map(() => ({ groups: [], errors: [], loading: true }));
  let INFO = [];

  async function loadAll() {
    if (S.demo) {
      const d = window.EKI_DEMO(CFG.stations);
      Object.assign(T, d.titles);
      DATA = d.stations;
      INFO = d.info;
      return;
    }
    const res = await Promise.all(CFG.stations.map(loadStation));
    DATA = res;
    const ops = new Map(), rws = new Set();
    for (const r of res) { r.ops.forEach((ep, op) => ops.set(op, ep)); r.groups.forEach((g) => rws.add(g.rw)); }
    INFO = await loadInfo(ops, rws);
  }
  async function refreshInfo() {
    if (S.demo) return;
    const ops = new Map(), rws = new Set();
    for (const r of DATA) { r.ops?.forEach((ep, op) => ops.set(op, ep)); r.groups.forEach((g) => rws.add(g.rw)); }
    INFO = await loadInfo(ops, rws);
    renderTicker();
  }

  // ---------------------------------------------------------------- compute
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  function upcoming(st, day, now, rows) {
    const all = [];
    for (const off of [0, 1]) {
      const type = dayType(day + off * DAY);
      st.groups.forEach((g, gi) => {
        const list = pickCalendar(g.cal, type);
        if (!list) return;
        for (const [t, dest, tt, pf, last] of list) {
          let m = toMin(t);
          if (m < 180) m += 1440;
          m += off * 1440;
          if (m >= now - 0.5) all.push({ m, t, dest, tt, pf, last, g, gi });
        }
      });
    }
    all.sort((a, b) => a.m - b.m);
    // ogni linea/direzione ha garantito il suo prossimo treno, il resto in ordine di orario
    const chosen = new Set();
    const firsts = new Map();
    for (const e of all) if (!firsts.has(e.gi)) firsts.set(e.gi, e);
    for (const e of [...firsts.values()].sort((a, b) => a.m - b.m).slice(0, rows)) chosen.add(e);
    for (const e of all) { if (chosen.size >= rows) break; chosen.add(e); }
    return [...chosen].sort((a, b) => a.m - b.m);
  }

  // ----------------------------------------------------------------- render
  const both = (o, cls = '') => `<span class="ja ${cls}">${esc(o.ja)}</span><span class="en ${cls}">${esc(o.en)}</span>`;
  const badge = (r) => `<span class="badge" style="--c:${esc(r.color)}" title="${esc(r.ja)}">${esc(r.code)}</span>`;

  function buildBoard() {
    $('#board').innerHTML = CFG.stations.map((st, i) => `
      <section class="panel" id="p${i}">
        <div class="panel-head">
          <span class="st-name">${both(st)}</span>
          <span class="st-walk" id="w${i}"></span>
          <span class="st-lines" id="l${i}"></span>
        </div>
        <div class="cols">
          <span>${both({ ja: '路線', en: 'Line' })}</span>
          <span>${both({ ja: '種別', en: 'Type' })}</span>
          <span>${both({ ja: '時刻', en: 'Time' })}</span>
          <span>${both({ ja: '行先', en: 'Destination' })}</span>
          <span>${both({ ja: '番線', en: 'Plat.' })}</span>
          <span style="text-align:right">${both({ ja: '発車まで', en: 'Departs' })}</span>
        </div>
        <div class="rows" id="r${i}"></div>
      </section>`).join('');
  }

  function errorText(st) {
    const e = st.errors[0];
    if (!e) return null;
    if (e.status === 401 || e.status === 403) return { ja: 'APIキーが無効です', en: 'Chiave API non valida (HTTP ' + e.status + ')' };
    if (e instanceof TypeError) return { ja: '接続できません', en: 'Rete non raggiungibile' };
    return { ja: 'データ取得エラー', en: e.message };
  }

  function renderPanels() {
    const { day, min } = serviceClock();
    const rows = Math.max(2, Math.min(12, Number(S.rows) || CFG.rows));
    CFG.stations.forEach((cfg, i) => {
      const st = DATA[i];
      const walk = walkOf(cfg);
      $('#w' + i).innerHTML = walk ? both({ ja: `徒歩${walk}分`, en: `${walk} min walk` }) : '';
      const seen = new Map();
      for (const g of st.groups) { const r = rwInfo(g.rw); seen.set(r.code + r.color, r); }
      $('#l' + i).innerHTML = [...seen.values()].map(badge).join('');

      const box = $('#r' + i);
      if (st.loading) { box.innerHTML = `<div class="msg">${both({ ja: '読み込み中…', en: 'Loading…' })}</div>`; return; }
      const list = upcoming(st, day, min, rows);
      if (!list.length) {
        const err = errorText(st);
        if (err) { box.innerHTML = `<div class="msg err">${both(err)}</div>`; return; }
        const none = st.groups.length || st.foundCount === undefined
          ? { ja: '本日の運転は終了しました', en: 'No more departures today' }
          : { ja: '時刻表データがありません', en: 'Nessun orario per questa stazione con le chiavi attuali' };
        box.innerHTML = `<div class="msg">${both(none)}</div>`;
        return;
      }
      box.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      box.innerHTML = list.map((e) => {
        const diff = e.m - min;
        const r = rwInfo(e.g.rw);
        const ty = typeTitle(e.tt);
        const showDir = (CFG.showDirectionFor || []).includes(r.code) && T.dir[e.g.dir];
        const mins = Math.max(0, Math.floor(diff));
        const eta = diff < 1
          ? both({ ja: 'まもなく', en: 'Now' })
          : `<span class="ja">あと<b>${mins}</b>分</span><span class="en"><b>${mins}</b> min</span>`;
        const cls = ['row', diff < walk ? 'dim' : '', diff < 1 ? 'now' : diff < 3 ? 'soon' : ''].join(' ');
        return `<div class="${cls}">
          ${badge(r)}
          <span class="type ${typeClass(e.tt)}">${both(ty)}</span>
          <span class="time">${esc(e.t)}</span>
          <span class="dest">${both(stTitle(e.dest))}${showDir ? `<small>${both(T.dir[e.g.dir])}</small>` : ''}${e.last ? `<span class="last-tag">${both({ ja: '終電', en: 'Last' })}</span>` : ''}</span>
          <span class="pf">${esc(e.pf)}</span>
          <span class="eta">${eta}</span>
        </div>`;
      }).join('');
    });
  }

  function renderClock() {
    const { p, day } = serviceClock();
    const pad = (n) => String(n).padStart(2, '0');
    $('#clock').innerHTML = `${pad(p.h)}:${pad(p.mi)}<small>:${pad(p.s)}</small>`;
    const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    const W = ['日', '月', '火', '水', '木', '金', '土'];
    const WE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    $('#date').innerHTML = both({ ja: `${p.m}月${p.d}日(${W[dow]})`, en: `${WE[dow]} ${p.d} ${ME[p.m - 1]}` });
    const dt = DAYTYPE_LABEL[dayType(day)];
    $('#daytype').innerHTML = both({ ja: dt[0], en: dt[1] });
  }

  let tickerSig = '';
  function renderTicker() {
    const bad = INFO.filter((i) => !i.ok);
    const items = bad.length ? bad : (INFO.length ? [{ ja: '各線 平常運転', en: 'All lines operating normally', ok: true }] : []);
    const html = items.length
      ? items.map((i) => both(i)).join('<span class="sep">◆</span>')
      : both({ ja: '運行情報を取得できません', en: 'Service information unavailable' });
    if (html === tickerSig) return;
    tickerSig = html;
    const el = $('#ticker');
    el.innerHTML = html;
    el.classList.toggle('alert', bad.length > 0);
    el.classList.toggle('scroll', bad.length > 0);
    el.style.setProperty('--dur', Math.max(20, el.textContent.length * 0.25) + 's');
  }

  // --------------------------------------------------------------- settings
  function openSettings() {
    const f = $('#settings-form');
    f.publicKey.value = S.publicKey;
    f.challengeKey.value = S.challengeKey;
    f.rows.value = S.rows;
    $('#walk-fields').innerHTML = '<legend>Minuti a piedi da casa</legend>' + CFG.stations.map((st, i) =>
      `<label>${esc(st.ja)} · ${esc(st.en)}<input name="walk${i}" type="number" min="0" max="60" value="${walkOf(st)}"></label>`).join('');
    $('#settings').showModal();
  }
  $('#settings').addEventListener('close', () => {
    const v = $('#settings').returnValue;
    if (v === 'cancel' || !v) return;
    if (v === 'clear') { store.clearCache(); location.reload(); return; }
    const f = $('#settings-form');
    const walk = {};
    CFG.stations.forEach((st, i) => { walk[st.ja] = Number(f['walk' + i].value) || 0; });
    store.set('settings', {
      publicKey: f.publicKey.value.trim(), challengeKey: f.challengeKey.value.trim(),
      rows: Number(f.rows.value) || CFG.rows, walk,
    });
    store.clearCache();
    location.reload();
  });
  $('#settings-btn').addEventListener('click', openSettings);

  // ------------------------------------------------------------------- boot
  $('#demo-badge').hidden = !S.demo;
  buildBoard();
  renderClock();
  renderPanels();
  setInterval(renderClock, 1000);
  setInterval(renderPanels, 5000);
  setInterval(() => document.body.classList.toggle('lang-en'), (CFG.langSwitchSeconds || 6) * 1000);

  const boot = () => loadAll()
    .catch((e) => console.error(e))
    .finally(() => { renderPanels(); renderTicker(); });
  boot();
  setInterval(boot, 60 * 60 * 1000);       // ricarica (dalla cache) ogni ora
  setInterval(refreshInfo, 3 * 60 * 1000); // 運行情報 ogni 3 minuti
  window.EKI = { T, get DATA() { return DATA; }, S };
})();
