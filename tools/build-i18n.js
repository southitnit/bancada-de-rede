// Gera public/i18n.js a partir de i18n/en.json + i18n/runtime.js (rode: node tools/build-i18n.js)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const d = Object.assign(JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'i18n/en-extra.json'), 'utf8')));
// frases de várias linhas: cada linha também vira entrada (o terminal mostra linha a linha)
for (const [k, v] of Object.entries({ ...d })) { if (!k.includes('\n')) continue; const a = k.split('\n'), b = v.split('\n'); if (a.length !== b.length) continue; a.forEach((x, i) => { const t = x.trim(); if (t.length >= 3 && !(t in d) && t !== b[i].trim()) d[t] = b[i].trim(); }); }
const js = '/* gerado de i18n/en.json — não edite à mão (node tools/build-i18n.js) */\nwindow.I18N_EN=' + JSON.stringify(d) + ';\n' + fs.readFileSync(path.join(root, 'i18n/runtime.js'), 'utf8');
fs.writeFileSync(path.join(root, 'public/i18n.js'), js);
console.log('i18n.js:', Object.keys(d).length, 'frases');
