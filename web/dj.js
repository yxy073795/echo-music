/* ===== AI DJ 引擎：BPM 分析 + 交叉淡化 + 对话调参 ===== */
(function(){
if (window.__djLoaded) return; window.__djLoaded = true;
const Q = String.fromCharCode(39);
const DQ = String.fromCharCode(34);
const $ = (id) => document.getElementById(id);
const dj = { on: false, bpmCache: new Map(), adj: {}, mainVol: 1, nextVol: 1 };
window.__dj = dj;
function djEscape(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function djAddMsg(c, t) { const ch = $('djchat'); if (!ch) return; const d = document.createElement('div'); d.className = 'msg ' + c; d.innerHTML = t; ch.appendChild(d); ch.scrollTop = ch.scrollHeight; }
async function analyzeBpmMobile(url) {
  try {
    const resp = await fetch(url);
    const ab = await resp.arrayBuffer();
    const off = new OfflineAudioContext(1, 44100 * 30, 44100);
    const buf = await off.decodeAudioData(ab);
    const mono = new Float32Array(buf.length);
    mono.set(buf.getChannelData(0));
    const SR = 44100, win = Math.floor(SR * 0.08), hop = Math.floor(SR * 0.0232);
    const energies = [];
    for (let i = 0; i + win < mono.length; i += hop) { let e = 0; for (let j = i; j < i + win; j++) e += mono[j] * mono[j]; energies.push(e / win); }
    const diff = new Float32Array(Math.max(1, energies.length - 1));
    for (let i = 1; i < energies.length; i++) diff[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
    const dt = hop / SR; let best = null;
    const maxLag = Math.min(Math.floor(diff.length / 2), Math.floor(60 / 60 / dt) + 5);
    for (let lag = Math.max(4, Math.floor(60 / 200 / dt) - 5); lag < maxLag; lag++) {
      const bpm = 60 / (lag * dt); if (bpm < 60 || bpm > 200) continue;
      let sum = 0, cnt = 0; for (let t = 0; t + lag < diff.length; t += lag) { sum += diff[t] * diff[t + lag]; cnt++; }
      const val = cnt ? sum / cnt : 0;
      if (!best || val > best.val) best = { lag, val, bpm: Math.round(bpm) };
    }
    return best ? best.bpm : null;
  } catch (e) { return null; }
}
window.__analyzeBpm = analyzeBpmMobile;
async function analyzeAll() {
  try {
    const st = window.__st || {};
    const songs = st.songs || [];
    let done = 0;
    for (const s of songs) { if (!s._bpm) { s._bpm = await analyzeBpmMobile(s.url); done++; } }
    if (done > 0) window.__toast && window.__toast('BPM 分析完成 ' + done + ' 首');
  } catch (e) {}
}
window.__djAnalyzeAll = analyzeAll;
function djToggle() {
  dj.on = !dj.on;
  const st = window.__st || {};
  if (dj.on) {
    if ((st.songs || []).length && !(st.songs[0] || {})._bpm) { window.__toast && window.__toast('AI DJ 已开启，正在分析 BPM…'); analyzeAll(); }
    else window.__toast && window.__toast('AI DJ 已开启');
  } else { window.__toast && window.__toast('AI DJ 已关闭'); }
  if (window.__render) window.__render();
}
window.__djToggle = djToggle;
function djTransition(nextIdx, list) {
  if (!dj.on) return false;
  const st = window.__st || {};
  const songs = list || st.filtered || [];
  if (nextIdx < 0 || nextIdx >= songs.length) return false;
  const curA = window.__audio || document.querySelector('audio');
  if (!curA || !curA.src) return false;
  const next = songs[nextIdx];
  const nextA = new Audio(); nextA.src = next.url; nextA.volume = 0;
  const mixLead = Math.max(1.2, Math.min(6, dj.adj.mixLead || 3));
  const nextVol = Math.max(0.4, Math.min(1, dj.adj.nextVol || 1));
  const curVol = curA.volume;
  nextA.play().then(() => {
    let t = 0;
    const iv = setInterval(() => {
      t += 0.05;
      const k = Math.min(1, t / mixLead);
      curA.volume = Math.max(0, curVol * (1 - k));
      nextA.volume = nextVol * k;
      if (k >= 1) { clearInterval(iv); curA.pause(); }
    }, 50);
  });
  // 切换主播放器状态
  curA.src = next.url;
  curA.volume = 1;
  curA.play();
  setTimeout(() => { nextA.pause(); nextA.src = ''; }, 6000);
  return true;
}
window.__djTransition = djTransition;
async function djChatSend(text) {
  const q = String(text || '').trim();
  if (!q) return;
  const st = window.__st || {};
  if (!st.key) { djAddMsg('ai', '请先在设置填写 DeepSeek API Key'); return; }
  djAddMsg('user', djEscape(q));
  djAddMsg('ai', '正在调整…');
  try {
    const msgs = [{ role: 'system', content: '你是 AI DJ 混音助手。根据用户指令输出 JSON，可选字段：mixLead(过渡时长秒,1-6)、nextVol(新歌音量,0.4-1)。只输出 JSON 对象。' }];
    const body = JSON.stringify({ model: 'deepseek-chat', messages: msgs.concat([{ role: 'user', content: q }]) });
    const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + st.key }, body: body });
    if (!r.ok) { djAddMsg('ai', 'AI 请求失败'); return; }
    const j = await r.json();
    const o = j.choices && j.choices[0] ? j.choices[0].message.content : null;
    if (!o) { djAddMsg('ai', 'AI 无响应'); return; }
    const m = o.match(/\{[\s\S]*\}/);
    if (m) {
      const adj = JSON.parse(m[0]);
      dj.adj = Object.assign({}, dj.adj, adj);
      const parts = [];
      if (adj.mixLead) parts.push('过渡 ' + adj.mixLead + 's');
      if (adj.nextVol) parts.push('新歌音量 ' + Math.round(adj.nextVol * 100) + '%');
      djAddMsg('ai', '✅ 已应用：' + (parts.join('，') || '保持当前混音风格'));
      window.__toast && window.__toast('AI DJ 已调整混音参数');
    } else { djAddMsg('ai', o.slice(0, 200)); }
  } catch (e) { djAddMsg('ai', '出错: ' + djEscape(e.message)); }
}
window.__djChatSend = djChatSend;
function init() {
  const sendBtn = $('djsend');
  const input = $('djinput');
  const closeBtn = $('djclose');
  if (sendBtn) sendBtn.addEventListener('click', () => { const v = input.value; input.value = ''; djChatSend(v); });
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value; input.value = ''; djChatSend(v); } });
  if (closeBtn) closeBtn.addEventListener('click', () => { const m = $('djmodal'); if (m) m.classList.remove('show'); });
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.view === 'dj') t.addEventListener('click', () => {
      if (!dj.on) djToggle();
      const m = $('djmodal'); if (m) m.classList.add('show');
    });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();