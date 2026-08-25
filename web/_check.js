
const $=id=>document.getElementById(id);
const st={songs:[],filtered:[],cur:-1,view:"rec",key:localStorage.getItem("echoWebKey")||"",playing:false,recAlbum:null,modal:null};
function fmt(s){if(!isFinite(s))return"0:00";const m=Math.floor(s/60),x=Math.floor(s%60);return m+":"+String(x).padStart(2,"0")}
function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function guessAlbum(p){const a=(p||"").split("/");return a.length>1?a[0]:"未知专辑"}
function guessArtist(n){const m=String(n).match(/^(.+?)\s*-\s*/);return m?m[1]:"未知歌手"}
function probe(u){return new Promise(r=>{const a=new Audio();a.src=u;a.onloadedmetadata=()=>r(a.duration||0);a.onerror=()=>r(0)})}
/* ===== 封面解析：从 MP3 ID3 / FLAC / M4A 提取内嵌封面 ===== */
function readCoverFromFile(f){
  return new Promise(resolve=>{
    if(!f||!f.size)return resolve(null);
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const buf=reader.result;
        const u8=new Uint8Array(buf);
        if(u8[0]===0x49&&u8[1]===0x44&&u8[2]===0x33){
          let pos=10;
          const sz=((u8[6]&0x7f)<<21)|((u8[7]&0x7f)<<14)|((u8[8]&0x7f)<<7)|(u8[9]&0x7f);
          const end=Math.min(10+sz, u8.length);
          while(pos+10<=end){
            const fid=String.fromCharCode(u8[pos],u8[pos+1],u8[pos+2],u8[pos+3]);
            const fsz=((u8[pos+4]&0x7f)<<21)|((u8[pos+5]&0x7f)<<14)|((u8[pos+6]&0x7f)<<7)|(u8[pos+7]&0x7f);
            if(fid==="APIC"){
              let p2=pos+10;
              if(p2+4>end)break;
              const enc=u8[p2]; p2++;
              const mimeStart=p2;
              while(p2<end&&u8[p2]!==0)p2++;
              const mime=String.fromCharCode.apply(null,u8.slice(mimeStart,p2));
              if(u8[p2]===0)p2++;
              p2++;
              if(enc===1||enc===2){
                while(p2+1<end&&!(u8[p2]===0&&u8[p2+1]===0))p2+=2;
                if(p2+1<end)p2+=2;
              }else{
                while(p2<end&&u8[p2]!==0)p2++;
                if(p2<end)p2++;
              }
              const imgStart=p2;
              const imgEnd=Math.min(pos+10+fsz,end);
              if(imgEnd>imgStart+16){
                const mt=mime||"image/jpeg";
                const blob=new Blob([buf.slice(imgStart,imgEnd)],{type:mt});
                resolve(URL.createObjectURL(blob));
                return;
              }
            }
            if(fsz<=0)break;
            pos+=10+fsz;
          }
        }
        if(u8[0]===0x66&&u8[1]===0x4c&&u8[2]===0x61&&u8[3]===0x43){
          let pos=4;
          for(let i=0;i<128;i++){
            if(pos+4>u8.length)break;
            const isLast=(u8[pos]&0x80)!==0;
            const type=u8[pos]&0x7f;
            const blen=((u8[pos+1]&0xff)<<16)|((u8[pos+2]&0xff)<<8)|(u8[pos+3]&0xff);
            if(type===6&&blen>8){
              const pStart=pos+4;
              let p2=pStart+4;
              const mimeLen=(u8[p2+3]<<24)|(u8[p2+2]<<16)|(u8[p2+1]<<8)|u8[p2];
              p2+=4;
              const mime=String.fromCharCode.apply(null,u8.slice(p2,p2+mimeLen));
              p2+=mimeLen;
              const dlen=(u8[p2+3]<<24)|(u8[p2+2]<<16)|(u8[p2+1]<<8)|u8[p2];
              p2+=4+dlen;
              const dataLen=(u8[p2+3]<<24)|(u8[p2+2]<<16)|(u8[p2+1]<<8)|u8[p2];
              p2+=4;
              const imgStart=p2;
              const imgEnd=Math.min(imgStart+dataLen,u8.length);
              if(imgEnd>imgStart+16){
                const blob=new Blob([buf.slice(imgStart,imgEnd)],{type:mime||"image/jpeg"});
                resolve(URL.createObjectURL(blob));
                return;
              }
            }
            pos+=4+blen;
            if(isLast)break;
          }
        }
        resolve(null);
      }catch(e){resolve(null)}
    };
    reader.onerror=()=>resolve(null);
    reader.readAsArrayBuffer(f.slice(0,3*1024*1024));
  });
}
async function importFiles(list){
  const ex=/\.(mp3|flac|alac|m4a|aac|wav|ogg|oga|opus|ape|wma|aiff|aif)$/i;
  const fs=[...list].filter(f=>ex.test(f.name));
  if(!fs.length){toast("没有音频文件");return}
  toast("正在导入 "+fs.length+" 首…");
  const arr=[];
  for(const f of fs){
    try{
      const url=URL.createObjectURL(f);
      const d=await probe(url);
      const cover=await readCoverFromFile(f);
      arr.push({id:f.webkitRelativePath||f.name,name:f.name.replace(/\.[^.]+$/,""),url,duration:d,album:guessAlbum(f.webkitRelativePath||f.name),artist:guessArtist(f.name),cover:cover});
    }catch(e){}
  }
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
function coverEl(s,cls){return s&&s.cover?"<img src=\""+s.cover+"\" alt=\"\">":"<span>♪</span>"}
function upUI(){
  const s=curSong();
  $("pb-play").textContent=audio.paused?"▶":"⏸";$("fs-play").textContent=audio.paused?"▶":"⏸";
  if(s){
    $("pb-title").textContent=s.name;$("pb-artist").textContent=s.artist;
    $("pb-cover").style.background=grad(s.name);$("pb-cover").innerHTML=coverEl(s);
    $("fs-ti").textContent=s.name;$("fs-ar").textContent=s.artist;
    $("fs-cover").style.background=grad(s.name);$("fs-cover").innerHTML=coverEl(s);
  }
  loadLrc(s);
}
audio.addEventListener("timeupdate",()=>{if(audio.duration){$("fil").style.width=(audio.currentTime/audio.duration*100)+"%";$("tc").textContent=fmt(audio.currentTime);$("tt").textContent=fmt(audio.duration)}upLrc()});
audio.addEventListener("ended",nx);
audio.addEventListener("play",()=>{st.playing=true;upUI()});
audio.addEventListener("pause",()=>{st.playing=false;upUI()});
function showModal(id){st.modal=id;document.querySelectorAll(".modal").forEach(m=>m.classList.remove("show"));$(id).classList.add("show")}
function hideModal(){st.modal=null;document.querySelectorAll(".modal").forEach(m=>m.classList.remove("show"))}
function render(){
  const T={rec:"每日推荐",songs:"所有歌曲",albums:"专辑",artists:"歌手"};
  $("pt").textContent=T[st.view]||"";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===st.view));
  if(st.view==="rec")rr();else if(st.view==="songs")rs();else if(st.view==="albums")ra();else if(st.view==="artists")rp();
}
function rr(){
  const c=$("content");
  if(!st.songs.length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>点击右上角「导入音乐」批量选择音频文件<br>支持 MP3 / FLAC / M4A / WAV 等，自动读取内嵌封面</p></div>';return}
  const byAlbum={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(byAlbum[a]=byAlbum[a]||[]).push(s)});
  const albums=Object.keys(byAlbum);
  const picked=st.recAlbum&&byAlbum[st.recAlbum]?st.recAlbum:albums[Math.floor(Math.random()*albums.length)];
  st.recAlbum=picked;
  const list=byAlbum[picked];
  c.innerHTML='<div class="rec-banner"><div class="rec-cover" style="background:'+grad(picked)+'">'+(list.find(x=>x.cover)?'<img src="'+list.find(x=>x.cover).cover+'">':'🎵')+'</div><h2>每日推荐</h2><p>'+esc(picked)+' · '+list.length+' 首</p><button class="play-album" id="rec-play">▶ 播放整张专辑</button></div>'+list.map((s,i)=>'<div class="row" data-i="'+i+'" data-list="rec"><span class="cov-sm" style="background:'+grad(s.name)+'">'+coverEl(s)+'</span><span class="t">'+esc(s.name)+'</span><span class="d">'+esc(s.artist)+'</span></div>').join("");
}
function rs(){const c=$("content");if(!st.filtered.length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有歌曲，先导入音乐吧</p></div>';return}c.innerHTML=st.filtered.map((s,i)=>'<div class="row'+(i===st.cur?" playing":"")+'" data-i="'+i+'"><span class="cov-sm" style="background:'+grad(s.name)+'">'+coverEl(s)+'</span><span class="t">'+esc(s.name)+'</span><span class="d">'+esc(s.artist)+'</span></div>').join("")}
function ra(){const b={};st.songs.forEach(s=>{const a=s.album||"未知专辑";(b[a]=b[a]||[]).push(s)});const c=$("content");if(!Object.keys(b).length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有专辑</p></div>';return}c.innerHTML='<div class="grid">'+Object.keys(b).map((a,i)=>'<div class="card" data-a="'+esc(a)+'"><div class="cov" style="background:'+grad(a)+'">'+(b[a].find(x=>x.cover)?'<img src="'+b[a].find(x=>x.cover).cover+'">':'♪')+'</div><div class="nm">'+esc(a)+'</div><div class="ct">'+b[a].length+' 首</div></div>').join("")+"</div>"}
function rp(){const b={};st.songs.forEach(s=>{const a=s.artist||"未知歌手";(b[a]=b[a]||[]).push(s)});const c=$("content");if(!Object.keys(b).length){c.innerHTML='<div class="empty"><div class="ic">🎵</div><p>还没有歌手</p></div>';return}c.innerHTML='<div class="grid">'+Object.keys(b).map(a=>'<div class="card" data-p="'+esc(a)+'"><div class="cov" style="background:'+grad(a)+'">♪</div><div class="nm">'+esc(a)+'</div><div class="ct">'+b[a].length+' 首</div></div>').join("")+"</div>"}
let lrcS={lines:[],cur:-1};
function parseLrc(t){const L=[];const re=/\[([0-9]+):([0-9]+(?:\.[0-9]+)?)\](.*)/g;let m;while((m=re.exec(t)))L.push({t:+m[1]*60+ +m[2],text:m[3].trim()});return L}
async function loadLrc(s){lrcS={lines:[],cur:-1};const el=$("fs-lyr");if(!s){el.innerHTML='<div class="empty"><p>暂无歌词</p></div>';return}el.innerHTML='<div class="empty"><p>正在获取歌词…</p></div>';try{const l=await fetchLrc(s);if(l){lrcS.lines=parseLrc(l);el.innerHTML=lrcS.lines.length?lrcS.lines.map((x,i)=>'<div class="lrc'+(i===lrcS.cur?" on":"")+'" data-i="'+i+'">'+esc(x.text)+'</div>').join(""):'<div class="empty"><p>暂无歌词</p></div>'}}catch(e){el.innerHTML='<div class="empty"><p>歌词获取失败</p></div>'}}
async function fetchLrc(s){try{const q=encodeURIComponent(s.name+" "+(s.artist||""));const r=await fetch("https://lrclib.net/api/search?q="+q);const j=await r.json();if(j&&j[0]&&j[0].syncedLyrics)return j[0].syncedLyrics}catch(e){}if(st.key){try{const o=await ds([{role:"system",content:"你是歌词专家。输出歌曲《"+s.name+"》完整歌词，LRC 格式 [mm:ss.xx] 每行一句。只输出 LRC，不要解释。"}],s);if(o)return o}catch(e){}}return null}
async function ds(ms,mt){if(!st.key)return null;const r=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+st.key},body:JSON.stringify({model:"deepseek-chat",messages:ms})});if(!r.ok)return null;const j=await r.json();return j.choices&&j.choices[0]?j.choices[0].message.content:null}
async function aiPick(txt){const q=String(txt||"").trim();if(!q)return;if(!st.key){addMsg("ai","请先在设置填写 API Key");return}addMsg("user",esc(q));addMsg("ai","正在思考…");try{const lib=st.songs.slice(0,200).map(s=>"《"+s.name+"》"+(s.artist||"")).join(String.fromCharCode(10));const o=await ds([{role:"system",content:"你是音乐推荐助手。从用户曲库中挑选适合的歌，输出 JSON 数组：[\"歌名 - 歌手\"]，5-10 首。"},{role:"user",content:"曲库：\n"+lib+"\n\n要求："+q}]);if(o){const m=o.match(/\[[\s\S]*\]/);if(m){const names=JSON.parse(m[0]);const found=names.map(nm=>{const n=String(nm).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,"");return st.songs.find(s=>(s.name+s.artist).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,"").includes(n)||n.includes((s.name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,""))) }).filter(Boolean);if(found.length){addMsg("ai",found.map(s=>"♪ "+esc(s.name)+" — "+esc(s.artist)).join("<br>"));st.filtered=found;st.view="songs";render();toast("已为你挑出 "+found.length+" 首");return}}addMsg("ai",o.slice(0,300));return}addMsg("ai","没挑到，换个说法试试")}catch(e){addMsg("ai","出错了: "+e.message)}}
function addMsg(c,t){const ch=$("aipc");const d=document.createElement("div");d.className="msg "+c;d.innerHTML=t;ch.appendChild(d);ch.scrollTop=ch.scrollHeight}
$("imp").addEventListener("click", async () => {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const capFilePicker = window.Capacitor.Plugins.FilePicker;
      if (!capFilePicker) { $("finput").click(); return; }
      const result = await capFilePicker.pickFiles({ types: ["audio/*"], multiple: true, readData: false });
      const files = (result && result.files) ? result.files : [];
      if (!files.length) { toast('未选择文件'); return; }
      const ex = /\.(mp3|flac|alac|m4a|aac|wav|ogg|oga|opus|ape|wma|aiff|aif)$/i;
      const audioFiles = files.filter(f => f && f.name && ex.test(f.name));
      if (!audioFiles.length) { toast('没有音频文件'); return; }
      toast('正在导入 ' + audioFiles.length + ' 首…');
      const arr = [];
      for (const f of audioFiles) {
        try {
          const url = f.path ? f.path : (f.uri || f.webPath || f.name);
          const d = await probe(url);
          arr.push({ id: f.name, name: f.name.replace(/\.[^.]+$/,''), url: url, duration: d, album: guessAlbum(f.name), artist: guessArtist(f.name), cover: null });
        } catch (e) {}
      }
      if (!arr.length) { toast('导入失败，请重试'); return; }
      st.songs = arr; st.filtered = arr; render(); toast('已导入 ' + arr.length + ' 首');
    } catch (e) { toast('文件选择失败: ' + e.message); }
    return;
  }
  $("finput").click();
});
$("finput").addEventListener("change",e=>importFiles(e.target.files));
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{hideModal();st.view=b.dataset.view;render()}));
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
$("setc").addEventListener("click",hideModal);
$("sets").addEventListener("click",()=>{st.key=$("key").value.trim();localStorage.setItem("echoWebKey",st.key);hideModal();toast("已保存")});
$("aipc2").addEventListener("click",hideModal);
$("aips").addEventListener("click",()=>{const v=$("aipi").value;$("aipi").value="";aiPick(v)});
$("aipi").addEventListener("keydown",e=>{if(e.key==="Enter"){const v=$("aipi").value;$("aipi").value="";aiPick(v)}});
// 长按设置打开弹窗（无独立设置页）
$("pt").addEventListener("dblclick",()=>showModal("setm"));
document.querySelector(".tabs").addEventListener("click",e=>{const t=e.target.closest(".tab");if(!t)return;if(t.dataset.view==="settings"){showModal("setm")}else if(t.dataset.view==="aipick"){showModal("aipm")}else{hideModal()}});
document.addEventListener("keydown",e=>{if(e.code==="Space"&&e.target.tagName!=="INPUT"){e.preventDefault();tog()}});
let tt;function toast(m){const t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(tt);tt=setTimeout(()=>t.style.display="none",2200)}
window.__st = st;
window.__toast = toast;
window.__render = render;
window.__audio = audio;
// 切歌时尝试 DJ 过渡
const _origPlayIdx = playIdx;
playIdx = function(i, list) {
  const l = list || st.filtered;
  if (window.__dj && window.__dj.on) {
    if (window.__djTransition && l.length && i >= 0 && i < l.length) {
      const ok = window.__djTransition(i, l);
      if (ok) { st.cur = i; st.filtered = l; upUI(); render(); return; }
    }
  }
  _origPlayIdx(i, list);
};
render();

