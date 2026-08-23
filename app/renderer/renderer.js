(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.api || {};

  const state = {
    songs: [],
    favorites: new Set(),
    current: -1,
    playing: false,
    shuffle: false,
    repeat: 'off',
    volume: 0.8,
    query: '',
    dj: false,
    favOnly: false,
    activePlaylist: null,
    hasKey: false,
    hasDjKey: false,
    viewMode: 'daily',
    albumFilter: null,
    artistFilter: null,
    genreFilter: null,
    genreName: '',
    djVoice: 'zh-CN-XiaoxiaoNeural',
    djPreset: 'auto',
    fsLayout: 'side',
    smartOrder: false,
    albumPlayIds: null
  };
  try { if (localStorage.getItem('echoFsLayout') === 'center') state.fsLayout = 'center'; } catch (e) {}

  /* ---------- 收听统计 ---------- */
  let _listenSec = 0;
  let _listenLastFlush = 0;
  let _listenPlayed = new Set();
  function flushListen() {
    const song = currentSong();
    if (!song || _listenSec < 1) { _listenSec = 0; return; }
    const sec = Math.round(_listenSec);
    _listenSec = 0;
    try { api.recordListen(song.id, sec, false); } catch (e) {}
  }

  /* ---------- 音频元素工厂（主播放 + DJ 桥接共用） ---------- */
  function createAudioEl() {
    const el = new Audio();
    el.volume = state.volume;
    // 变速但保持音高（时间拉伸），避免变调
    try { el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true; } catch (e) {}
    el.addEventListener('loadedmetadata', () => { if (el === audio) onLoadedMeta(); });
    el.addEventListener('timeupdate', () => { if (el === audio) { onTimeUpdate(); _listenSec += 0.4; if (Date.now() - _listenLastFlush > 5000) { _listenLastFlush = Date.now(); flushListen(); } } });
    el.addEventListener('ended', () => { if (el === audio) onEnded(); });
    el.addEventListener('play', () => { if (el === audio) { setPlaying(true); const song = currentSong(); if (song && !_listenPlayed.has(song.id)) { _listenPlayed.add(song.id); try { api.recordListen(song.id, 0, true); } catch (e) {} } } });
    el.addEventListener('pause', () => { if (el === audio) setPlaying(false); });
    el.addEventListener('error', () => { if (el === audio) onAudioError(); });
    return el;
  }
  let audio = createAudioEl();

  const COVER_GRADIENTS = [
    'linear-gradient(135deg,#f7971e,#ffd200)',
    'linear-gradient(135deg,#30cfd0,#330867)',
    'linear-gradient(135deg,#f857a6,#ff5858)',
    'linear-gradient(135deg,#5ee7df,#b490ca)',
    'linear-gradient(135deg,#c471f5,#fa71cd)',
    'linear-gradient(135deg,#43cea2,#185a9d)',
    'linear-gradient(135deg,#ff9966,#ff5e62)',
    'linear-gradient(135deg,#7f7fd5,#86a8e7)'
  ];

  /* ---------- 工具 ---------- */
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileUrl = (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23');
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const toast = (msg) => {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 2600);
  };

  /* ---------- AI 封面生成（液态玻璃风格，无 API key） ---------- */
  const aiCoverCache = new Map();
  const AI_PALETTES = [
    ['#3a1c71', '#d76d77', '#ffaf7b'],
    ['#0f2027', '#203a43', '#2c5364'],
    ['#1a2a6c', '#b21f1f', '#fdbb2d'],
    ['#0f0c29', '#302b63', '#24243e'],
    ['#41295a', '#2F0743', '#7b4397'],
    ['#141e30', '#243b55', '#35577d'],
    ['#1f4037', '#99f2c8', '#56ab2f'],
    ['#42275a', '#734b6d', '#e96443']
  ];
  function aiCoverUrl(song) {
    const key = song.id || song.path;
    if (!key) return null;
    if (aiCoverCache.has(key)) return aiCoverCache.get(key);
    try {
      const size = 300;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const x = c.getContext('2d');
      const h = hash(key);
      const pal = AI_PALETTES[h % AI_PALETTES.length];
      const g = x.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, pal[0]);
      g.addColorStop(0.55, pal[1]);
      g.addColorStop(1, pal[2]);
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
      for (let i = 0; i < 4; i++) {
        const cx = (h >> (i * 3)) % size;
        const cy = ((h >> (i * 3 + 5)) * 37) % size;
        const r = 60 + ((h >> (i * 2)) % 90);
        const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, 'rgba(255,255,255,0.30)');
        rg.addColorStop(0.6, 'rgba(255,255,255,0.07)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = rg;
        x.beginPath();
        x.arc(cx, cy, r, 0, Math.PI * 2);
        x.fill();
      }
      x.strokeStyle = 'rgba(255,255,255,0.55)';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(size * 0.5, size * 0.52, size * 0.34, -Math.PI * 0.82, -Math.PI * 0.28);
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.10)';
      x.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        x.beginPath(); x.moveTo(size * i / 6, 0); x.lineTo(size * i / 6, size); x.stroke();
        x.beginPath(); x.moveTo(0, size * i / 6); x.lineTo(size, size * i / 6); x.stroke();
      }
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.font = 'bold 64px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('♪', size * 0.5, size * 0.5);
      const url = c.toDataURL('image/png');
      aiCoverCache.set(key, url);
      return url;
    } catch (e) { return null; }
  }
  function aiCoverHtml(song, cls) {
    const u = aiCoverUrl(song);
    if (u) return '<img class="' + cls + '" src="' + u + '" alt="" loading="lazy" />';
    return null;
  }
  function coverHtml(song, cls) {
    if (song.cover) return '<img class="' + cls + '" src="' + fileUrl(song.cover) + '" alt="" loading="lazy" />';
    const ai = aiCoverHtml(song, cls);
    if (ai) return ai;
    const g = COVER_GRADIENTS[hash(song.id || song.path) % COVER_GRADIENTS.length];
    return '<div class="' + cls + ' cover-fallback" style="background:' + g + '">♪</div>';
  }

  function currentSong() { return state.songs[state.current] || null; }

  function djTagHtml(song) {
    try {
      const bpm = dj.bpmCache.get(song.id);
      const k = dj.keyCache.get(song.id);
      if (!bpm && !k) return '';
      let h = '<span class="dj-tags">';
      if (bpm) h += '<span class="dj-tag">' + bpm + ' BPM</span>';
      if (k) h += '<span class="dj-tag dj-tag-key">' + k.key + (k.mode === 'minor' ? 'm' : '') + '</span>';
      return h + '</span>';
    } catch (e) { return ''; }
  }
  /* ---------- 列表渲染 ---------- */
  function visibleSongs() {
    let list = state.songs;
    if (state.favOnly) list = list.filter((s) => state.favorites.has(s.id));
    if (state.activePlaylist) {
      const pl = playlists.list.find((p) => p.id === state.activePlaylist);
      if (pl) {
        const ids = new Set(pl.songIds);
        list = list.filter((s) => ids.has(s.id));
      }
    }
    if (state.albumFilter) {
      list = list.filter((s) => (s.album || '未知专辑').trim() === state.albumFilter);
      // 专辑按原版曲目顺序排列（Smart Reorder 模式除外）
      if (!state.smartOrder) {
        const trackOf = (s) => {
          const t = s.track;
          const n = (t != null) ? parseInt(String(t), 10) : NaN;
          if (!isNaN(n) && n > 0) return n;
          const base = String(s.path || '').split(String.fromCharCode(92)).pop() || '';
          const m = /^[ 	]*([0-9]{1,3})/.exec(base);
          if (m) return parseInt(m[1], 10);
          return 9999;
        };
        list = list.slice().sort((a, b) => (trackOf(a) - trackOf(b)) || 0);
      }
    }
    if (state.artistFilter) list = list.filter((s) => s.artist === state.artistFilter);
    if (state.genreFilter) list = list.filter(state.genreFilter);
    const q = state.query.trim().toLowerCase();
    if (q) list = list.filter((s) => (s.title + s.artist + s.album).toLowerCase().includes(q));
    return list;
  }

  function renderSongs() {
    const list = visibleSongs();
    const box = $('song-list');
    box.innerHTML = '';
    $('empty-state').hidden = true;
    $('list-head').hidden = list.length === 0;
    updateViewBack();
    const cur = currentSong();
    if (state.genreName || state.albumFilter || state.artistFilter) {
      $('song-count').textContent = list.length + ' 首 / 共 ' + state.songs.length + ' 首';
    } else {
      $('song-count').textContent = state.songs.length + ' 首歌曲';
    }
    list.forEach((song, i) => {
      const row = document.createElement('div');
      row.className = 'song-row' + (cur && song.id === cur.id ? ' playing' : '');
      row.dataset.id = song.id;
      const liked = state.favorites.has(song.id);
      row.innerHTML =
        '<span class="col-index">' + (i + 1) + '</span>' +
        '<span class="col-title">' + coverHtml(song, 'cover') + '<span class="t">' + esc(song.title) + '</span></span>' +
        '<span class="col-artist">' + esc(song.artist) + '</span>' +
        '<span class="col-album">' + esc(song.album) + '</span>' +
        '<span class="col-duration">' + fmtTime(song.duration) + '</span>' +
        '<span class="col-djtags">' + djTagHtml(song) + '</span>' +
        '<button class="heart' + (liked ? ' liked' : '') + '">' + (liked ? '♥' : '♡') + '</button>';
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('heart')) { toggleFavorite(song, e.target); return; }
        if (cur && song.id === cur.id && !audio.paused) { $('fullscreen').hidden = false; return; }
        playById(song.id);
      });
      row.addEventListener('dblclick', () => { playById(song.id); $('fullscreen').hidden = false; });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, song);
      });
      box.appendChild(row);
    });
  }

  /* ---------- 每日推荐 ---------- */
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60);
    return h + ' 小时 ' + (m % 60) + ' 分';
  }
  async function renderDaily() {
    const box = $('song-list');
    $('empty-state').hidden = true;
    $('list-head').hidden = true;
    updateViewBack();
    setMainTitle('每日推荐');
    box.innerHTML = '<div class=\'daily-loading\'>正在生成今日推荐…</div>';
    let stats = { plays: {}, seconds: {}, daily: {} };
    try { stats = (await api.getListenStats()) || stats; } catch (e) {}
    const ids = Object.keys(stats.plays);
    const scored = ids.map((id) => ({ id, plays: stats.plays[id] || 0, sec: stats.seconds[id] || 0 }))
      .sort((a, b) => (b.plays - a.plays) || (b.sec - a.sec));
    const topSongs = scored.slice(0, 12).map((s) => state.songs.find((x) => x.id === s.id)).filter(Boolean);
    // 时长统计基础数据
    const today = new Date();
    const dayKey = (d) => d.toISOString().slice(0, 10);
    const daySec = (offset) => stats.daily[dayKey(new Date(Date.now() - offset * 86400000))] || 0;
    // 7 天柱状
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); days.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), v: daySec(i) }); }
    // 4 周柱状
    const weeks = [];
    for (let w = 3; w >= 0; w--) {
      let sum = 0; const names = [];
      for (let i = w * 7 + 6; i >= w * 7; i--) { const d = new Date(Date.now() - i * 86400000); sum += daySec(i); names.unshift((d.getMonth() + 1) + '/' + d.getDate()); }
      weeks.push({ label: '第' + (4 - w) + '周', v: sum, names: names[0] + '~' + names[names.length - 1] });
    }
    // 12 月柱状
    const months = [];
    for (let m = 11; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      let sum = 0;
      Object.keys(stats.daily).forEach((k) => { if (k.slice(0, 7) === key) sum += stats.daily[k]; });
      months.push({ label: (d.getMonth() + 1) + '月', v: sum });
    }
    // 专辑 / 歌手 时长
    const albumMap = new Map(); const artistMap = new Map();
    state.songs.forEach((s) => {
      const sec = stats.seconds[s.id] || 0;
      if (sec <= 0) return;
      const al = (s.album || '未知专辑'); const ar = (s.artist || '未知歌手');
      if (!albumMap.has(al)) albumMap.set(al, { name: al, sec: 0, cover: s.cover, id: s.id });
      albumMap.get(al).sec += sec;
      if (!artistMap.has(ar)) artistMap.set(ar, { name: ar, sec: 0, cover: s.cover, id: s.id });
      artistMap.get(ar).sec += sec;
    });
    const albums = [...albumMap.values()].sort((a, b) => b.sec - a.sec).slice(0, 8);
    const artists = [...artistMap.values()].sort((a, b) => b.sec - a.sec).slice(0, 8);
    const totalSec = Object.values(stats.seconds).reduce((a, b) => a + (b || 0), 0);
    // ============ 页面结构 ============
    let html = '';
    // 顶部 Hero：大标题 + 日期 + 推荐语
    const now = new Date();
    const weekCN = ['日','一','二','三','四','五','六'][now.getDay()];
    html += '<div class=\'daily-hero\'>';
    html += '  <div class=\'daily-hero-eyebrow\'>每日推荐 · ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + weekCN + '</div>';
    html += '  <div class=\'daily-hero-title\'>为你推荐</div>';
    html += '  <div class=\'daily-hero-sub\'>' + (topSongs.length ? '根据你这几天听过的 ' + topSongs.length + ' 首歌，为你挑选今日最佳' : '多听几首歌，明天就能看到你的专属推荐') + '</div>';
    html += '</div>';
    // 推荐横滑卡片
    if (topSongs.length) {
      html += '<div class=\'daily-section\'>今日推荐</div>';
      html += '<div class=\'daily-cards\'>';
      topSongs.forEach((song) => {
        const sc = scored.find((s) => s.id === song.id);
        html += '<div class=\'daily-card\' data-id=\'' + song.id + '\'>';
        html += '  <div class=\'daily-card-cover\'>' + coverHtml(song, 'gc-cover') + '</div>';
        html += '  <div class=\'daily-card-title\'>' + esc(song.title) + '</div>';
        html += '  <div class=\'daily-card-sub\'>' + esc(song.artist) + '</div>';
        html += '  <div class=\'daily-card-badge\'>' + (sc ? sc.plays : 0) + ' 次</div>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class=\'daily-empty\'>还没有收听记录，先去听几首歌吧。</div>';
    }
    // ============ 图表统计区（玻璃胶囊切换） ============
    html += '<div class=\'chart-section\'>';
    html += '  <div class=\'chart-tabs\' id=\'chart-tabs\'>';
    html += '    <button class=\'chart-tab active\' data-tab=\'time\'>收听时长</button>';
    html += '    <button class=\'chart-tab\' data-tab=\'album\'>专辑</button>';
    html += '    <button class=\'chart-tab\' data-tab=\'artist\'>歌手</button>';
    html += '  </div>';
    // 收听时长：子胶囊 今日/本周/本月
    html += '  <div class=\'chart-panel\' id=\'chart-time\'>';
    html += '    <div class=\'chart-subtabs\' id=\'chart-subtabs\'>';
    html += '      <button class=\'chart-sub active\' data-range=\'day\'>今日</button>';
    html += '      <button class=\'chart-sub\' data-range=\'week\'>本周</button>';
    html += '      <button class=\'chart-sub\' data-range=\'month\'>本月</button>';
    html += '    </div>';
    html += '    <div class=\'chart-body\' id=\'chart-body\'></div>';
    html += '  </div>';
    // 专辑面板
    html += '  <div class=\'chart-panel\' id=\'chart-album\' hidden>';
    html += '    <div class=\'chart-body\' id=\'chart-album-body\'></div>';
    html += '  </div>';
    // 歌手面板
    html += '  <div class=\'chart-panel\' id=\'chart-artist\' hidden>';
    html += '    <div class=\'chart-body\' id=\'chart-artist-body\'></div>';
    html += '  </div>';
    html += '</div>';
    box.innerHTML = html;
    // 点击卡片播放
    box.querySelectorAll('.daily-card').forEach((card) => { card.addEventListener('click', () => playById(card.dataset.id)); });
    // 图表渲染器
    const chartBody = $('chart-body');
    const albumBody = $('chart-album-body');
    const artistBody = $('chart-artist-body');
    function barChart(items, unit) {
      const max = Math.max(60, ...items.map((x) => x.v));
      let h = '<div class=\'chart-bars\'>';
      items.forEach((it) => {
        const pct = Math.max(3, Math.round((it.v / max) * 100));
        h += '<div class=\'chart-bar-col\'>';
        h += '  <div class=\'chart-bar-val\'>' + (it.v >= 60 ? Math.round(it.v / 60) + 'm' : it.v + 's') + '</div>';
        h += '  <div class=\'chart-bar-track\'><div class=\'chart-bar-fill\' style=\'height:' + pct + '%\'></div></div>';
        h += '  <div class=\'chart-bar-label\'>' + it.label + '</div>';
        h += '</div>';
      });
      h += '</div>';
      return h;
    }
    function listChart(items) {
      const max = Math.max(60, ...items.map((x) => x.sec));
      let h = '<div class=\'chart-list\'>';
      items.forEach((it) => {
        const pct = Math.max(4, Math.round((it.sec / max) * 100));
        h += '<div class=\'chart-row\'>';
        h += '  <span class=\'chart-row-cover\'>' + coverHtml({ cover: it.cover, id: it.id }, 'gc-cover') + '</span>';
        h += '  <span class=\'chart-row-name\'>' + esc(it.name) + '</span>';
        h += '  <span class=\'chart-row-track\'><span class=\'chart-row-fill\' style=\'width:' + pct + '%\'></span></span>';
        h += '  <span class=\'chart-row-time\'>' + fmtDuration(it.sec) + '</span>';
        h += '</div>';
      });
      h += '</div>';
      return h;
    }
    function renderTime(range) {
      if (range === 'day') chartBody.innerHTML = barChart(days, 's');
      else if (range === 'week') chartBody.innerHTML = barChart(weeks, 's');
      else chartBody.innerHTML = barChart(months, 's');
    }
    renderTime('day');
    albumBody.innerHTML = listChart(albums);
    artistBody.innerHTML = listChart(artists);
    // 标签切换
    const tabs = box.querySelectorAll('.chart-tab');
    const panels = { time: $('chart-time'), album: $('chart-album'), artist: $('chart-artist') };
    tabs.forEach((tb) => tb.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      tb.classList.add('active');
      Object.keys(panels).forEach((k) => { panels[k].hidden = k !== tb.dataset.tab; });
    }));
    const subs = box.querySelectorAll('.chart-sub');
    subs.forEach((sb) => sb.addEventListener('click', () => {
      subs.forEach((x) => x.classList.remove('active'));
      sb.classList.add('active');
      renderTime(sb.dataset.range);
    }));
  }
  /* ---------- 每日推荐全屏首页（AI 推荐专辑） ---------- */
  async function pickRecommendedAlbum() {
    let stats = {};
    try { stats = (await api.getListenStats()) || {}; } catch (e) {}
    const songs = state.songs;
    if (!songs.length) return null;
    const byAlbum = {};
    songs.forEach((s) => { const a = (s.album || '未知专辑').trim(); (byAlbum[a] = byAlbum[a] || []).push(s); });
    const albums = Object.keys(byAlbum).map((name) => ({ name, songs: byAlbum[name], plays: 0, sec: 0, cover: null }));
    albums.forEach((al) => {
      al.songs.forEach((s) => {
        al.plays += (stats.plays && stats.plays[s.id]) || 0;
        al.sec += (stats.seconds && stats.seconds[s.id]) || 0;
        if (!al.cover && s.cover) al.cover = s.cover;
      });
    });
    // 权重：播放次数 + 时长；没有收听数据的专辑排后
    const scored = albums.slice().sort((a, b) => (b.plays * 10 + b.sec) - (a.plays * 10 + a.sec));
    const top = scored.filter((a) => a.plays + a.sec > 0);
    const pool = (top.length ? top : scored).filter((a) => a.cover || a.songs.some((s) => s.cover));
    // 每日种子：同一天固定推荐同一个，第二天换一个
    const today = new Date().toDateString();
    let seed = 0;
    for (const ch of today) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const base = pool.length ? pool : scored;
    if (!base.length) return null;
    return base[seed % base.length];
  }
  async function showRecPage() {
    const rec = $('rec-page');
    if (!rec || rec._shown) return;
    const album = await pickRecommendedAlbum();
    if (!album) return;
    rec._album = album;
    $('rec-album-name').textContent = album.name;
    const cover = $('rec-cover');
    const g = COVER_GRADIENTS[hash(album.name) % COVER_GRADIENTS.length];
    const coverSong = album.songs.find((s) => s.cover) || album.songs[0];
    if (coverSong && coverSong.cover) {
      cover.style.background = '';
      cover.innerHTML = '<img src="' + fileUrl(coverSong.cover) + '" alt="" />';
    } else {
      cover.style.background = g;
      const ai = aiCoverUrl(coverSong);
      cover.innerHTML = ai ? '<img src="' + ai + '" alt="" />' : '♪';
    }
    rec.hidden = false;
    rec._shown = true;
  }

  /* ---------- 视图调度 / 专辑 / 歌手 ---------- */
  function renderMain() {
    if (state.viewMode === 'daily') { renderDaily(); return; }
    if (state.viewMode === 'albums' && !state.albumFilter) { renderAlbums(); return; }
    if (state.viewMode === 'artists' && !state.artistFilter) { renderArtists(); return; }
    renderSongs();
  }
  function gridCoverHtml(song) {
    if (song.cover) return '<img class="gc-cover" src="' + fileUrl(song.cover) + '" alt="" />';
    const ai = aiCoverHtml(song, 'gc-cover');
    if (ai) return ai;
    const g = COVER_GRADIENTS[hash(song.id || song.path) % COVER_GRADIENTS.length];
    return '<div class="gc-cover-fb" style="background:' + g + '">♪</div>';
  }
  function renderAlbums() {
    const box = $('song-list');
    box.innerHTML = '';
    $('empty-state').hidden = true;
    $('list-head').hidden = true;
    updateViewBack();
    const map = new Map();
    state.songs.forEach((s) => {
      const key = (s.album || '未知专辑').trim();
      if (!map.has(key)) map.set(key, { album: key, artist: s.artist || '', count: 0, cover: s.cover, id: s.id });
      map.get(key).count++;
    });
    $('song-count').textContent = map.size + ' 张专辑';
    const grid = document.createElement('div');
    grid.className = 'grid-view';
    map.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'grid-card';
      card.innerHTML = gridCoverHtml({ cover: a.cover, id: a.id }) +
        '<div class="gc-name">' + esc(a.album) + '</div>' +
        '<div class="gc-sub">' + esc(a.artist) + ' · ' + a.count + ' 首</div>';
      card.addEventListener('click', () => { state.albumFilter = a.album; renderMain(); });
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }
  function renderArtists() {
    const box = $('song-list');
    box.innerHTML = '';
    $('empty-state').hidden = true;
    $('list-head').hidden = true;
    updateViewBack();
    const map = new Map();
    state.songs.forEach((s) => {
      const key = s.artist || '未知歌手';
      if (!map.has(key)) map.set(key, { artist: key, count: 0, cover: s.cover, id: s.id });
      map.get(key).count++;
    });
    $('song-count').textContent = map.size + ' 位歌手';
    const grid = document.createElement('div');
    grid.className = 'grid-view';
    map.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'grid-card';
      card.innerHTML = gridCoverHtml({ cover: a.cover, id: a.id }) +
        '<div class="gc-name">' + esc(a.artist) + '</div>' +
        '<div class="gc-sub">' + a.count + ' 首歌曲</div>';
      card.addEventListener('click', () => { state.artistFilter = a.artist; renderMain(); });
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }
  function updateViewBack() {
    const back = $('view-back');
    const show = !!(state.albumFilter || state.artistFilter || state.viewMode !== 'songs');
    back.hidden = !show;
    const pab = $('btn-play-album');
    if (pab) pab.hidden = !state.albumFilter;
    if (show) {
      $('view-back-title').textContent = state.albumFilter ? state.albumFilter : state.artistFilter ? state.artistFilter : state.viewMode === 'albums' ? '所有专辑' : state.viewMode === 'artists' ? '所有歌手' : '';
    }
  }
  function goBackView() {
    if (state.albumFilter) { state.albumFilter = null; renderMain(); }
    else if (state.artistFilter) { state.artistFilter = null; renderMain(); }
    else if (state.viewMode !== 'songs') { state.viewMode = 'songs'; setMainTitle('资料库'); renderMain(); }
  }
  function setMainTitle(t) { $('topbar-title').textContent = t; $('page-title').textContent = t; }

  function showEmpty() { $('empty-state').hidden = false; $('list-head').hidden = true; $('song-count').textContent = ''; }
  function hideEmpty() { $('empty-state').hidden = true; $('list-head').hidden = false; }

  /* ---------- 曲库 ---------- */
  async function reloadLibrary() {
    const lib = await api.loadLibrary();
    state.songs = lib.songs || [];
    state.favorites = new Set(lib.favorites || []);
    if (state.songs.length) { hideEmpty(); renderMain(); }
    else { showEmpty(); }
    // 后台批量分析 BPM + 调性（填充歌单标签，不阻塞 UI）
    analyzeLibraryMeta();
  }

  let _metaIdx = 0;
  let _metaBusy = false;
  async function analyzeLibraryMeta() {
    if (_metaBusy) return;
    _metaBusy = true;
    _metaIdx = 0;
    const songs = state.songs;
    while (_metaIdx < songs.length) {
      const s = songs[_metaIdx++];
      try {
        if (!dj.bpmCache.has(s.id)) await analyzeBpm(s);
        if (!dj.keyCache.has(s.id)) {
          const buf = dj.bufferCache.get(s.id);
          if (buf) await analyzeKey(s, buf);
        }
        // 每分析 8 首刷新一次列表（标签显示）
        if (_metaIdx % 8 === 0 && state.viewMode === 'songs') renderMain();
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 120));
    }
    if (state.viewMode === 'songs') renderMain();
    _metaBusy = false;
  }

  function showStatus(msg) { const el = $('scan-status'); el.textContent = msg; el.hidden = false; }
  function hideStatus() { $('scan-status').hidden = true; }

  async function runScan() {
    const btn = $('scan-btn');
    const btn2 = $('rescan-btn');
    btn.disabled = true; btn2.disabled = true;
    showStatus('正在扫描音乐…');
    try {
      await api.scanLibrary();
      await reloadLibrary();
      showStatus('扫描完成');
      setTimeout(hideStatus, 3000);
    } catch (e) {
      showStatus('扫描出错：' + e.message);
    }
    btn.disabled = false; btn2.disabled = false;
  }

  /* ---------- 播放 ---------- */
  function playById(id) {
    if (state.albumPlayIds && state.albumPlayIds.length && state.albumPlayIds.indexOf(id) < 0) {
      state.albumPlayIds = null;
    }
    const i = state.songs.findIndex((s) => s.id === id);
    if (i >= 0) playAt(i);
  }

  function playAt(i) {
    if (i < 0 || i >= state.songs.length) return;
    state.current = i;
    const song = state.songs[i];
    audio.src = fileUrl(song.path);
    audio.playbackRate = 1;
    audio.volume = state.volume;
    resetBridge();
    audio.play().catch(() => {});
    const pbx2 = $('pb-transition');
    if (pbx2) pbx2.hidden = true;
    updateNowPlaying(song);
    setPlaying(true);
    renderSongs();
    loadLyrics(song);
    if (state.dj) {
      prepareBridge();
      showDjComment(song);
    }
  }

  function triggerCoverSlide(el) {
    if (!el) return;
    el.classList.remove('slide-in');
    void el.offsetWidth;
    el.classList.add('slide-in');
    setTimeout(() => el.classList.remove('slide-in'), 600);
  }
  function updateNowPlaying(song) {
    const g = COVER_GRADIENTS[hash(song.id || song.path) % COVER_GRADIENTS.length];
    const pc = $('pb-cover');
    pc.style.background = g;
    pc.innerHTML = song.cover ? '<img src="' + fileUrl(song.cover) + '" alt="" />' : (aiCoverHtml(song, '') || '♪');
    triggerCoverSlide(pc);
    $('pb-title').textContent = song.title;
    $('pb-artist').textContent = song.artist;
    $('time-total').textContent = fmtTime(song.duration);
    $('time-current').textContent = '0:00';
    $('progress-fill').style.width = '0%';
    $('progress-thumb').style.left = '0%';
    $('fs-title').textContent = song.title;
    $('fs-artist').textContent = song.artist + ' · ' + song.album;
    const fc = $('fs-cover');
    fc.style.background = g;
    fc.innerHTML = song.cover ? '<img src="' + fileUrl(song.cover) + '" alt="" />' : (aiCoverHtml(song, '') || '♪');
    // 播放页封面保持静态，不做任何滑动动画
    const liked = state.favorites.has(song.id);
    $('pb-heart').classList.toggle('liked', liked);
    $('pb-heart').textContent = liked ? '♥' : '♡';
    applyTint(song);
    const qp = $('queue-panel');
    if (qp && !qp.hidden) renderQueue();
  }

  function setPlaying(v) {
    state.playing = v;
    const playSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5 3.2v9.6L12.6 8z"/></svg>';
    const pauseSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3.4" y="3" width="3" height="10" rx="1"/><rect x="9.6" y="3" width="3" height="10" rx="1"/></svg>';
    $('btn-play').innerHTML = v ? pauseSvg : playSvg;
    $('btn-play').title = v ? '暂停' : '播放';
  }

  function pickNextIndex() {
    if (!state.songs.length) return -1;
    // 专辑连播：按专辑曲目顺序完整播放（播完最后一首停止）
    if (state.albumPlayIds && state.albumPlayIds.length) {
      const curId = state.songs[state.current] ? state.songs[state.current].id : null;
      const i = curId != null ? state.albumPlayIds.indexOf(curId) : -1;
      if (i >= 0) {
        const nid = state.albumPlayIds[i + 1];
        if (nid != null) {
          const ni = state.songs.findIndex((s) => s.id === nid);
          if (ni >= 0) return ni;
        }
        return -1;
      }
    }
    if (state.shuffle) {
      if (state.songs.length < 2) return 0;
      let i = Math.floor(Math.random() * state.songs.length);
      while (i === state.current) i = Math.floor(Math.random() * state.songs.length);
      return i;
    }
    // DJ 过渡开启且已生成 BPM 优化顺序：按优化顺序找下一首（不切回已播的歌）
    if (state.dj && dj.order && dj.order.length) {
      const curId = state.songs[state.current] ? state.songs[state.current].id : null;
      const idx = dj.order.indexOf(curId);
      if (idx >= 0) {
        if (!dj._played) dj._played = new Set();
        dj._played.add(curId);
        for (let k = 1; k <= dj.order.length; k++) {
          const candId = dj.order[(idx + k) % dj.order.length];
          if (!dj._played.has(candId)) {
            const ni = state.songs.findIndex((s) => s.id === candId);
            if (ni >= 0) return ni;
          }
        }
      }
    }
    return (state.current + 1) % state.songs.length;
  }

  function next() {
    if (!state.songs.length) return;
    if (state.current < 0) { playAt(0); return; }
    if (state.dj && dj.bridge && dj.bridge.built && !dj.bridge.started) {
      startBridge(true);
      return;
    }
    playAt(pickNextIndex());
  }

  function prev() {
    if (!state.songs.length) return;
    if (state.current <= 0) { playAt(0); return; }
    if (state.albumPlayIds && state.albumPlayIds.length && state.songs[state.current]) {
      const i = state.albumPlayIds.indexOf(state.songs[state.current].id);
      if (i > 0) {
        const nid = state.albumPlayIds[i - 1];
        const ni = state.songs.findIndex((s) => s.id === nid);
        if (ni >= 0) { playAt(ni); return; }
      }
    }
    playAt(state.current - 1);
  }

  /* ---------- 播放队列 ---------- */
  function queueSongs(maxN) {
    const out = [];
    const n = state.songs.length;
    if (!n) return out;
    const cur = state.current;
    if (state.dj && dj.order && dj.order.length) {
      const curId = cur >= 0 ? state.songs[cur].id : null;
      const start = curId != null ? dj.order.indexOf(curId) : -1;
      const played = dj._played || new Set();
      for (let k = 1; k < dj.order.length && out.length < maxN; k++) {
        const candId = dj.order[(start + k) % dj.order.length];
        if (played.has(candId)) continue;
        const si = state.songs.findIndex((s) => s.id === candId);
        if (si >= 0) out.push(state.songs[si]);
      }
    } else if (state.shuffle) {
      const idxs = state.songs.map((_, i) => i).filter((i) => i !== cur);
      for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t; }
      for (const i of idxs) { if (out.length >= maxN) break; out.push(state.songs[i]); }
    } else {
      for (let k = 1; k < n && out.length < maxN; k++) out.push(state.songs[(cur + k) % n]);
    }
    return out;
  }
  function renderQueue() {
    const panel = $('queue-panel');
    const list = $('queue-list');
    if (!panel || !list) return;
    const cur = currentSong();
    const up = queueSongs(30);
    const count = $('queue-count');
    if (count) count.textContent = up.length ? up.length + ' 首待播' : '';
    list.innerHTML = '';
    if (!up.length) {
      const em = document.createElement('div');
      em.className = 'queue-empty';
      em.textContent = state.songs.length ? '队列为空' : '曲库还没有歌曲';
      list.appendChild(em);
      return;
    }
    // 正在播放置顶
    if (cur) {
      const row = document.createElement('div');
      row.className = 'queue-row playing';
      row.dataset.id = cur.id;
      const g = COVER_GRADIENTS[hash(cur.id || cur.path) % COVER_GRADIENTS.length];
      const thumb = cur.cover ? '<img src="' + fileUrl(cur.cover) + '" alt="" />' : '<span class="q-cover-fb" style="background:' + g + '">♪</span>';
      row.innerHTML =
        '<span class="q-idx">♪</span>' +
        '<span class="q-cover">' + thumb + '</span>' +
        '<span class="q-meta"><span class="q-title">' + esc(cur.title) + '</span><span class="q-artist">' + esc(cur.artist) + ' · 正在播放</span></span>' +
        '<span class="q-dur">' + fmtTime(cur.duration) + '</span>';
      row.addEventListener('click', () => { $('fullscreen').hidden = false; });
      list.appendChild(row);
    }
    up.forEach((song) => {
      const row = document.createElement('div');
      row.className = 'queue-row';
      row.dataset.id = song.id;
      const g = COVER_GRADIENTS[hash(song.id || song.path) % COVER_GRADIENTS.length];
      const thumb = song.cover ? '<img src="' + fileUrl(song.cover) + '" alt="" />' : '<span class="q-cover-fb" style="background:' + g + '">♪</span>';
      row.innerHTML =
        '<span class="q-idx"></span>' +
        '<span class="q-cover">' + thumb + '</span>' +
        '<span class="q-meta"><span class="q-title">' + esc(song.title) + '</span><span class="q-artist">' + esc(song.artist) + '</span></span>' +
        '<span class="q-dur">' + fmtTime(song.duration) + '</span>';
      row.addEventListener('click', () => { playById(song.id); });
      list.appendChild(row);
    });
  }
  function toggleQueue() {
    const panel = $('queue-panel');
    const btn = $('btn-queue');
    if (!panel) return;
    if (panel.hidden) { renderQueue(); panel.hidden = false; if (btn) btn.classList.add('active'); }
    else { panel.hidden = true; if (btn) btn.classList.remove('active'); }
  }

  async function toggleFavorite(song, btn) {
    try {
      const liked = await api.toggleFavorite(song.id);
      if (liked) state.favorites.add(song.id); else state.favorites.delete(song.id);
      if (btn) { btn.classList.toggle('liked', liked); btn.textContent = liked ? '♥' : '♡'; }
      toast(liked ? '已收藏' : '已取消收藏');
      const cur = currentSong();
      if (cur && cur.id === song.id) updateNowPlaying(song);
      if (state.favOnly) renderSongs();
    } catch (e) { toast('收藏失败'); }
  }

  /* ---------- 音频事件 ---------- */
  function onLoadedMeta() {
    const d = audio.duration || (currentSong() && currentSong().duration) || 0;
    $('time-total').textContent = fmtTime(d);
  }
  function onTimeUpdate() {
    const d = audio.duration || 0;
    const t = audio.currentTime || 0;
    $('time-current').textContent = fmtTime(t);
    if (d > 0) {
      const pct = (t / d) * 100;
      $('progress-fill').style.width = pct + '%';
      $('progress-thumb').style.left = pct + '%';
    }
    updateLyricsHighlight();
    djTick();
  }
  function onEnded() {
    flushListen();
    if (state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (dj.bridge && dj.bridge.started && dj.bridge.song) {
      swapMain();
      return;
    }
    next();
  }
  function onAudioError() {
    const song = currentSong();
    toast(song ? '无法播放：' + song.title + '（文件可能已移动）' : '播放出错');
  }

  /* ---------- 进度条 / 音量 ---------- */
  function bindTrack(track, fill, thumb, onSeek) {
    const setFrom = (clientX) => {
      const r = track.getBoundingClientRect();
      const v = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      fill.style.width = v * 100 + '%';
      thumb.style.left = v * 100 + '%';
      onSeek(v);
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      track.classList.add('dragging');
      setFrom(e.clientX);
      const move = (ev) => { if (track.hasPointerCapture(ev.pointerId)) setFrom(ev.clientX); };
      const up = (ev) => {
        track.classList.remove('dragging');
        try { track.releasePointerCapture(ev.pointerId); } catch (e2) {}
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });
    track.addEventListener('click', (e) => setFrom(e.clientX));
  }

  bindTrack($('progress-track'), $('progress-fill'), $('progress-thumb'), (ratio) => {
    if (!audio.src) return;
    if (audio.duration > 0) audio.currentTime = ratio * audio.duration;
  });

  bindTrack($('volume-track'), $('volume-fill'), $('volume-thumb'), (ratio) => {
    state.volume = ratio;
    audio.volume = ratio;
    if (dj.bridge && !dj.bridge.started) dj.bridge.element.volume = ratio;
  });

  /* ---------- 播放控制 ---------- */
  function togglePlay() {
    if (!state.songs.length) return;
    if (state.current < 0) { playAt(0); return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-next').addEventListener('click', next);
  $('btn-prev').addEventListener('click', prev);
  $('btn-shuffle').addEventListener('click', (e) => {
    state.shuffle = !state.shuffle;
    e.currentTarget.classList.toggle('active', state.shuffle);
    toast(state.shuffle ? '已开启随机播放' : '已关闭随机播放');
  });
  $('btn-repeat').addEventListener('click', (e) => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    e.currentTarget.classList.toggle('active', state.repeat !== 'off');
    e.currentTarget.textContent = state.repeat === 'one' ? '①' : '↻';
  });
  $('pb-heart').addEventListener('click', () => {
    const song = currentSong();
    if (song) toggleFavorite(song, $('pb-heart'));
  });

  /* ---------- 扫描 / 文件夹 ---------- */
  $('scan-btn').addEventListener('click', runScan);
  $('rescan-btn').addEventListener('click', runScan);
  const srtBtn = document.getElementById('smart-reorder-btn');
  if (srtBtn) srtBtn.addEventListener('click', applySmartReorder);
  $('add-folder-btn').addEventListener('click', async () => {
    try {
      const p = await api.addFolder();
      if (p) { toast('已添加文件夹，正在扫描…'); runScan(); }
    } catch (e) { toast('无法打开文件夹选择器'); }
  });
  api.onLibraryProgress((data) => {
    if (data.scanned) { hideStatus(); reloadLibrary(); return; }
    showStatus(data.message || '');
    if (typeof data.count === 'number' && data.count > 0) $('song-count').textContent = data.count + ' 首歌曲';
  });

  /* ---------- 全屏正在播放页 ---------- */
  $('pb-cover').addEventListener('click', () => { $('fullscreen').hidden = false; });
  $('btn-lyrics').addEventListener('click', () => { $('fullscreen').hidden = false; });
  // 专辑详情页：按曲目顺序完整播放整张专辑
  const btnPlayAlbum = $('btn-play-album');
  if (btnPlayAlbum) btnPlayAlbum.addEventListener('click', () => {
    const list = visibleSongs();
    if (!list.length) { toast('该专辑没有歌曲'); return; }
    state.albumPlayIds = list.map((s) => s.id);
    playById(list[0].id);
    toast('正在播放专辑：' + (state.albumFilter || ''));
  });
  const btnQueue = $('btn-queue');
  if (btnQueue) btnQueue.addEventListener('click', (e) => { e.stopPropagation(); toggleQueue(); });
  // Auto Mix 预设选择
  const amBar = document.getElementById('am-bar');
  if (amBar) {
    const setAm = (p) => { state.djPreset = p; amBar.querySelectorAll('.am-preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === p)); };
    amBar.querySelectorAll('.am-preset').forEach((b) => b.addEventListener('click', () => setAm(b.dataset.preset)));
    setAm('auto');
  }
  $('fs-close').addEventListener('click', () => { $('fullscreen').hidden = true; });
  // 每日推荐首页：关闭进资料库 / 播放整张专辑
  const recClose = $('rec-close');
  if (recClose) recClose.addEventListener('click', () => { $('rec-page').hidden = true; });
  const recPlay = $('rec-play');
  if (recPlay) recPlay.addEventListener('click', () => {
    const rec = $('rec-page');
    const album = rec && rec._album;
    rec.hidden = true;
    if (!album || !album.songs || !album.songs.length) return;
    // 按专辑原版曲目顺序播放整张专辑
    const tOf = (s) => { const t = s.track; const n = (t != null) ? parseInt(String(t), 10) : NaN; if (!isNaN(n) && n > 0) return n; const base = String(s.path || '').split(String.fromCharCode(92)).pop() || ''; const m = /^[ 	]*([0-9]{1,3})/.exec(base); return m ? parseInt(m[1], 10) : 9999; };
    const sorted = album.songs.slice().sort((a, b) => tOf(a) - tOf(b));
    state.albumPlayIds = sorted.map((s) => s.id);
    playById(sorted[0].id);
    // 直接以「封面左、歌词右」布局就位，任何元素不做滑动动画
    state.fsLayout = 'side';
    applyFsLayout(true);
    ['fs-cover', 'fs-info', 'fs-lyrics'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.transition = 'none'; });
    $('fullscreen').hidden = false;
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      ['fs-cover', 'fs-info', 'fs-lyrics'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.transition = ''; });
    }); });
    toast('正在播放专辑：' + album.name);
  });
  /* 播放页布局切换：封面左歌词右 ↔ 封面居中无歌词（CSS 过渡平滑动画） */
  function applyFsLayout(instant) {
    const inner = document.querySelector('.fs-inner');
    const btn = $('fs-layout-btn');
    if (inner) {
      if (instant) inner.style.transition = 'none';
      inner.classList.toggle('fs-center', state.fsLayout === 'center');
      if (instant) { void inner.offsetWidth; inner.style.transition = ''; }
    }
    const lyrEl = $('fs-lyrics');
    if (lyrEl) lyrEl.style.opacity = '';
    if (btn) {
      btn.innerHTML = state.fsLayout === 'center'
        ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><rect x="6.5" y="3.5" width="11" height="17" rx="2.5"/></svg>'
        : '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><rect x="3" y="5.5" width="9" height="13" rx="2" opacity="0.95"/><rect x="14.5" y="5.5" width="6.5" height="13" rx="2" opacity="0.4"/></svg>';
      btn.title = state.fsLayout === 'center' ? '切换布局：居中封面（点击恢复左右布局）' : '切换布局：左封面右歌词（点击切换为居中）';
    }
  }
  applyFsLayout(true);
  const fsLayoutBtn = $('fs-layout-btn');
  if (fsLayoutBtn) {
    fsLayoutBtn.addEventListener('click', () => {
      if (dj.transitioning) { toast('过渡进行中，稍后再切换布局'); return; }
      state.fsLayout = state.fsLayout === 'center' ? 'side' : 'center';
      try { localStorage.setItem('echoFsLayout', state.fsLayout); } catch (e) {}
      applyFsLayout(false);
      toast(state.fsLayout === 'center' ? '已切换：封面居中，无歌词' : '已切换：封面左、歌词右');
    });
  }
  $('fs-backdrop').addEventListener('click', () => { $('fullscreen').hidden = true; });

  /* ---------- 导航 ---------- */
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const name = btn.textContent.trim().replace(/^[^\u4e00-\u9fff]+/, '');
      $('topbar-title').textContent = name;
      $('page-title').textContent = name;
      if (view === 'dj') {
        state.favOnly = false;
        toggleDj();
        return;
      }
      if (view === 'settings') { openSettings(); return; }
      if (view === 'search') { $('search-input').focus(); return; }
      if (view === 'daily') {
        state.favOnly = false;
        state.activePlaylist = null;
        state.viewMode = 'daily';
        state.albumFilter = state.artistFilter = null;
        resetChips();
        renderMain();
        return;
      }
      if (view === 'library') {
        state.favOnly = false;
        state.activePlaylist = null;
        state.viewMode = 'songs';
        state.albumFilter = state.artistFilter = null;
        resetChips();
        renderPlaylistNav();
        renderMain();
      }
    });
  });
  document.querySelectorAll('.nav-item[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.filter;
      state.favOnly = false;
      state.activePlaylist = null;
      state.albumFilter = state.artistFilter = null;
      state.viewMode = mode;
      resetChips();
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderPlaylistNav();
      setMainTitle(mode === 'albums' ? '专辑' : mode === 'artists' ? '歌手' : '歌曲');
      renderMain();
    });
  });
  document.querySelector('.nav-playlist')?.addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    state.activePlaylist = null;
    state.viewMode = 'songs';
    state.albumFilter = state.artistFilter = null;
    resetChips();
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    setMainTitle(state.favOnly ? '我喜欢的音乐' : '资料库');
    renderPlaylistNav();
    renderMain();
  });

  /* ---------- 流派标签 / 深夜电台 ---------- */
  const GENRE_KEYWORDS = {
    '流行': ['pop', '流行'],
    '摇滚': ['rock', '摇滚', 'metal', 'punk'],
    '民谣': ['folk', '民谣', 'acoustic'],
    '电子': ['electronic', '电音', 'edm', 'dance', '舞曲', 'techno', 'house', 'club']
  };
  function resetChips() {
    document.querySelectorAll('#genre-chips .chip').forEach((c) => c.classList.toggle('active', c.textContent === '全部'));
    state.genreFilter = null;
    state.genreName = '';
  }
  function applyGenre(label) {
    document.querySelectorAll('#genre-chips .chip').forEach((c) => c.classList.toggle('active', c.textContent === label));
    if (label === '全部') { state.genreFilter = null; state.genreName = ''; renderMain(); return; }
    if (label === '华语') {
      state.genreFilter = (s) => /[\u4e00-\u9fff]/.test((s.title || '') + (s.artist || '') + (s.album || ''));
    } else {
      const kw = GENRE_KEYWORDS[label] || [label];
      state.genreFilter = (s) => {
        const g = String(s.genre || '').toLowerCase();
        if (g && kw.some((k) => g.indexOf(k) >= 0)) return true;
        const t = ((s.title || '') + ' ' + (s.artist || '') + ' ' + (s.album || '')).toLowerCase();
        return kw.some((k) => t.indexOf(k) >= 0);
      };
    }
    state.genreName = label;
    renderMain();
  }
  function startNightRadio() {
    if (!state.songs.length) { toast('请先扫描音乐'); return; }
    if (!state.dj) toggleDj();
    state.shuffle = true;
    $('btn-shuffle').classList.add('active');
    state.viewMode = 'songs';
    state.albumFilter = state.artistFilter = null;
    state.favOnly = false;
    setMainTitle('深夜电台');
    toast('深夜电台已启动：随机 + 无缝混音');
    if (state.current < 0 || audio.paused) {
      if (state.current < 0) playAt(Math.floor(Math.random() * state.songs.length));
      else audio.play().catch(() => {});
    }
  }
  document.querySelectorAll('#genre-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const label = chip.textContent;
      if (label === '深夜电台') { startNightRadio(); return; }
      applyGenre(label);
    });
  });
  $('btn-view-back').addEventListener('click', goBackView);

  /* ---------- 搜索 ---------- */
  $('search-input').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderSongs();
  });

  /* ---------- 窗口控制 ---------- */
  $('win-min').addEventListener('click', () => api.minimize && api.minimize());
  $('win-max').addEventListener('click', () => api.maximize && api.maximize());
  $('win-close').addEventListener('click', () => api.close && api.close());

  /* ---------- 歌词 ---------- */
  const lyricsState = { lines: [], translated: [], hasTime: false, current: -1 };

  function parseLrc(lrcText) {
    const lines = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)/g;
    const text = lrcText || '';
    let m;
    while ((m = re.exec(text))) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      const t = m[4].trim();
      if (t) lines.push({ time: min * 60 + sec + frac / 1000, text: t });
    }
    return lines;
  }

  function splitTranslated(text) {
    return String(text || '').split('\n').map((t) => t.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim()).filter((t) => t);
  }

  function renderLyrics(data) {
    const el = $('fs-lyrics');
    lyricsState.lines = [];
    lyricsState.translated = [];
    lyricsState.hasTime = false;
    lyricsState.current = -1;
    if (!data || !data.lyrics) {
      el.innerHTML = '<div class="lyrics-placeholder">未找到歌词<br/><span class="lrc-link" id="lrc-key-link">配置 DeepSeek API Key（AI 搜索歌词 + 中文翻译）</span></div>';
      bindLyricsKeyLink();
      return;
    }
    let lines;
    if (data.lyrics.synced) {
      lines = parseLrc(data.lyrics.synced);
      lyricsState.hasTime = lines.length > 0;
      if (!lyricsState.hasTime && data.lyrics.plain) {
        lines = data.lyrics.plain.split('\n').map((t) => ({ time: -1, text: t.trim() })).filter((l) => l.text);
      }
    } else if (data.lyrics.plain) {
      lines = data.lyrics.plain.split('\n').map((t) => ({ time: -1, text: t.trim() })).filter((l) => l.text);
      // 无时间戳歌词：按歌曲时长均分估算每行时间，实现近似同步
      const dur = (audio.duration || 0);
      if (dur > 10 && lines.length) {
        const per = dur / lines.length;
        lines.forEach((l2, i2) => { l2.time = i2 * per; });
        lyricsState.hasTime = true;
      }
    } else {
      el.innerHTML = '<div class="lyrics-placeholder">未找到歌词</div>';
      return;
    }
    lyricsState.lines = lines;
    lyricsState.translated = splitTranslated(data.translated);
    el.innerHTML = '';
    lines.forEach((l, i) => {
      const div = document.createElement('div');
      div.className = 'lrc-line';
      const orig = document.createElement('div');
      orig.className = 'lrc-orig';
      const done = document.createElement('span');
      done.className = 'lrc-done';
      const pending = document.createElement('span');
      pending.className = 'lrc-pending';
      pending.textContent = l.text;
      orig.appendChild(done);
      orig.appendChild(pending);
      div.appendChild(orig);
      const tr = lyricsState.translated[i];
      if (tr) {
        const td = document.createElement('div');
        td.className = 'lrc-trans';
        td.textContent = tr;
        div.appendChild(td);
      }
      el.appendChild(div);
    });
    if (data.source === 'ai') {
      const note = document.createElement('div');
      note.className = 'lrc-note';
      note.textContent = '歌词由 DeepSeek AI 生成，可能与原唱略有出入';
      el.appendChild(note);
    }
    if (!lyricsState.translated.length) {
      const link = document.createElement('div');
      link.className = 'lrc-link';
      if (!state.hasKey) link.textContent = '点击配置 DeepSeek API Key 开启中文翻译';
      else if (data.trStatus === 'disabled') link.textContent = '翻译未开启（在设置中打开中文翻译开关）';
      else link.textContent = '翻译失败：请检查 API Key 是否正确、账户是否有余额';
      link.addEventListener('click', openSettings);
      el.appendChild(link);
    }
    updateLyricsHighlight();
  }

  function bindLyricsKeyLink() {
    const l = document.getElementById('lrc-key-link');
    if (l) l.addEventListener('click', openSettings);
  }

  function updateLyricsHighlight() {
    if (!lyricsState.hasTime || !lyricsState.lines.length) return;
    const t = audio.currentTime || 0;
    let idx = 0;
    for (let i = 0; i < lyricsState.lines.length; i++) {
      if (lyricsState.lines[i].time <= t) idx = i; else break;
    }
    if (idx === lyricsState.current) {
      applyWordProgress(idx, t);
      return;
    }
    lyricsState.current = idx;
    const el = $('fs-lyrics');
    const rows = el.querySelectorAll('.lrc-line');
    rows.forEach((rr) => rr.classList.remove('active'));
    if (rows[idx]) {
      rows[idx].classList.add('active');
      const top = rows[idx].offsetTop;
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 2 + rows[idx].offsetHeight / 2), behavior: 'smooth' });
    }
    applyWordProgress(idx, t);
  }

  // 逐字同步：按当前行时间进度拆分「已唱 / 未唱」
  function applyWordProgress(idx, t) {
    try {
      const rows = document.querySelectorAll('#fs-lyrics .lrc-line');
      const row = rows[idx];
      if (!row) return;
      const done = row.querySelector('.lrc-done');
      const pending = row.querySelector('.lrc-pending');
      if (!done || !pending) return;
      const line = lyricsState.lines[idx];
      const next = lyricsState.lines[idx + 1];
      const start = line.time;
      const end = next ? next.time : start + Math.max(4, line.text.length * 0.25);
      const dur = Math.max(0.3, end - start);
      const p = Math.max(0, Math.min(1, (t - start) / dur));
      const chars = Array.from(line.text);
      const n = Math.round(chars.length * p);
      done.textContent = chars.slice(0, n).join('');
      pending.textContent = chars.slice(n).join('');
    } catch (e) {}
  }

  async function loadLyrics(song) {
    const el = $('fs-lyrics');
    el.innerHTML = '<div class="lyrics-placeholder">正在获取歌词…</div>';
    try {
      const data = await api.getLyrics(song);
      renderLyrics(data);
    } catch (e) {
      el.innerHTML = '<div class="lyrics-placeholder">歌词获取失败</div>';
    }
  }

  /* ---------- 设置 ---------- */
  async function openSettings() {
    try {
      const s = await api.getSettings();
      state.hasKey = !!s.hasKey;
      state.hasDjKey = !!s.hasDjKey;
      doubaoCfg.appId = s.doubaoAppId || '';
      doubaoCfg.token = s.doubaoTtoken || '';
      $('settings-modal').hidden = false;
      $('api-key-input').value = '';
      $('dj-voice-select').value = s.djVoice || 'zh-CN-XiaoxiaoNeural';
      $('doubao-appid').value = s.doubaoAppId || '';
      $('doubao-token').value = '';
      $('doubao-token').placeholder = s.doubaoTtoken ? '已配置（留空保持不变）' : '输入火山引擎 Access Token';
      $('api-key-input').placeholder = s.hasKey ? '已配置（留空则保持不变）' : '输入你的 DeepSeek API Key';
      $('dj-api-key-input').value = '';
      $('dj-api-key-input').placeholder = s.hasDjKey ? '已配置（留空则保持不变）' : '输入 AI DJ 专用 API Key（可选）';
      $('translation-toggle').checked = s.translationEnabled !== false;
      $('settings-status').textContent = s.hasKey ? '已配置 API Key（仅保存在本地）' : '尚未配置 API Key（歌词翻译需要）';
    } catch (e) { toast('设置读取失败'); }
  }
  function closeSettings() { $('settings-modal').hidden = true; }

  /* ---------- AI DJ 上线提示胶囊（10 秒） ---------- */
  let _djMarqueeTimer = null;
  function showDjMarquee() {
    const mq = $('dj-marquee');
    if (!mq) return;
    mq.hidden = false;
    // 重启旋转动画（每次开启都从头转）
    mq.style.animation = 'none';
    void mq.offsetWidth;
    mq.style.animation = '';
    clearTimeout(_djMarqueeTimer);
    _djMarqueeTimer = setTimeout(hideDjMarquee, 10000);
  }
  function hideDjMarquee() {
    clearTimeout(_djMarqueeTimer);
    const mq = $('dj-marquee');
    if (mq) mq.hidden = true;
  }

  /* ---------- AI 挑歌 ---------- */
  function openAiPick() {
    $('aipick-modal').hidden = false;
    const chat = $('aipick-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    setTimeout(() => { const inp = $('aipick-input'); if (inp) inp.focus(); }, 60);
  }
  function closeAiPick() { $('aipick-modal').hidden = true; }
  function aiPickAddMsg(cls, html) {
    const chat = $('aipick-chat');
    if (!chat) return null;
    const div = document.createElement('div');
    div.className = 'aipick-msg ' + cls;
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }
  async function sendAiPick(text) {
    const q = String(text || '').trim();
    if (!q) return;
    if (!state.hasKey && !state.hasDjKey) { aiPickAddMsg('ai', '⚠️ 还没有配置 API Key，请先到 设置 里填入 DeepSeek API Key。'); return; }
    aiPickAddMsg('user', escapeHtml(q));
    const loading = aiPickAddMsg('ai loading', '🎧 AI 正在从你的曲库里挑歌…');
    const songs = state.songs.slice(0, 250).map((s) => ({ title: s.title, artist: s.artist, album: s.album, bpm: dj.bpmCache.get(s.id) || null, key: dj.keyCache.get(s.id) || null }));
    try {
      const res = await Promise.race([ api.djPick(q, songs), new Promise((r2) => setTimeout(() => r2(null), 60000)) ]);
      if (loading) loading.remove();
      if (!res || !res.picks || !res.picks.length) { aiPickAddMsg('ai', '😅 没能挑到合适的歌。试试换一种描述，或者先确认曲库里有歌。'); return; }
      let html = (res.text || '给你挑好了：') + '<br>';
      const map = new Map();
      state.songs.forEach((s) => { const k = (s.title || '').toLowerCase().trim() + '||' + (s.artist || '').toLowerCase().trim(); if (!map.has(k)) map.set(k, s); });
      const found = []; const missing = [];
      res.picks.forEach((p) => {
        const k = (p.title || '').toLowerCase().trim() + '||' + (p.artist || '').toLowerCase().trim();
        const s = map.get(k);
        if (s) { found.push(s); html += '<div class="aipick-song"><b>' + escapeHtml(s.title) + '</b> - <span>' + escapeHtml(s.artist) + '</span><span class="aipick-reason">' + escapeHtml(p.why || '') + '</span></div>'; }
        else missing.push(p);
      });
      if (missing.length) html += '<div class="aipick-reason" style="margin-top:6px">另有 ' + missing.length + ' 首不在曲库中，已跳过。</div>';
      if (found.length) html += '<div class="aipick-actions"><button class="ghost-btn" data-aipick-play>▶ 立即用 AI DJ 播放</button><button class="ghost-btn" data-aipick-save>存为播放列表</button></div>';
      else html += '<div>曲库里没有找到完全匹配的歌曲，可以换个说法试试。</div>';
      const msgEl = aiPickAddMsg('ai', html);
      if (msgEl) {
        const playBtn = msgEl.querySelector('[data-aipick-play]');
        if (playBtn) playBtn.addEventListener('click', () => playAiPickList(found));
        const saveBtn = msgEl.querySelector('[data-aipick-save]');
        if (saveBtn) saveBtn.addEventListener('click', () => saveAiPickList(found));
      }
    } catch (e) {
      if (loading) loading.remove();
      aiPickAddMsg('ai', '⚠️ 挑歌失败：' + escapeHtml(e.message || '网络错误'));
    }
  }
  async function playAiPickList(songs) {
    if (!songs || !songs.length) { toast('没有可播放的歌曲'); return; }
    closeAiPick();
    if (!state.dj) toggleDj();
    const ids = songs.map((s) => s.id);
    const order = buildDjOrder(ids);
    if (order && order.length) dj.order = order;
    dj._played = new Set();
    playById(ids[0]);
    if (state.dj) showDjMarquee();
    toast('AI 挑歌歌单已开始播放');
  }
  async function saveAiPickList(songs) {
    if (!songs || !songs.length) { toast('没有可保存的歌曲'); return; }
    try {
      const name = 'AI 挑歌 ' + new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      const pl = await api.createPlaylist(name);
      if (!pl) { toast('创建播放列表失败'); return; }
      for (const s of songs) await api.addToPlaylist(pl.id, s.id);
      await reloadPlaylists();
      toast('已保存到播放列表：' + name);
      closeAiPick();
    } catch (e) { toast('保存失败：' + e.message); }
  }
  function buildDjOrder(ids) {
    const arr = ids.map((id) => ({ id, bpm: dj.bpmCache.get(id) || null }));
    if (arr.length < 2 || !arr.some((x) => x.bpm)) return null;
    const used = new Set(); const order = []; let cur = 0;
    used.add(cur); order.push(arr[cur].id);
    while (order.length < arr.length) {
      let best = -1, bestDiff = Infinity;
      for (let i = 0; i < arr.length; i++) {
        if (used.has(i)) continue;
        const cb = arr[cur].bpm, nb = arr[i].bpm;
        const diff = (cb && nb) ? Math.abs(nb - cb) : 999;
        let score = diff;
        if (cb && nb) { const pct = diff / cb; if (pct <= 0.05) score = diff; else if (pct <= 0.10) score = diff + 50; else if (pct <= 0.20) score = diff + 200; else score = diff + 500; }
        if (score < bestDiff) { bestDiff = score; best = i; }
      }
      if (best < 0) break; used.add(best); order.push(arr[best].id); cur = best;
    }
    return order;
  }

  /* ---------- AI DJ 实时对话：混音出问题随时跟 AI 说，AI 调整参数实时生效 ---------- */
  function openDjChat() {
    $('djchat-modal').hidden = false;
    const now = $('djchat-now');
    if (now) {
      const s = currentSong();
      if (s) {
        now.hidden = false;
        now.innerHTML = '<b>' + escapeHtml(s.title) + '</b> - <span>' + escapeHtml(s.artist) + '</span>' + (dj.curBpm ? ' <span>BPM ' + Math.round(dj.curBpm) + '</span>' : '');
      } else { now.hidden = true; }
    }
    const chat = $('djchat-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    setTimeout(() => { const inp = $('djchat-input'); if (inp) inp.focus(); }, 60);
  }
  function closeDjChat() { $('djchat-modal').hidden = true; }
  function djChatAddMsg(cls, html) {
    const chat = $('djchat-chat');
    if (!chat) return null;
    const div = document.createElement('div');
    div.className = 'aipick-msg ' + cls;
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }
  function buildDjChatContext() {
    const cur = currentSong();
    const ctx = {};
    if (cur) {
      ctx.cur = { title: cur.title, artist: cur.artist, bpm: dj.bpmCache.get(cur.id) || null, introEnd: null, outroStart: null, tailQuiet: null };
      try {
        const buf = dj.bufferCache.get(cur.id) || null;
        if (buf) {
          const st = detectStructure(buf, ctx.cur.bpm || 120, cur.id);
          if (st) { ctx.cur.introEnd = st.introEnd; ctx.cur.outroStart = st.outroStart; }
          const env = cachedEnv(buf, cur.id);
          if (env && env.diff) {
            const avg = (a, b2) => { let s = 0, c = 0; for (let i = Math.max(0, Math.floor(a)); i < Math.min(env.diff.length, Math.floor(b2)); i += 4) { s += env.diff[i]; c++; } return c ? s / c : 0; };
            const songAvg = avg(0, env.diff.length);
            const tailAvg = avg(st ? st.outroStart / env.dt : env.diff.length * 0.8, env.diff.length);
            ctx.cur.tailQuiet = songAvg > 0 && tailAvg < songAvg * 0.5;
          }
        }
      } catch (e) {}
    }
    const b = dj.bridge;
    if (b && b.song) ctx.next = { title: b.song.title, artist: b.song.artist, bpm: b.bpm || dj.bpmCache.get(b.song.id) || null, entryPoint: null };
    ctx.plan = { alignNext: null, mixLead: null, mixRamp: null, mixHold: null, cutDur: null, newVol: null, eqSpeed: null };
    return ctx;
  }
  async function sendDjChat(text) {
    const q = String(text || '').trim();
    if (!q) return;
    if (!state.hasKey && !state.hasDjKey) { djChatAddMsg('ai', '⚠️ 还没有配置 API Key，请先到 设置 里填入 DeepSeek API Key。'); return; }
    djChatAddMsg('user', escapeHtml(q));
    const loading = djChatAddMsg('ai loading', '🎧 AI DJ 正在分析问题并调整混音…');
    try {
      const res = await Promise.race([ api.djChat(q, buildDjChatContext()), new Promise((r2) => setTimeout(() => r2(null), 60000)) ]);
      if (loading) loading.remove();
      if (!res) { djChatAddMsg('ai', '😅 没听懂，能再说具体一点吗？比如是切太快、尾奏太长还是音量不对。'); return; }
      const adj = res.adjust || {};
      if (Object.keys(adj).length) {
        dj.userAdjust = Object.assign({}, dj.userAdjust || {}, adj);
        const lbls = { mixLead: '混音提前', mixRamp: '升音量', mixHold: '重合时长', cutDur: '裁切', newVol: '新歌音量', eqSpeed: 'EQ', alignNext: '切入位置' };
        const adjHtml = '<div class="djchat-msg-adj">✅ 已应用：' + Object.keys(adj).map((k) => '<i>' + (lbls[k] || k) + ' ' + adj[k] + '</i>').join('') + '</div>';
        djChatAddMsg('ai', escapeHtml(res.text || '已调整') + adjHtml);
        toast('AI DJ 已调整混音参数，下次切歌生效');
      } else {
        djChatAddMsg('ai', escapeHtml(res.text || '收到') + '<br><span class="aipick-reason">（没有需要调整的参数，继续保持当前混音风格）</span>');
      }
    } catch (e) {
      if (loading) loading.remove();
      djChatAddMsg('ai', '⚠️ 连接失败：' + escapeHtml(e.message || '网络错误'));
    }
  }
  function escapeHtml(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  $('settings-backdrop').addEventListener('click', closeSettings);
  $('settings-cancel').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', async () => {
    const key = $('api-key-input').value.trim();
    const djKey = $('dj-api-key-input').value.trim();
    try {
      if (key) {
        await api.setSettings({ apiKey: key });
        toast('API Key 已保存');
      }
      if (djKey) {
        await api.setSettings({ djApiKey: djKey });
        toast('AI DJ Key 已保存');
      }
      await api.setSettings({
        translationEnabled: $('translation-toggle').checked,
        doubaoAppId: $('doubao-appid').value.trim(),
        doubaoTtoken: $('doubao-token').value.trim(),
        djVoice: $('dj-voice-select').value
      });
      const st2 = await api.getSettings();
      state.hasKey = !!st2.hasKey;
      state.hasDjKey = !!st2.hasDjKey;
      doubaoCfg.appId = st2.doubaoAppId || '';
      doubaoCfg.token = st2.doubaoTtoken || '';
      state.djVoice = st2.djVoice || 'zh-CN-XiaoxiaoNeural';
      if ($('doubao-token').value.trim()) toast('豆包语音已配置，DJ 将用豆包声线');
    } catch (e) { toast('保存失败'); }
    closeSettings();
    const song = currentSong();
    if (song) loadLyrics(song);
  });

  /* ---------- 专业 EQ 交叉混音（Bass Swap） ---------- */
  function buildEqChain(ctx, source) {
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 200; low.gain.value = 0;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1; mid.gain.value = 0;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 2000; high.gain.value = 0;
    const out = ctx.createGain(); out.gain.value = 0;
    source.connect(low); low.connect(mid); mid.connect(high); high.connect(out); out.connect(ctx.destination);
    return { low, mid, high, out };
  }
  /* ---------- AI DJ：BPM 检测 + 无缝混音 ---------- */
  /* ============ Smart Reorder（智能重排：BPM + 调性） ============ */
  function keyCompatibilityScore(a, b) {
    if (!a || !b) return 8;
    if (a.idx === b.idx) return 12;
    const diff = Math.min(Math.abs(a.idx - b.idx), 12 - Math.abs(a.idx - b.idx));
    if (diff === 3) return 10;
    if (diff <= 1) return 9;
    if (diff === 4) return 8;
    if (diff === 5) return 7;
    if (diff === 7) return 6;
    return Math.max(2, 5 - diff);
  }
  function smartReorder(songs, startIndex) {
    if (!Array.isArray(songs) || songs.length < 2) return songs;
    const list = songs.slice();
    const used = new Set();
    const result = [];
    let cur = (startIndex != null && startIndex >= 0 && startIndex < list.length) ? startIndex : 0;
    used.add(cur);
    result.push(list[cur]);
    while (result.length < list.length) {
      const curSong = list[cur];
      const curBpm = dj.bpmCache.get(curSong.id) || null;
      const curKey = dj.keyCache.get(curSong.id) || null;
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < list.length; i++) {
        if (used.has(i)) continue;
        const s2 = list[i];
        const bpm2 = dj.bpmCache.get(s2.id) || null;
        const key2 = dj.keyCache.get(s2.id) || null;
        let score = 0;
        if (curBpm && bpm2) {
          const pct = Math.abs(bpm2 - curBpm) / curBpm;
          if (pct <= 0.03) score += 40;
          else if (pct <= 0.06) score += 32;
          else if (pct <= 0.10) score += 22;
          else if (pct <= 0.18) score += 12;
          else score += Math.max(0, 8 - pct * 20);
        } else {
          score += 15;
        }
        score += keyCompatibilityScore(curKey, key2);
        // 节拍强度相近（鼓点/底音密度）：强节拍歌接强节拍歌，温馨歌接温馨歌
        const bi1 = dj.beatIntensity.get(curSong.id);
        const bi2 = dj.beatIntensity.get(s2.id);
        if (bi1 != null && bi2 != null) {
          const biDiff = Math.abs(bi1 - bi2);
          if (biDiff <= 0.12) score += 24;
          else if (biDiff <= 0.25) score += 15;
          else if (biDiff <= 0.4) score += 6;
        } else {
          score += 8;
        }
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) break;
      used.add(best);
      result.push(list[best]);
      cur = best;
    }
    return result;
  }
  function applySmartReorder() {
    const list = visibleSongs();
    if (list.length < 2) { toast('列表歌曲太少，无法重排'); return; }
    const cur = currentSong();
    const startIdx = cur ? list.findIndex((s) => s.id === cur.id) : -1;
    const reordered = smartReorder(list, startIdx >= 0 ? startIdx : 0);
    const reorderedIds = new Set(reordered.map((s) => s.id));
    const rest = state.songs.filter((s) => !reorderedIds.has(s.id));
    const merged = reordered.concat(rest);
    const newIndexMap = new Map(merged.map((s, i) => [s.id, i]));
    state.songs = merged;
    if (cur) {
      const ni = newIndexMap.get(cur.id);
      if (ni != null) state.current = ni;
    }
    dj.order = reordered.map((s) => s.id);
    dj._played = new Set();
    state.smartOrder = true;
    renderSongs();
    toast('Smart Reorder：已按 BPM + 调性智能重排');
  }
  const dj = {
    ctx: null,
    bpmCache: new Map(),
    keyCache: new Map(),
    beatIntensity: new Map(),
    bufferCache: new Map(),
    envCache: new Map(),
    bridge: null,
    crossfadeSec: 5,
    _fade: null,
    _commentTimer: null,
    _startTimer: null,
    effect: null,
    transitioning: false,
    _swapped: false,
    _played: new Set(),
    lastStrategy: null,
    order: null,
    lastAlign: null,
    userAdjust: null
  };
  let djGen = 0;

  function getAudioCtx() {
    if (!dj.ctx) dj.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (dj.ctx.state === 'suspended') dj.ctx.resume().catch(() => {});
    return dj.ctx;
  }

  /* ---------- Auto Mix：调性检测（chroma + Krumhansl-Schmuckler） ---------- */
  const KS_PROFILES = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  };
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function detectKey(buf) {
    try {
      if (!buf) return null;
      const sr = buf.sampleRate;
      const ch0 = buf.getChannelData(0);
      const N = ch0.length;
      const hop = Math.floor(sr * 0.1);
      const fft = new Float32Array(4096);
      const chroma = new Float32Array(12);
      const step = Math.max(1, Math.floor(sr / 22050));
      const n = Math.floor(N / step);
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) mono[i] = ch0[i * step];
      const SR = 22050;
      const frame = Math.floor(SR * 0.1);
      for (let off = 0; off + frame < mono.length; off += frame) {
        for (let k = 0; k < 4096; k++) fft[k] = 0;
        for (let i = 0; i < frame && i < 4096; i++) fft[i] = mono[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame));
        // 简易 DFT 到 12 个半音
        for (let pc = 0; pc < 12; pc++) {
          let energy = 0;
          for (let oct = 1; oct < 6; oct++) {
            const freq = 440 * Math.pow(2, (pc - 9) / 12 + oct - 4);
            const bin = Math.round(freq * 4096 / SR);
            if (bin > 0 && bin < 4096) {
              energy += fft[bin] * fft[bin];
            }
          }
          chroma[pc] += energy;
        }
      }
      // 归一化 chroma
      const maxC = Math.max(0.0001, ...chroma);
      for (let i = 0; i < 12; i++) chroma[i] /= maxC;
      // Krumhansl-Schmuckler 匹配
      let bestKey = 0, bestCorr = -Infinity, bestMode = 'major';
      for (let k = 0; k < 12; k++) {
        for (const mode of ['major', 'minor']) {
          let corr = 0;
          const prof = KS_PROFILES[mode];
          for (let i = 0; i < 12; i++) corr += chroma[(k + i) % 12] * prof[i];
          if (corr > bestCorr) { bestCorr = corr; bestKey = k; bestMode = mode; }
        }
      }
      return { key: NOTE_NAMES[bestKey], mode: bestMode, idx: bestKey };
    } catch (e) { return null; }
  }
  // 调性兼容性：同一调或关系调（±4 半音内的相对小调/大调）视为兼容
  function keyCompatible(a, b) {
    if (!a || !b) return true;
    const diff = Math.min(Math.abs(a.idx - b.idx), 12 - Math.abs(a.idx - b.idx));
    if (a.idx === b.idx) return true;
    // 关系调：小三度（3）和同主音（0）
    if (diff === 3 || diff === 0) return true;
    return diff <= 1;
  }
  async function analyzeKey(song, buf) {
    if (dj.keyCache.has(song.id)) return dj.keyCache.get(song.id);
    const b = buf || dj.bufferCache.get(song.id);
    const k = detectKey(b);
    if (k) dj.keyCache.set(song.id, k);
    return k;
  }
  // 过渡策略自动选择
  function chooseTransitionStrategy(bpmA, bpmB, keyA, keyB) {
    if (!bpmA || !bpmB) return 'crossfade';
    const diff = Math.abs(bpmA - bpmB);
    const compat = keyCompatible(keyA, keyB);
    if (diff <= 4 && compat) return 'cut';
    if (diff <= 12 && compat) return 'crossfade';
    if (diff <= 25) return 'fade';
    if (diff <= 40) return 'filter';
    return 'echo';
  }
  async function analyzeBpm(song) {
    if (!song || !song.path) return null;
    if (dj.bpmCache.has(song.id)) return dj.bpmCache.get(song.id);
    try {
      const cached = await api.getBpm(song.id);
      if (cached) { dj.bpmCache.set(song.id, cached); return cached; }
    } catch (e) {}
    try {
      const ab = await api.readFileBuffer(song.path);
      if (!ab) return null;
      const ctx = getAudioCtx();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      dj.bufferCache.set(song.id, buf);
      const SR = 22050;
      const ch = buf.getChannelData(0);
      const step = Math.max(1, Math.floor(buf.sampleRate / SR));
      const n = Math.floor(ch.length / step);
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) mono[i] = ch[i * step];
      const win = Math.floor(SR * 0.05);
      const hop = Math.floor(SR * 0.0232);
      const energies = [];
      for (let i = 0; i + win < n; i += hop) {
        let e = 0;
        for (let j = i; j < i + win; j++) e += mono[j] * mono[j];
        energies.push(e / win);
      }
      const diff = new Float32Array(Math.max(1, energies.length - 1));
      for (let i = 1; i < energies.length; i++) diff[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
      const dt = hop / SR;
      let best = null;
      const candidates = [];
      const maxLag = Math.min(Math.floor(diff.length / 2), Math.floor(60 / 60 / dt) + 5);
      for (let lag = Math.max(4, Math.floor(60 / 200 / dt) - 5); lag < maxLag; lag++) {
        const bpm = 60 / (lag * dt);
        if (bpm < 60 || bpm > 200) continue;
        let sum = 0, cnt = 0;
        for (let t = 0; t + lag < diff.length; t += lag) { sum += diff[t] * diff[t + lag]; cnt++; }
        const val = cnt ? sum / cnt : 0;
        candidates.push({ lag, val, bpm: Math.round(bpm) });
        if (!best || val > best.val) best = { lag, val, bpm: Math.round(bpm) };
      }
      if (!best) return null;
      // BPM 倍频修正：检测 2x / 0.5x 候选，选得分更高且更合理的（避免半速/倍速误判）
      const tryBpm = (bp) => candidates.filter((c) => Math.abs(c.bpm - bp) <= 1).reduce((m, c) => (c.val > m.val ? c : m), { val: 0 });
      const half = best.bpm / 2 >= 60 ? tryBpm(best.bpm / 2) : null;
      const twice = best.bpm * 2 <= 200 ? tryBpm(best.bpm * 2) : null;
      if (half && half.val > best.val * 1.15) best = { lag: half.lag, val: half.val, bpm: Math.round(best.bpm / 2) };
      else if (twice && twice.val > best.val * 1.15) best = { lag: twice.lag, val: twice.val, bpm: Math.round(best.bpm * 2) };
      // 节拍强度：能量突变的密度（鼓点/底音越多，值越高 0~1）
      try {
        const sorted = Array.from(diff).sort((a, b) => b - a);
        const thr = sorted[Math.floor(sorted.length * 0.3)] || 0;
        let peaks = 0, total = 0;
        for (let i = 1; i < diff.length; i++) { total++; if (diff[i] > thr) peaks++; }
        dj.beatIntensity.set(song.id, total ? Math.min(1, peaks / total * 4) : 0);
      } catch (e) {}
      dj.bpmCache.set(song.id, best.bpm);
      try { await api.saveBpm(song.id, best.bpm); } catch (e) {}
      return best.bpm;
    } catch (e) {
      console.error('[dj] bpm error:', e.message);
      return null;
    }
  }

  function resetBridge() {
    djGen++;
    clearInterval(dj._fade);
    dj._fade = null;
    if (dj.bridge) {
      dj.bridge.element.pause();
      dj.bridge.element.src = '';
      dj.bridge.song = null;
      dj.bridge.built = false;
      dj.bridge.started = false;
      dj.bridge.crossfading = false;
    }
  }

  async function prepareBridge() {
    if (!state.dj || state.current < 0) return;
    const gen = ++djGen;
    const cur = currentSong();
    if (!cur) return;
    const nextIdx = pickNextIndex();
    if (nextIdx < 0 || nextIdx === state.current) return;
    const nextSong = state.songs[nextIdx];
    const results = await Promise.all([analyzeBpm(cur), analyzeBpm(nextSong)]);
    // Auto Mix：顺带分析调性用于标签和过渡策略
    try {
      const cb = dj.bufferCache.get(cur.id);
      const nb2 = dj.bufferCache.get(nextSong.id);
      if (cb) analyzeKey(cur, cb);
      if (nb2) analyzeKey(nextSong, nb2);
    } catch (e) {}
    // 预热：提前解码下一首并缓存调性/节拍包络，切换瞬间零卡顿
    try {
      const nb3 = await ensureDecoded(nextSong);
      if (nb3) {
        if (!dj.envCache.has(nextSong.id)) cachedEnv(nb3, nextSong.id);
        if (!dj.keyCache.has(nextSong.id)) analyzeKey(nextSong, nb3);
      }
      const cb3 = dj.bufferCache.get(cur.id);
      if (cb3) {
        if (!dj.envCache.has(cur.id)) cachedEnv(cb3, cur.id);
        if (!dj.keyCache.has(cur.id)) analyzeKey(cur, cb3);
      }
    } catch (e) {}

    if (gen !== djGen || !state.dj) return;
    if (!dj.bridge) dj.bridge = { element: createAudioEl(), song: null, built: false, started: false, crossfading: false, bufferMode: false, bridgeElapsed: 0 };
    const b = dj.bridge;
    b.song = nextSong;
    b.built = false;
    b.started = false;
    b.crossfading = false;
    dj.curBpm = results[0];
    b.bpm = results[1];
    b.element.src = fileUrl(nextSong.path);
    b.element.volume = state.volume;
    b.built = true;
  }

  function alignRates(bpmA, bpmB) {
    if (!bpmA || !bpmB || bpmA <= 0 || bpmB <= 0) return { a: 1, b: 1 };
    const avg = (bpmA + bpmB) / 2;
    const clamp = (v) => Math.min(1.25, Math.max(0.8, v));
    return { a: clamp(avg / bpmA), b: clamp(avg / bpmB) };
  }

  /* ---------- 节拍检测辅助 ---------- */
  function onsetEnv(buf) {
    const SR = 22050;
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(buf.sampleRate / SR));
    const n = Math.floor(ch.length / step);
    const win = Math.floor(SR * 0.05);
    const hop = Math.floor(SR * 0.0232);
    const energies = [];
    for (let i = 0; i + win < n; i += hop) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += ch[j * step] * ch[j * step];
      energies.push(e / win);
    }
    const diff = new Float32Array(Math.max(1, energies.length - 1));
    for (let i = 1; i < energies.length; i++) diff[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
    return { diff, dt: hop / SR };
  }
  function cachedEnv(buf, id) {
    if (!dj.envCache.has(id)) dj.envCache.set(id, onsetEnv(buf));
    return dj.envCache.get(id);
  }
  function estimateNextBeatDelay(buf, bpm, fromTime, id) {
    if (!buf || !bpm || bpm <= 0) return 0;
    const period = 60 / bpm;
    const { diff, dt } = cachedEnv(buf, id);
    const fromIdx = Math.min(Math.floor(fromTime / dt), diff.length - 1);
    const searchStart = Math.max(0, fromIdx - Math.floor((period * 2.5) / dt));
    let anchorIdx = -1, bestVal = 0;
    for (let i = searchStart; i < fromIdx && i < diff.length; i++) {
      if (diff[i] > bestVal) { bestVal = diff[i]; anchorIdx = i; }
    }
    if (anchorIdx < 0) return 0;
    const anchorTime = anchorIdx * dt;
    let delay = period - ((fromTime - anchorTime) % period + period) % period;
    if (delay <= 0.02) delay = period;
    return Math.max(0.06, Math.min(delay, period * 1.1));
  }
  function firstBeatOffset(buf, bpm, id) {
    if (!buf || !bpm || bpm <= 0) return 0;
    const period = 60 / bpm;
    const { diff, dt } = cachedEnv(buf, id);
    const window = Math.min(diff.length, Math.floor((period * 4) / dt));
    let best = 0, bestVal = 0;
    for (let i = 1; i < window; i++) {
      if (diff[i] > bestVal) { bestVal = diff[i]; best = i; }
    }
    return Math.min(best * dt, period * 1.2);
  }

  /* ---------- 歌曲结构识别（前奏 intro / 尾奏 outro） ---------- */
  function detectStructure(buf, bpm, id) {
    try {
      if (!buf || !bpm) return null;
      const period = 60 / bpm;
      const { diff, dt } = cachedEnv(buf, id);
      const seg = Math.max(1, Math.round(0.5 / dt));
      const smooth = [];
      for (let i = 0; i < diff.length; i += seg) {
        let s = 0, c = 0;
        for (let j = i; j < i + seg && j < diff.length; j++) { s += diff[j]; c++; }
        smooth.push(c ? s / c : 0);
      }
      const segDur = seg * dt;
      const totalDur = buf.duration || 0;
      const energyAvg = smooth.reduce((a, b) => a + b, 0) / Math.max(1, smooth.length);
      let introEnd = 8;
      for (let i = 1; i < Math.min(smooth.length, Math.floor(30 / segDur)); i++) {
        if (smooth[i] > energyAvg * 1.6) { introEnd = i * segDur; break; }
      }
      let outroStart = Math.max(0, totalDur - 12);
      const tailIdx = Math.floor(smooth.length * 0.8);
      for (let i = smooth.length - 1; i >= tailIdx; i--) {
        if (smooth[i] > energyAvg * 0.6) { outroStart = Math.min(totalDur - 3, (i + 1) * segDur); break; }
      }
      return { introEnd: Math.round(introEnd), outroStart: Math.round(outroStart), duration: Math.round(totalDur) };
    } catch (e) { return null; }
  }
  /* ---------- 响度匹配（吵→安静平滑过渡） ---------- */
  function rmsOf(buf, fromSec, durSec) {
    if (!buf) return 0;
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const s = Math.max(0, Math.floor(fromSec * sr));
    const e = Math.min(ch.length, Math.floor((fromSec + Math.max(0.5, durSec || 6)) * sr));
    let sum = 0, n = 0;
    for (let i = s; i < e; i += 193) { sum += ch[i] * ch[i]; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  }
  function loudnessGain(oldBuf, oldFrom, newBuf, newFrom) {
    const rOld = rmsOf(oldBuf, oldFrom, 6);
    const rNew = rmsOf(newBuf, Math.max(0, newFrom), 6);
    if (rOld < 0.01 || rNew < 0.01) return 1;
    return Math.min(1.5, Math.max(0.6, rOld / rNew));
  }
  /* ---------- EQ 分层：给音频元素挂 WebAudio 滤波链（过渡时新歌低频延后加入，旧歌高频先撤） ---------- */
  function routeElement(el) {
    if (!el || el._routed) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const src = ctx.createMediaElementSource(el);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.7;
      src.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
      el._hp = hp; el._lp = lp; el._routed = true;
    } catch (e) {}
  }
  function resetEq(el) {
    try { if (el && el._hp) el._hp.frequency.value = 20; if (el && el._lp) el._lp.frequency.value = 20000; } catch (e) {}
  }

  /* ---------- 实时歌曲画像（每首歌独立分析，过渡方案因歌而异） ---------- */
  function analyzeSongProfile(song, buf, id, bpm) {
    if (!buf) return null;
    const prof = { id, bpm, key: null, beatIntensity: null, introEnd: 0, outroStart: 0, outroLen: 0, tailQuiet: false, entryPoint: 0, duration: buf.duration || 0 };
    try { prof.key = dj.keyCache.get(id) || null; } catch (e) {}
    try { prof.beatIntensity = dj.beatIntensity.get(id) || null; } catch (e) {}
    try {
      const st = detectStructure(buf, bpm, id);
      if (st) { prof.introEnd = st.introEnd; prof.outroStart = st.outroStart; }
    } catch (e) {}
    try {
      const { diff, dt } = cachedEnv(buf, id);
      if (diff && diff.length > 50) {
        const avg = (a, b2) => { let s = 0, c = 0; for (let i = Math.max(0, Math.floor(a)); i < Math.min(diff.length, Math.floor(b2)); i += 4) { s += diff[i]; c++; } return c ? s / c : 0; };
        const songAvg = avg(0, diff.length);
        prof.outroLen = Math.max(0, prof.duration - prof.outroStart);
        const tailAvg = avg(prof.outroStart / dt, diff.length);
        prof.tailQuiet = songAvg > 0 && tailAvg < songAvg * 0.5;
        // 新歌可切入段：introEnd 后第一个「能量中等且持续 ≥2 秒」的段起点（跳过前奏与低谷）
        const sorted = Array.from(diff).sort((a, b) => b - a);
        const thr = sorted[Math.floor(sorted.length * 0.4)];
        const startIdx = Math.floor(Math.max(prof.introEnd, 3) / dt);
        const runNeed = Math.floor(2 / dt);
        let run = 0;
        for (let i = startIdx; i < diff.length - runNeed; i++) {
          if (diff[i] > thr) { run++; if (run >= runNeed) { prof.entryPoint = Math.max(0, (i - run + 1) * dt); break; } }
          else run = 0;
        }
      }
    } catch (e) {}
    return prof;
  }
  /* 逐对定制混音方案：每两首歌都不同 */
  function buildMixPlan(cur, next) {
    const plan = { alignNext: next ? next.entryPoint : 0, mixLead: 7, mixRamp: 1.4, mixHold: 3.2, cutDur: 0.3, newVol: 0.7, eqSpeed: 1 };
    if (!cur) return plan;
    // 混音提前量：由旧歌尾奏决定（尾奏长且平淡 → 早切入早裁，不拖；有能量尾奏 → 正常）
    if (cur.tailQuiet) plan.mixLead = Math.max(4, Math.min(cur.outroLen + 1.5, 6));
    else if (cur.outroLen > 0.5) plan.mixLead = Math.max(5, Math.min(cur.outroLen + 2, 9));
    else plan.mixLead = 7;
    // 兼容度决定重合时长：BPM 接近 + 调性兼容 → 深度融合；不兼容 → 快进快出
    if (next) {
      const bpmDiff = Math.abs((cur.bpm || 120) - (next.bpm || 120));
      const compat = keyCompatible(cur.key, next.key);
      if (bpmDiff <= 4 && compat) { plan.mixHold = 4.4; plan.mixRamp = 1.7; plan.cutDur = 0.35; }
      else if (bpmDiff <= 12 && compat) { plan.mixHold = 3.4; plan.mixRamp = 1.4; plan.cutDur = 0.3; }
      else { plan.mixHold = 2.4; plan.mixRamp = 1.1; plan.cutDur = 0.25; }
      plan.eqSpeed = next.beatIntensity && next.beatIntensity > 0.5 ? 0.8 : 1.2;
    }
    // AI 实时对话调整（用户反馈的偏好，优先级最高，持续生效）
    const ua = dj.userAdjust;
    if (ua) {
      if (typeof ua.mixLead === 'number') plan.mixLead = Math.max(4, Math.min(12, ua.mixLead));
      if (typeof ua.mixRamp === 'number') plan.mixRamp = Math.max(0.8, Math.min(3, ua.mixRamp));
      if (typeof ua.mixHold === 'number') plan.mixHold = Math.max(1.5, Math.min(6, ua.mixHold));
      if (typeof ua.cutDur === 'number') plan.cutDur = Math.max(0.15, Math.min(0.6, ua.cutDur));
      if (typeof ua.newVol === 'number') plan.newVol = Math.max(0.4, Math.min(0.9, ua.newVol));
      if (typeof ua.eqSpeed === 'number') plan.eqSpeed = Math.max(0.5, Math.min(1.5, ua.eqSpeed));
      if (typeof ua.alignNext === 'number') plan.alignNext = Math.max(0, Math.min(60, ua.alignNext));
    }
    return plan;
  }

  /* ---------- 真·无缝衔接：节拍相位对齐 ---------- */
  async function startBridge(manual) {
    const b = dj.bridge;
    if (!b || !b.built || b.started) return;
    b.started = true;
    dj._swapped = false;
    let ctxTime0 = 0;
    const pbx = $('pb-transition');
    if (pbx) pbx.hidden = false;
    routeElement(audio);
    routeElement(b.element);
    const curSong = currentSong();
    const curBuf = curSong ? (dj.bufferCache.get(curSong.id) || await ensureDecoded(curSong)) : null;
    const nextBuf = dj.bufferCache.get(b.song.id) || await ensureDecoded(b.song);
    const bpmA = dj.bpmCache.get(curSong ? curSong.id : '') || dj.curBpm;
    const bpmB = b.bpm || dj.bpmCache.get(b.song.id);
    const period = bpmA && bpmA > 0 ? 60 / bpmA : 0.5;
    const rate = (bpmA && bpmB && bpmA > 0 && bpmB > 0) ? Math.min(1.4, Math.max(0.7, bpmA / bpmB)) : 1;
    // 实时画像：分析正在播放的歌与下一首（逐对定制混音）
    const curProf = curBuf ? analyzeSongProfile(curSong, curBuf, curSong ? curSong.id : '', bpmA) : null;
    const nextProf = nextBuf ? analyzeSongProfile(b.song, nextBuf, b.song.id, bpmB) : null;
    const mixPlan = buildMixPlan(curProf, nextProf);
    // AI 实时定制：把两首歌的实时画像交给 DeepSeek，逐对重新调整过渡方案（有 key 时），失败则回退内置算法
    let aiPlan = null;
    if ((state.hasKey || state.hasDjKey) && api.getDjPlan && curSong) {
      try {
        aiPlan = await Promise.race([
          api.getDjPlan(Object.assign({}, curSong, curProf || {}), Object.assign({}, b.song, nextProf || {})),
          new Promise((res) => setTimeout(() => res(null), 9000))
        ]);
      } catch (e) { aiPlan = null; }
      if (aiPlan) {
        if (aiPlan.alignPrefer) mixPlan.alignNext = aiPlan.alignPrefer;
        if (aiPlan.mixLead) mixPlan.mixLead = aiPlan.mixLead;
        if (aiPlan.mixRamp) mixPlan.mixRamp = aiPlan.mixRamp;
        if (aiPlan.mixHold) mixPlan.mixHold = aiPlan.mixHold;
        if (aiPlan.cutDur) mixPlan.cutDur = aiPlan.cutDur;
        if (aiPlan.newVol) mixPlan.newVol = aiPlan.newVol;
        if (aiPlan.eqSpeed) mixPlan.eqSpeed = aiPlan.eqSpeed;
      }
    }
    const fb0 = nextBuf ? firstBeatOffset(nextBuf, bpmB, b.song.id) : 0;
    const align = nextBuf ? (() => {
      // 新歌切入：优先用画像的「能量切入段」（跳过前奏/低谷）；不可用则退回首拍
      if (mixPlan.alignNext && mixPlan.alignNext > fb0 + 0.3 && mixPlan.alignNext < nextBuf.duration - 1) return mixPlan.alignNext;
      return fb0;
    })() : 0;
    let delay = curBuf && bpmA ? estimateNextBeatDelay(curBuf, bpmA, audio.currentTime || 0, curSong ? curSong.id : '') : 0;
    const remain = (audio.duration || 999) - (audio.currentTime || 0);
    if (delay <= 0.05 || (manual && delay > 1.5)) delay = manual ? 0.12 : Math.min(0.12, Math.max(0.05, remain - 0.4));
    if (delay >= remain - 0.3) delay = Math.max(0.05, remain - 0.3);
    dj.lastAlign = { delay: Math.round(delay * 1000), rate: Math.round(rate * 100) / 100, align: Math.round(align * 100) / 100, bpmA, bpmB };
    // 重分析提前完成（远离切换时刻，切换瞬间不再卡顿）：调性 / 结构 / 过渡策略
    let strategy = 'crossfade';
    try {
      const ka = analyzeKey(curSong, curBuf);
      const kb = analyzeKey(b.song, nextBuf);
      const struct = detectStructure(nextBuf, bpmB, b.song.id);
      b.structure = struct;
      strategy = chooseTransitionStrategy(bpmA, bpmB, ka, kb);
      if (state.djPreset && state.djPreset !== 'auto') strategy = state.djPreset;
      dj.lastStrategy = strategy;
      updateAmStrategyLabel();
    } catch (e) { strategy = 'crossfade'; }
    dj._startTimer = setTimeout(() => {
      const strategyInfo = document.getElementById('dj-strategy');
      if (strategyInfo) strategyInfo.textContent = strategy.toUpperCase();
      // 新歌用 HTMLAudio 播放：preservesPitch 变速但音高不变（杜绝变声器效果）
      try { b.element.preservesPitch = true; b.element.mozPreservesPitch = true; b.element.webkitPreservesPitch = true; } catch (e) {}
      b.element.playbackRate = rate;
      b.element.currentTime = align;
      b.element.volume = 0;
      b.element.play().catch(() => {});
      b.bufferMode = false;
      const lockStartMain = audio.currentTime || 0;
      const lockStartBridge = b.element.currentTime || 0;
      const lockRate = rate;
      const gain = loudnessGain(curBuf, audio.currentTime || 0, nextBuf, align);
      // 切入窗口：8 秒，旧歌在节拍点被裁掉（缩减长度），新歌同点平滑切入
      // 乐句对齐：过渡长度对齐 16 拍乐句；若旧歌尾奏平淡（低能量），在能量段内完成过渡（提前切掉平淡尾部）
      // 混音提前量：由这一对歌的专属方案决定（旧歌尾奏长短/能量不同 → 切入时机不同）
      const tNowX = audio.currentTime || 0;
      const endX = audio.duration || 0;
      const remainX = endX - tNowX;
      let mixLead = mixPlan.mixLead;
      mixLead = Math.max(3, Math.min(mixLead, remainX - 0.5));
      let fading = false;
      let cutState = 0;
      let mixStartT = 0;
      let cutStartT = 0;
      clearInterval(dj._fade);
      dj._fade = setInterval(() => {
        // 节拍锁定：实时微调新歌速率（preservesPitch 保证音高不变）——两首歌鼓点始终踩在一起
        try {
          const tMain = audio.currentTime || 0;
          const tBr = b.element.currentTime || 0;
          const ideal = lockStartBridge + (tMain - lockStartMain) * lockRate;
          const drift = tBr - ideal;
          if (Math.abs(drift) > 0.012) {
            const corr = Math.max(-0.03, Math.min(0.03, -drift * 0.4));
            b.element.playbackRate = Math.max(0.6, Math.min(1.5, lockRate + corr));
          }
        } catch (e) {}
        b.bridgeElapsed = b.element.currentTime || 0;
        const remain = (audio.duration || 0) - (audio.currentTime || 0);
        // 混音开始：旧歌还剩 mixLead 秒时，新歌进入（节拍重合，两首歌都响）
        if (!fading && remain <= mixLead) { fading = true; mixStartT = audio.currentTime || 0; }
        if (fading) {
          const t = (audio.currentTime || 0) - mixStartT;
          if (cutState === 0) {
            // 混音段：新歌按方案节奏升到目标音量（明显可闻的鼓点），旧歌保持 —— 两首歌节拍重合
            const mp = Math.min(1, t / mixPlan.mixRamp);
            b.element.volume = Math.max(0, Math.min(1, state.volume * (0.06 + (mixPlan.newVol - 0.06) * mp) * gain));
            audio.volume = Math.max(0, Math.min(1, state.volume * (1 - 0.12 * mp)));
            // EQ 分层：新歌低频随进入放开（速度按方案 eqSpeed 调整），旧歌高频微收
            try {
              if (b.element._hp) b.element._hp.frequency.value = 700 - 680 * mp * mixPlan.eqSpeed;
              if (audio._lp) audio._lp.frequency.value = 20000 - 1200 * mp;
            } catch (e) {}
            // 重合时长按方案（兼容的歌混得更久，不兼容的快进快出）
            if (t >= mixPlan.mixRamp + mixPlan.mixHold) { cutState = 1; cutStartT = audio.currentTime || 0; }
          } else if (cutState === 1) {
            // 裁切：旧歌按方案时长快速撤到 0（不是慢慢淡出，而是 DJ 式裁切）
            const ct = (audio.currentTime || 0) - cutStartT;
            audio.volume = Math.max(0, Math.min(1, state.volume * Math.max(0, 0.88 * (1 - Math.min(1, ct / mixPlan.cutDur)))));
            try { if (audio._lp) audio._lp.frequency.value = 20000 - 19000 * Math.min(1, ct / mixPlan.cutDur); } catch (e) {}
            if (ct >= mixPlan.cutDur && !dj._swapped) {
              dj._swapped = true;
              clearInterval(dj._fade); dj._fade = null;
              swapMain();
              return;
            }
          }
        }
      }, 40);

    }, Math.max(0, delay * 1000));
  }

  /* ---------- DJ 过渡视觉动画 ---------- */
  /* ---------- DJ 过渡视觉动画 ---------- */
  function playCoverTransition(oldSong, newSong) {
    try {
      const fsEl = $('fullscreen');
      if (fsEl.hidden || !oldSong || !newSong) return;
      const inner = fsEl.querySelector('.fs-inner');
      dj.transitioning = true;
      const cover = $('fs-cover');
      const info = fsEl.querySelector('.fs-info');
      const lyrics = $('fs-lyrics');
      const root = document.documentElement;
      const centerMode = state.fsLayout === 'center';
      cover.style.transition = 'opacity 0.2s';
      cover.style.opacity = '0';
      info.style.transition = 'opacity 0.2s';
      info.style.opacity = '0';
      const oldCoverClone = cover.cloneNode(true);
      oldCoverClone.id = 'fs-cover-old';
      const oldInfoClone = info.cloneNode(true);
      oldInfoClone.id = 'fs-info-old';
      if (centerMode) {
        Object.assign(oldCoverClone.style, { position:'absolute', left:'50%', top:'46%', width:'340px', height:'340px', transform:'translate(-50%,-50%) scale(1)', opacity:'1', transition:'transform 3.5s cubic-bezier(0.22,1,0.36,1), opacity 3.5s ease', zIndex:'20', pointerEvents:'none' });
        Object.assign(oldInfoClone.style, { position:'absolute', left:'50%', top:'46%', transform:'translate(-50%, 190px)', transition:'opacity 2s ease', zIndex:'19', pointerEvents:'none' });
      } else {
        Object.assign(oldCoverClone.style, { position:'absolute', left:'50%', top:'42%', transform:'translate(calc(-50% - 300px), -50%)', transition:'transform 2s cubic-bezier(0.22, 1, 0.36, 1), opacity 2s', zIndex:'20', pointerEvents:'none' });
        Object.assign(oldInfoClone.style, { position:'absolute', left:'50%', top:'42%', transform:'translate(calc(-50% - 300px), 175px)', transition:'transform 2s cubic-bezier(0.22, 1, 0.36, 1), opacity 2s', zIndex:'19', pointerEvents:'none' });
      }
      inner.appendChild(oldCoverClone);
      inner.appendChild(oldInfoClone);
      Promise.all([extractCoverColor(oldSong), extractCoverColor(newSong)]).then((cols) => {
        const a = cols[0], b = cols[1];
        if (a && b) {
          const mix = { r: Math.round((a.r + b.r) / 2), g: Math.round((a.g + b.g) / 2), b: Math.round((a.b + b.b) / 2) };
          root.style.setProperty('--tint-r', mix.r);
          root.style.setProperty('--tint-g', mix.g);
          root.style.setProperty('--tint-b', mix.b);
          setTimeout(() => {
            root.style.setProperty('--tint-r', b.r);
            root.style.setProperty('--tint-g', b.g);
            root.style.setProperty('--tint-b', b.b);
          }, 4600);
        }
      });
      if (!centerMode) {
        lyrics.style.transition = 'opacity 3s ease';
        lyrics.style.opacity = '0';
      }
      const newCoverEl = document.createElement('div');
      newCoverEl.id = 'fs-cover-new';
      const g2 = COVER_GRADIENTS[hash(newSong.id || newSong.path) % COVER_GRADIENTS.length];
      const newInfoEl = document.createElement('div');
      newInfoEl.id = 'fs-info-new';
      if (centerMode) {
        newCoverEl.style.cssText = 'position:absolute;left:50%;top:46%;width:340px;height:340px;border-radius:22px;overflow:hidden;display:grid;place-items:center;font-size:100px;color:#fff;background:' + g2 + ';box-shadow:0 30px 70px rgba(0,0,0,0.65);transform:translate(-50%,-50%) scale(0.88);opacity:0;transition:transform 3s cubic-bezier(0.22,1,0.36,1), opacity 2.4s ease;zIndex:21;pointerEvents:none';
        newCoverEl.style.zIndex = '21';
        newInfoEl.style.cssText = 'position:absolute;left:50%;top:46%;transform:translate(-50%, 190px);opacity:0;transition:opacity 1.8s ease;text-align:center;white-space:nowrap;zIndex:21;pointerEvents:none';
        newInfoEl.style.zIndex = '21';
      } else {
        newCoverEl.style.cssText = 'position:absolute;left:50%;top:42%;width:300px;height:300px;border-radius:22px;overflow:hidden;display:grid;place-items:center;font-size:90px;color:#fff;background:' + g2 + ';box-shadow:0 30px 70px rgba(0,0,0,0.65);transition:transform 2s cubic-bezier(0.22,1,0.36,1), opacity 0.5s;zIndex:21;pointerEvents:none;opacity:0;transform:translate(calc(-50% + 700px), -50%)';
        newCoverEl.style.zIndex = '21';
        newInfoEl.style.cssText = 'position:absolute;left:50%;top:42%;transform:translate(calc(-50% + 700px), 175px);transition:transform 2s cubic-bezier(0.22,1,0.36,1), opacity 0.5s;text-align:center;white-space:nowrap;zIndex:21;pointerEvents:none;opacity:0';
        newInfoEl.style.zIndex = '21';
      }
      if (newSong.cover) {
        const ni = document.createElement('img');
        ni.src = fileUrl(newSong.cover);
        ni.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        newCoverEl.appendChild(ni);
      } else {
        const ai = aiCoverUrl(newSong);
        if (ai) { const ni2 = document.createElement('img'); ni2.src = ai; ni2.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'; newCoverEl.appendChild(ni2); }
        else newCoverEl.textContent = '♪';
      }
      newInfoEl.innerHTML = '<h2 style="font-size:26px;font-weight:800;color:var(--text)">' + esc(newSong.title) + '</h2><p style="font-size:15px;color:var(--text-secondary);margin-top:6px">' + esc(newSong.artist) + ' · ' + esc(newSong.album || '') + '</p>';
      inner.appendChild(newCoverEl);
      inner.appendChild(newInfoEl);
      if (centerMode) {
        setTimeout(() => {
          oldCoverClone.style.transform = 'translate(-50%,-50%) scale(1.16)';
          oldCoverClone.style.opacity = '0';
          oldInfoClone.style.opacity = '0';
          newInfoEl.style.opacity = '1';
        }, 50);
        setTimeout(() => {
          newCoverEl.style.opacity = '1';
          newCoverEl.style.transform = 'translate(-50%,-50%) scale(1)';
        }, 1200);
        setTimeout(() => {
          oldCoverClone.remove();
          oldInfoClone.remove();
          newCoverEl.remove();
          newInfoEl.remove();
          cover.style.transition = 'opacity 0.5s';
          cover.style.opacity = '1';
          info.style.transition = 'opacity 0.5s';
          info.style.opacity = '1';
          dj.transitioning = false;
        }, 4600);
      } else {
        setTimeout(() => {
          oldCoverClone.style.transform = 'translate(calc(-50% - 700px), -50%)';
          oldCoverClone.style.opacity = '0';
          oldInfoClone.style.transform = 'translate(calc(-50% - 700px), 175px)';
          oldInfoClone.style.opacity = '0';
        }, 2500);
        setTimeout(() => {
          oldCoverClone.remove();
          oldInfoClone.remove();
          newCoverEl.style.opacity = '1';
          newInfoEl.style.opacity = '1';
          newCoverEl.style.transform = 'translate(calc(-50% - 300px), -50%)';
          newInfoEl.style.transform = 'translate(calc(-50% - 300px), 175px)';
        }, 4500);
        setTimeout(() => {
          newCoverEl.remove();
          newInfoEl.remove();
          lyrics.style.transition = 'opacity 3s ease';
          lyrics.style.opacity = '1';
          cover.style.transition = 'opacity 0.5s';
          cover.style.opacity = '1';
          info.style.transition = 'opacity 0.5s';
          info.style.opacity = '1';
          dj.transitioning = false;
        }, 6500);
      }
      setTimeout(() => {
        cover.style.transition = '';
        cover.style.opacity = '';
        info.style.transition = '';
        info.style.opacity = '';
        lyrics.style.transition = '';
        lyrics.style.opacity = '';
      }, 10000);
    } catch (e) { console.error('[transition]', e); dj.transitioning = false; }
  }
  function swapMain() {
    const b = dj.bridge;
    if (!b || !b.song) { next(); return; }
    const newIdx = state.songs.findIndex((s) => s.id === b.song.id);
    if (newIdx < 0) { next(); return; }
    const oldSong = currentSong();
    const oldEl = audio;
    // HTMLAudio 双元素无缝交换（无 buffer、无变调、无硬切）
    audio = b.element;
    resetEq(audio);
    b.element = oldEl;
    b.song = null;
    b.built = false;
    b.started = false;
    b.crossfading = false;
    oldEl.pause();
    oldEl.src = '';
    state.current = newIdx;
    audio.volume = state.volume;
    try { audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; } catch (e) {}
    const fromRate = audio.playbackRate;
    // 变速回原速：缓慢恢复，不突然跳回
    clearInterval(dj._rateTimer);
    const rateStart = Date.now();
    const rateDur = 4000;
    dj._rateTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - rateStart) / rateDur);
      audio.playbackRate = fromRate + (1 - fromRate) * p;
      if (p >= 1) { clearInterval(dj._rateTimer); dj._rateTimer = null; }
    }, 60);
    const song = state.songs[newIdx];
    const pbx2 = $('pb-transition');
    if (pbx2) pbx2.hidden = true;
    playCoverTransition(oldSong, song);
    updateNowPlaying(song);
    setPlaying(!audio.paused);
    renderSongs();
    loadLyrics(song);
    if (state.dj) { prepareBridge(); }
  }

  function djTick() {
    if (!state.dj || !dj.bridge || !dj.bridge.built || dj.bridge.started) return;
    const d = audio.duration || 0;
    const t = audio.currentTime || 0;
    if (d > 0 && t >= Math.max(d * 0.6, d - 30)) startBridge(false);
  }

  function toggleDj() {
    state.dj = !state.dj;
    $('btn-dj').classList.toggle('active', state.dj);
    if (!state.dj) {
      djGen++;
      resetBridge();
      audio.playbackRate = 1;
      audio.volume = state.volume;
      $('dj-comment').hidden = true;
      dj.order = null;
      dj._played = new Set();
      const pbx3 = $('pb-transition');
      if (pbx3) pbx3.hidden = true;
      const stripOff = $('am-strip'); if (stripOff) stripOff.hidden = true;
      hideDjMarquee();
      toast('AI DJ 模式已关闭');
    } else {
      // 为最佳过渡，按 BPM 贪心重排当前列表
      const curId = state.current >= 0 ? state.songs[state.current].id : null;
      const base = visibleSongs();
      const withBpm = base.map((s) => ({ s, bpm: dj.bpmCache.get(s.id) || null }));
      if (withBpm.length > 1 && withBpm.some((x) => x.bpm)) {
        const startIdx = curId ? withBpm.findIndex((x) => x.s.id === curId) : 0;
        const used = new Set(); const order = []; let cur = startIdx >= 0 ? startIdx : 0;
        used.add(cur); order.push(withBpm[cur].s.id);
        while (order.length < withBpm.length) {
          let best = -1, bestDiff = Infinity;
          for (let i = 0; i < withBpm.length; i++) {
            if (used.has(i)) continue;
            const cb = withBpm[cur].bpm; const nb = withBpm[i].bpm;
            const diff = (cb && nb) ? Math.abs(nb - cb) : 999;
            // 优先 BPM 接近（≤5% 几乎不变调），再逐步放宽
            let score = diff;
            if (cb && nb) {
              const pct = diff / cb;
              if (pct <= 0.05) score = diff;
              else if (pct <= 0.10) score = diff + 50;
              else if (pct <= 0.20) score = diff + 200;
              else score = diff + 500;
            }
            if (score < bestDiff) { bestDiff = score; best = i; }
          }
          if (best < 0) break; used.add(best); order.push(withBpm[best].s.id); cur = best;
        }
        dj.order = order;
        dj._played = new Set();
        const stripOn = $('am-strip'); if (stripOn) stripOn.hidden = false;
        bindAmStrip();
        showDjMarquee();
        toast('DJ 过渡已开启：已按 BPM 优化播放顺序');
      } else {
        dj.order = null;
      dj._played = new Set();
        showDjMarquee();
        toast('DJ 过渡效果已开启：切歌时自动无缝衔接');
      }
      if (state.current >= 0) { prepareBridge(); }
    }
  }

  async function showDjComment(song) {
    if (!state.dj || !song) return;
    const el = $('dj-comment');
    el.textContent = '正在准备下一首…';
    el.hidden = false;
    let text = null;
    try { text = await api.getDjComment(song); } catch (e) {}
    if (!text) text = '接下来是《' + song.title + '》— ' + song.artist + '。一起享受音乐吧！';
    el.textContent = text;
    speakDj(text);
    clearTimeout(dj._commentTimer);
    dj._commentTimer = setTimeout(() => { el.hidden = true; }, 8000);
  }

  $('btn-dj').addEventListener('click', toggleDj);
  // 播放胶囊：添加到播放列表
  $('btn-add-playlist').addEventListener('click', (e) => {
    const song = currentSong();
    if (!song) { toast('请先选择一首歌曲'); return; }
    ctxPos = { x: e.clientX - 40, y: e.clientY - 120, song };
    buildPlaylistChooser();
    const m = $('ctx-menu');
    m.style.left = Math.max(8, Math.min(e.clientX - 120, window.innerWidth - 220)) + 'px';
    m.style.top = Math.max(8, e.clientY - 40) + 'px';
    m.hidden = false;
  });
  $('btn-ai').addEventListener('click', openSettings);
  const _aipickBtn = $('btn-ai-pick');
  if (_aipickBtn) _aipickBtn.addEventListener('click', () => { openAiPick(); });
  $('aipick-backdrop').addEventListener('click', closeAiPick);
  $('aipick-cancel').addEventListener('click', closeAiPick);
  $('aipick-send').addEventListener('click', () => { const v = $('aipick-input').value; $('aipick-input').value = ''; sendAiPick(v); });
  $('aipick-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const v = $('aipick-input').value; $('aipick-input').value = ''; sendAiPick(v); } });
  document.querySelectorAll('#aipick-suggest .aipick-chip').forEach((c) => c.addEventListener('click', () => { const q = c.getAttribute('data-q'); if (q) sendAiPick(q); }));
  document.querySelectorAll('#djchat-suggest .aipick-chip').forEach((c) => c.addEventListener('click', () => { const q = c.getAttribute('data-q'); if (q) sendDjChat(q); }));
  const _djChatBtn = $('btn-dj-chat');
  if (_djChatBtn) _djChatBtn.addEventListener('click', () => { openDjChat(); });
  $('djchat-backdrop').addEventListener('click', closeDjChat);
  $('djchat-cancel').addEventListener('click', closeDjChat);
  $('djchat-send').addEventListener('click', () => { const v = $('djchat-input').value; $('djchat-input').value = ''; sendDjChat(v); });
  $('djchat-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const v = $('djchat-input').value; $('djchat-input').value = ''; sendDjChat(v); } });
  $('doubao-test').addEventListener('click', doubaoTestVoice);
  $('dj-voice-test').addEventListener('click', () => {
    const v = $('dj-voice-select').value;
    edgeSpeak('你好，我是你的音乐电台主持人，欢迎收听 Echo 电台。', v, '+6%', '+0Hz');
    toast('正在用所选音色试听…');
  });

  /* ---------- 封面取色（液态玻璃动态背景） ---------- */
  function extractCoverColor(song) {
    if (!song || !song.cover) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          const s = 20;
          c.width = s; c.height = s;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, s, s);
          const d = ctx.getImageData(0, 0, s, s).data;
          let rr = 0, gg = 0, bb = 0, cnt = 0;
          for (let i = 0; i < d.length; i += 16) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; cnt++; }
          resolve({ r: Math.round(rr / cnt), g: Math.round(gg / cnt), b: Math.round(bb / cnt) });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = fileUrl(song.cover);
    });
  }
  async function applyTint(song) {
    const col = await extractCoverColor(song);
    if (col && document.documentElement) {
      document.documentElement.style.setProperty('--tint-r', col.r);
      document.documentElement.style.setProperty('--tint-g', col.g);
      document.documentElement.style.setProperty('--tint-b', col.b);
    }
  }

  /* ---------- Edge TTS（免费微软晓晓，无需任何配置） ---------- */
  async function edgeSpeak(text) {
    try {
      const b64 = await api.edgeTts(text, state.djVoice || 'zh-CN-XiaoxiaoNeural', '+6%', '+0Hz');
      if (!b64) return false;
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: 'audio/mpeg' }));
      const au = new Audio();
      const duck = () => { audio.volume = Math.max(0.25, state.volume * 0.45); };
      const restore = () => { audio.volume = state.volume; URL.revokeObjectURL(url); };
      au.src = url;
      au.addEventListener('play', duck);
      au.addEventListener('ended', restore);
      au.addEventListener('error', restore);
      await au.play();
      return true;
    } catch (e) { return false; }
  }
  // 系统语音兜底
  function legacySystemSpeak(text) {
    try {
      if (!window.speechSynthesis || !text) return false;
      const utter = new SpeechSynthesisUtterance(String(text));
      const v = pickVoice();
      if (v) utter.voice = v;
      utter.lang = v ? v.lang : 'zh-CN';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      const duck = () => { audio.volume = Math.max(0.25, state.volume * 0.45); };
      const restore = () => { audio.volume = state.volume; };
      utter.addEventListener('start', duck);
      utter.addEventListener('end', restore);
      utter.addEventListener('error', restore);
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 豆包语音（火山引擎大模型语音合成 v3 WebSocket） ---------- */
  let doubaoCfg = { appId: '', token: '' };
  function doubaoSpeak(text) {
    return new Promise((resolve) => {
      if (!doubaoCfg.appId || !doubaoCfg.token) { resolve(false); return; }
      let ws;
      try { ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/ws'); } catch (e) { resolve(false); return; }
      const audioChunks = [];
      const reqid = 'em-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      const body = JSON.stringify({
        app: { appid: doubaoCfg.appId, token: doubaoCfg.token, cluster: 'volcano_tts' },
        user: { uid: 'echomusic' },
        audio: { voice_type: 'BV700_streaming', encoding: 'mp3', speed_ratio: 1.0 },
        request: { reqid: reqid, text: String(text).slice(0, 280), operation: 'query' }
      });
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        if (ok && audioChunks.length) {
          const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const au = new Audio();
          const duck = () => { audio.volume = Math.max(0.25, state.volume * 0.45); };
          const restore = () => { audio.volume = state.volume; URL.revokeObjectURL(url); };
          au.src = url;
          au.addEventListener('play', duck);
          au.addEventListener('ended', restore);
          au.addEventListener('error', restore);
          au.play().then(() => resolve(true)).catch(() => { restore(); resolve(false); });
        } else {
          resolve(false);
        }
      };
      const timer = setTimeout(() => finish(false), 15000);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const header = new ArrayBuffer(20);
        const dv = new DataView(header);
        dv.setUint32(0, 20, false);
        dv.setUint32(4, 1, false);
        dv.setUint32(8, 0, false);
        dv.setUint32(12, 1, false);
        dv.setUint32(16, 0, false);
        const enc = new TextEncoder().encode(body);
        const msg = new Uint8Array(20 + enc.length);
        msg.set(new Uint8Array(header), 0);
        msg.set(enc, 20);
        ws.send(msg);
      };
      ws.onmessage = (ev) => {
        try {
          const buf = new Uint8Array(ev.data);
          if (buf.length < 20) return;
          const hs = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, false);
          if (buf.length < hs) return;
          const j = JSON.parse(new TextDecoder().decode(buf.slice(hs)));
          if (j.code !== 0) { finish(false); return; }
          if (j.audio && j.audio.data) {
            const bin = atob(j.audio.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            audioChunks.push(arr);
          }
          if (j.event === 'final' || j.event === 'error') finish(true);
        } catch (e) {}
      };
      ws.onerror = () => finish(false);
    });
  }
  // 用输入框当前值试听（未保存也能试）
  function doubaoTestVoice() {
    const appId = document.getElementById('doubao-appid').value.trim();
    const token = document.getElementById('doubao-token').value.trim();
    if (!appId || !token) { toast('请先填写豆包 App ID 和 Access Token'); return; }
    const old = doubaoCfg;
    doubaoCfg = { appId: appId, token: token };
    doubaoSpeak('你好，欢迎收听 Echo 音乐电台，我是你的 AI 主持人，接下来为你带来无缝混音。');
    doubaoCfg = old;
    toast('正在合成试听音频…');
  }

  /* ---------- DJ 真人语音主持（TTS） ---------- */
  let djVoice = null;
  function pickVoice() {
    try {
      if (djVoice) return djVoice;
      const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      djVoice = vs.find((v) => /zh[-_]/i.test(v.lang) && /huihui|yaoyao|kangkang|xiaoxiao|xiaoyi|yunxi|tingting/i.test(v.name))
        || vs.find((v) => /zh[-_]/i.test(v.lang))
        || null;
    } catch (e) { djVoice = null; }
    return djVoice;
  }
  // AI 语音播报已按用户要求关闭（保留文字评论，不再出声）
  function speakDj() { return false; }
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => { djVoice = null; pickVoice(); };
  }

  // Auto Mix 常驻条：预设绑定 + 策略标签
  function bindAmStrip() {
    const strip = $('am-strip');
    if (!strip || strip._bound) return;
    strip._bound = true;
    const setAm2 = (p) => { state.djPreset = p; strip.querySelectorAll('.am-preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === p)); };
    strip.querySelectorAll('.am-preset').forEach((b) => b.addEventListener('click', () => setAm2(b.dataset.preset)));
    setAm2(state.djPreset || 'auto');
  }
  function updateAmStrategyLabel() {
    const lb = $('am-strategy-label');
    if (lb) lb.textContent = (dj.lastStrategy || '—').toUpperCase();
  }
  /* ---------- 打碟效果 ---------- */
  async function ensureDecoded(song) {
    if (!song || !song.path) return null;
    if (dj.bufferCache.has(song.id)) return dj.bufferCache.get(song.id);
    try {
      const ab = await api.readFileBuffer(song.path);
      if (!ab) return null;
      const ctx = getAudioCtx();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      dj.bufferCache.set(song.id, buf);
      return buf;
    } catch (e) { return null; }
  }
  async function playEffect(type, quiet) {
    const song = currentSong();
    if (!song) { toast('请先播放一首歌'); return; }
    if (!state.dj) { toast('请先开启 DJ 模式'); return; }
    stopEffect();
    try {
      const ctx = getAudioCtx();
      const buf = await ensureDecoded(song);
      if (!buf) { toast('音频分析失败'); return; }
      const pos = Math.min(Math.max(0, audio.currentTime || 0), Math.max(0, buf.duration - 0.6));
      const bpm = dj.bpmCache.get(song.id) || dj.curBpm || 120;
      const beat = Math.max(0.25, 60 / bpm);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(ctx.destination);
      const mainVol = audio.volume;
      audio.volume = Math.max(0, Math.min(1, Math.min(mainVol, 0.18)));
      dj.effect = { src, gain, stopTimer: null, mainVol };
      if (type === 'loop') {
        const len = Math.min(Math.max(beat, beat * 2), Math.max(0.1, buf.duration - pos));
        src.loop = true;
        src.loopStart = pos;
        src.loopEnd = Math.min(buf.duration, pos + len);
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.12);
        src.start();
        dj.effect.stopTimer = setTimeout(stopEffect, 4000);
        if (!quiet) toast('Loop 循环 4 秒');
      } else if (type === 'beat') {
        const len = Math.min(beat, Math.max(0.1, buf.duration - pos));
        src.loop = true;
        src.loopStart = pos;
        src.loopEnd = Math.min(buf.duration, pos + len);
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 0.08);
        src.start();
        dj.effect.stopTimer = setTimeout(stopEffect, 2000);
        if (!quiet) toast('拍子重复 2 秒');
      } else if (type === 'scratch') {
        const len = Math.min(0.4, Math.max(0.05, buf.duration - pos));
        gain.gain.setValueAtTime(0.9, ctx.currentTime);
        src.start(0, pos, len * 3.2);
        src.playbackRate.setValueAtTime(1, ctx.currentTime);
        src.playbackRate.linearRampToValueAtTime(-1.4, ctx.currentTime + len);
        src.playbackRate.linearRampToValueAtTime(1.1, ctx.currentTime + len * 2);
        src.playbackRate.linearRampToValueAtTime(-1.2, ctx.currentTime + len * 2.6);
        src.playbackRate.linearRampToValueAtTime(1, ctx.currentTime + len * 3.2);
        dj.effect.stopTimer = setTimeout(stopEffect, 3000);
        if (!quiet) toast('搓碟效果');
      }
    } catch (e) {
      console.error('[djfx] error:', e.message);
      if (!quiet) toast('打碟效果失败');
    }
  }
  function stopEffect() {
    const fx = dj.effect;
    dj.effect = null;
    if (fx) {
      clearTimeout(fx.stopTimer);
      try { fx.src.stop(); } catch (e) {}
      try { fx.src.disconnect(); } catch (e) {}
      try { fx.gain.disconnect(); } catch (e) {}
      if (typeof fx.mainVol === 'number') audio.volume = Math.max(0, Math.min(1, fx.mainVol));
    }
  }

  /* ---------- 媒体快捷键 / 本地快捷键 ---------- */
  function seekBy(sec) {
    if (!audio.src || !audio.duration) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + sec));
  }
  function changeVolume(delta) {
    state.volume = Math.min(1, Math.max(0, state.volume + delta));
    audio.volume = state.volume;
    if (dj.bridge && !dj.bridge.started) dj.bridge.element.volume = state.volume;
    $('volume-fill').style.width = (state.volume * 100) + '%';
    $('volume-thumb').style.left = (state.volume * 100) + '%';
  }
  api.onMediaKey && api.onMediaKey((ch) => {
    if (ch === 'media:playpause') togglePlay();
    else if (ch === 'media:next') next();
    else if (ch === 'media:prev') prev();
  });
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') seekBy(5);
    else if (e.key === 'ArrowLeft') seekBy(-5);
    else if (e.key === 'ArrowUp') { e.preventDefault(); changeVolume(0.05); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); changeVolume(-0.05); }
    else if (e.key === 'n' || e.key === 'N') next();
    else if (e.key === 'p' || e.key === 'P') prev();
    else if (e.key === 'Escape') $('fullscreen').hidden = true;
  });

  /* ---------- 睡眠定时器 ---------- */
  const sleep = { endAt: 0, timer: null, fading: false };
  function sleepRemaining() {
    return sleep.endAt ? Math.max(0, sleep.endAt - Date.now()) : 0;
  }
  function sleepFadeOut() {
    if (sleep.fading) return;
    sleep.fading = true;
    const start = state.volume;
    const steps = 20;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, start * (1 - i / steps)));
      if (i >= steps) {
        clearInterval(iv);
        sleep.fading = false;
        audio.pause();
        toast('睡眠时间到，已停止播放');
      }
    }, 100);
  }
  function setSleep(min) {
    clearInterval(sleep.timer);
    sleep.timer = null;
    sleep.endAt = 0;
    $('btn-sleep').classList.remove('active');
    if (min > 0) {
      sleep.endAt = Date.now() + min * 60000;
      $('btn-sleep').classList.add('active');
      $('sleep-pop').hidden = true;
      toast('睡眠定时器已设置：' + min + ' 分钟后停止');
      sleep.timer = setInterval(() => {
        if (sleepRemaining() <= 0) {
          clearInterval(sleep.timer);
          sleep.timer = null;
          sleep.endAt = 0;
          $('btn-sleep').classList.remove('active');
          sleepFadeOut();
        }
      }, 1000);
    } else {
      $('sleep-pop').hidden = true;
      toast('睡眠定时器已关闭');
    }
  }
  $('btn-sleep').addEventListener('click', (e) => {
    e.stopPropagation();
    $('sleep-pop').hidden = !$('sleep-pop').hidden;
  });
  document.querySelectorAll('.sleep-opt').forEach((btn) => {
    btn.addEventListener('click', () => setSleep(parseInt(btn.dataset.min, 10)));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sleep-pop') && !e.target.closest('#btn-sleep')) $('sleep-pop').hidden = true;
  });

  /* ---------- 播放列表 ---------- */
  const playlists = { list: [] };
  let ctxPos = { x: 0, y: 0, song: null };

  async function reloadPlaylists() {
    try {
      playlists.list = await api.listPlaylists();
      renderPlaylistNav();
    } catch (e) { toast('播放列表读取失败'); }
  }

  function renderPlaylistNav() {
    const nav = $('playlist-nav');
    nav.innerHTML = '';
    playlists.list.forEach((pl) => {
      const btn = document.createElement('button');
      btn.className = 'nav-item nav-playlist' + (state.activePlaylist === pl.id ? ' active' : '');
      btn.innerHTML = '<span class="pl-color" style="--c:#ff9500"></span><span class="t">' + esc(pl.name) + '</span><span class="pl-count">' + pl.count + '</span>';
      btn.addEventListener('click', () => openPlaylist(pl.id));
      nav.appendChild(btn);
    });
  }

  function openPlaylist(id) {
    state.activePlaylist = id;
    state.favOnly = false;
    const pl = playlists.list.find((p) => p.id === id);
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    renderPlaylistNav();
    $('topbar-title').textContent = pl ? pl.name : '播放列表';
    $('page-title').textContent = pl ? pl.name : '播放列表';
    renderSongs();
  }

  function showCtxMenu(x, y, song) {
    ctxPos = { x, y, song };
    buildCtxMenu();
  }
  function buildCtxMenu() {
    const m = $('ctx-menu');
    const { x, y, song } = ctxPos;
    if (!song) return;
    m.innerHTML = '';
    const del = document.createElement('button');
    del.className = 'ctx-item ctx-danger';
    del.textContent = '从资料库删除';
    del.addEventListener('click', async () => {
      m.hidden = true;
      const ok = await api.removeSong(song.id);
      if (!ok) { toast('删除失败'); return; }
      toast('已从资料库删除《' + song.title + '》');
      if (currentSong() && currentSong().id === song.id) {
        audio.pause();
        audio.src = '';
        state.current = -1;
        setPlaying(false);
      }
      await reloadLibrary();
      renderMain();
    });
    m.appendChild(del);
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    m.appendChild(sep);
    const add = document.createElement('button');
    add.className = 'ctx-item';
    add.textContent = '添加到播放列表…';
    add.addEventListener('click', () => buildPlaylistChooser());
    m.appendChild(add);
    if (state.activePlaylist) {
      const rm = document.createElement('button');
      rm.className = 'ctx-item';
      rm.textContent = '从当前播放列表移除';
      rm.addEventListener('click', async () => {
        m.hidden = true;
        await api.removeFromPlaylist(state.activePlaylist, song.id);
        toast('已从播放列表移除');
        reloadPlaylists();
        renderSongs();
      });
      m.appendChild(rm);
    }
    m.style.left = Math.min(x, window.innerWidth - 210) + 'px';
    m.style.top = Math.min(y, window.innerHeight - 170) + 'px';
    m.hidden = false;
  }
  function buildPlaylistChooser() {
    const m = $('ctx-menu');
    m.innerHTML = '';
    const { song } = ctxPos;
    if (!playlists.list.length) {
      const it = document.createElement('button');
      it.className = 'ctx-item';
      it.textContent = '（还没有播放列表，请先新建）';
      m.appendChild(it);
      return;
    }
    playlists.list.forEach((pl) => {
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.textContent = '♪ ' + pl.name;
      b.addEventListener('click', async () => {
        m.hidden = true;
        await api.addToPlaylist(pl.id, song.id);
        toast('已添加到《' + pl.name + '》');        reloadPlaylists();
      });
      m.appendChild(b);
    });
    const back = document.createElement('button');
    back.className = 'ctx-item';
    back.textContent = '← 返回';
    back.addEventListener('click', () => buildCtxMenu());
    m.appendChild(back);
  }

  function closePlaylistModal() { $('playlist-modal').hidden = true; }
  function fillPlaylistPicker() {
    const box = $('playlist-song-picker');
    if (!box) return;
    box.innerHTML = '';
    state.songs.forEach((s) => {
      const label = document.createElement('label');
      label.className = 'pl-pick-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s.id;
      cb.className = 'pl-pick-cb';
      cb.addEventListener('change', updatePickCount);
      label.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = s.title + ' — ' + s.artist;
      label.appendChild(span);
      box.appendChild(label);
    });
    updatePickCount();
  }
  function updatePickCount() {
    const el = $('pl-pick-count');
    if (!el) return;
    el.textContent = document.querySelectorAll('#playlist-song-picker .pl-pick-cb:checked').length;
  }
  function selectedPickIds() {
    return Array.from(document.querySelectorAll('#playlist-song-picker .pl-pick-cb:checked')).map((c) => c.value);
  }
  $('new-playlist-btn').addEventListener('click', () => {
    $('playlist-modal').hidden = false;
    $('playlist-name-input').value = '';
    fillPlaylistPicker();
    setTimeout(() => $('playlist-name-input').focus(), 60);
  });
  const plAll = document.getElementById('pl-pick-all');
  if (plAll) plAll.addEventListener('click', () => {
    document.querySelectorAll('#playlist-song-picker .pl-pick-cb').forEach((c) => { c.checked = true; });
    updatePickCount();
  });
  const plNone = document.getElementById('pl-pick-none');
  if (plNone) plNone.addEventListener('click', () => {
    document.querySelectorAll('#playlist-song-picker .pl-pick-cb').forEach((c) => { c.checked = false; });
    updatePickCount();
  });
  $('playlist-backdrop').addEventListener('click', closePlaylistModal);
  $('playlist-cancel').addEventListener('click', closePlaylistModal);
  $('playlist-ok').addEventListener('click', async () => {
    const name = $('playlist-name-input').value.trim();
    if (!name) { toast('请输入播放列表名称'); return; }
    const pl = await api.createPlaylist(name);
    if (pl) {
      const ids = selectedPickIds();
      for (const id of ids) {
        try { await api.addToPlaylist(pl.id, id); } catch (e) {}
      }
      toast(ids.length ? ('已创建并添加 ' + ids.length + ' 首歌曲') : '播放列表已创建');
    }
    closePlaylistModal();
    await reloadPlaylists();
    if (pl) openPlaylist(pl.id);
  });
  $('playlist-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('playlist-ok').click();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctx-menu')) $('ctx-menu').hidden = true;
    if (!e.target.closest('#queue-panel') && !e.target.closest('#btn-queue')) {
      const qp = $('queue-panel');
      if (qp && !qp.hidden) { qp.hidden = true; const bq = $('btn-queue'); if (bq) bq.classList.remove('active'); }
    }
  });

  /* ---------- 测试钩子 ---------- */
  window.__test = {
    sleepTest: async () => {
      setSleep(0.02);
      const t0 = Date.now();
      while (Date.now() - t0 < 10000 && !audio.paused) await new Promise((rr) => setTimeout(rr, 300));
      return { active: sleep.endAt > 0, remaining: Math.round(sleepRemaining()), paused: audio.paused, elapsedMs: Date.now() - t0 };
    },
    analyze: async (song) => analyzeBpm(song),
    djToggle: () => { toggleDj(); return state.dj; },
    forceTransition: async () => {
      if (!dj.bridge || !dj.bridge.built) return { ok: false, reason: 'no bridge' };
      if (audio.duration > 0) audio.currentTime = Math.max(0, audio.duration - 4.5);
      await startBridge(false);
      await new Promise((rr) => setTimeout(rr, 3000));
      const b = dj.bridge;
      return {
        ok: true,
        bridgeStarted: !!(b && b.started),
        mainPaused: audio.paused,
        mainRate: audio.playbackRate,
        bridgeRate: b ? b.element.playbackRate : null,
        bridgePlaying: b ? !b.element.paused : null,
        align: dj.lastAlign
      };
    },
    voiceTest: () => {
      const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      const zh = vs.filter((v) => /zh[-_]/i.test(v.lang));
      const pv = pickVoice();
      return { total: vs.length, zh: zh.length, zhName: zh.length ? zh[0].name : null, picked: pv ? pv.name : null };
    },
    scrollTest: () => {
      document.querySelector('[data-filter="artists"]').click();
      const sa = document.querySelector('.scroll-area');
      sa.scrollTop = 400;
      return { scrollable: sa.scrollHeight > sa.clientHeight, moved: sa.scrollTop > 0 };
    },
    viewTest: async () => {
      document.querySelector('[data-filter="albums"]').click();
      await new Promise((rr) => setTimeout(rr, 400));
      const albumCards = document.querySelectorAll('.grid-card').length;
      const backVisible = !document.getElementById('view-back').hidden;
      document.querySelector('[data-filter="songs"]').click();
      document.querySelectorAll('#genre-chips .chip').forEach((c) => { if (c.textContent === '华语') c.click(); });
      await new Promise((rr) => setTimeout(rr, 400));
      const cjkRows = document.querySelectorAll('.song-row').length;
      document.querySelectorAll('#genre-chips .chip').forEach((c) => { if (c.textContent === '全部') c.click(); });
      await new Promise((rr) => setTimeout(rr, 200));
      const allRows = document.querySelectorAll('.song-row').length;
      return { albumCards, backVisible, cjkRows, allRows };
    },
    effectTest: async (type) => {
      await playEffect(type || 'loop');
      await new Promise((rr) => setTimeout(rr, 1200));
      return { active: !!dj.effect, mainVol: Math.round(audio.volume * 100) / 100 };
    },
    albumPlayTest: async () => {
      const byAlbum = {};
      state.songs.forEach((s) => { const a = (s.album || '未知专辑').trim(); (byAlbum[a] = byAlbum[a] || []).push(s); });
      const an = Object.keys(byAlbum).find((a) => byAlbum[a].length >= 3);
      if (!an) return { found: false };
      state.viewMode = 'songs';
      state.albumFilter = an;
      renderMain();
      const btn = document.getElementById('btn-play-album');
      const btnVisible = !!(btn && !btn.hidden);
      btn.click();
      await new Promise((rr) => setTimeout(rr, 600));
      const order = state.albumPlayIds ? state.albumPlayIds.slice() : null;
      const cur = currentSong();
      const inAlbum = state.songs.filter((s) => (s.album || '未知专辑').trim() === an);
      const ok = !!(order && order.length === inAlbum.length && cur && order[0] === cur.id && inAlbum.length >= 3);
      state.albumPlayIds = null;
      state.albumFilter = null;
      renderMain();
      return { album: an, count: order ? order.length : 0, btnVisible, firstIsCurrent: ok };
    },
    queueTest: async () => {
      const btn = document.getElementById('btn-queue');
      const panel = document.getElementById('queue-panel');
      if (!btn || !panel) return { btnExists: !!btn, panelExists: !!panel };
      btn.click();
      await new Promise((rr) => setTimeout(rr, 250));
      const rows = document.querySelectorAll('.queue-row').length;
      const visible = !panel.hidden;
      const firstTitle = (document.querySelector('.queue-row .q-title') || {}).textContent || null;
      btn.click();
      await new Promise((rr) => setTimeout(rr, 100));
      const closed = panel.hidden;
      return { btnExists: true, rows, visible, closed, firstTitle };
    },
    albumOrderTest: async () => {
      const byAlbum = {};
      state.songs.forEach((s) => { const a = (s.album || '未知专辑').trim(); (byAlbum[a] = byAlbum[a] || []).push(s); });
      const an = Object.keys(byAlbum).find((a) => byAlbum[a].length >= 3);
      if (!an) return { found: false };
      const tOf = (s) => (s.track != null ? parseInt(String(s.track), 10) : NaN);
      const fb = (s) => { const base = String(s.path || '').split(String.fromCharCode(92)).pop() || ''; const m = /^[ 	]*([0-9]{1,3})/.exec(base); return m ? parseInt(m[1], 10) : 9999; };
      const key = (s) => { const t = tOf(s); return (!isNaN(t) && t > 0) ? t : fb(s); };
      state.viewMode = 'songs';
      state.albumFilter = an;
      renderMain();
      await new Promise((rr) => setTimeout(rr, 250));
      const idsShown = [...document.querySelectorAll('.song-row')].map((r) => r.dataset.id);
      const shown = idsShown.map((id) => state.songs.find((x) => x.id === id)).filter(Boolean);
      const expected = shown.slice().sort((x, y) => key(x) - key(y));
      state.albumFilter = null;
      renderMain();
      const hasTrack = shown.some((s) => s.track != null);
      return { album: an, count: shown.length, sortedOk: shown.every((s, i) => s.id === expected[i].id), hasTrack };
    },
    promo: {
      ready: () => state.songs.length > 0,
      metaReady: () => dj.bpmCache.size >= Math.min(15, state.songs.length),
      gotoLibrary: () => { document.querySelector('[data-filter="songs"]').click(); state.albumFilter = null; state.artistFilter = null; state.viewMode = 'songs'; renderMain(); },
      gotoAlbums: () => { state.viewMode = 'albums'; state.albumFilter = null; renderMain(); },
      openAlbum: (name) => { state.viewMode = 'songs'; state.albumFilter = name; renderMain(); },
      albumNames: () => [...new Set(state.songs.map((s) => (s.album || '未知专辑').trim()))].slice(0, 20),
      playMyWay: () => { const s = state.songs.find((x) => String(x.title || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'myway') || state.songs[0]; if (s) playById(s.id); return s ? s.title : null; },
      seek: (t) => { if (audio.duration > 0) audio.currentTime = t; },
      pause: () => { audio.pause(); },
      openFullscreen: () => { $('fullscreen').hidden = false; },
      closeFullscreen: () => { $('fullscreen').hidden = true; },
      setCenter: () => { if (state.fsLayout !== 'center') { state.fsLayout = 'center'; applyFsLayout(false); } },
      setSide: () => { if (state.fsLayout !== 'side') { state.fsLayout = 'side'; applyFsLayout(false); } },
      openQueue: () => { toggleQueue(); },
      closeQueue: () => { const p = $('queue-panel'); if (p) p.hidden = true; },
      djOn: () => { if (!state.dj) toggleDj(); },
      ensureTranslation: () => { const tg = $('translation-toggle'); if (tg && !tg.checked) { tg.checked = true; } },
      lyricInfo: () => ({ lines: document.querySelectorAll('#fs-lyrics .lrc-line').length, trans: document.querySelectorAll('#fs-lyrics .lrc-trans').length }),
      scrollLyrics: (delta) => { const el = $('fs-lyrics'); if (el) el.scrollTop += delta; },
      playVisualTransition: () => {
        const cur = currentSong();
        if (!cur) return false;
        const nxt = state.songs.find((s) => s.id !== cur.id) || state.songs[0];
        $('fullscreen').hidden = false;
        playCoverTransition(cur, nxt);
        return true;
      }
    },
    layoutTest: async () => {
      const fs = document.getElementById('fullscreen');
      const btn = document.getElementById('fs-layout-btn');
      const inner = document.querySelector('.fs-inner');
      if (!btn || !inner) return { btnExists: !!btn, innerExists: !!inner };
      const prevLayout = state.fsLayout;
      fs.hidden = false;
      btn.click();
      await new Promise((rr) => setTimeout(rr, 300));
      const toCenter = inner.classList.contains('fs-center') && state.fsLayout === 'center';
      btn.click();
      await new Promise((rr) => setTimeout(rr, 300));
      const backSide = !inner.classList.contains('fs-center') && state.fsLayout === 'side';
      fs.hidden = true;
      return { btnExists: true, toCenter, backSide };
    },
    djState: () => ({
      on: state.dj,
      bridgeBuilt: !!(dj.bridge && dj.bridge.built),
      bridgeSong: dj.bridge && dj.bridge.song ? dj.bridge.song.title : null,
      mainTitle: currentSong() ? currentSong().title : null
    })
  };

  /* ---------- 鼠标跟随背景光效 ---------- */
  // 鼠标光效：平滑尾随（lerp 插值，光效缓缓跟手，不跳变不卡顿）
  const _bgTarget = { x: 50, y: 0 };
  const _bgCur = { x: 50, y: 0 };
  let _bgLerpRaf = 0;
  document.addEventListener('mousemove', (e) => {
    _bgTarget.x = (e.clientX / window.innerWidth) * 100;
    _bgTarget.y = (e.clientY / window.innerHeight) * 100;
    if (_bgLerpRaf) return;
    _bgLerpRaf = requestAnimationFrame(function tick() {
      _bgCur.x += (_bgTarget.x - _bgCur.x) * 0.07;
      _bgCur.y += (_bgTarget.y - _bgCur.y) * 0.07;
      const root = document.documentElement;
      root.style.setProperty('--mx', _bgCur.x.toFixed(2) + '%');
      root.style.setProperty('--my', _bgCur.y.toFixed(2) + '%');
      if (Math.abs(_bgTarget.x - _bgCur.x) < 0.08 && Math.abs(_bgTarget.y - _bgCur.y) < 0.08) {
        cancelAnimationFrame(_bgLerpRaf); _bgLerpRaf = 0;
      } else {
        _bgLerpRaf = requestAnimationFrame(tick);
      }
    });
  }, { passive: true });

  /* ---------- 启动 ---------- */
  // 启动页兜底：无论加载是否完成，6 秒后强制隐藏（绝不卡黑屏）
  setTimeout(() => { const spf = $('splash'); if (spf) { spf.classList.add('hide'); setTimeout(() => spf.remove(), 600); } }, 6000);

  // 启动页进度：圆圈随加载进度转满，然后淡出进入主页
  const CIRC = 2 * Math.PI * 52;
  const splashProg = $('splash-progress');
  const splashSub = $('splash-sub');
  function setSplashPct(p) {
    if (splashProg) splashProg.style.strokeDashoffset = (CIRC * (1 - Math.min(1, Math.max(0, p)))).toFixed(1);
    if (splashSub && p >= 1) splashSub.textContent = '启动完成';
  }
  (async function init() {
    try {
      const t0 = Date.now();
      setSplashPct(0.08);
      const st = await api.getSettings();
      setSplashPct(0.25);
      state.hasKey = !!(st && st.hasKey);
      state.hasDjKey = !!(st && st.hasDjKey);
      doubaoCfg.appId = (st && st.doubaoAppId) || '';
      doubaoCfg.token = (st && st.doubaoTtoken) || '';
      state.djVoice = (st && st.djVoice) || 'zh-CN-XiaoxiaoNeural';
      await reloadLibrary();
      // 曲库为空时自动扫描（修复首次启动/数据损坏导致的空库）
      if (!state.songs.length) {
        setSplashPct(0.4);
        await runScan();
        await reloadLibrary();
      }
      setSplashPct(0.65);
      await reloadPlaylists();
      if (state.viewMode === 'daily') { renderMain(); }
      setSplashPct(0.9);
      const remain = Math.max(0, 1600 - (Date.now() - t0));
      if (remain > 0) await new Promise((r) => setTimeout(r, remain));
      setSplashPct(1);
      await new Promise((r) => setTimeout(r, 350));
      await showRecPage(); // 先显示推荐首页（splash 仍盖着，避免露出旧界面）
      const sp = $('splash');
      if (sp) sp.classList.add('hide');
      setTimeout(() => { if (sp) sp.remove(); }, 600);
    } catch (e) {
      console.error('init error', e);
      showEmpty();
      const sp = $('splash');
      if (sp) { sp.classList.add('hide'); setTimeout(() => sp.remove(), 600); }
    }
    console.log('Echo Music 播放器已启动');
  })();
})();
