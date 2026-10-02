/* Sur — music player frontend */
const $ = id => document.getElementById(id);
const audio = $('audio');
const view = $('view');

/* PWA: installable app shell + offline shell cache */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const S = {
  tab: 'home', queue: [], idx: 0, shuffle: false, repeat: 'off',
  lyricsBrowseId: null, currentId: null, order: [], disliked: false,
  likes: JSON.parse(localStorage.getItem('mm_likes') || '[]'),
  history: JSON.parse(localStorage.getItem('sur_history') || '[]'),
};
function saveLikes() { localStorage.setItem('mm_likes', JSON.stringify(S.likes)); }
function saveHistory() {
  try { localStorage.setItem('sur_history', JSON.stringify(S.history.slice(0, 60))); }
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

/* ---------- helpers ---------- */
function ic(n, cls) {
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
}
async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
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
function spinner() { view.innerHTML = '<div class="spin"></div>'; }
function errBox(msg) { view.innerHTML = '<div class="err">' + esc(msg) + '</div>'; }
function greet() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
}
function rowHtml(t, rank) {
  return '<div class="row" data-vid="' + t.videoId + '">' +
    (rank ? '<div class="rk">' + rank + '</div>' : '') +
    '<img loading="lazy" src="' + esc(art(t)) + '" alt="">' +
    '<div class="mid"><div class="t">' + esc(t.title) + '</div>' +
    '<div class="s">' + esc(t.artists || '') + '</div></div>' +
    '<div class="d">' + esc(t.duration || '') + '</div></div>';
}
function cardHtml(c, round) {
  return '<div class="card' + (round ? ' round' : '') + '" data-playlist="' + esc(c.playlistId || '') + '">' +
    '<img loading="lazy" src="' + esc(c.thumbnail || '') + '" alt="">' +
    '<div class="t">' + esc(c.title) + '</div><div class="s">' + esc(c.description || c.artists || '') + '</div></div>';
}

/* ---------- navigation ---------- */
const navStack = [];
function nav(fn) { navStack.push(fn); fn(); }
function goBack() {
  navStack.pop();
  const fn = navStack[navStack.length - 1];
  if (fn) fn(); else renderTab();
}
function setTab(tab) {
  S.tab = tab; navStack.length = 0;
  document.querySelectorAll('.navbtn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    const use = b.querySelector('use');
    const base = b.dataset.tab;
    use.setAttribute('href', '#i-' + base + (on ? '' : '-o'));
  });
  renderTab();
}
function renderTab() {
  navStack.length = 0;
  ({ home: showHome, explore: showExplore, library: showLibrary, search: showSearch })[S.tab]();
}

/* ---------- home ---------- */
async function showHome() {
  spinner();
  try {
    const h = await api('/api/home');
    const picks = h.trending.slice(0, 10);
    let html = '<div class="greet">' + greet() + '</div>';
    html += '<div class="sec-head"><div class="sec-title">Quick picks</div></div>';
    html += '<div class="qpicks">' + picks.map((t, i) => rowHtml(t, i + 1)).join('') + '</div>';
    if (h.moods && h.moods.length) {
      html += '<div class="sec">Moods</div><div class="chips">' +
        h.moods.map(m => '<button class="chip" data-mood="' + esc(m.params) + '" data-mtitle="' + esc(m.title) + '">' + esc(m.title) + '</button>').join('') + '</div>';
    }
    html += '<div class="sec-head"><div class="sec-title">Trending now</div></div>';
    html += '<div class="hscroll">' + h.trending.map(t =>
      '<div class="card" data-vid="' + t.videoId + '"><img loading="lazy" src="' + esc(art(t)) + '" alt="">' +
      '<div class="t">' + esc(t.title) + '</div><div class="s">' + esc(t.artists) + '</div></div>').join('') + '</div>';
    view.innerHTML = html;
    view._ctxTracks = h.trending;
    bindAll();
  } catch (e) { errBox('Could not load home: ' + e.message); }
}

/* ---------- explore ---------- */
const TILE_COLORS = [
  'linear-gradient(135deg,#7c3aed,#db2777)', 'linear-gradient(135deg,#0891b2,#22d3ee)',
  'linear-gradient(135deg,#ea580c,#f59e0b)', 'linear-gradient(135deg,#16a34a,#84cc16)',
  'linear-gradient(135deg,#dc2626,#f97316)', 'linear-gradient(135deg,#4f46e5,#06b6d4)',
  'linear-gradient(135deg,#be185d,#8b5cf6)', 'linear-gradient(135deg,#0d9488,#a3e635)',
];
async function showExplore() {
  spinner();
  try {
    const h = await api('/api/home');
    const tiles = (list) => '<div class="tiles">' + list.map((m, i) =>
      '<div class="tile" data-mood="' + esc(m.params) + '" data-mtitle="' + esc(m.title) + '" style="background:' + TILE_COLORS[i % TILE_COLORS.length] + '">' + esc(m.title) + '</div>').join('') + '</div>';
    let html = '<div class="sec">Moods &amp; moments</div>' + tiles(h.moods || []);
    html += '<div class="sec">Genres</div>' + tiles(h.genres || []);
    if (h.artists && h.artists.length) {
      html += '<div class="sec">Top artists</div><div class="hscroll">' + h.artists.map(a =>
        '<div class="card round" data-artist="' + esc(a.browseId) + '"><img loading="lazy" src="' + esc(a.thumbnail) + '" alt="">' +
        '<div class="t">' + esc(a.name) + '</div><div class="s">Artist</div></div>').join('') + '</div>';
    }
    view.innerHTML = html;
    bindAll();
  } catch (e) { errBox('Could not load explore: ' + e.message); }
}

async function showMood(params, title) {
  spinner();
  try {
    const pls = await api('/api/mood?params=' + encodeURIComponent(params));
    view.innerHTML = '<div class="backrow"><button class="iconbtn" id="bk">' + ic('back') + '</button></div>' +
      '<div class="sec" style="margin-top:0">' + esc(title) + '</div>' +
      '<div class="grid2">' + pls.map(p =>
        '<div class="card" data-playlist="' + esc(p.playlistId) + '"><img loading="lazy" src="' + esc(p.thumbnail) + '" alt="">' +
        '<div class="t">' + esc(p.title) + '</div><div class="s">Playlist</div></div>').join('') + '</div>';
    $('bk').onclick = goBack;
    bindAll();
  } catch (e) { errBox('Could not load: ' + e.message); }
}

/* ---------- library ---------- */
function showLibrary() {
  let html = '<div class="sec" style="margin-top:6px">Liked songs' + (S.likes.length ? ' (' + S.likes.length + ')' : '') + '</div>';
  if (!S.likes.length) {
    html += '<div class="empty">' + ic('like-o') + '<h3>Songs you like will appear here</h3><p>Tap the heart icon on any song to save it.</p></div>';
  } else {
    html += '<button class="pill solid" id="libPlay" style="max-width:220px;margin-bottom:10px">' + ic('play', 'sm') + ' Play all</button>';
    html += S.likes.map(t => rowHtml(t)).join('');
  }
  if (S.history.length) {
    html += '<div class="sec-head"><div class="sec-title">Recently played</div>' +
      '<button class="chip" id="clearHist" style="padding:6px 12px">Clear</button></div>';
    html += '<div id="histRows">' + S.history.map(t => rowHtml(t)).join('') + '</div>';
  }
  view.innerHTML = html;
  view._ctxTracks = S.likes.concat(S.history);
  const lp = $('libPlay');
  if (lp) lp.onclick = () => playTrack(S.likes[0].videoId, S.likes, 0);
  const ch = $('clearHist');
  if (ch) ch.onclick = (e) => { e.stopPropagation(); S.history = []; saveHistory(); showLibrary(); };
  bindAll();
}

/* ---------- search ---------- */
const FILTERS = [['songs', 'Songs'], ['videos', 'Videos'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists']];
let curFilter = 'songs', lastQuery = '', suggestTimer = null;

function showSearch() {
  view.innerHTML =
    '<div class="searchwrap"><div class="searchbox">' + ic('search', 'sm') +
    '<input id="q" placeholder="Search songs, artists, albums..." value="' + esc(lastQuery) + '" autocomplete="off">' +
    '<button class="iconbtn" id="qClear" style="display:none">' + ic('x', 'sm') + '</button></div>' +
    '<div class="suggest hidden" id="suggest"></div></div>' +
    '<div class="chips" id="fchips">' +
    FILTERS.map(f => '<button class="chip' + (f[0] === curFilter ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>').join('') +
    '</div><div id="res"></div>';
  const q = $('q'), sug = $('suggest');
  q.addEventListener('input', () => {
    $('qClear').style.display = q.value ? '' : 'none';
    clearTimeout(suggestTimer);
    const v = q.value.trim();
    if (v.length < 2) { sug.classList.add('hidden'); return; }
    suggestTimer = setTimeout(async () => {
      try {
        const list = await api('/api/suggest?q=' + encodeURIComponent(v));
        if (!list.length) { sug.classList.add('hidden'); return; }
        sug.innerHTML = list.map(s =>
          '<div class="srow" data-s="' + esc(s) + '">' + ic('search', 'sm') + '<span>' + esc(s) + '</span></div>').join('');
        sug.classList.remove('hidden');
        sug.querySelectorAll('.srow').forEach(r => r.addEventListener('mousedown', () => {
          q.value = r.dataset.s; sug.classList.add('hidden'); doSearch(r.dataset.s);
        }));
      } catch (e) { /* ignore */ }
    }, 250);
  });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { sug.classList.add('hidden'); doSearch(q.value); }
  });
  q.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 200));
  $('qClear').onclick = () => { q.value = ''; $('qClear').style.display = 'none'; $('res').innerHTML = ''; lastQuery = ''; q.focus(); };
  document.querySelectorAll('#fchips .chip').forEach(c =>
    c.addEventListener('click', () => {
      curFilter = c.dataset.f;
      document.querySelectorAll('#fchips .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      if (lastQuery) doSearch(lastQuery);
    }));
  if (lastQuery) doSearch(lastQuery); else q.focus();
}

async function doSearch(q) {
  q = q.trim(); if (!q) return;
  lastQuery = q;
  const res = $('res');
  res.innerHTML = '<div class="spin"></div>';
  try {
    const items = await api('/api/search?q=' + encodeURIComponent(q) + '&filter=' + curFilter);
    if (!items.length) { res.innerHTML = '<div class="empty">' + ic('search') + '<h3>No results found</h3></div>'; return; }
    if (curFilter === 'songs' || curFilter === 'videos') {
      const tracks = items.filter(i => i.videoId).map(i => ({
        videoId: i.videoId, title: i.title, artists: i.artists,
        thumbnail: i.thumbnail, duration: i.duration,
      }));
      res.innerHTML = items.map(i => rowHtml({
        videoId: i.videoId, title: i.title, artists: i.artists, thumbnail: i.thumbnail, duration: i.duration,
      })).join('');
      res._tracks = tracks;
    } else {
      res.innerHTML = '<div class="grid2">' + items.map(i => {
        const key = i.type === 'album' ? 'data-album' : i.type === 'artist' ? 'data-artist' : 'data-playlist';
        const sub = i.type === 'album' ? 'Album • ' + i.artists : i.type === 'artist' ? 'Artist' : 'Playlist • ' + (i.author || '');
        return '<div class="card' + (i.type === 'artist' ? ' round' : '') + '" ' + key + '="' + esc(i.browseId) + '">' +
          '<img loading="lazy" src="' + esc(i.thumbnail) + '" alt=""><div class="t">' + esc(i.title) +
          '</div><div class="s">' + esc(sub) + '</div></div>';
      }).join('') + '</div>';
    }
    bindAll(res);
  } catch (e) { res.innerHTML = '<div class="err">Search failed: ' + esc(e.message) + '</div>'; }
}

/* ---------- detail (album / playlist / artist) ---------- */
async function showDetail(kind, id) {
  spinner();
  const url = kind === 'album' ? '/api/album/' + id : kind === 'playlist' ? '/api/playlist/' + id : '/api/artist/' + id;
  try {
    const d = await api(url);
    const title = d.title || d.name;
    const sub = d.artists || d.author || d.subscribers || '';
    let html = '<div class="backrow"><button class="iconbtn" id="bk">' + ic('back') + '</button></div>' +
      '<div class="hero"><img src="' + esc(d.thumbnail) + '" class="' + (kind === 'artist' ? 'round' : '') + '" alt="">' +
      '<div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p>' +
      (d.year ? '<p>' + esc(d.year) + '</p>' : '') +
      (d.trackCount ? '<p>' + d.trackCount + ' songs</p>' : '') + '</div></div>';
    const tracks = kind === 'artist' ? d.songs : d.tracks;
    if (tracks && tracks.length) {
      html += '<div class="actions"><button class="pill solid" id="pa">' + ic('play', 'sm') + ' Play</button>' +
        '<button class="pill ghost" id="sa">' + ic('shuffle', 'sm') + ' Shuffle</button></div>';
      html += tracks.map((t, i) => rowHtml(t, kind === 'artist' ? '' : i + 1)).join('');
    }
    if (kind === 'artist' && d.albums && d.albums.length) {
      html += '<div class="sec">Albums</div><div class="hscroll">' + d.albums.map(a =>
        '<div class="card" data-album="' + esc(a.browseId) + '"><img loading="lazy" src="' + esc(a.thumbnail) + '" alt="">' +
        '<div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.year || '') + '</div></div>').join('') + '</div>';
    }
    view.innerHTML = html;
    $('bk').onclick = goBack;
    view._ctxTracks = tracks;
    const pa = $('pa'), sa = $('sa');
    if (pa) pa.onclick = () => { S.shuffle = false; playTrack(tracks[0].videoId, tracks, 0); };
    if (sa) sa.onclick = () => { S.shuffle = true; S.order = []; playTrack(tracks[0].videoId, tracks, 0); };
    bindAll();
  } catch (e) { errBox('Could not load: ' + e.message); }
}

/* ---------- row / card binding ---------- */
function bindAll(root) {
  const scope = root || view;
  scope.querySelectorAll('[data-vid]').forEach(el => {
    el.onclick = () => {
      const ctx = scope._tracks || view._ctxTracks || null;
      const idx = ctx ? Math.max(0, ctx.findIndex(t => t.videoId === el.dataset.vid)) : 0;
      playTrack(el.dataset.vid, ctx, idx);
    };
  });
  scope.querySelectorAll('[data-album]').forEach(el => el.onclick = () => nav(() => showDetail('album', el.dataset.album)));
  scope.querySelectorAll('[data-playlist]').forEach(el => { if (el.dataset.playlist) el.onclick = () => nav(() => showDetail('playlist', el.dataset.playlist)); });
  scope.querySelectorAll('[data-artist]').forEach(el => el.onclick = () => nav(() => showDetail('artist', el.dataset.artist)));
  scope.querySelectorAll('[data-mood]').forEach(el => el.onclick = () => nav(() => showMood(el.dataset.mood, el.dataset.mtitle)));
}

/* ---------- likes ---------- */
function isLiked(videoId) { return S.likes.some(t => t.videoId === videoId); }
function toggleLike() {
  const t = S.queue[S.idx];
  if (!t) return;
  const i = S.likes.findIndex(x => x.videoId === t.videoId);
  if (i >= 0) S.likes.splice(i, 1);
  else S.likes.unshift({ videoId: t.videoId, title: t.title, artists: t.artists, thumbnail: art(t), duration: t.duration });
  saveLikes(); updateRateUI();
}
function updateRateUI() {
  const liked = S.currentId && isLiked(S.currentId);
  $('pLikeIc').setAttribute('href', liked ? '#i-like' : '#i-like-o');
  $('pLike').classList.toggle('on', !!liked);
  $('pDislikeIc').setAttribute('href', S.disliked ? '#i-dislike' : '#i-dislike-o');
  $('pDislike').classList.toggle('on', S.disliked);
}

/* ---------- player ---------- */
function setMiniVisible(v) { $('mini').classList.toggle('show', v); }

async function playTrack(videoId, queue, startIdx) {
  S.currentId = videoId; S.disliked = false; S.lyricsBrowseId = null;
  audio._retried = false;
  setMiniVisible(true);
  $('mTitle').textContent = 'Loading...'; $('mArtist').textContent = '';
  $('pTitle').textContent = 'Loading...'; $('pArtist').textContent = '';
  updateRateUI();
  try {
    const meta = await api('/api/song/' + videoId);
    if (S.currentId !== videoId) return;
    audio.src = meta.stream_url;
    audio.play().catch(() => {});
    const qt = (queue || []).find(t => t.videoId === videoId);
    const artistName = (qt && qt.artists) || meta.author || 'Unknown artist';
    $('mTitle').textContent = meta.title || 'Unknown';
    $('pTitle').textContent = meta.title || 'Unknown';
    $('mArtist').textContent = artistName; $('pArtist').textContent = artistName;
    $('mArt').src = meta.thumbnail; $('pArt').src = meta.thumbnail;
    updateRateUI();
    pushHistory({ videoId, title: meta.title || 'Unknown', artists: artistName,
                  thumbnail: meta.thumbnail, duration: qt ? qt.duration : null });
    setMediaSession(meta.title || 'Unknown', artistName, meta.thumbnail);
    loadQueue(videoId, queue, startIdx);
    if (!$('lyricsBox').classList.contains('hidden')) loadLyrics();  // refresh open lyrics tab
  } catch (e) {
    $('mTitle').textContent = 'Could not play this song';
    $('mArtist').textContent = 'Tap to retry';
  }
}

async function loadQueue(videoId, queue, startIdx) {
  if (queue && queue.length) {
    S.queue = queue; S.idx = startIdx || 0;
    renderQueue(); updateRateUI(); return;
  }
  try {
    const q = await api('/api/queue/' + videoId);
    S.queue = q.tracks; S.lyricsBrowseId = q.lyricsBrowseId || null;
    S.idx = Math.max(0, q.tracks.findIndex(t => t.videoId === videoId));
    renderQueue(); updateRateUI();
  } catch (e) { /* queue optional */ }
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
  if (S.repeat === 'one' && auto) { audio.currentTime = 0; audio.play(); return; }
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
    '<div class="d">' + esc(t.duration || '') + '</div></div>').join('');
  box.querySelectorAll('[data-qi]').forEach(el => el.onclick = () => playAt(+el.dataset.qi));
}
const lyricsCache = {};  // videoId -> {synced:[{t,text}]} | {plain:"..."}  (no reload)

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
    box.textContent = entry.plain || 'No lyrics available for this song.';
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
  if (vid && lyricsCache[vid]) { renderLyrics(lyricsCache[vid]); return; }  // cached: no reload
  box.innerHTML = '<div class="spin"></div>';
  try {
    let entry = null;
    // 1) synced lyrics first (glowing active line, YT Music style)
    try {
      const artist = String(track.artists || '').split(',')[0].trim();
      const d = await api('/api/synced-lyrics?artist=' + encodeURIComponent(artist) +
                          '&title=' + encodeURIComponent(track.title || ''));
      if (d && d.synced) {
        const lines = parseLRC(d.synced);
        if (lines.length) entry = { synced: lines };
      }
    } catch (e) { /* fall through to plain */ }
    // 2) fallback: plain lyrics from YouTube Music
    if (!entry) {
      if (!S.lyricsBrowseId && S.queue[S.idx]) {
        const q = await api('/api/queue/' + S.queue[S.idx].videoId);
        S.lyricsBrowseId = q.lyricsBrowseId;
      }
      let text = '';
      if (S.lyricsBrowseId) {
        const l = await api('/api/lyrics?browseId=' + S.lyricsBrowseId);
        text = l.lyrics || '';
      }
      entry = { plain: text || 'No lyrics available for this song.' };
    }
    if (vid) lyricsCache[vid] = entry;
    renderLyrics(entry, box);
  } catch (e) { box.innerHTML = '<div class="err">Could not load lyrics.</div>'; }
}

/* ---------- background playback: full MediaSession integration ----------
   This is what keeps music playing with the screen off / app in background
   and powers the lock-screen + notification + Bluetooth controls. */
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

/* ---------- player events ---------- */
let lastPosUpdate = 0;
audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    $('seek').value = Math.floor(audio.currentTime / audio.duration * 1000);
    $('mProg').style.width = (audio.currentTime / audio.duration * 100) + '%';
  }
  $('tCur').textContent = fmt(audio.currentTime);
  const now = Date.now();
  if (now - lastPosUpdate > 4000) { lastPosUpdate = now; updatePositionState(); }
  syncActiveLine();
});
audio.addEventListener('loadedmetadata', () => { $('tDur').textContent = fmt(audio.duration); updatePositionState(); });
audio.addEventListener('seeked', updatePositionState);
audio.addEventListener('ended', () => next(true));
/* If a stream URL expired mid-play (403), re-resolve once and resume. */
audio.addEventListener('error', () => {
  if (!S.currentId || audio._retried) return;
  audio._retried = true;
  fetch('/api/song/' + S.currentId).then(r => r.json()).then(meta => {
    if (meta.stream_url && S.currentId) {
      const pos = audio.currentTime || 0;
      audio.src = meta.stream_url;
      audio.currentTime = pos;
      audio.play().catch(() => {});
    }
  }).catch(() => {});
  setTimeout(() => { audio._retried = false; }, 30000);
});
function setPlayIcons(playing) {
  $('mToggleIc').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('pToggleIc').setAttribute('href', playing ? '#i-pause' : '#i-play');
}
audio.addEventListener('play', () => { setPlayIcons(true); setPlaybackState(true); });
audio.addEventListener('pause', () => { setPlayIcons(false); setPlaybackState(false); });
$('seek').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration;
});
$('vol').addEventListener('input', e => { audio.volume = e.target.value / 100; });
function toggle() { audio.paused ? audio.play() : audio.pause(); }
$('mToggle').onclick = e => { e.stopPropagation(); toggle(); };
$('pToggle').onclick = toggle;
$('mNext').onclick = e => { e.stopPropagation(); next(false); };
$('pNext').onclick = () => next(false);
$('pPrev').onclick = prev;
$('mini').onclick = () => { $('player').classList.add('show'); showPTab('queue'); renderQueue(); };
$('pClose').onclick = () => $('player').classList.remove('show');
$('pMore').onclick = () => { showPTab('queue'); };
$('pLike').onclick = toggleLike;
$('pDislike').onclick = () => { S.disliked = !S.disliked; updateRateUI(); };
$('pShuffle').onclick = e => {
  S.shuffle = !S.shuffle; S.order = [];
  $('pShuffle').classList.toggle('dim', !S.shuffle);
};
$('pRepeat').onclick = () => {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  $('pRepeat').classList.toggle('dim', S.repeat === 'off');
  $('pRepeatIc').setAttribute('href', S.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
};
function showPTab(which) {
  const q = which === 'queue';
  $('tabQueue').classList.toggle('on', q);
  $('tabLyrics').classList.toggle('on', !q);
  $('queueBox').classList.toggle('hidden', !q);
  $('lyricsBox').classList.toggle('hidden', q);
  if (!q) loadLyrics();
}
$('tabQueue').onclick = () => showPTab('queue');
$('tabLyrics').onclick = () => showPTab('lyrics');

/* ---------- top-level nav ---------- */
document.querySelectorAll('.navbtn').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('brandBtn').onclick = () => setTab('home');
$('topSearch').onclick = () => setTab('search');

setTab('home');
