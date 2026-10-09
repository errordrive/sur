/* Sur v2 — premium music player frontend */
const $ = id => document.getElementById(id);
const APP_VERSION = '2.0.0';
const audio = $('audio');
const view = $('view');

/* PWA: installable app shell + offline shell cache */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ---------------- state ---------------- */
const S = {
  tab: 'home', queue: [], idx: 0, shuffle: false, repeat: 'off',
  lyricsBrowseId: null, currentId: null, order: [], disliked: false,
  playSeq: 0, retried: false, suppressErr: false, seeking: false, loading: false,
  pTab: 'queue',
  likes: JSON.parse(localStorage.getItem('mm_likes') || '[]'),
  history: JSON.parse(localStorage.getItem('sur_history') || '[]'),
  recent: JSON.parse(localStorage.getItem('sur_recent_searches') || '[]'),
};
function saveLikes() { localStorage.setItem('mm_likes', JSON.stringify(S.likes)); }
function saveHistory() {
  try { localStorage.setItem('sur_history', JSON.stringify(S.history.slice(0, 60))); }
  catch (e) {}
}
function persistRecent() {
  try { localStorage.setItem('sur_recent_searches', JSON.stringify(S.recent.slice(0, 10))); }
  catch (e) {}
}
function pushHistory(t) {
  if (!t || !t.videoId) return;
  S.history = S.history.filter(x => x.videoId !== t.videoId);
  S.history.unshift({
    videoId: t.videoId, title: t.title, artists: t.artists,
    thumbnail: art(t), duration: t.duration,
  });
  S.history = S.history.slice(0, 60);
  saveHistory();
}

/* Track registry: any rendered track is playable by id even without a list context */
const TRACK_REG = {};
function reg(tracks) {
  (tracks || []).forEach(t => { if (t && t.videoId) TRACK_REG[t.videoId] = t; });
}

/* ---------------- helpers ---------------- */
function ic(n, cls) {
  return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
}
async function api(path, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 45000);
  try {
    const r = await fetch(path, { signal: ctrl.signal });
    let j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('request timed out');
    throw e;
  } finally { clearTimeout(timer); }
}
function fmt(sec) {
  if (!sec || sec < 0 || !isFinite(sec)) return '0:00';
  sec = Math.floor(sec);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function art(t) {
  return t.thumbnail || (t.videoId ? 'https://i.ytimg.com/vi/' + t.videoId + '/hqdefault.jpg' : '');
}
function greet() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
}
function errBox(msg, retry) {
  view.innerHTML = '<div class="err"><div>' + esc(msg) + '</div>' +
    (retry ? '<div><button class="pill solid" id="errRetry">Retry</button></div>' : '') + '</div>';
  if (retry) $('errRetry').onclick = retry;
}
function secHead(t) {
  return '<div class="sec-head"><div class="sec-title">' + esc(t) + '</div></div>';
}
function skelRows(n) {
  n = n || 6;
  let h = '';
  for (let i = 0; i < n; i++)
    h += '<div class="skel-row"><div class="skel a"></div><div class="b"><div class="skel l1"></div><div class="skel l2"></div></div></div>';
  return h;
}
function skelCards(n) {
  n = n || 6;
  let h = '<div class="skel-cards">';
  for (let i = 0; i < n; i++)
    h += '<div class="skel-card"><div class="skel a"></div><div class="skel l1"></div></div>';
  return h + '</div>';
}

/* ---------------- toasts (never fail silently) ---------------- */
function toast(msg, opts) {
  opts = opts || {};
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  const sp = document.createElement('span');
  sp.textContent = msg;
  el.appendChild(sp);
  function dismiss() {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action;
    b.onclick = () => { dismiss(); if (opts.onAction) opts.onAction(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(dismiss, opts.timeout || 4200);
}
function diagToast() {
  return { action: 'Diagnostics', onAction: () => setTab('settings'), timeout: 7000 };
}

/* ---------------- dynamic accent from artwork ---------------- */
const DEFAULT_ACCENT = '#ff4d6d';
function setAccent(hex) {
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    root.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',.14)');
    root.setProperty('--accent-glow', 'rgba(' + r + ',' + g + ',' + b + ',.32)');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#0a0a0f');
}
function extractAccent(url) {
  setAccent(DEFAULT_ACCENT);
  if (!url) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 48, 48);
      const d = x.getImageData(0, 0, 48, 48).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        if (d[i + 3] < 128) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (!n) return;
      r /= n; g /= n; b /= n;
      // boost saturation
      const avg = (r + g + b) / 3, sat = 1.45;
      r = avg + (r - avg) * sat; g = avg + (g - avg) * sat; b = avg + (b - avg) * sat;
      // keep luminance in a visible band on dark backgrounds
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 80 && lum > 0) { const k = 80 / lum; r *= k; g *= k; b *= k; lum = 80; }
      if (lum > 190) { const k = 190 / lum; r *= k; g *= k; b *= k; }
      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));
      setAccent('#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1));
    } catch (e) { /* tainted canvas or CORS — keep default */ }
  };
  img.onerror = () => {};
  img.src = url;
}

/* ---------------- navigation ---------------- */
const navStack = [];
function nav(fn) { navStack.push(fn); fn(); }
function goBack() {
  navStack.pop();
  const fn = navStack[navStack.length - 1];
  if (fn) fn(); else renderTab();
}
function setTab(tab) {
  S.tab = tab; navStack.length = 0;
  document.querySelectorAll('.navbtn, .snavbtn').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  renderTab();
  view.focus({ preventScroll: true });
}
function renderTab() {
  navStack.length = 0;
  ({ home: showHome, search: showSearch, library: showLibrary, settings: showSettings })[S.tab]();
}

/* ---------------- shared row / card html ---------------- */
function rowHtml(t, rank) {
  return '<div class="row" data-vid="' + t.videoId + '">' +
    (rank ? '<div class="rk">' + rank + '</div>' : '') +
    '<img loading="lazy" src="' + esc(art(t)) + '" alt="">' +
    '<div class="mid"><div class="t">' + esc(t.title) + '</div>' +
    '<div class="s">' + esc(t.artists || '') + '</div></div>' +
    '<span class="eq"><i></i><i></i><i></i></span>' +
    '<div class="d">' + esc(t.duration || '') + '</div></div>';
}
function trackCard(t) {
  return '<div class="card" data-vid="' + t.videoId + '">' +
    '<img loading="lazy" src="' + esc(art(t)) + '" alt="">' +
    '<div class="t">' + esc(t.title) + '</div><div class="s">' + esc(t.artists || '') + '</div></div>';
}
function setCtx(id, tracks) {
  const el = $(id);
  if (el) el._tracks = tracks;
}

/* ---------------- home ---------------- */
async function showHome() {
  view.innerHTML = '<div class="greet">' + greet() + '</div>' +
    '<div class="sec">Jump back in</div>' + skelCards(4) +
    '<div class="sec">Trending now</div>' + skelCards(6);
  try {
    const h = await api('/api/home');
    reg(h.trending);
    let html = '<div class="greet">' + greet() + '</div>';
    const hist = S.history.slice(0, 10);
    if (hist.length) {
      reg(hist);
      html += secHead('Jump back in') +
        '<div class="hscroll" data-ctx id="histRail">' + hist.map(trackCard).join('') + '</div>';
    }
    if (h.moods && h.moods.length) {
      html += '<div class="sec">Moods</div><div class="chips">' +
        h.moods.map(m => '<button class="chip" data-mood="' + esc(m.params) + '" data-mtitle="' + esc(m.title) + '">' + esc(m.title) + '</button>').join('') +
        '</div>';
    }
    const tr = h.trending || [];
    if (tr.length) {
      html += secHead('Trending now') +
        '<div class="hscroll" data-ctx id="trendRail">' + tr.map(trackCard).join('') + '</div>';
    }
    const ar = h.artists || [];
    if (ar.length) {
      html += secHead('Top artists') + '<div class="hscroll">' + ar.map(a =>
        '<div class="card round" data-artist="' + esc(a.browseId) + '">' +
        '<img loading="lazy" src="' + esc(a.thumbnail || '') + '" alt="">' +
        '<div class="t">' + esc(a.name) + '</div><div class="s">Artist</div></div>').join('') + '</div>';
    }
    if (!hist.length && !tr.length && !ar.length) {
      html += '<div class="empty">' + ic('note') + '<h3>Nothing here yet</h3><p>Search for music to get started.</p></div>';
    }
    view.innerHTML = html;
    view._ctxTracks = tr;
    setCtx('histRail', hist);
    setCtx('trendRail', tr);
    bindAll();
  } catch (e) { errBox('Could not load home. ' + e.message, showHome); }
}

async function showMood(params, title) {
  view.innerHTML = '<div class="spin"></div>';
  try {
    const pls = await api('/api/mood?params=' + encodeURIComponent(params));
    view.innerHTML = '<div class="backrow"><button class="iconbtn" id="bk" aria-label="Back">' + ic('back') + '</button></div>' +
      '<div class="greet" style="margin-top:0">' + esc(title) + '</div>' +
      '<div class="grid2">' + pls.map(p =>
        '<div class="card" data-playlist="' + esc(p.playlistId) + '"><img loading="lazy" src="' + esc(p.thumbnail) + '" alt="">' +
        '<div class="t">' + esc(p.title) + '</div><div class="s">Playlist</div></div>').join('') + '</div>';
    $('bk').onclick = goBack;
    bindAll();
  } catch (e) { errBox('Could not load. ' + e.message, () => showMood(params, title)); }
}

/* ---------------- search ---------------- */
let suggestTimer = null, lastQuery = '';

function showSearch() {
  view.innerHTML =
    '<div class="searchwrap"><div class="searchbox">' + ic('search', 'sm') +
    '<input id="q" placeholder="Search songs, artists, albums..." value="' + esc(lastQuery) + '" autocomplete="off" enterkeyhint="search">' +
    '<button class="iconbtn" id="qClear" style="display:none" aria-label="Clear search">' + ic('x', 'sm') + '</button></div>' +
    '<div class="suggest hidden" id="sug"></div></div>' +
    '<div id="recentWrap"></div><div id="res"></div>';
  renderRecent();
  const q = $('q'), sug = $('sug');
  const updClear = () => { $('qClear').style.display = q.value ? '' : 'none'; };
  q.addEventListener('input', () => {
    updClear();
    clearTimeout(suggestTimer);
    const v = q.value.trim();
    if (v.length < 2) { sug.classList.add('hidden'); return; }
    suggestTimer = setTimeout(async () => {
      try {
        const list = await api('/api/suggest?q=' + encodeURIComponent(v), 15000);
        if (!list.length || document.activeElement !== q) { sug.classList.add('hidden'); return; }
        sug.innerHTML = list.map(s =>
          '<div class="srow" data-s="' + esc(s) + '">' + ic('search', 'sm') + '<span>' + esc(s) + '</span></div>').join('');
        sug.classList.remove('hidden');
        sug.querySelectorAll('.srow').forEach(r => r.addEventListener('mousedown', (e) => {
          e.preventDefault();
          q.value = r.dataset.s; sug.classList.add('hidden'); updClear(); doSearch(r.dataset.s);
        }));
      } catch (e) { /* suggestions are best-effort */ }
    }, 300);
  });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { sug.classList.add('hidden'); doSearch(q.value); }
  });
  q.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 180));
  $('qClear').onclick = () => {
    q.value = ''; updClear(); $('res').innerHTML = ''; $('recentWrap').style.display = '';
    renderRecent(); lastQuery = ''; q.focus();
  };
  updClear();
  if (lastQuery) { q.value = lastQuery; updClear(); doSearch(lastQuery); }
  else if (!('ontouchstart' in window)) q.focus();
}

function renderRecent() {
  const w = $('recentWrap');
  if (!w) return;
  if (!S.recent.length) { w.innerHTML = ''; return; }
  w.innerHTML = '<div class="sec-head"><div class="sec-title" style="font-size:16px">Recent searches</div>' +
    '<button class="linkbtn" id="clrRecent">' + ic('trash', 'sm') + ' Clear</button></div>' +
    '<div class="chips">' + S.recent.map(r =>
      '<button class="chip ghost" data-rs="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div>';
  w.querySelectorAll('[data-rs]').forEach(c => c.onclick = () => { $('q').value = c.dataset.rs; doSearch(c.dataset.rs); });
  $('clrRecent').onclick = () => { S.recent = []; persistRecent(); renderRecent(); };
}
function saveRecent(q) {
  S.recent = [q].concat(S.recent.filter(x => x !== q)).slice(0, 10);
  persistRecent();
}

function groupRail(title, cards) {
  if (!cards.length) return '';
  return secHead(title) + '<div class="hscroll">' + cards.join('') + '</div>';
}
function collCard(kind, id, img, t, s, round) {
  const attr = kind === 'album' ? 'data-album' : kind === 'artist' ? 'data-artist' : 'data-playlist';
  return '<div class="card' + (round ? ' round' : '') + '" ' + attr + '="' + esc(id) + '">' +
    '<img loading="lazy" src="' + esc(img || '') + '" alt="">' +
    '<div class="t">' + esc(t) + '</div><div class="s">' + esc(s || '') + '</div></div>';
}

async function doSearch(q) {
  q = q.trim();
  if (!q) return;
  lastQuery = q;
  saveRecent(q);
  const rw = $('recentWrap');
  if (rw) rw.style.display = 'none';
  const sug = $('sug');
  if (sug) sug.classList.add('hidden');
  const res = $('res');
  res.innerHTML = '<div class="spin"></div>';
  const enc = '&q=' + encodeURIComponent(q);
  try {
    const [songs, albums, artists, playlists] = await Promise.all([
      api('/api/search?filter=songs' + enc),
      api('/api/search?filter=albums' + enc),
      api('/api/search?filter=artists' + enc),
      api('/api/search?filter=playlists' + enc),
    ]);
    const sng = (songs || []).filter(i => i.videoId);
    reg(sng);
    let html = '';
    if (sng.length) {
      const top = sng[0];
      html += '<div class="topresult" data-vid="' + top.videoId + '" data-ctx id="topRes">' +
        '<img src="' + esc(art(top)) + '" alt="">' +
        '<div><div class="t">' + esc(top.title) + '</div>' +
        '<div class="s">' + esc(top.artists || '') + '</div>' +
        '<span class="k">Top result</span></div></div>';
      html += secHead('Songs') + '<div data-ctx id="resSongs">' +
        sng.slice(0, 8).map(t => rowHtml(t)).join('') + '</div>';
    }
    html += groupRail('Albums', (albums || []).map(a =>
      collCard('album', a.browseId, a.thumbnail, a.title, 'Album' + (a.artists ? ' · ' + a.artists : ''))));
    html += groupRail('Artists', (artists || []).map(a =>
      collCard('artist', a.browseId, a.thumbnail, a.title, 'Artist', true)));
    html += groupRail('Playlists', (playlists || []).map(p =>
      collCard('playlist', p.browseId, p.thumbnail, p.title, 'Playlist' + (p.author ? ' · ' + p.author : ''))));
    if (!html) {
      res.innerHTML = '<div class="empty">' + ic('search') + '<h3>No results found</h3><p>Try a different song, artist or album.</p></div>';
      return;
    }
    res.innerHTML = html;
    setCtx('topRes', sng);
    setCtx('resSongs', sng);
    bindAll(res);
  } catch (e) {
    res.innerHTML = '<div class="err">Search failed: ' + esc(e.message) + '</div>';
  }
}

/* ---------------- library ---------------- */
function showLibrary() {
  let html = '<div class="greet">Your library</div>';
  html += '<div class="sec-head"><div class="sec-title" style="font-size:16px">Liked songs' +
    (S.likes.length ? ' (' + S.likes.length + ')' : '') + '</div></div>';
  if (!S.likes.length) {
    html += '<div class="empty">' + ic('like-o') + '<h3>Songs you like will appear here</h3><p>Tap the heart icon on any song to save it.</p></div>';
  } else {
    reg(S.likes);
    html += '<div class="actions" style="margin-top:0"><button class="pill solid" id="libPlay">' + ic('play', 'sm') + ' Play all</button>' +
      '<button class="pill ghost" id="libShuffle">' + ic('shuffle', 'sm') + ' Shuffle</button></div>';
    html += '<div data-ctx id="libLiked">' + S.likes.map(t => rowHtml(t)).join('') + '</div>';
  }
  if (S.history.length) {
    reg(S.history);
    html += '<div class="sec-head"><div class="sec-title" style="font-size:16px">Recently played</div>' +
      '<button class="linkbtn" id="clearHist">' + ic('trash', 'sm') + ' Clear</button></div>';
    html += '<div data-ctx id="libHist">' + S.history.map(t => rowHtml(t)).join('') + '</div>';
  }
  view.innerHTML = html;
  setCtx('libLiked', S.likes);
  setCtx('libHist', S.history);
  const lp = $('libPlay');
  if (lp) lp.onclick = () => { S.shuffle = false; playTrack(S.likes[0].videoId, S.likes, 0); };
  const ls = $('libShuffle');
  if (ls) ls.onclick = () => { S.shuffle = true; S.order = []; playTrack(S.likes[0].videoId, S.likes, 0); };
  const ch = $('clearHist');
  if (ch) ch.onclick = () => { S.history = []; saveHistory(); showLibrary(); toast('History cleared'); };
  bindAll();
}

/* ---------------- settings + diagnostics ---------------- */
function diagRow(ok, title, sub) {
  return '<div class="diagrow ' + (ok ? 'ok' : 'bad') + '">' + ic(ok ? 'check' : 'warn') +
    '<div><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div></div></div>';
}
function showSettings() {
  view.innerHTML =
    '<div class="greet">Settings</div>' +
    '<div class="setgroup"><h4>About</h4><div class="setcard">' +
    '<div class="setrow"><span class="brand-mark">' + ic('note') + '</span>' +
    '<div class="grow">Sur<span class="sub">Version ' + APP_VERSION + ' · Music PWA</span></div></div>' +
    '</div></div>' +
    '<div class="setgroup"><h4>Diagnostics</h4><div class="setcard">' +
    '<button class="setrow" id="runDiag"><span class="grow">Run diagnostics' +
    '<span class="sub">Checks stream cookies, the cipher relay and a live test resolve.</span></span></button>' +
    '<div id="diagOut"></div></div></div>' +
    '<div class="setgroup"><h4>Storage</h4><div class="setcard">' +
    '<button class="setrow danger" id="clearCache">' + ic('trash', 'lead') +
    '<span class="grow">Clear cached data<span class="sub">Removes offline app files. Liked songs and history are kept.</span></span></button>' +
    '</div></div>';
  $('runDiag').onclick = runDiag;
  $('clearCache').onclick = clearCache;
}
async function runDiag() {
  const out = $('diagOut');
  if (!out) return;
  out.innerHTML = '<div class="spin" style="margin:26px auto"></div>';
  try {
    const d = await api('/api/diag', 120000);
    const rows = [];
    rows.push(diagRow(!!d.cookies_configured, 'Stream cookies',
      d.cookies_configured
        ? 'Configured — YouTube streams resolve reliably.'
        : 'Not configured — streams may fail more often. The server owner can add YouTube cookies to fix this.'));
    const r = d.relay || {};
    rows.push(diagRow(!!r.ok, 'Cipher relay',
      r.ok ? 'Online · answered in ' + r.ms + ' ms.'
            : 'Offline' + (r.error ? ' — ' + r.error : '. The backup stream resolver is unreachable.')));
    const s = d.resolve || {};
    rows.push(diagRow(!!s.ok, 'Test song resolve',
      s.ok ? 'OK via ' + s.via + ' · took ' + s.ms + ' ms.'
            : 'Failed' + (s.error ? ' — ' + s.error : '. No stream resolver is working right now.')));
    out.innerHTML = rows.join('');
  } catch (e) {
    out.innerHTML = '<div class="err">Diagnostics failed: ' + esc(e.message) + '</div>';
  }
}
async function clearCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch (e) {}
  try {
    const regSW = await navigator.serviceWorker.getRegistration();
    if (regSW) regSW.update().catch(() => {});
  } catch (e) {}
  toast('Cached data cleared');
}

/* ---------------- detail (album / playlist / artist) ---------------- */
async function showDetail(kind, id) {
  view.innerHTML = '<div class="spin"></div>';
  const url = kind === 'album' ? '/api/album/' + id : kind === 'playlist' ? '/api/playlist/' + id : '/api/artist/' + id;
  try {
    const d = await api(url);
    const title = d.title || d.name;
    const sub = d.artists || d.author || d.subscribers || '';
    const tracks = kind === 'artist' ? d.songs : d.tracks;
    reg(tracks);
    let html = '<div class="backrow"><button class="iconbtn" id="bk" aria-label="Back">' + ic('back') + '</button></div>' +
      '<div class="hero"><img src="' + esc(d.thumbnail || '') + '" class="' + (kind === 'artist' ? 'round' : '') + '" alt="">' +
      '<div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p>' +
      (d.year ? '<p>' + esc(d.year) + '</p>' : '') +
      (d.trackCount ? '<p>' + d.trackCount + ' songs</p>' : '') + '</div></div>';
    if (tracks && tracks.length) {
      html += '<div class="actions"><button class="pill solid" id="pa">' + ic('play', 'sm') + ' Play</button>' +
        '<button class="pill ghost" id="sa">' + ic('shuffle', 'sm') + ' Shuffle</button></div>';
      html += '<div data-ctx id="detTracks">' + tracks.map((t, i) => rowHtml(t, kind === 'artist' ? '' : i + 1)).join('') + '</div>';
    }
    if (kind === 'artist' && d.albums && d.albums.length) {
      html += secHead('Albums') + '<div class="hscroll">' + d.albums.map(a =>
        '<div class="card" data-album="' + esc(a.browseId) + '"><img loading="lazy" src="' + esc(a.thumbnail) + '" alt="">' +
        '<div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.year || '') + '</div></div>').join('') + '</div>';
    }
    view.innerHTML = html;
    $('bk').onclick = goBack;
    setCtx('detTracks', tracks);
    const pa = $('pa'), sa = $('sa');
    if (pa) pa.onclick = () => { S.shuffle = false; playTrack(tracks[0].videoId, tracks, 0); };
    if (sa) sa.onclick = () => { S.shuffle = true; S.order = []; playTrack(tracks[0].videoId, tracks, 0); };
    bindAll();
  } catch (e) { errBox('Could not load. ' + e.message, () => showDetail(kind, id)); }
}

/* ---------------- row / card binding ---------------- */
function bindAll(root) {
  const scope = root || view;
  scope.querySelectorAll('[data-vid]').forEach(el => {
    el.onclick = () => {
      const vid = el.dataset.vid;
      const ctxEl = el.closest('[data-ctx]');
      const list = (ctxEl && ctxEl._tracks) || view._ctxTracks || null;
      let idx = list ? list.findIndex(t => t.videoId === vid) : -1;
      if (idx < 0) {
        const single = TRACK_REG[vid];
        playTrack(vid, single ? [single] : null, 0);
      } else {
        playTrack(vid, list, idx);
      }
    };
  });
  scope.querySelectorAll('[data-album]').forEach(el => el.onclick = () => nav(() => showDetail('album', el.dataset.album)));
  scope.querySelectorAll('[data-playlist]').forEach(el => {
    if (el.dataset.playlist) el.onclick = () => nav(() => showDetail('playlist', el.dataset.playlist));
  });
  scope.querySelectorAll('[data-artist]').forEach(el => el.onclick = () => nav(() => showDetail('artist', el.dataset.artist)));
  scope.querySelectorAll('[data-mood]').forEach(el => el.onclick = () => nav(() => showMood(el.dataset.mood, el.dataset.mtitle)));
}

/* ---------------- likes ---------------- */
function isLiked(videoId) { return S.likes.some(t => t.videoId === videoId); }
function toggleLike() {
  const t = S.queue[S.idx];
  if (!t) return;
  const i = S.likes.findIndex(x => x.videoId === t.videoId);
  if (i >= 0) { S.likes.splice(i, 1); toast('Removed from Liked songs'); }
  else {
    S.likes.unshift({ videoId: t.videoId, title: t.title, artists: t.artists, thumbnail: art(t), duration: t.duration });
    toast('Added to Liked songs');
  }
  saveLikes(); updateRateUI();
}
function updateRateUI() {
  const liked = S.currentId && isLiked(S.currentId);
  $('pLikeIc').setAttribute('href', liked ? '#i-like' : '#i-like-o');
  $('pLike').classList.toggle('on', !!liked);
  $('pDislikeIc').setAttribute('href', S.disliked ? '#i-dislike' : '#i-dislike-o');
  $('pDislike').classList.toggle('on', S.disliked);
}

/* ---------------- player ---------------- */
function setMiniVisible(v) { $('mini').classList.toggle('show', v); }
function setLoading(v) { S.loading = v; }

function openPlayer() {
  $('player').classList.add('show');
  $('player').setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  renderQueue();
  showPTab(S.pTab || 'queue');
}
function closePlayer() {
  $('player').classList.remove('show');
  $('player').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('locked');
}

async function playTrack(videoId, queue, startIdx, opts) {
  opts = opts || {};
  const seq = ++S.playSeq;
  S.currentId = videoId; S.disliked = false; S.lyricsBrowseId = null;
  S.retried = false;
  setMiniVisible(true);
  setLoading(true);
  $('mTitle').textContent = 'Loading...'; $('mArtist').textContent = '';
  $('pTitle').textContent = 'Loading...'; $('pArtist').textContent = '';
  $('mArt').removeAttribute('src'); $('pArt').removeAttribute('src');
  updateRateUI();
  try {
    const meta = await api('/api/song/' + videoId + (opts.fresh ? '?fresh=1' : ''), 90000);
    if (seq !== S.playSeq) return; // superseded by a newer tap
    if (!meta.stream_url) throw new Error('server returned no stream URL');
    startStream(meta, queue, startIdx, 0);
  } catch (e) {
    if (seq !== S.playSeq) return;
    setLoading(false);
    $('mTitle').textContent = 'Could not play this song';
    $('mArtist').textContent = 'Tap another song to try again';
    $('pTitle').textContent = 'Could not play this song';
    toast("Couldn't load song: " + e.message, diagToast());
  }
}

function startStream(meta, queue, startIdx, pos) {
  setLoading(false);
  S.suppressErr = true;
  try { audio.src = meta.stream_url; } catch (e) {}
  if (pos > 0) {
    const restore = () => {
      try { audio.currentTime = pos; } catch (e) {}
      audio.removeEventListener('loadedmetadata', restore);
    };
    audio.addEventListener('loadedmetadata', restore);
  }
  audio.play().catch(() => {});
  const qt = (queue || []).find(t => t.videoId === meta.videoId);
  const artistName = (qt && qt.artists) || meta.author || 'Unknown artist';
  const title = meta.title || 'Unknown';
  $('mTitle').textContent = title; $('pTitle').textContent = title;
  $('mArtist').textContent = artistName; $('pArtist').textContent = artistName;
  const thumb = meta.thumbnail || art({ videoId: meta.videoId });
  $('mArt').src = thumb; $('pArt').src = thumb; $('pBgArt').src = thumb;
  extractAccent(thumb);
  document.title = title + ' — Sur';
  updateRateUI();
  pushHistory({ videoId: meta.videoId, title, artists: artistName, thumbnail: thumb, duration: qt ? qt.duration : null });
  setMediaSession(title, artistName, thumb);
  loadQueue(meta.videoId, queue, startIdx);
  if (!$('lyricsBox').classList.contains('hidden')) loadLyrics();
}

async function loadQueue(videoId, queue, startIdx) {
  if (queue && queue.length) {
    S.queue = queue; S.idx = startIdx || 0;
    reg(queue);
    renderQueue(); updateRateUI(); return;
  }
  try {
    const q = await api('/api/queue/' + videoId);
    S.queue = q.tracks || []; S.lyricsBrowseId = q.lyricsBrowseId || null;
    S.idx = Math.max(0, S.queue.findIndex(t => t.videoId === videoId));
    reg(S.queue);
    renderQueue(); updateRateUI();
  } catch (e) { /* queue is optional */ }
}

function orderedQueue() {
  if (!S.shuffle) return S.queue.map((_, i) => i);
  if (!S.order.length || S.order.length !== S.queue.length) {
    S.order = S.queue.map((_, i) => i);
    for (let i = S.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [S.order[i], S.order[j]] = [S.order[j], S.order[i]];
    }
    const pos = S.order.indexOf(S.idx);
    [S.order[0], S.order[pos]] = [S.order[pos], S.order[0]];
  }
  return S.order;
}
function playAt(i) {
  if (i < 0 || i >= S.queue.length) return;
  S.idx = i; S.order = [];
  playTrack(S.queue[i].videoId, S.queue, i);
}
function next(auto) {
  if (S.repeat === 'one' && auto) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  const ord = orderedQueue(), pos = ord.indexOf(S.idx);
  if (pos < ord.length - 1) playAt(ord[pos + 1]);
  else if (S.repeat === 'all') playAt(ord[0]);
}
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const ord = orderedQueue(), pos = ord.indexOf(S.idx);
  if (pos > 0) playAt(ord[pos - 1]);
}
function renderQueue() {
  const box = $('queueBox');
  box.innerHTML = S.queue.map((t, i) =>
    '<div class="row' + (i === S.idx ? ' playing' : '') + '" data-qi="' + i + '">' +
    '<img loading="lazy" src="' + esc(art(t)) + '" alt=""><div class="mid"><div class="t">' + esc(t.title) +
    '</div><div class="s">' + esc(t.artists || '') + '</div></div>' +
    '<span class="eq"><i></i><i></i><i></i></span>' +
    '<div class="d">' + esc(t.duration || '') + '</div></div>').join('');
  box.querySelectorAll('[data-qi]').forEach(el => el.onclick = () => playAt(+el.dataset.qi));
}

/* ---------------- lyrics ---------------- */
const lyricsCache = {};
function parseLRC(lrc) {
  const out = [];
  String(lrc).split('\n').forEach(line => {
    const marks = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[.*?\]/g, '').trim();
    if (!text || !marks.length) return;
    marks.forEach(m => out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text }));
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}
function renderLyrics(entry, box) {
  box = box || $('lyricsBox');
  if (entry.synced) {
    box.innerHTML = entry.synced.map((l, i) =>
      '<div class="lrc-line" data-i="' + i + '">' + esc(l.text) + '</div>').join('');
    box._lrc = entry.synced;
    syncActiveLine();
  } else {
    box._lrc = null;
    box.innerHTML = '<div class="plain">' + esc(entry.plain || 'No lyrics available for this song.') + '</div>';
  }
}
function syncActiveLine() {
  const box = $('lyricsBox');
  if (!box || !box._lrc || box.classList.contains('hidden')) return;
  const t = audio.currentTime, lines = box._lrc;
  let idx = 0;
  for (let i = 0; i < lines.length; i++) { if (lines[i].t <= t + 0.15) idx = i; else break; }
  const cur = box.querySelector('.lrc-line.on');
  const el = box.querySelector('.lrc-line[data-i="' + idx + '"]');
  if (el && el !== cur) {
    if (cur) cur.classList.remove('on');
    el.classList.add('on');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  }
}
async function loadLyrics() {
  const box = $('lyricsBox');
  const track = S.queue[S.idx] || {};
  const vid = track.videoId || S.currentId;
  if (vid && lyricsCache[vid]) { renderLyrics(lyricsCache[vid]); return; }
  box.innerHTML = '<div class="spin"></div>';
  try {
    let entry = null;
    try {
      const artist = String(track.artists || '').split(',')[0].trim();
      const d = await api('/api/synced-lyrics?artist=' + encodeURIComponent(artist) +
                          '&title=' + encodeURIComponent(track.title || ''), 30000);
      if (d && d.synced) {
        const lines = parseLRC(d.synced);
        if (lines.length) entry = { synced: lines };
      }
    } catch (e) { /* fall through to plain */ }
    if (!entry) {
      if (!S.lyricsBrowseId && S.queue[S.idx]) {
        try {
          const q = await api('/api/queue/' + S.queue[S.idx].videoId, 30000);
          S.lyricsBrowseId = q.lyricsBrowseId;
        } catch (e) {}
      }
      let text = '';
      if (S.lyricsBrowseId) {
        try {
          const l = await api('/api/lyrics?browseId=' + S.lyricsBrowseId, 30000);
          text = l.lyrics || '';
        } catch (e) {}
      }
      entry = { plain: text || 'No lyrics available for this song.' };
    }
    if (vid) lyricsCache[vid] = entry;
    renderLyrics(entry, box);
  } catch (e) { box.innerHTML = '<div class="err">Could not load lyrics.</div>'; }
}

/* ---------------- media session (background playback) ---------------- */
function setMediaSession(title, artist, artwork) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Unknown',
      artist: artist || 'Unknown artist',
      album: 'Sur',
      artwork: artwork ? [
        { src: artwork, sizes: '96x96', type: 'image/jpeg' },
        { src: artwork, sizes: '512x512', type: 'image/jpeg' },
      ] : [],
    });
    updatePositionState();
  } catch (e) {}
}
function updatePositionState() {
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  try {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      });
    }
  } catch (e) {}
}
function setPlaybackState(playing) {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) {}
}
function initMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  const H = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) {} };
  H('play', () => audio.play());
  H('pause', () => audio.pause());
  H('previoustrack', prev);
  H('nexttrack', () => next(false));
  H('seekbackward', (d) => { audio.currentTime = Math.max(0, (audio.currentTime || 0) - (d.seekOffset || 10)); updatePositionState(); });
  H('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 0, (audio.currentTime || 0) + (d.seekOffset || 10)); updatePositionState(); });
  H('seekto', (d) => {
    if (d.fastSeek && 'fastSeek' in audio) { try { audio.fastSeek(d.seekTime); } catch (e) { audio.currentTime = d.seekTime; } }
    else audio.currentTime = d.seekTime;
    updatePositionState();
  });
}
initMediaSessionHandlers();

/* ---------------- audio events ---------------- */
let lastPosUpdate = 0;
function paintProgress() {
  if (S.seeking || !audio.duration) return;
  const r = audio.currentTime / audio.duration;
  $('seekFill').style.width = (r * 100) + '%';
  $('seekKnob').style.left = (r * 100) + '%';
  $('seek').setAttribute('aria-valuenow', Math.round(r * 100));
  $('mProg').style.width = (r * 100) + '%';
}
audio.addEventListener('timeupdate', () => {
  paintProgress();
  $('tCur').textContent = fmt(audio.currentTime);
  const now = Date.now();
  if (now - lastPosUpdate > 4000) { lastPosUpdate = now; updatePositionState(); }
  syncActiveLine();
});
audio.addEventListener('loadedmetadata', () => { $('tDur').textContent = fmt(audio.duration); updatePositionState(); });
audio.addEventListener('seeked', updatePositionState);
audio.addEventListener('playing', () => { S.suppressErr = false; });
audio.addEventListener('ended', () => next(true));

/* Robust playback: expired stream or dead URL -> re-resolve once with ?fresh=1,
   resume position; second failure -> loud toast with Diagnostics action. */
audio.addEventListener('error', async () => {
  if (!S.currentId || !audio.getAttribute('src') || S.suppressErr) return;
  if (S.retried) {
    setLoading(false);
    $('mTitle').textContent = 'Could not play this song';
    $('mArtist').textContent = 'Tap another song to try again';
    toast("Couldn't play this song", diagToast());
    return;
  }
  S.retried = true;
  toast("Couldn't play — retrying...");
  try {
    const meta = await api('/api/song/' + S.currentId + '?fresh=1', 90000);
    if (!meta.stream_url) throw new Error('no stream URL');
    const pos = audio.currentTime || 0;
    S.suppressErr = true;
    try { audio.src = meta.stream_url; } catch (e) {}
    if (pos > 0) {
      const restore = () => {
        try { audio.currentTime = pos; } catch (e) {}
        audio.removeEventListener('loadedmetadata', restore);
      };
      audio.addEventListener('loadedmetadata', restore);
    }
    await audio.play().catch(() => {});
    toast('Playing again');
  } catch (e) {
    setLoading(false);
    $('mTitle').textContent = 'Could not play this song';
    toast("Couldn't play this song: " + e.message, diagToast());
  }
});

function setPlayIcons(playing) {
  $('mToggleIc').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('pToggleIc').setAttribute('href', playing ? '#i-pause' : '#i-play');
}
audio.addEventListener('play', () => { setPlayIcons(true); setPlaybackState(true); });
audio.addEventListener('pause', () => { setPlayIcons(false); setPlaybackState(false); });

/* ---------------- custom seek bar ---------------- */
const seekEl = $('seek');
function seekRatio(e) {
  const r = seekEl.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}
function seekPaint(r) {
  $('seekFill').style.width = (r * 100) + '%';
  $('seekKnob').style.left = (r * 100) + '%';
  if (audio.duration) $('tCur').textContent = fmt(r * audio.duration);
}
seekEl.addEventListener('pointerdown', e => {
  if (!audio.duration || S.loading) return;
  S.seeking = true;
  try { seekEl.setPointerCapture(e.pointerId); } catch (err) {}
  seekPaint(seekRatio(e));
});
seekEl.addEventListener('pointermove', e => { if (S.seeking) seekPaint(seekRatio(e)); });
seekEl.addEventListener('pointerup', e => {
  if (!S.seeking) return;
  S.seeking = false;
  const r = seekRatio(e);
  audio.currentTime = r * audio.duration;
  updatePositionState();
});
seekEl.addEventListener('pointercancel', () => { S.seeking = false; });
seekEl.addEventListener('keydown', e => {
  if (!audio.duration) return;
  if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
  if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 10);
});

/* ---------------- controls wiring ---------------- */
function toggle() {
  if (S.loading || !audio.getAttribute('src')) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
$('mToggle').onclick = e => { e.stopPropagation(); toggle(); };
$('pToggle').onclick = toggle;
$('mNext').onclick = e => { e.stopPropagation(); next(false); };
$('pNext').onclick = () => next(false);
$('pPrev').onclick = prev;
$('mini').onclick = openPlayer;
$('mini').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(); }
});
$('pClose').onclick = closePlayer;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('player').classList.contains('show')) closePlayer();
});
$('pLike').onclick = toggleLike;
$('pDislike').onclick = () => { S.disliked = !S.disliked; updateRateUI(); };
$('pShuffle').onclick = () => {
  S.shuffle = !S.shuffle; S.order = [];
  $('pShuffle').classList.toggle('lit', S.shuffle);
  $('pShuffle').classList.toggle('off', !S.shuffle);
};
$('pRepeat').onclick = () => {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  $('pRepeat').classList.toggle('off', S.repeat === 'off');
  $('pRepeat').classList.toggle('lit', S.repeat !== 'off');
  $('pRepeatIc').setAttribute('href', S.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
};
$('vol').addEventListener('input', e => { audio.volume = e.target.value / 100; });

/* swipe-down on the grab handle collapses the player */
const playerInner = $('playerInner');
let dragY = null;
$('pGrab').addEventListener('pointerdown', e => {
  dragY = e.clientY;
  playerInner.classList.add('dragging');
  try { $('pGrab').setPointerCapture(e.pointerId); } catch (err) {}
});
$('pGrab').addEventListener('pointermove', e => {
  if (dragY === null) return;
  const dy = e.clientY - dragY;
  if (dy > 0) playerInner.style.transform = 'translateY(' + dy + 'px)';
});
function endDrag(e) {
  if (dragY === null) return;
  const dy = e.clientY - dragY;
  dragY = null;
  playerInner.classList.remove('dragging');
  playerInner.style.transform = '';
  if (dy > 110) closePlayer();
}
$('pGrab').addEventListener('pointerup', endDrag);
$('pGrab').addEventListener('pointercancel', () => {
  dragY = null;
  playerInner.classList.remove('dragging');
  playerInner.style.transform = '';
});

function showPTab(which) {
  S.pTab = which;
  const q = which === 'queue';
  $('tabQueue').classList.toggle('on', q);
  $('tabLyrics').classList.toggle('on', !q);
  $('queueBox').classList.toggle('hidden', !q);
  $('lyricsBox').classList.toggle('hidden', q);
  if (!q) loadLyrics();
}
$('tabQueue').onclick = () => showPTab('queue');
$('tabLyrics').onclick = () => showPTab('lyrics');

/* ---------------- top-level nav ---------------- */
document.querySelectorAll('.navbtn, .snavbtn').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
$('brandBtn').onclick = () => setTab('home');
$('settingsBtn').onclick = () => setTab('settings');

setTab('home');
