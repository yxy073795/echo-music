const fs = require('fs');
const p = 'D:/LetsView/EchoWeb/web/index.html';
let s = fs.readFileSync(p, 'utf8');
let count = 0;
while (true) {
  const start = s.indexOf('<<<<<<< HEAD');
  if (start < 0) break;
  const eq = s.indexOf('=======', start);
  const end = s.indexOf('>>>>>>>', eq);
  if (eq < 0 || end < 0) { console.log('BAD MARKERS at ' + start); process.exit(1); }
  const keep = s.slice(eq + '======='.length, end);
  s = s.slice(0, start) + keep + s.slice(end + '>>>>>>>'.length);
  count++;
}
fs.writeFileSync(p, s);
console.log('RESOLVED ' + count + ' conflicts in web/index.html');