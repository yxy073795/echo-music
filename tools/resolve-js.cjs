const fs = require('fs');
const p = 'D:/LetsView/EchoWeb/js/main.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('<<<<<<< HEAD');
const eq = s.indexOf('=======', start);
const end = s.indexOf('>>>>>>>', eq);
if (start < 0 || eq < 0 || end < 0) { console.log('MARKERS NOT FOUND'); process.exit(1); }
const keep = s.slice(eq + '======='.length, end);
s = s.slice(0, start) + keep + s.slice(end + '>>>>>>>'.length);
fs.writeFileSync(p, s);
console.log('RESOLVED main.js');