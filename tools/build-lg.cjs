const fs = require('fs');
const html = fs.readFileSync('D:/LetsView/EchoWeb/liquidglass/ui-html.txt', 'utf8');
const shaders = fs.readFileSync('D:/LetsView/EchoWeb/liquidglass/shaders.txt', 'utf8');
const mainJs = fs.readFileSync('D:/LetsView/EchoWeb/liquidglass/main-js.txt', 'utf8');
const parts = shaders.split('@@@');
// parts[0]=FRAG@@@..., parts[1]=frag, parts[2]=@@@BG@@@..., 实际结构：
// "FRAG@@@" + frag + "\n@@@BG@@@" + bgFrag + "\n@@@VERT@@@" + vert
const fragIdx = shaders.indexOf('FRAG@@@') + 7;
const bgIdx = shaders.indexOf('@@@BG@@@') + 7;
const vIdx = shaders.indexOf('@@@VERT@@@') + 9;
const frag = shaders.slice(fragIdx, shaders.indexOf('@@@BG@@@')).trim();
const bg = shaders.slice(bgIdx, shaders.indexOf('@@@VERT@@@')).trim();
const vert = shaders.slice(vIdx).trim();
// 注入 shader 到 mainJs（用 JSON.stringify 安全转义）
let js = mainJs.replace('__FRAG__', JSON.stringify(frag)).replace('__BG__', JSON.stringify(bg));
// 组装完整 HTML
const full = html + js + '\n</script>\n</body>\n</html>';
fs.writeFileSync('D:/LetsView/EchoWeb/liquidglass/index.html', full);
console.log('final len:', full.length, 'frag:', frag.length, 'bg:', bg.length);