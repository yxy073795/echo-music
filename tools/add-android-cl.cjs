const fs = require('fs');
const p = 'D:/LetsView/EchoWeb/index.html';
let s = fs.readFileSync(p, 'utf8');
// 在 changelog 列表开头加安卓条目
const anchor = '<div class="cl-item"><span class="cl-dot"></span><div><b>iOS 26 液态玻璃界面</b>';
if (s.indexOf(anchor) < 0) { console.log('CHANGELOG ANCHOR NOT FOUND'); process.exit(1); }
if (s.indexOf('安卓版') >= 0) { console.log('ALREADY'); process.exit(0); }
const item = '<div class="cl-item"><span class="cl-dot"></span><div><b>安卓版上线</b><p>首个 Android APK 已发布，手机上直接安装即可使用（测试版）。</p></div></div>\n        ';
s = s.replace(anchor, item + anchor);
fs.writeFileSync(p, s);
console.log('CHANGELOG UPDATED');