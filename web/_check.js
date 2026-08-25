
const $=id=>document.getElementById(id);
const st={songs:[],filtered:[],cur:-1,view:"rec",key:localStorage.getItem("echoWebKey")||"",playing:false,recAlbum:null};
function fmt(s){if(!isFinite(s))return"0:00";const m=Math.floor(s/60),x=Math.floor(s%60);return m+":"+String(x).padStart(2,"0")}
function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function guessAlbum(p){const a=(p||"").split("/");return a.length>1?a[0]:"未知专辑"}
function guessArtist(n){const m=String(n).match(/^(.+?)\s*-\s*/);return m?m[1]:"未知歌手"}
function probe(u){return new Promise(r=>{const a=new Audio();a.src=u;a.onloadedmetadata=()=>r(a.duration||0);a.onerror=()=>r(0)})}
async function importFiles(list){
  const ex=/\.(mp3|flac|alac|m4a|aac|wav|ogg|oga|opus|ape|wma|aiff|aif)$/i;
  const fs=[...list].filter(f=>ex.test(f.name));
  if(!fs.length){toast("没有音频文件");return}
  const arr=[];
  for(const f of fs){try{const url=URL.createObjectURL(f);const d=await probe(url);arr.push({id:f.webkitRelativePath||f.name,name:f.name.replace(/\.[^.]+$/,""),url,duration:d,album:guessAlbum(f.webkitRelativePath||f.name),artist:guessArtist(f.name)})}catch(e){}}
  st.songs=arr;st.filtered=arr;render();toast("已导入 "+arr.length+" 首");
}
const audio=new Audio();
function playIdx(i,list){
  if(!list)list=st.filtered;
  if(i<0||i>=list.length)return;
  st.cur=i;st.filtered=list;
  const s=list[i];audio.src=s.url;audio.play();st.playing=true;upUI();render();
}
function tog(){if(st.cur<0&&st.songs.length){playIdx(0);return}audio.paused?audio.play():audio.pause()}
function nx(){if(!st.filtered.length)return;playIdx((st.cur+1)%st.filtered.length)}
function pv(){if(!st.filtered.length)return;playIdx((st.cur-1+st.filtered.length)%st.filtered.length)}
const GR=[["#6c5ce7","#a29bfe"],["#e17055","#fdcb6e"],["#00cec9","#55efc4"],["#0984e3","#74b9ff"],["#d63031","#fab1a0"],["#e84393","#fd79a8"]];
function grad(n){let h=0;for(const ch of String(n))h=(h*31+ch.charCodeAt(0))%997;const g=GR[h%GR.length];return"linear-gradient(135deg,"+g[0]+","+g[1]+")"}
function curSong(){return st.cur>=0&&st.filtered[st.cur]?st.filtered[st.cur]:null}
function upUI(){
  const s=curSong();
  $("pb-play").textContent=audio.paused?"▶":"⏸";$("fs-play").textContent=audio.paused?"▶":"⏸";
  if(s){
    $("pb-title").textContent=s.name;$("pb-artist").textContent=s.artist;
    $("pb-cover").style.background=grad(s.name);$("pb-cover").textContent="♪";
    $("fs-ti").textContent=s.name;$("fs-ar").textContent=s.artist;
    $("fs-cover").style.background=grad(s.name);$("fs-cover").textContent="♪";
  }
  loadLrc(s);
}
audio.addEventListener("timeupdate",()=>{if(audio.duration){$("fil").style.width=(audio.currentTime/audio.duration*100)+"%";$("tc").textContent=fmt(audio.currentTime);$("tt").textContent=fmt(audio.duration)}upLrc()});
audio.addEventListener("ended",nx);
audio.addEventListener("play",()=>{st.playing=true;upUI()});
audio.addEventListener("pause",()=>{st.playing=false;upUI()});
function render(){
  const T={rec:"每日推荐",songs:"所有歌曲",albums:"专辑",artists:"歌手",aipick:"AI 挑歌",settings:"设置"};
  $("pt").textContent=T[st.view]||"";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===st.view));
  if(st.view==="rec")rr();else if(st.view==="songs")rs();else if(st.view==="albums")ra();else if(st.view==="artists")rp();else if(st.view==="aipick"){$("aipm").classList.add("show");}else if(st.view==="settings"){$("setm").classList.add("show");}
}
function rr(){
  const c=$("content");
  if(!st.songs.length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>点击右上角「导入音乐」选择你的音乐文件<br>支持 MP3 / FLAC / M4A / WAV 等</p></div>';return}
  const byAlbum={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(byAlbum[a]=byAlbum[a]||[]).push(s)});
  const albums=Object.keys(byAlbum);
  const picked=st.recAlbum&&byAlbum[st.recAlbum]?st.recAlbum:albums[Math.floor(Math.random()*albums.length)];
  st.recAlbum=picked;
  const list=byAlbum[picked];
  c.innerHTML='<div class="rec-banner"><div class="rec-cover" style="background:'+grad(picked)+'">🎵</div><h2>每日推荐</h2><p>'+esc(picked)+' · '+list.length+' 首</p><button class="play-album" id="rec-play">▶ 播放整张专辑</button></div>'+list.map((s,i)=>'<div class="row" data-i="'+i+'" data-list="rec"><span class="cov-sm" style="background:'+grad(s.name)+'">♪</span><span class="t">'+esc(s.name)+'</span><span class="d">'+esc(s.artist)+'</span></div>').join("");
}
function rs(){const c=$("content");if(!st.filtered.length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有歌曲，先导入音乐吧</p></div>';return}c.innerHTML=st.filtered.map((s,i)=>'<div class="row'+(i===st.cur?" playing":"")+'" data-i="'+i+'"><span class="cov-sm" style="background:'+grad(s.name)+'">♪</span><span class="t">'+esc(s.name)+'</span><span class="d">'+esc(s.artist)+'</span></div>').join("")}
function ra(){const b={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(b[a]=b[a]||[]).push(s)});const c=$("content");if(!Object.keys(b).length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有专辑</p></div>';return}c.innerHTML='<div class="grid">'+Object.keys(b).map((a,i)=>'<div class="card" data-a="'+esc(a)+'"><div class="cov" style="background:'+grad(a)+'">♪</div><div class="nm">'+esc(a)+'</div><div class="ct">'+b[a].length+' 首</div></div>').join("")+"</div>"}
function rp(){const b={};st.songs.forEach(s=>{const a=s.artist||"未知歌手";(b[a]=b[a]||[]).push(s)});const c=$("content");if(!Object.keys(b).length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有歌手</p></div>';return}c.innerHTML='<div class="grid">'+Object.keys(b).map(a=>'<div class="card" data-p="'+esc(a)+'"><div class="cov" style="background:'+grad(a)+'">♪</div><div class="nm">'+esc(a)+'</div><div class="ct">'+b[a].length+' 首</div></div>').join("")+"</div>"}
let lrcS={lines:[],cur:-1};
function parseLrc(t){const L=[];const re=/\[([0-9]+):([0-9]+(?:\.[0-9]+)?)\](.*)/g;let m;while((m=re.exec(t)))L.push({t:+m[1]*60+ +m[2],text:m[3].trim()});return L}
async function loadLrc(s){lrcS={lines:[],cur:-1};const el=$("fs-lyr");if(!s){el.innerHTML='<div class="empty"><p>暂无歌词</p></div>';return}el.innerHTML='<div class="empty"><p>正在获取歌词…</p></div>';try{const l=await fetchLrc(s);if(l){lrcS.lines=parseLrc(l);el.innerHTML=lrcS.lines.length?lrcS.lines.map((x,i)=>'<div class="lrc'+(i===lrcS.cur?" on":"")+'" data-i="'+i+'">'+esc(x.text)+'</div>').join(""):'<div class="empty"><p>暂无歌词</p></div>'}}catch(e){el.innerHTML='<div class="empty"><p>歌词获取失败</p></div>'}}
async function fetchLrc(s){try{const q=encodeURIComponent(s.name+" "+(s.artist||""));const r=await fetch("https://lrclib.net/api/search?q="+q);const j=await r.json();if(j&&j[0]&&j[0].syncedLyrics)return j[0].syncedLyrics}catch(e){}if(st.key){try{const o=await ds([{role:"system",content:"你是歌词专家。输出歌曲《"+s.name+"》完整歌词，LRC 格式 [mm:ss.xx] 每行一句。只输出 LRC，不要解释。"}],s);if(o)return o}catch(e){}}return null}
async function trans(){const txt=lrcS.lines.map(l=>l.text).join(String.fromCharCode(10));try{const o=await ds([{role:"system",content:"把下面歌词逐行翻译成中文，保持 LRC 时间戳格式不变：\n"+txt}]);if(o)lrcS.lines=parseLrc(o);const el=$("fs-lyr");if(el)el.innerHTML=lrcS.lines.map((x,i)=>'<div class="lrc'+(i===lrcS.cur?" on":"")+'" data-i="'+i+'">'+esc(x.text)+'</div>').join("")}catch(e){}}
function upLrc(){if(!lrcS.lines.length)return;const t=audio.currentTime||0;let idx=-1;for(let i=0;i<lrcS.lines.length;i++){if(lrcS.lines[i].t<=t)idx=i;else break}if(idx!==lrcS.cur){lrcS.cur=idx;document.querySelectorAll("#fs-lyr .lrc").forEach(e=>e.classList.toggle("on",+e.dataset.i===idx))}}
async function ds(ms,mt){if(!st.key)return null;const r=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+st.key},body:JSON.stringify({model:"deepseek-chat",messages:ms})});if(!r.ok)return null;const j=await r.json();return j.choices&&j.choices[0]?j.choices[0].message.content:null}
async function aiPick(txt){const q=String(txt||"").trim();if(!q)return;if(!st.key){addMsg("ai","请先在设置填写 API Key");return}addMsg("user",esc(q));addMsg("ai","正在思考…");try{const lib=st.songs.slice(0,200).map(s=>"《"+s.name+"》"+(s.artist||"")).join(String.fromCharCode(10));const o=await ds([{role:"system",content:"你是音乐推荐助手。从用户曲库中挑选适合的歌，输出 JSON：{songs:[\"歌名 - 歌手\"]}，5-10 首。"},{role:"user",content:"曲库：\n"+lib+"\n\n要求："+q}]);if(o){const m=o.match(/\{[\s\S]*\}/);if(m){const names=JSON.parse(m[0]).songs||[];const found=names.map(nm=>{const n=String(nm).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,"");return st.songs.find(s=>(s.name+s.artist).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,"").includes(n)||n.includes((s.name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,""))) }).filter(Boolean);if(found.length){addMsg("ai",found.map(s=>"♪ "+esc(s.name)+" — "+esc(s.artist)).join("<br>"));st.filtered=found;render();toast("已为你挑出 "+found.length+" 首");return}}addMsg("ai",o.slice(0,300));return}addMsg("ai","没挑到，换个说法试试")}catch(e){addMsg("ai","出错了: "+e.message)}}
function addMsg(c,t){const ch=$("aipc");const d=document.createElement("div");d.className="msg "+c;d.innerHTML=t;ch.appendChild(d);ch.scrollTop=ch.scrollHeight}
$("imp").addEventListener("click", async () => {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const f = document.createElement("input");
      f.type = "file"; f.accept = "audio/*"; f.multiple = true;
      f.onchange = () => importFiles(f.files);
      f.click();
    } catch (e) { toast("文件选择失败: " + e.message); }
    return;
  }
  $("finput").click();
});
$("finput").addEventListener("change",e=>importFiles(e.target.files));
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{st.view=b.dataset.view;render()}));
$("content").addEventListener("click",e=>{
  const rp=e.target.closest("#rec-play");if(rp){const byA={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(byA[a]=byA[a]||[]).push(s)});const list=byA[st.recAlbum]||st.songs;playIdx(0,list);return}
  const r=e.target.closest(".row");if(r){const list=r.dataset.list==="rec"?(()=>{const byA={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(byA[a]=byA[a]||[]).push(s)});return byA[st.recAlbum]||st.songs})():st.filtered;playIdx(+r.dataset.i,list);return}
  const a=e.target.closest(".card[data-a]");if(a){const ss=st.songs.filter(s=>(s.album||"未知专辑")===a.dataset.a);st.filtered=ss;st.view="songs";render();return}
  const p=e.target.closest(".card[data-p]");if(p){const ss=st.songs.filter(s=>(s.artist||"未知歌手")===p.dataset.p);st.filtered=ss;st.view="songs";render();return}
});
$("player-bar").addEventListener("click",e=>{if(!e.target.closest(".pb-btn"))$("fs").classList.add("show")});
$("pb-play").addEventListener("click",e=>{e.stopPropagation();tog()});
$("pb-next").addEventListener("click",e=>{e.stopPropagation();nx()});
$("pb-prev").addEventListener("click",e=>{e.stopPropagation();pv()});
$("fs-close").addEventListener("click",()=>$("fs").classList.remove("show"));
$("fs-play").addEventListener("click",tog);
$("fs-next").addEventListener("click",nx);
$("fs-prev").addEventListener("click",pv);
$("trk").addEventListener("click",e=>{const r=e.currentTarget.getBoundingClientRect();const p=(e.clientX-r.left)/r.width;audio.currentTime=p*audio.duration});
$("setc").addEventListener("click",()=>{$("setm").classList.remove("show");render()});
$("sets").addEventListener("click",()=>{st.key=$("key").value.trim();localStorage.setItem("echoWebKey",st.key);$("setm").classList.remove("show");render();toast("已保存")});
$("aipc2").addEventListener("click",()=>{$("aipm").classList.remove("show");render()});
$("aips").addEventListener("click",()=>{const v=$("aipi").value;$("aipi").value="";aiPick(v)});
$("aipi").addEventListener("keydown",e=>{if(e.key==="Enter"){const v=$("aipi").value;$("aipi").value="";aiPick(v)}});
document.addEventListener("keydown",e=>{if(e.code==="Space"&&e.target.tagName!=="INPUT"){e.preventDefault();tog()}});
let tt;function toast(m){const t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(tt);tt=setTimeout(()=>t.style.display="none",2200)}
render();
