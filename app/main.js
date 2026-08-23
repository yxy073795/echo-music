const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const isScreenshot = process.argv.includes('--screenshot');
const isTestScan = process.argv.includes('--testscan');
const isPromo = process.argv.includes('--promo');
const isQuickPick = process.argv.includes('--quickpick');
const isUiTest = process.argv.includes('--uitest');

// 开发模式下把用户数据目录放到项目内（沙箱/便携式运行），打包后自动使用系统目录
if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '.user-data'));
}

const DATA_DIR = () => app.getPath('userData');
const LIBRARY_FILE = () => path.join(DATA_DIR(), 'library.json');
const COVERS_DIR = () => path.join(DATA_DIR(), 'covers');
const SETTINGS_FILE = () => path.join(DATA_DIR(), 'settings.json');
const LYRICS_DIR = () => path.join(DATA_DIR(), 'lyrics');
const BPM_FILE = () => path.join(DATA_DIR(), 'bpm.json');
const STATS_FILE = () => path.join(DATA_DIR(), 'stats.json');

/* ================= 曲库持久化 ================= */
function defaultLibrary() {
  return { songs: [], favorites: [], roots: [], playlists: [] };
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE())) {
      const lib = JSON.parse(fs.readFileSync(LIBRARY_FILE(), 'utf8'));
      if (lib && Array.isArray(lib.songs)) return Object.assign(defaultLibrary(), lib);
    }
  } catch (e) { console.error('[library] load error:', e.message); }
  return defaultLibrary();
}

function saveLibrary(lib) {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(LIBRARY_FILE(), JSON.stringify(lib, null, 2));
  } catch (e) { console.error('[library] save error:', e.message); }
}

function defaultStats() { return { plays: {}, seconds: {}, daily: {} }; }
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE())) {
      const s = JSON.parse(fs.readFileSync(STATS_FILE(), 'utf8'));
      if (s && typeof s === 'object') return Object.assign(defaultStats(), s);
    }
  } catch (e) {}
  return defaultStats();
}
function saveStats(stats) {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(STATS_FILE(), JSON.stringify(stats, null, 2));
  } catch (e) {}
}

/* ================= 音频扫描（MP3 / FLAC / ALAC / M4A / WAV / OGG / APE 等） ================= */
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.alac', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.ape', '.wma', '.aiff', '.aif', '.mp4']);
const SKIP_DIRS = new Set([
  'windows', 'program files', 'program files (x86)', 'appdata', 'node_modules',
  '$recycle.bin', 'system volume information', 'recovery', 'perflogs',
  'msocache', 'intel', 'amd', 'nvidia', 'python', 'python27', 'python36', 'python37',
  '.npm-cache', '.electron-cache', '.user-data', '.git', 'dsh', 'deepseekharness',
  'system', 'library', 'applications', 'private', 'usr', 'bin', 'sbin', 'cores'
]);

function isSkippable(name) {
  const n = name.toLowerCase();
  return SKIP_DIRS.has(n) || n.startsWith('$') || n.startsWith('.');
}

async function collectAudio(root, depth, maxDepth, onFound) {
  let found = [];
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return found; }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (depth < maxDepth && !isSkippable(ent.name)) {
        const sub = await collectAudio(full, depth + 1, maxDepth, onFound);
        found = found.concat(sub);
      }
    } else if (ent.isFile() && AUDIO_EXTS.has(path.extname(ent.name).toLowerCase())) {
      found.push(full);
      if (found.length % 25 === 0) onFound && onFound(found.length);
    }
  }
  return found;
}

async function saveCover(filePath, picture) {
  try {
    const hash = crypto.createHash('md5').update(filePath).digest('hex');
    const ext = (picture.format || '').toLowerCase().includes('png') ? 'png' : 'jpg';
    const dest = path.join(COVERS_DIR(), hash + '.' + ext);
    fs.mkdirSync(COVERS_DIR(), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, Buffer.from(picture.data));
    return dest;
  } catch (e) { return null; }
}

async function readSongMeta(filePath) {
  const info = {
    path: filePath,
    title: path.basename(filePath, path.extname(filePath)),
    artist: '未知歌手',
    album: '未知专辑',
    genre: '',
    track: null,
    duration: 0,
    cover: null
  };
  try {
    const { parseFile } = await import('music-metadata');
    const meta = await parseFile(filePath, { duration: true });
    const c = meta.common || {};
    if (c.title) info.title = c.title;
    if (c.artist) info.artist = c.artist;
    else if (Array.isArray(c.artists) && c.artists.length) info.artist = c.artists.join(', ');
    if (c.album) info.album = c.album;
    if (c.track && typeof c.track === 'object' && c.track.no) info.track = c.track.no;
    else if (typeof c.track === 'number' && c.track > 0) info.track = c.track;
    if (Array.isArray(c.genre) && c.genre.length) info.genre = String(c.genre[0]);
    else if (typeof c.genre === 'string' && c.genre) info.genre = c.genre;
    if (meta.format && meta.format.duration) info.duration = Math.round(meta.format.duration);
    if (c.picture && c.picture.length) info.cover = await saveCover(filePath, c.picture[0]);
  } catch (e) { /* 标签读取失败则用文件名兜底 */ }
  return info;
}

function sendProgress(win, message, count) {
  if (win && !win.isDestroyed()) win.webContents.send('library:progress', { message, count });
}

async function detectRoots(savedRoots, fast) {
  const roots = new Set(Array.isArray(savedRoots) ? savedRoots : []);
  const home = os.homedir();
  const names = ['Music', '音乐', 'Downloads', '下载', 'Desktop', '桌面', 'Documents', '文档', 'Videos', '视频', 'Pictures', '图片'];
  for (const n of names) {
    try { const p = path.join(home, n); if (fs.existsSync(p)) roots.add(p); } catch {}
  }
  if (!fast) {
    if (process.platform === 'darwin') {
      // macOS：补充 ~/Music 下的常见子目录与音乐盘（/Volumes 下可读卷）
      const macDirs = ['Music', '音乐', 'Downloads', '下载', 'Desktop', '桌面', 'Documents', '文档'];
      for (const n of macDirs) {
        try { const p = path.join(home, n); if (fs.existsSync(p)) roots.add(p); } catch {}
      }
      try {
        const vols = fs.readdirSync('/Volumes');
        for (const v of vols) {
          if (v.startsWith('.') || v === 'Macintosh HD') continue;
          const vp = path.join('/Volumes', v);
          try { if (fs.statSync(vp).isDirectory()) roots.add(vp); } catch {}
        }
      } catch {}
    } else {
      // Windows：固定盘很少时，补充扫描盘符根目录
      const driveHits = [];
      for (let letter = 67; letter <= 90; letter++) {
        const d = String.fromCharCode(letter) + ':/';
        try { if (fs.statSync(d).isDirectory()) driveHits.push(d); } catch {}
      }
      if (driveHits.length <= 3) driveHits.forEach((d) => roots.add(d));
    }
  }
  return [...roots];
}

async function scanLibrary(win, opts) {
  opts = opts || {};
  const lib = loadLibrary();
  sendProgress(win, '正在查找音乐文件…', 0);
  const roots = await detectRoots(lib.roots, !!opts.fast);
  lib.roots = roots;
  const files = [];
  for (const root of roots) {
    const list = await collectAudio(root, 0, opts.maxDepth || 9, () => {
      sendProgress(win, '正在查找音乐文件… 已找到 ' + files.length + ' 首', files.length);
    });
    files.push(...list);
  }
  const seen = new Set(lib.songs.map((s) => s.path));
  let added = 0, skipped = 0, enriched = 0;
  for (const f of files) {
    if (seen.has(f)) {
      // 存量歌曲缺 genre 时补全（一次性迁移）
      const old = lib.songs.find((s) => s.path === f);
      if (old && (!old.genre || old.track == null)) {
        const meta = await readSongMeta(f);
        if (!old.genre) old.genre = meta.genre || '';
        if (old.track == null) old.track = meta.track || null;
        if (meta.cover && !old.cover) old.cover = meta.cover;
        enriched++;
      }
      skipped++;
      continue;
    }
    seen.add(f);
    const song = await readSongMeta(f);
    song.id = crypto.createHash('md5').update(f).digest('hex').slice(0, 16);
    lib.songs.push(song);
    added++;
    if (added === 1 || lib.songs.length % 10 === 0) {
      sendProgress(win, '正在读取歌曲信息… ' + lib.songs.length + ' 首', lib.songs.length);
    }
    if (opts.cap && added >= opts.cap) break;
  }
  lib.songs.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  saveLibrary(lib);
  sendProgress(win, '扫描完成，共 ' + lib.songs.length + ' 首歌曲（新增 ' + added + '，补全 ' + enriched + '）', lib.songs.length);
  return lib;
}

/* ================= 设置 ================= */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE())) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
      if (s && typeof s === 'object') return Object.assign({ apiKey: '', model: 'deepseek-chat', translationEnabled: true, djApiKey: '' }, s);
    }
  } catch (e) { console.error('[settings] load error:', e.message); }
  return { apiKey: '', model: 'deepseek-chat', translationEnabled: true, djApiKey: '' };
}

function saveSettings(s) {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2));
  } catch (e) { console.error('[settings] save error:', e.message); }
}

/* ================= 歌词（LRCLIB + DeepSeek） ================= */
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

async function fetchLrcLib(track, artist, album, duration) {
  const params = new URLSearchParams({
    track_name: track || '', artist_name: artist || '',
    album_name: album || '', duration: String(Math.round(duration) || 0)
  });
  const res = await fetch('https://lrclib.net/api/get?' + params.toString(), {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'EchoMusic/0.1 (local music player)' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('LRCLIB HTTP ' + res.status);
  return await res.json();
}

async function searchLrcLib(track, artist) {
  const params = new URLSearchParams({ track_name: track || '', artist_name: artist || '' });
  const res = await fetch('https://lrclib.net/api/search?' + params.toString(), {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'EchoMusic/0.1 (local music player)' }
  });
  if (!res.ok) return null;
  const list = await res.json();
  return Array.isArray(list) && list.length ? list[0] : null;
}

async function deepseekChat(messages, apiKey, model, maxTokens) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model: model || 'deepseek-chat', messages, temperature: 0.3, max_tokens: maxTokens || 4000 })
  });
  if (!res.ok) throw new Error('DeepSeek HTTP ' + res.status);
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
}

async function translateLyrics(song, lyrics, settings) {
  const sourceText = ((lyrics && (lyrics.synced || lyrics.plain)) || '').slice(0, 6000);
  if (!sourceText.trim()) return null;
  return await deepseekChat([
    { role: 'system', content: '你是专业歌词翻译。把下面的歌词逐行翻译成简体中文，保留原有的 [mm:ss.xx] 时间戳格式（没有时间戳的按行一一对应）。只输出翻译结果，不要任何解释。' },
    { role: 'user', content: sourceText }
  ], settings.apiKey, settings.model, 4000);
}

async function generateLyricsDeepSeek(song, settings) {
  return await deepseekChat([
    { role: 'system', content: '你是歌词专家。请输出歌曲《' + song.title + '》的完整歌词，使用 LRC 时间戳格式 [mm:ss.xx]，每行一句。如果无法确认原词，尽力根据你掌握的信息还原；如果完全不了解这首歌，请只回复"无法获取歌词"。只输出歌词，不要解释。' },
    { role: 'user', content: '歌曲：' + song.title + ' - ' + song.artist }
  ], settings.apiKey, settings.model, 3000);
}

async function getLyricsFor(song) {
  const id = song.id;
  const cacheFile = path.join(LYRICS_DIR(), id + '.json');
  const settings = loadSettings();
  let cached = null;
  try {
    if (fs.existsSync(cacheFile)) cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch (e) { /* 缓存损坏则忽略 */ }
  if (cached && cached.lyrics) {
    // 缓存命中：若已配置 Key 且还没有翻译，则补翻译（修复"填了 Key 还是没翻译"）
    const needTrans = !!(settings.apiKey && settings.translationEnabled !== false && !cached.translated);
    if (!needTrans) return cached;
    try {
      const tr = await translateLyrics(song, cached.lyrics, settings);
      if (tr) {
        cached.translated = tr;
        cached.trStatus = 'ok';
        cached.time = Date.now();
        try { fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2)); } catch (e) {}
      } else {
        cached.trStatus = 'error';
      }
    } catch (e) {
      console.error('[lyrics] translate cached error:', e.message);
      cached.trStatus = 'error';
    }
    return cached;
  }
  let lyrics = null, source = null;
  try {
    let lrc = await fetchLrcLib(song.title, song.artist, song.album, song.duration);
    if (!lrc || (!lrc.syncedLyrics && !lrc.plainLyrics)) {
      lrc = await searchLrcLib(song.title, song.artist);
    }
    if (lrc && (lrc.syncedLyrics || lrc.plainLyrics)) {
      lyrics = { synced: lrc.syncedLyrics || null, plain: lrc.plainLyrics || null };
      source = 'lrclib';
    }
  } catch (e) { console.error('[lyrics] lrclib error:', e.message); }

  let translated = null;
  let trStatus = settings.apiKey ? (settings.translationEnabled === false ? 'disabled' : 'no-key') : 'no-key';
  if (settings.apiKey && settings.translationEnabled !== false) {
    try {
      translated = await translateLyrics(song, lyrics, settings);
      trStatus = translated ? 'ok' : 'error';
    } catch (e) {
      console.error('[lyrics] translate error:', e.message);
      trStatus = 'error';
    }
  }

  if (!lyrics && settings.apiKey) {
    try {
      const gen = await generateLyricsDeepSeek(song, settings);
      if (gen && gen.indexOf('无法获取') === -1) {
        lyrics = { synced: null, plain: gen };
        source = 'ai';
      }
    } catch (e) { console.error('[lyrics] ai fallback error:', e.message); }
  }

  const result = { id, title: song.title, artist: song.artist, lyrics, translated, trStatus, source, time: Date.now() };
  try {
    fs.mkdirSync(LYRICS_DIR(), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  } catch (e) { /* 缓存写失败不影响使用 */ }
  return result;
}

/* ================= BPM 缓存 & DJ 串词 ================= */
function loadBpmCache() {
  try {
    if (fs.existsSync(BPM_FILE())) return JSON.parse(fs.readFileSync(BPM_FILE(), 'utf8')) || {};
  } catch (e) {}
  return {};
}

function saveBpmCache(cache) {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(BPM_FILE(), JSON.stringify(cache, null, 2));
  } catch (e) {}
}

async function generateDjComment(song, settings) {
  const key = (settings.djApiKey || '').trim() || settings.apiKey;
  if (!settings || !key) return null;
  try {
    return await deepseekChat([
      { role: 'system', content: '你是一位风格热情的中文电台 DJ。根据歌曲信息写一两句自然、有感染力的串场介绍词，像音乐电台主播一样，不要出现"AI"字样，一句话即可。' },
      { role: 'user', content: '接下来播放：' + song.title + ' - ' + song.artist + (song.album ? '（专辑《' + song.album + '》）' : '') }
    ], key, settings.model, 200);
  } catch (e) {
    console.error('[dj] comment error:', e.message);
    return null;
  }
}

async function generateDjPlan(cur, next, settings) {
  const key = (settings.djApiKey || '').trim() || settings.apiKey;
  if (!settings || !key) return null;
  try {
    const curInfo = '旧歌：《' + cur.title + '》' + cur.artist +
      '，BPM=' + (cur.bpm || '?') + '，时长=' + Math.round(cur.duration || 0) + '秒' +
      '，前奏结束=' + (cur.introEnd || '?') + '秒，尾奏开始=' + (cur.outroStart || '?') + '秒' +
      '，尾奏平淡=' + (cur.tailQuiet ? '是' : '否') + '，建议切入=' + (cur.entryPoint || '?') + '秒';
    const nextInfo = '新歌：《' + next.title + '》' + next.artist +
      '，BPM=' + (next.bpm || '?') + '，时长=' + Math.round(next.duration || 0) + '秒' +
      '，前奏结束=' + (next.introEnd || '?') + '秒，能量切入段起点=' + (next.entryPoint || '?') + '秒';
    const text = await deepseekChat([
      { role: 'system', content: '你是专业 DJ 混音师，为两首歌设计无缝过渡。根据给出的歌曲实时分析数据，输出一个 JSON 对象（纯 JSON，不要 markdown 代码块），字段：{ alignPrefer: 新歌从第几秒切入（秒，若新歌前奏长则建议跳过前奏进入能量段，0 表示用默认）, mixLead: 旧歌结束前多少秒开始混音（4~12，尾奏平淡则偏小）, mixRamp: 新歌升到目标音量所需秒数（0.8~3）, mixHold: 两首歌节拍重合持续秒数（1.5~6，两歌越兼容越长）, cutDur: 旧歌被裁掉所需秒数（0.15~0.6，DJ 式快切用 0.25 左右）, newVol: 新歌混音期目标音量（0.4~0.9，新歌响度更高则偏小）, eqSpeed: 新歌低频放开速度系数（0.5~1.5，新歌鼓点密集用 0.8 左右防糊） }。只输出 JSON。' },
      { role: 'user', content: curInfo + '。' + nextInfo + '。请设计这一对歌的最佳无缝过渡方案。' }
    ], key, settings.model, 500);
    if (!text) return null;
    const cleaned = String(text).replace(/```json/g, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const plan = JSON.parse(m[0]);
    return {
      alignPrefer: Number(plan.alignPrefer) || 0,
      mixLead: Math.max(4, Math.min(12, Number(plan.mixLead) || 8)),
      mixRamp: Math.max(0.8, Math.min(3, Number(plan.mixRamp) || 1.4)),
      mixHold: Math.max(1.5, Math.min(6, Number(plan.mixHold) || 3.2)),
      cutDur: Math.max(0.15, Math.min(0.6, Number(plan.cutDur) || 0.3)),
      newVol: Math.max(0.4, Math.min(0.9, Number(plan.newVol) || 0.7)),
      eqSpeed: Math.max(0.5, Math.min(1.5, Number(plan.eqSpeed) || 1))
    };
    console.log('[dj-ai] plan for ' + cur.title + ' -> ' + next.title + ': ' + JSON.stringify(plan));
  } catch (e) {
    console.error('[dj] plan error:', e.message);
    return null;
  }
}
/* ================= Edge TTS（免费微软神经网络语音） ================= */
const WebSocket = require('ws');
const EDGE_WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_GEC_VERSION = '1-143.0.3650.75';
const EDGE_WIN_EPOCH = 11644473600;

function edgeSecMsGec() {
  let ticks = Date.now() / 1000;
  ticks += EDGE_WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const s = Math.floor(ticks).toString() + '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  return crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
}
function edgeJsDate() {
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + pad(d.getUTCDate()) + ' ' + d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' GMT+0000 (Coordinated Universal Time)';
}
function edgeTts(text, voice, rate, pitch) {
  return new Promise((resolve) => {
    try {
      const url = EDGE_WSS + '&ConnectionId=' + crypto.randomUUID().replace(/-/g, '') + '&Sec-MS-GEC=' + edgeSecMsGec() + '&Sec-MS-GEC-Version=' + EDGE_GEC_VERSION;
      const ws = new WebSocket(url, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
          'Cookie': 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';'
        }
      });
      const chunks = [];
      let idle = null;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(idle);
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve(ok ? Buffer.concat(chunks).toString('base64') : null);
      };
      const timer = setTimeout(() => finish(false), 25000);
      ws.on('open', () => {
        const ts = edgeJsDate();
        const config = 'X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
          JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } });
        ws.send(config);
        const safeText = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').slice(0, 500);
        const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='" + (voice || 'zh-CN-XiaoxiaoNeural') + "'><prosody pitch='" + (pitch || '+0Hz') + "' rate='" + (rate || '+6%') + "' volume='+0%'>" + safeText + '</prosody></voice></speak>'; 
        const header = 'X-RequestId:' + crypto.randomUUID().replace(/-/g, '') + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts + 'Z\r\nPath:ssml\r\n\r\n';
        ws.send(header + ssml);
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(data);
          clearTimeout(idle);
          idle = setTimeout(() => finish(true), 1800);
          return;
        }
        const str = data.toString();
        const idx = str.indexOf('{');
        if (idx >= 0) {
          try { const j = JSON.parse(str.slice(idx)); if (j.type === 'turn.end') finish(true); } catch (e) {}
        }
      });
      ws.on('error', () => finish(false));
      ws.on('close', () => { if (chunks.length && !done) finish(true); });
    } catch (e) { resolve(null); }
  });
}

/* ================= 窗口 ================= */
function pickTestSong(songs) {
  if (!Array.isArray(songs) || !songs.length) return null;
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const myWay = songs.find((s) => s && norm(s.title) === 'myway');
  const ume = songs.find((s) => s && (norm(s.title).includes('ume') || norm(s.title).includes('ume')));
  if (myWay) return myWay;
  if (ume) return ume;
  const brat = songs.find((s) => s && s.album && /brat/i.test(String(s.album)));
  return brat || songs[0];
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: isPromo ? 1920 : wa.width,
    height: isPromo ? 1080 : wa.height,
    x: 0, y: 0,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0e',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!isPromo) win.maximize(); // 确保最大化状态（窗口本就是全屏尺寸，无跳变）
    win.show();
  });

  win.webContents.on('console-message', (_e, _l, message) => console.log('[renderer]', message));

  if (isScreenshot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (isTestScan) {
            console.log('[testscan] scanning...');
            const scanLib = await Promise.race([
              scanLibrary(win, { fast: true, maxDepth: 7, cap: 250 }),
              new Promise((rr) => setTimeout(() => rr(null), 30000))
            ]);
            console.log('[testscan] scan done, songs=' + (scanLib ? scanLib.songs.length : 'TIMEOUT'));
            if (!scanLib) throw new Error('scan timeout');
            try {
              const first = pickTestSong(scanLib.songs);
              if (first) {
                console.log('[testscan] lyrics for ' + first.title);
                const lyr = await Promise.race([
                  getLyricsFor(first),
                  new Promise((rr) => setTimeout(() => rr(null), 30000))
                ]);
                console.log('[testscan] lyrics got source=' + (lyr ? lyr.source : 'TIMEOUT'));
                const safeLyr = lyr || { source: 'timeout', lyrics: null, translated: null };
                fs.writeFileSync(path.join(__dirname, 'lyrics-test.json'), JSON.stringify({
                  id: first.id, title: first.title, artist: first.artist,
                  source: safeLyr.source,
                  syncedHead: (safeLyr.lyrics && safeLyr.lyrics.synced || '').slice(0, 400),
                  translatedHead: (safeLyr.translated || '').slice(0, 400)
                }, null, 2));
                console.log('[lyrics-test] saved for ' + first.title + ' source=' + safeLyr.source);
                // 已知歌曲强制验证（晴天 - 周杰伦）
                try {
                  const known = await Promise.race([
                    getLyricsFor({ id: 'test-qt', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 }),
                    new Promise((rr) => setTimeout(() => rr(null), 25000))
                  ]);
                  if (!known) throw new Error('known lyrics timeout');
                  fs.writeFileSync(path.join(__dirname, 'lyrics-known.json'), JSON.stringify({
                    title: known.title, source: known.source,
                    syncedHead: (known.lyrics && known.lyrics.synced || '').slice(0, 300),
                    translated: known.translated ? '有翻译' : '无（未配置 API Key）'
                  }, null, 2));
                  console.log('[lyrics-test] known song source=' + known.source);
                } catch (e2) {
                  console.error('[lyrics-test] known failed:', e2.message);
                }
              }
            } catch (e) {
              console.error('[lyrics-test] failed:', e.message);
            }
            win.webContents.send('library:scanned');
            await new Promise((r) => setTimeout(r, 1500));
          }
          const image = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, 'screenshot.png'), image.toPNG());

          // 像素统计
          const bmp = image.toBitmap();
          const size = image.getSize();
          const total = size.width * size.height;
          let red = 0, light = 0, dark = 0;
          for (let i = 0; i < bmp.length; i += 4) {
            const b = bmp[i], g = bmp[i + 1], rr = bmp[i + 2], a = bmp[i + 3];
            if (a < 128) continue;
            if (rr > 180 && g < 120 && b < 120) red++;
            const avg = (rr + g + b) / 3;
            if (avg > 190) light++;
            if (avg < 45) dark++;
          }
          const stats = {
            size,
            redPct: +(red / total * 100).toFixed(2),
            lightPct: +(light / total * 100).toFixed(2),
            darkPct: +(dark / total * 100).toFixed(2)
          };
          fs.writeFileSync(path.join(__dirname, 'screenshot-stats.json'), JSON.stringify(stats, null, 2));

          // DOM 结构验证
          const dom = await win.webContents.executeJavaScript(`(() => {
            const firstRow = document.querySelector('.song-row .t');
            return {
              rows: document.querySelectorAll('.song-row').length,
              covers: document.querySelectorAll('.song-row img.cover').length,
              fallbacks: document.querySelectorAll('.song-row .cover-fallback').length,
              firstRowTitle: firstRow ? firstRow.textContent : null,
              pageTitle: document.getElementById('page-title').textContent,
              emptyVisible: !document.getElementById('empty-state').hidden,
              playerBarH: document.querySelector('.player-bar').offsetHeight,
              sidebarW: document.querySelector('.sidebar').offsetWidth,
              scanStatus: document.getElementById('scan-status').textContent
            };
          })()`);
          fs.writeFileSync(path.join(__dirname, 'dom-stats.json'), JSON.stringify(dom, null, 2));

          console.log('[screenshot] done stats=' + JSON.stringify(stats) + ' dom=' + JSON.stringify(dom));

          // 播放测试：自动点击第一首歌，2.5 秒后检查播放状态
          try {
            await win.webContents.executeJavaScript(`(() => {
              const row = document.querySelector('.song-row');
              if (row) row.click();
              return !!row;
            })()`);
            await new Promise((rr) => setTimeout(rr, 2500));
            const playtest = await win.webContents.executeJavaScript(`(() => ({
              pbTitle: document.getElementById('pb-title').textContent,
              timeCurrent: document.getElementById('time-current').textContent,
              playBtn: document.getElementById('btn-play').textContent,
              toast: document.getElementById('toast').textContent || '',
              toastHidden: document.getElementById('toast').hidden,
              fsLyricLines: document.querySelectorAll('#fs-lyrics .lrc-line').length,
              fsLyricFirst: (document.querySelector('#fs-lyrics .lrc-orig') || {}).textContent || null
            }))()`);
            fs.writeFileSync(path.join(__dirname, 'playtest.json'), JSON.stringify(playtest, null, 2));
            console.log('[playtest] ' + JSON.stringify(playtest));
          } catch (e) {
            console.error('[playtest] failed:', e.message);
          }
          // DJ 测试：BPM 分析 + DJ 开关
          try {
            const djTest = await win.webContents.executeJavaScript(`(async () => {
              const lib = await window.api.loadLibrary();
              const nm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const s = (lib.songs.find((x) => x && nm(x.title) === 'myway')) || lib.songs[0];
              if (!s) return { error: 'no songs' };
              const bpm = await window.__test.analyze(s);
              // 切到歌曲列表并播放第一首（测试默认在每日推荐页）
              document.querySelector('[data-filter=\"songs\"]').click();
              await new Promise((rr) => setTimeout(rr, 400));
              const row = document.querySelector('.song-row');
              if (row) row.click();
              await new Promise((rr) => setTimeout(rr, 1200));
              const djOn = window.__test.djToggle();
              await new Promise((rr) => setTimeout(rr, 10000));
              const st = window.__test.djState();
              const tr = await window.__test.forceTransition();
              const st2 = await window.__test.sleepTest();
              const fx = await window.__test.effectTest('loop');
              const fx2 = await window.__test.effectTest('scratch');
              const vt = await window.__test.viewTest();
              const tts = window.__test.voiceTest();
              const et = await window.api.edgeTts('你好，这是语音测试。', 'zh-CN-XiaoxiaoNeural');
              const sc = window.__test.scrollTest();
              const lt = await window.__test.layoutTest();
              const qt = await window.__test.queueTest();
              const ao = await window.__test.albumOrderTest();
              const apt = await window.__test.albumPlayTest();
              return { title: s.title, artist: s.artist, bpm, djOn, bridgeBuilt: st.bridgeBuilt, bridgeSong: st.bridgeSong, transition: tr, sleep: st2, effectLoop: fx, effectScratch: fx2, views: vt, tts, scroll: sc, layout: lt, queue: qt, albumOrder: ao, albumPlay: apt, edgeOk: !!(et && et.length > 100) };
            })()`);
            fs.writeFileSync(path.join(__dirname, 'dj-test.json'), JSON.stringify(djTest, null, 2));
            console.log('[dj-test] ' + JSON.stringify(djTest));
          } catch (e) {
            console.error('[dj-test] failed:', e.message);
          }
          // 播放列表测试
          try {
            const plTest = await win.webContents.executeJavaScript(`(async () => {
              const created = await window.api.createPlaylist('测试歌单');
              const lib = await window.api.loadLibrary();
              const nm2 = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const s = (lib.songs.find((x) => x && nm2(x.title) === 'myway')) || (lib.songs.find((x) => x && nm2(x.title) === 'ume')) || lib.songs[0];
              if (created && s) {
                await window.api.addToPlaylist(created.id, s.id);
              }
              const list = await window.api.listPlaylists();
              const found = list.find((p) => p.id === created.id);
              return { created: !!created, added: !!(found && found.count > 0), count: found ? found.count : 0, name: created ? created.name : null };
            })()`);
            fs.writeFileSync(path.join(__dirname, 'playlists-test.json'), JSON.stringify(plTest, null, 2));
            console.log('[playlists-test] ' + JSON.stringify(plTest));
          } catch (e) {
            console.error('[playlists-test] failed:', e.message);
          }
          // AI 挑歌测试（真实调用 DeepSeek）
          try {
            const aipickTest = await win.webContents.executeJavaScript(`(async () => {
              const lib = await window.api.loadLibrary();
              const songs = lib.songs.slice(0, 60).map((s) => ({ title: s.title, artist: s.artist, album: s.album, bpm: null, key: null }));
              const res = await window.api.djPick('来点适合深夜听的安静英文歌', songs);
              return { ok: !!(res && res.picks && res.picks.length), count: res ? res.picks.length : 0, text: res ? res.text : null, first: res && res.picks[0] ? (res.picks[0].title + ' - ' + res.picks[0].artist) : null, uiBtn: !!document.getElementById('btn-ai-pick'), modal: !!document.getElementById('aipick-modal'), marquee: !!document.getElementById('dj-marquee') };
            })()`);
            fs.writeFileSync(path.join(__dirname, 'aipick-test.json'), JSON.stringify(aipickTest, null, 2));
            console.log('[aipick-test] ' + JSON.stringify(aipickTest));
          } catch (e) {
            console.error('[aipick-test] failed:', e.message);
          }
        } catch (err) {
          console.error('[screenshot] failed:', err.message);
        } finally {
          app.quit();
        }
      }, 3000);
    });
  }

  if (isPromo) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const promoDir = path.join(__dirname, 'promo');
        fs.mkdirSync(promoDir, { recursive: true });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const js = (c) => win.webContents.executeJavaScript(c);
        const shot = async (name) => {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(promoDir, name), img.toPNG());
        };
        try {
          console.log('[promo] start');
          // 等待曲库与 BPM/调性分析完成（标签可见）
          for (let i = 0; i < 60; i++) { const ok = await js('window.__test && window.__test.promo && window.__test.promo.ready()'); if (ok) break; await sleep(500); }
          for (let i = 0; i < 150; i++) { const ok = await js('window.__test.promo.metaReady()'); if (ok) break; await sleep(500); }
          console.log('[promo] library ready');
          // S0.5 沉浸式每日推荐首页（等待推荐页显示后截图）
          for (let i = 0; i < 30; i++) { const ok = await js("!document.getElementById('rec-page').hidden"); if (ok) break; await sleep(300); }
          await sleep(1200);
          await shot('recpage.png');
          // S1 资料库列表（本地扫描）
          await js('window.__test.promo.gotoLibrary()');
          await sleep(1500);
          await shot('s1_library.png');
          // S2 专辑网格
          await js('window.__test.promo.gotoAlbums()');
          await sleep(1500);
          await shot('s2_albums.png');
          // S3 专辑详情（曲目顺序）
          const albums = await js('window.__test.promo.albumNames()');
          const chosen = (albums && albums.find((a) => /BRAT|Harry|Sour|Olivia/i.test(String(a)))) || (albums && albums[0]);
          if (chosen) {
            await js('window.__test.promo.openAlbum(' + JSON.stringify(chosen) + ')');
            await sleep(1400);
            await shot('s3_album.png');
          }
          // S4 歌词翻译（全屏 + 慢滚动）
          await js('window.__test.promo.ensureTranslation()');
          await js('window.__test.promo.playMyWay()');
          await sleep(1200);
          await js('window.__test.promo.openFullscreen()');
          await js('window.__test.promo.seek(50)');
          await sleep(1800);
          const lyr = await js('window.__test.promo.lyricInfo()');
          console.log('[promo] lyrics lines=' + lyr.lines + ' trans=' + lyr.trans);
          await shot('s4_lyrics.png');
          await js('window.__test.promo.pause()');
          for (let f = 0; f < 30; f++) { await js('window.__test.promo.scrollLyrics(7)'); await shot('s4m_' + String(f).padStart(3, '0') + '.png'); await sleep(60); }
          // S5 AI DJ：标签 + 视觉过渡动画
          await js('window.__test.promo.closeFullscreen()');
          await js('window.__test.promo.gotoLibrary()');
          await sleep(900);
          await shot('s5_tags.png');
          await js('window.__test.promo.playMyWay()');
          await sleep(600);
          await js('window.__test.promo.djOn()');
          await sleep(1000);
          const started = await js('window.__test.promo.playVisualTransition()');
          console.log('[promo] transition started=' + started);
          for (let f = 0; f < 88; f++) { await shot('s5m_' + String(f).padStart(3, '0') + '.png'); await sleep(72); }
          // S5b：居中布局的过渡动画（封面居中放大溶解，更聚焦精致）——重拍用
          await js('window.__test.promo.setCenter()');
          await sleep(600);
          const started2 = await js('window.__test.promo.playVisualTransition()');
          console.log('[promo] center transition started=' + started2);
          for (let f = 0; f < 88; f++) { await shot('s5c_' + String(f).padStart(3, '0') + '.png'); await sleep(72); }
          // S6 播放队列
          await js('window.__test.promo.openQueue()');
          await sleep(600);
          await shot('s6_queue.png');
          await js('window.__test.promo.closeQueue()');
          // S7 布局切换（左右 → 居中）
          await js('window.__test.promo.openFullscreen()');
          await js('window.__test.promo.setSide()');
          await sleep(800);
          await js('window.__test.promo.setCenter()');
          for (let f = 0; f < 22; f++) { await shot('s7m_' + String(f).padStart(3, '0') + '.png'); await sleep(62); }
          await shot('s7_center.png');
          await js('window.__test.promo.closeFullscreen()');
          console.log('[promo] capture done');
        } catch (e) {
          console.error('[promo] failed:', e.message);
        } finally {
          app.quit();
        }
      }, 1500);
    });
  }

  return win;
}

/* ================= IPC ================= */
ipcMain.handle('library:load', (event) => {
  const lib = loadLibrary();
  // 后台补全曲目号（一次性迁移：为缺 track 的老歌重读标签，不阻塞返回）
  if (lib.songs.some((s) => s.track == null)) {
    setTimeout(async () => {
      try {
        const l2 = loadLibrary();
        let changed = false;
        for (const s of l2.songs) {
          if (s.track != null) continue;
          try {
            const meta = await readSongMeta(s.path);
            if (meta.track != null) { s.track = meta.track; changed = true; }
          } catch (e) {}
          await new Promise((r) => setTimeout(r, 40));
        }
        if (changed) {
          saveLibrary(l2);
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win && !win.isDestroyed()) win.webContents.send('library:scanned');
        }
      } catch (e) {}
    }, 2500);
  }
  return lib;
});
ipcMain.handle('library:scan', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await scanLibrary(win, { fast: false });
});
ipcMain.handle('library:addFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, { title: '选择音乐文件夹', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const lib = loadLibrary();
  if (!lib.roots.includes(res.filePaths[0])) lib.roots.push(res.filePaths[0]);
  saveLibrary(lib);
  return res.filePaths[0];
});
ipcMain.handle('settings:get', () => {
  const s = loadSettings();
  return { hasKey: !!(s.apiKey && s.apiKey.trim()), model: s.model, translationEnabled: !!s.translationEnabled, hasDoubao: !!(s.doubaoAppId && s.doubaoTtoken), djVoice: s.djVoice || 'zh-CN-XiaoxiaoNeural', hasDjKey: !!(s.djApiKey && s.djApiKey.trim()), djApiKey: s.djApiKey || '' };
});
ipcMain.handle('settings:set', (event, patch) => {
  const s = loadSettings();
  if (patch && typeof patch.apiKey === 'string' && patch.apiKey.trim()) s.apiKey = patch.apiKey.trim();
  if (patch && typeof patch.model === 'string' && patch.model.trim()) s.model = patch.model.trim();
  if (patch && typeof patch.translationEnabled === 'boolean') s.translationEnabled = patch.translationEnabled;
  if (patch && typeof patch.doubaoAppId === 'string') s.doubaoAppId = patch.doubaoAppId.trim();
  if (patch && typeof patch.doubaoTtoken === 'string') s.doubaoTtoken = patch.doubaoTtoken.trim();
  if (patch && typeof patch.djVoice === 'string' && patch.djVoice) s.djVoice = patch.djVoice;
  if (patch && typeof patch.djApiKey === 'string') s.djApiKey = patch.djApiKey.trim();
  saveSettings(s);
  return { ok: true };
});
ipcMain.handle('file:readBuffer', (event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (e) { return null; }
});
ipcMain.handle('bpm:get', (event, id) => {
  const c = loadBpmCache();
  return c[id] || null;
});
ipcMain.handle('bpm:save', (event, id, bpm) => {
  if (!id || !bpm) return false;
  const c = loadBpmCache();
  c[id] = Math.round(bpm);
  saveBpmCache(c);
  return true;
});
ipcMain.handle('tts:edge', async (event, text, voice, rate, pitch) => {
  if (!text) return null;
  try { return await edgeTts(text, voice, rate, pitch); } catch (e) { return null; }
});
ipcMain.handle('dj:plan', async (event, cur, next) => {
  if (!cur || !next) return null;
  return await generateDjPlan(cur, next, loadSettings());
});

ipcMain.handle('dj:comment', async (event, song) => {
  if (!song || !song.title) return null;
  return await generateDjComment(song, loadSettings());
});
async function generateDjPick(text, songs, settings) {
  const key = (settings.djApiKey || '').trim() || settings.apiKey;
  if (!key || !text || !songs || !songs.length) return null;
  try {
    const lib = songs.slice(0, 250).map((s) => {
      const bpm = s.bpm ? ' BPM=' + s.bpm : '';
      const key2 = s.key ? ' 调=' + s.key : '';
      const album = s.album ? '《' + s.album + '》' : '';
      return '《' + s.title + '》-' + s.artist + album + bpm + key2;
    }).join('\n');
    const out = await deepseekChat([
      { role: 'system', content: '你是专业的 AI DJ 选歌师，用户会描述想要的听歌感觉（心情/场合/风格/速度），你要从他提供的本地曲库中挑选歌曲组成一个能进行智能无缝混音的歌单。选歌原则：1）风格情绪贴合用户描述；2）BPM 尽量接近或呈平滑渐变（无缝混音需要节拍相近）；3）调性尽量兼容；4）只从给出的曲库中选择，绝对不要编造曲库外的歌曲；5）数量 8~15 首；6）按混音顺序排列。只输出一个 JSON 对象（不要 markdown 代码块），格式：{"text":"给用户的简短中文推荐说明（50字内）","picks":[{"title":"歌名","artist":"歌手","why":"简短中文理由（20字内）"}]}' },
      { role: 'user', content: '用户要求：' + String(text).slice(0, 200) + '\n\n本地曲库（标题-歌手-专辑 BPM 调性）：\n' + lib }
    ], key, settings.model, 2500);
    if (!out) return null;
    const cleaned = String(out).replace(/```json/g, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    return { text: data.text || '', picks: Array.isArray(data.picks) ? data.picks.slice(0, 20) : [] };
  } catch (e) {
    console.error('[dj-pick] error:', e.message);
    return null;
  }
}

/* AI DJ 实时对话：用户反馈混音问题，AI 返回调整参数（混音逻辑实时修正） */
async function generateDjChat(text, context, settings) {
  const key = (settings.djApiKey || '').trim() || settings.apiKey;
  if (!key || !text) return null;
  try {
    const now = context || {};
    const curSong = now.cur ? '当前正在播：' + now.cur.title + ' - ' + now.cur.artist + '（BPM=' + (now.cur.bpm || '?') + '，前奏结束=' + (now.cur.introEnd || '?') + 's，尾奏开始=' + (now.cur.outroStart || '?') + 's' + (now.cur.tailQuiet ? '，尾奏平淡' : '') + '）' : '当前未在播放';
    const nextSong = now.next ? '下一首：' + now.next.title + ' - ' + now.next.artist + '（BPM=' + (now.next.bpm || '?') + '，能量切入段=' + (now.next.entryPoint || '?') + 's）' : '无下一首';
    const planInfo = now.plan ? '当前混音方案：切入=' + (now.plan.alignNext || 0) + 's，提前量=' + (now.plan.mixLead || 7) + 's，升音量=' + (now.plan.mixRamp || 1.4) + 's，重合=' + (now.plan.mixHold || 3.2) + 's，裁切=' + (now.plan.cutDur || 0.3) + 's，新歌音量=' + (now.plan.newVol || 0.7) + '，EQ=' + (now.plan.eqSpeed || 1) : '无当前方案';
    const out = await deepseekChat([
      { role: 'system', content: '你是专业的 AI DJ 混音工程师，直接嵌入音乐播放器里。用户正在听歌，混音/切歌/节拍/音量出现问题时，他会直接跟你说。你要：1）用简短中文回应（50字内）；2）根据问题调整混音参数，输出 JSON 对象（纯 JSON 不要 markdown）：{"text":"给用户的简短中文回应","adjust":{"mixLead":数值或省略（旧歌结束前多少秒开始混音，4~12，用户嫌拖沓就调小，嫌仓促就调大）,"mixRamp":数值或省略（新歌升到目标音量秒数，0.8~3）,"mixHold":数值或省略（两歌节拍重合秒数，1.5~6，嫌重合太长调小）,"cutDur":数值或省略（旧歌裁切秒数，0.15~0.6，嫌切太慢调小）,"newVol":数值或省略（新歌混音期音量，0.4~0.9，嫌新歌太小声调大）,"eqSpeed":数值或省略（低频放开速度，0.5~1.5）,"alignPrefer":数值或省略（新歌从第几秒切入，跳过前奏）}}。只能调整这些参数，不要输出别的。' },
      { role: 'user', content: curSong + '\n' + nextSong + '\n' + planInfo + '\n\n用户反馈：' + String(text).slice(0, 300) }
    ], key, settings.model, 800);
    if (!out) return null;
    const cleaned = String(out).replace(/```json/g, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    const adj = data.adjust || {};
    const plan = {};
    if (typeof adj.mixLead === 'number') plan.mixLead = Math.max(4, Math.min(12, adj.mixLead));
    if (typeof adj.mixRamp === 'number') plan.mixRamp = Math.max(0.8, Math.min(3, adj.mixRamp));
    if (typeof adj.mixHold === 'number') plan.mixHold = Math.max(1.5, Math.min(6, adj.mixHold));
    if (typeof adj.cutDur === 'number') plan.cutDur = Math.max(0.15, Math.min(0.6, adj.cutDur));
    if (typeof adj.newVol === 'number') plan.newVol = Math.max(0.4, Math.min(0.9, adj.newVol));
    if (typeof adj.eqSpeed === 'number') plan.eqSpeed = Math.max(0.5, Math.min(1.5, adj.eqSpeed));
    if (typeof adj.alignPrefer === 'number') plan.alignNext = Math.max(0, Math.min(60, adj.alignPrefer));
    return { text: data.text || '已调整', adjust: plan };
  } catch (e) {
    console.error('[dj-chat] error:', e.message);
    return null;
  }
}
ipcMain.handle('dj:chat', async (event, text, context) => {
  return await generateDjChat(text, context, loadSettings());
});
ipcMain.handle('dj:pick', async (event, text, songs) => {
  return await generateDjPick(text, songs, loadSettings());
});
ipcMain.handle('lyrics:get', (event, song) => {
  if (!song || !song.id || !song.title) return { lyrics: null, translated: null, source: null };
  return getLyricsFor(song);
});
ipcMain.handle('playlist:list', () => {
  const lib = loadLibrary();
  return (lib.playlists || []).map((p) => ({ id: p.id, name: p.name, count: p.songIds.length }));
});
ipcMain.handle('playlist:create', (event, name) => {
  if (!name || !String(name).trim()) return null;
  const lib = loadLibrary();
  if (!lib.playlists) lib.playlists = [];
  const pl = { id: crypto.createHash('md5').update(String(name) + Date.now()).digest('hex').slice(0, 8), name: String(name).trim(), songIds: [] };
  lib.playlists.push(pl);
  saveLibrary(lib);
  return pl;
});
ipcMain.handle('playlist:add', (event, playlistId, songId) => {
  const lib = loadLibrary();
  const pl = (lib.playlists || []).find((p) => p.id === playlistId);
  if (!pl || !songId) return false;
  if (!pl.songIds.includes(songId)) pl.songIds.push(songId);
  saveLibrary(lib);
  return true;
});
ipcMain.handle('playlist:remove', (event, playlistId, songId) => {
  const lib = loadLibrary();
  const pl = (lib.playlists || []).find((p) => p.id === playlistId);
  if (!pl) return false;
  pl.songIds = pl.songIds.filter((id) => id !== songId);
  saveLibrary(lib);
  return true;
});
ipcMain.handle('stats:record', (event, songId, seconds, play) => {
  if (!songId) return;
  const stats = loadStats();
  const today = new Date().toISOString().slice(0, 10);
  stats.plays[songId] = (stats.plays[songId] || 0) + (play ? 1 : 0);
  stats.seconds[songId] = (stats.seconds[songId] || 0) + Math.round(seconds || 0);
  stats.daily[today] = (stats.daily[today] || 0) + Math.round(seconds || 0);
  saveStats(stats);
});
ipcMain.handle('stats:get', () => loadStats());
ipcMain.handle('song:remove', (event, id) => {
  if (!id) return false;
  const lib = loadLibrary();
  const before = lib.songs.length;
  lib.songs = lib.songs.filter((s) => s.id !== id);
  if (lib.favorites) lib.favorites = lib.favorites.filter((f) => f !== id);
  if (lib.playlists) lib.playlists.forEach((p) => { p.songIds = p.songIds.filter((s) => s !== id); });
  if (lib.songs.length === before) return false;
  saveLibrary(lib);
  return true;
});

ipcMain.handle('favorite:toggle', (event, id) => {
  const lib = loadLibrary();
  const i = lib.favorites.indexOf(id);
  if (i >= 0) lib.favorites.splice(i, 1); else lib.favorites.push(id);
  saveLibrary(lib);
  return lib.favorites.includes(id);
});
ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

function registerMediaKeys() {
  const send = (ch) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.webContents.send(ch);
  };
  try {
    globalShortcut.register('MediaPlayPause', () => send('media:playpause'));
    globalShortcut.register('MediaNextTrack', () => send('media:next'));
    globalShortcut.register('MediaPreviousTrack', () => send('media:prev'));
    console.log('[media] 全局媒体键已注册（播放/暂停、下一首、上一首）');
  } catch (e) {
    console.error('[media] 媒体键注册失败:', e.message);
  }
}

if (isUiTest) {
  app.whenReady().then(async () => {
    createWindow();
    const w = BrowserWindow.getAllWindows()[0];
    for (let i = 0; i < 30; i++) { try { const ok = await w.webContents.executeJavaScript('window.__test && window.__test.djToggle !== undefined'); if (ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 500)); }
    try {
      const res = await w.webContents.executeJavaScript(`(async () => {
        const lib = await window.api.loadLibrary();
        if (!lib.songs.length) return { err: 'no songs' };
        window.__test.djToggle();
        await new Promise((r) => setTimeout(r, 800));
        const mq = document.getElementById('dj-marquee');
        const marqueeShown = mq && !mq.hidden;
        const anim = mq ? getComputedStyle(mq).animationName : null;
        const text = mq && mq.querySelector('.dj-marquee-inner') ? mq.querySelector('.dj-marquee-inner').textContent : null;
        const ringBg = mq ? getComputedStyle(mq).backgroundImage.slice(0, 40) : null;
        document.getElementById('btn-ai-pick').click();
        await new Promise((r) => setTimeout(r, 300));
        const modalShown = !document.getElementById('aipick-modal').hidden;
        const welcome = document.getElementById('aipick-welcome').textContent.slice(0, 20);
        const chips = document.querySelectorAll('.aipick-chip').length;
        window.__test.djToggle();
        await new Promise((r) => setTimeout(r, 300));
        const marqueeHiddenAfter = mq.hidden;
        // 端到端：发一条真实消息，等 AI 回复
        document.getElementById('aipick-input').value = '来点适合跑步的英文歌';
        document.getElementById('aipick-send').click();
        let result = null;
        for (let i = 0; i < 90; i++) {
          const msgs = document.querySelectorAll('#aipick-chat .aipick-msg');
          const last = msgs[msgs.length - 1];
          if (last && last.classList.contains('ai') && !last.classList.contains('loading') && last.querySelector('[data-aipick-play]')) { result = { reply: last.textContent.slice(0, 80), playBtn: !!last.querySelector('[data-aipick-play]'), saveBtn: !!last.querySelector('[data-aipick-save]') }; break; }
          await new Promise((r) => setTimeout(r, 1000));
        }
        // 点“存为播放列表”
        let saved = null;
        if (result) {
          const last = document.querySelectorAll('#aipick-chat .aipick-msg');
          const btn = last[last.length - 1].querySelector('[data-aipick-save]');
          if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 1500)); }
          const pls = await window.api.listPlaylists();
          saved = pls.find((p) => /^AI 挑歌/.test(p.name));
        }
        // 强制重新显示跑马灯供截图（AI 挑歌已耗时超过 10 秒自动隐藏）；隐藏 rec-page 以免盖住
        if (!window.__test.djState().on) window.__test.djToggle();
        const mqEl = document.getElementById('dj-marquee');
        if (mqEl) { mqEl.hidden = false; mqEl.style.animation = 'none'; void mqEl.offsetWidth; mqEl.style.animation = ''; }
        const recEl = document.getElementById('rec-page');
        if (recEl) recEl.hidden = true;
        await new Promise((r) => setTimeout(r, 400));
        const mq2 = document.getElementById('dj-marquee');
        const rect = mq2.getBoundingClientRect();
        const mqStyle = mq2 ? { display: getComputedStyle(mq2).display, vis: getComputedStyle(mq2).visibility, opacity: getComputedStyle(mq2).opacity, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } } : null;
        return { marqueeShown, anim, text, ringBg, mqStyle, modalShown, welcome, chips, aiPick: result, saved: saved ? { name: saved.name, count: saved.count } : null };
      })()`);
      console.log('[uitest]' + JSON.stringify(res));
      fs.writeFileSync(path.join(__dirname, 'uitest.json'), JSON.stringify(res, null, 2));
      // AI DJ 实时对话测试（真实调用 DeepSeek）
      try {
        const dct = await w.webContents.executeJavaScript(`(async () => {
          const btn = document.getElementById('btn-dj-chat');
          const modalEl = document.getElementById('djchat-modal');
          const uiOk = !!btn && !!modalEl;
          if (btn) btn.click();
          await new Promise((r) => setTimeout(r, 300));
          const modalOpen = !modalEl.hidden;
          const nowShown = !document.getElementById('djchat-now').hidden;
          document.getElementById('djchat-input').value = '切得太快了，过渡慢一点，新歌声音也大一点';
          document.getElementById('djchat-send').click();
          let reply = null;
          for (let i = 0; i < 90; i++) {
            const msgs = document.querySelectorAll('#djchat-chat .aipick-msg');
            const last = msgs[msgs.length - 1];
            if (last && last.classList.contains('ai') && !last.classList.contains('loading')) { reply = { text: last.textContent.slice(0, 60), adj: last.querySelector('.djchat-msg-adj') ? last.querySelector('.djchat-msg-adj').textContent.slice(0, 80) : null }; break; }
            await new Promise((r) => setTimeout(r, 1000));
          }
          const ua = window.__test ? null : null;
          return { uiOk, modalOpen, nowShown, reply };
        })()`);
        fs.writeFileSync(path.join(__dirname, 'djchat-test.json'), JSON.stringify(dct, null, 2));
        console.log('[djchat-test] ' + JSON.stringify(dct));
      } catch (e2) {
        console.error('[djchat-test] failed:', e2.message);
      }
      try {
        const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'marquee-shot.png'), img.toPNG());
        console.log('[uitest-shot] saved');
      } catch (se) { console.error('[uitest-shot] fail:', se.message); }
    } catch (e) {
      console.error('[uitest] failed:', e.message);
    }
    app.quit();
  });
} else if (isQuickPick) {
  app.whenReady().then(async () => {
    try {
      const settings = loadSettings();
      const lib = loadLibrary();
      const songs = (lib.songs || []).slice(0, 60).map((s) => ({ title: s.title, artist: s.artist, album: s.album, bpm: null, key: null }));
      console.log('[quickpick] songs=' + songs.length + ' key=' + ((settings.djApiKey || '').trim() ? 'dj' : (settings.apiKey ? 'main' : 'none')));
      const t0 = Date.now();
      const res = await generateDjPick('来点适合深夜听的安静英文歌', songs, settings);
      console.log('[quickpick] elapsed=' + (Date.now() - t0) + 'ms result=' + JSON.stringify(res));
    } catch (e) {
      console.error('[quickpick] failed:', e.message);
    }
    app.quit();
  });
} else {
  app.whenReady().then(() => {
    createWindow();
    registerMediaKeys();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}