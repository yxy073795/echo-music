const fs = require('fs');
const p = 'D:/LetsView/EchoWeb/index.html';
let s = fs.readFileSync(p, 'utf8');
// 保留我的版本(======= 之后到 >>>>>>> 之间)，删除 HEAD 部分和冲突标记
const start = s.indexOf('<<<<<<< HEAD');
const eq = s.indexOf('=======', start);
const end = s.indexOf('>>>>>>>', eq);
if (start < 0 || eq < 0 || end < 0) { console.log('MARKERS NOT FOUND'); process.exit(1); }
// 保留 ======= 到 >>>>>>> 之间的内容（我的新版本）
const keep = s.slice(eq + '======='.length, end);
s = s.slice(0, start) + keep + s.slice(end + '>>>>>>>'.length);
fs.writeFileSync(p, s);
console.log('RESOLVED index.html, kept v0.2.3');