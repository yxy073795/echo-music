const fs = require('fs');
// 清理 index.html 和 main.js 中的冲突残留行
const files = ['D:/LetsView/EchoWeb/index.html', 'D:/LetsView/EchoWeb/js/main.js'];
const pat = /^\s*95a96ce \(v0\.2\.3:.*\)\s*$/m;
for (const p of files) {
  let s = fs.readFileSync(p, 'utf8');
  const before = s.length;
  s = s.replace(pat, '');
  fs.writeFileSync(p, s);
  console.log(p + ': removed ' + (before - s.length) + ' chars');
}