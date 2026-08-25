const fs = require('fs');
const p = 'D:/LetsView/EchoWeb/index.html';
let s = fs.readFileSync(p, 'utf8');
const anchor = '      <div class="dl-card dl-card-web reveal">';
if (s.indexOf(anchor) < 0) { console.log('ANCHOR NOT FOUND'); process.exit(1); }
if (s.indexOf('dl-btn-android') >= 0) { console.log('ALREADY'); process.exit(0); }
const card = '      <div class="dl-card reveal">\n' +
  '        <div class="dl-icon">🤖</div>\n' +
  '        <div class="dl-name">Echo Music for Android</div>\n' +
  '        <div class="dl-meta">APK 约 4 MB · 支持 Android 7.0+</div>\n' +
  '        <a class="btn btn-primary btn-lg" href="downloads/Echo-Music-0.1.0-android.apk" id="dl-btn-android" download="Echo-Music-0.1.0-android.apk">下载 Android 版</a>\n' +
  '        <div class="dl-steps">\n' +
  '          <div class="step"><span class="step-num">1</span><span>点击上方按钮下载 APK</span></div>\n' +
  '          <div class="step"><span class="step-num">2</span><span>允许安装未知来源应用（设置 → 安全）</span></div>\n' +
  '          <div class="step"><span class="step-num">3</span><span>打开 Echo Music，开始聆听</span></div>\n' +
  '        </div>\n' +
  '      </div>\n' +
  '      ';
s = s.replace(anchor, card + anchor);
fs.writeFileSync(p, s);
console.log('CARD ADDED');