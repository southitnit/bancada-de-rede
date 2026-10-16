/* Bancada de Rede — interface (canvas, consoles, inspetor, biblioteca de labs). */
(function () {
'use strict';
const E = window.Engine;
const { TYPES, VENDORS, VN, isSw, isHost, fwd, pc, ip2i, i2ip, netStr, cidrStr, allAllowed, spn, linkAt, l3ifs, CAT, modelOf, isMgmt, isInternal } = E;
const vOf = d => isHost(d.type) ? 'linux' : UI.vendor === 'auto' ? E.osOf(d) : UI.vendor;
const dev = id => E.dev(id), byName = n => E.byName(n);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  min: '<svg viewBox="0 0 24 24"><path d="M6 17h12"/></svg>',
  term: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 10 3 2-3 2M12 15h5"/></svg>'
};

/* ---------- estado ---------- */
let S = null;
const UI = { sel: null, tool: 'select', linkFrom: null, vendor: 'cisco', tab: 'geral', drawer: 'sim', drawerOpen: true, insp: true, open: new Set(), hl: { f: [], r: [] },
  simRes: null, guideMin: false, clickConsole: true, theme: 'system', view: { cx: 600, cy: 420, k: 1 },
  view2: 'topo', showMg: true, pf: 'used', pq: '', catOpen: new Set(['dc']) };
const CUR = { id: null, dirty: false, savedAt: null, saving: false };
const undo = [], redo = []; let lastSnap = null;
const PKEY = 'bancada-prefs-v4', DKEY = 'bancada-draft-v2', LKEY = 'bancada-labs-v2';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
function savePrefs() { lsSet(PKEY, { vendor: UI.vendor, theme: UI.theme, clickConsole: UI.clickConsole, insp: UI.insp, drawerOpen: UI.drawerOpen, showMg: UI.showMg, pf: UI.pf, catOpen: [...UI.catOpen] }); }
function saveDraft() { lsSet(DKEY, { S, cur: { id: CUR.id, dirty: CUR.dirty } }); }
function setS(s) { S = s; E.use(S); }

/* ---------- armazenamento: servidor ou navegador ---------- */
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
const Store = {
  mode: 'local', info: null,
  async init() {
    try { const r = await fetch('api/health', { cache: 'no-store' }); const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('json')) { const j = await r.json(); if (j && j.ok) { this.mode = 'server'; this.info = j; } } } catch (_) {}
    if (this.mode === 'server') { try { UI.net = await API('api/net/status'); } catch (_) { UI.net = null; } }
  },
  async req(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status)); return j;
  },
  lall() { return lsGet(LKEY, {}) || {}; },
  async list() { if (this.mode === 'server') return (await this.req('GET', 'api/labs')).labs; return Object.values(this.lall()).map(x => x.meta).sort((a, b) => b.updated.localeCompare(a.updated)); },
  async get(id) { if (this.mode === 'server') return this.req('GET', 'api/labs/' + id); const x = this.lall()[id]; if (!x) throw new Error('lab não encontrado'); return { meta: x.meta, topology: JSON.parse(JSON.stringify(x.topology)) }; },
  async save(id, name, topology) {
    if (this.mode === 'server') { const configs = buildConfigs(topology); return id ? this.req('PUT', 'api/labs/' + id, { name, topology, configs }) : this.req('POST', 'api/labs', { name, topology, configs }); }
    const err = E.validate(topology); if (err) throw new Error(err);
    const all = this.lall(), now = new Date().toISOString(), nid = id || rid(), prev = all[nid];
    topology.name = name;
    const meta = { id: nid, name, created: prev ? prev.meta.created : now, updated: now, devices: topology.devices.length, links: topology.links.length };
    all[nid] = { meta, topology }; if (!lsSet(LKEY, all)) throw new Error('o navegador recusou o armazenamento (cheio ou bloqueado)'); return meta;
  },
  async remove(id) { if (this.mode === 'server') return this.req('DELETE', 'api/labs/' + id); const all = this.lall(); delete all[id]; lsSet(LKEY, all); }
};

/* configs dos 7 sistemas para gravar junto do lab no servidor */
function buildConfigs(topo) {
  const out = {}; const keep = S; E.use(topo);
  try { topo.devices.forEach(d => { const n = E.safeName(d.name);
    if (d.type === 'chassis') out[`chassis/${n}.txt`] = E.gen('auto', d);
    else if (isHost(d.type)) out[`hosts/${n}.${d.os ? (E.isWin(d) ? 'ps1' : 'sh') : 'txt'}`] = E.gen('linux', d);
    else if (d.type === 'cloud') out[`nuvens/${n}.txt`] = E.gen('auto', d);
    else VENDORS.forEach(([v]) => { out[`${v}/${n}.txt`] = E.gen(v, d); }); }); }
  finally { E.use(keep); }
  return out;
}

/* ---------- utilidades de UI ---------- */
let toastT;
function toast(m, k) { const t = $('#toast'); t.textContent = m; t.className = 'toast' + (k ? ' ' + k : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }
async function download(filename, data, mime) {
  if (window.claude && window.claude.use) {
    try { const d = await window.claude.use('downloads'); if (d) { await d.save({ filename, data }); toast(`${filename} pronto.`); return true; } }
    catch (e) { if (e && e.code === 'declined') { toast('Download cancelado.'); return false; } if (e && e.code === 'rate_limited') { toast('Já existe um download aguardando confirmação.'); return false; } }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); toast(`${filename} baixado.`); return true;
}
const slug = s => String(s || 'lab').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'lab';
const fname = d => `${E.safeName(d.name)}_${isHost(d.type) ? 'host' : d.type === 'chassis' ? 'chassis' : d.type === 'cloud' ? 'nuvem' : vOf(d)}.${isHost(d.type) && d.os ? (E.isWin(d) ? 'ps1' : 'sh') : 'txt'}`;
const vkey = v => String(v || '').toLowerCase().split(/\s+/)[0];
function vc(id) { id = +id; if (id === 1) return 'var(--v0)'; const m = id % 60 === 0 ? 6 : Math.ceil((id % 60) / 10); return `var(--v${((m - 1) % 6) + 1})`; }
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
const ipCls = (v, req) => (v && !pc(v)) || (req && !v) ? ' bad' : '';
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

/* ---------- histórico ---------- */
function commit() { if (lastSnap) undo.push(lastSnap); if (undo.length > 80) undo.shift(); redo.length = 0; lastSnap = JSON.stringify(S); CUR.dirty = true; saveDraft(); renderAll(); bridgeSync(); }
function restore(snap) { setS(JSON.parse(snap)); lastSnap = snap; CUR.dirty = true;
  if (UI.sel && !(UI.sel.kind === 'dev' ? dev(UI.sel.id) : S.links.find(l => l.id === UI.sel.id))) UI.sel = null; saveDraft(); renderAll(); }
function doUndo() { if (!undo.length) return toast('Nada para desfazer.'); redo.push(lastSnap); restore(undo.pop()); }
function doRedo() { if (!redo.length) return toast('Nada para refazer.'); undo.push(lastSnap); restore(redo.pop()); }
function loadState(topo, o = {}) { setTimeout(bridgeSync, 0);
  closeAllTerms(); E.cliReset(); setS(topo); CUR.id = o.id || null; CUR.dirty = !!o.dirty; CUR.savedAt = o.savedAt || null;
  UI.sel = null; UI.hl = { f: [], r: [] }; UI.simRes = null; UI.linkFrom = null; UI.open.clear();
  undo.length = 0; redo.length = 0; lastSnap = JSON.stringify(S); saveDraft(); renderAll(); fit();
}

/* ---------- glifos ---------- */
function glyph(t) { switch (t) {
  case 'sw2': case 'sw3': { let s = '<rect x="-32" y="-14" width="64" height="28" rx="4" class="gb"/>'; for (let i = 0; i < 8; i++) s += `<rect x="${-27 + i * 7}" y="1" width="5" height="6" rx="1" class="gp"/>`;
    s += '<path d="M-24 -6 h14 m-4 -3 l4 3 l-4 3 M24 -6 h-14 m4 -3 l-4 3 l4 3" class="ga"/>';
    if (t === 'sw3') s += '<rect x="16" y="-25" width="20" height="13" rx="2" class="gbadge"/><text x="26" y="-15.5" text-anchor="middle" class="gbt">L3</text>'; return s; }
  case 'rtr': return '<path d="M-28 -5 v11 a28 10 0 0 0 56 0 v-11" class="gb"/><ellipse cx="0" cy="-5" rx="28" ry="10" class="gt"/><path d="M-13 -5 h26 M-9 -8 l-4 3 l4 3 M9 -8 l4 3 l-4 3 M0 -12 v14" class="ga"/>';
  case 'fw': return '<rect x="-30" y="-17" width="60" height="34" rx="2" class="gb"/><path d="M-30 -6 h60 M-30 5 h60 M-12 -17 v11 M10 -17 v11 M-2 -6 v11 M20 -6 v11 M-20 -6 v11 M-12 5 v12 M10 5 v12" class="gl"/>';
  case 'pc': return '<rect x="-21" y="-19" width="42" height="28" rx="3" class="gb"/><rect x="-16" y="-14" width="32" height="18" rx="1" class="gt"/><path d="M-6 9 l-3 8 h18 l-3 -8" class="gl"/>';
  case 'srv': return '<rect x="-17" y="-23" width="34" height="46" rx="3" class="gb"/><path d="M-11 -12 h22 M-11 -4 h22 M-11 4 h22" class="gl"/><circle cx="9" cy="14" r="2.5" class="gbadge"/>';
  case 'cloud': return '<path d="M-22 14 h44 a12 12 0 0 0 1 -24 a17 17 0 0 0 -32 -5 a12 12 0 0 0 -13 29 z" class="gb"/><path d="M-14 4 h28 M-10 -3 h20" class="gl"/>';
} return ''; }
function glyphOf(d) { const m = modelOf(d); const f = m && m.form;
  if (f === 'rack') { const h = m.u > 1 ? 30 : 20, y = -h / 2 - 4; let s = `<rect x="-36" y="${y}" width="72" height="${h}" rx="2.5" class="gb"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="${-31 + i * 8}" y="${y + 4}" width="6" height="${h - 8}" rx="1" class="gt"/>`;
    s += `<rect x="18" y="${y + 4}" width="14" height="${Math.min(8, h - 8)}" rx="1" class="gbadge"/>`; return s; }
  if (f === 'blade') return '<rect x="-11" y="-26" width="22" height="50" rx="2" class="gb"/><path d="M-6 -19 h12 M-6 -13 h12 M-6 -7 h12" class="gl"/><circle cx="0" cy="15" r="2.5" class="gbadge"/>';
  if (f === 'iom') { let s = '<rect x="-30" y="-11" width="60" height="22" rx="3" class="gb"/>'; for (let i = 0; i < 6; i++) s += `<rect x="${-25 + i * 8.5}" y="-3" width="6" height="6" rx="1" class="gp"/>`; return s + `<rect x="14" y="-21" width="22" height="11" rx="2" class="gbadge"/><text x="25" y="-12.6" text-anchor="middle" class="gbt">${m.id === 'k8s-fabric' ? 'K8S' : 'IOM'}</text>`; }
  if (d.type === 'cloud') return glyph('cloud') + `<rect x="-17" y="-29" width="34" height="11" rx="2" class="gbadge"/><text x="0" y="-20.6" text-anchor="middle" class="gbt">${E.cloudKind(d) === 'real' ? 'REAL' : 'FAKE'}</text>`;
  return glyph(d.type); }
const nodeIf = d => { const a = l3ifs(d); return a.find(f => !f.mgmt) || a[0]; };
function frameOf(ch) { const ms = E.membersOf(ch); if (!ms.length) return { x0: ch.x, y0: ch.y, x1: ch.x + 220, y1: ch.y + 120 };
  const xs = ms.map(d => d.x), ys = ms.map(d => d.y); return { x0: Math.min(...xs) - 64, y0: Math.min(...ys) - 70, x1: Math.max(...xs) + 64, y1: Math.max(...ys) + 84 }; }

/* ---------- vista (zoom e pan) ---------- */
const cv = () => $('#cv');
function applyView() { const r = cv().getBoundingClientRect(); if (!r.width) return; const v = UI.view, w = r.width / v.k, h = r.height / v.k;
  cv().setAttribute('viewBox', `${v.cx - w / 2} ${v.cy - h / 2} ${w} ${h}`); $('#zVal').textContent = Math.round(v.k * 100) + '%'; }
function fit() { const r = cv().getBoundingClientRect(); if (!r.width) return;
  if (!S.devices.length) { UI.view = { cx: 600, cy: 400, k: 1 }; return applyView(); }
  const ds = S.devices.filter(d => d.type !== 'chassis'); if (!ds.length) { UI.view = { cx: 600, cy: 400, k: 1 }; return applyView(); }
  const xs = ds.map(d => d.x), ys = ds.map(d => d.y);
  const x0 = Math.min(...xs) - 90, x1 = Math.max(...xs) + 90, y0 = Math.min(...ys) - 110, y1 = Math.max(...ys) + 100;
  const k = Math.max(.25, Math.min(1.3, r.width / (x1 - x0), r.height / (y1 - y0)));
  UI.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k }; applyView(); }
function zoomAt(f, clientX, clientY) { const r = cv().getBoundingClientRect(); const v = UI.view;
  if (clientX === undefined) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
  const ox = clientX - r.left - r.width / 2, oy = clientY - r.top - r.height / 2;
  const wx = v.cx + ox / v.k, wy = v.cy + oy / v.k; const k = Math.max(.2, Math.min(3, v.k * f));
  UI.view = { cx: wx - ox / k, cy: wy - oy / k, k }; applyView(); }
function toWorld(e) { const el = cv(); const pt = el.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(el.getScreenCTM().inverse()); }

/* ---------- canvas ---------- */
function linkStyle(l) { const A = dev(l.a.dev), B = dev(l.b.dev), pa = A.ports[l.a.k], pb = B.ports[l.b.k];
  const ends = [[A, pa], [B, pb]]; if (ends.some(([d, p]) => isSw(d.type) && p.mode === 'trunk')) return 'trunk';
  const acc = ends.filter(([d, p]) => isSw(d.type) && p.mode === 'access'); if (acc.length) return 'v' + acc[0][1].vlan; return 'routed'; }
function lkKind(l, A, B) { if (l.internal) return 'internal'; if (isMgmt(A, l.a.k) || isMgmt(B, l.b.k)) return 'mgmt'; return ''; }
function renderCanvas() {
  if (UI.view2 === 'rack') renderRacks();
  let fr = ''; S.devices.filter(d => d.type === 'chassis').forEach(ch => { const b = frameOf(ch), m = modelOf(ch), on = UI.sel && UI.sel.kind === 'dev' && UI.sel.id === ch.id;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    fr += `<g data-frame="${ch.id}"><rect class="frame${on ? ' on' : ''}" x="${b.x0}" y="${b.y0}" width="${w}" height="${h}" rx="8"/><rect class="fhead" x="${b.x0}" y="${b.y0}" width="${w}" height="24" rx="6"/>`
      + `<text class="fhead-t" x="${b.x0 + 10}" y="${b.y0 + 16.5}">${esc(ch.name)}</text><text class="fhead-s" x="${b.x1 - 10}" y="${b.y0 + 16}" text-anchor="end">${esc(m ? m.vendor + ' ' + m.name : '')}</text></g>`; });
  $('#gFrames').innerHTML = fr;
  let h = '';
  S.links.forEach(l => { const A = dev(l.a.dev), B = dev(l.b.dev); if (!A || !B) return; const kind = lkKind(l, A, B); if (kind === 'mgmt' && !UI.showMg) return;
    const on = UI.sel && UI.sel.kind === 'link' && UI.sel.id === l.id;
    const down = A.ports[l.a.k].shut || B.ports[l.b.k].shut;
    const c = `x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"`; let base;
    if (kind === 'internal') base = `<line ${c} stroke="var(--dev-stroke)" stroke-width="1.1" opacity=".45" class="base"/>`;
    else if (kind === 'mgmt') base = `<line ${c} stroke="var(--muted)" stroke-width="1.3" stroke-dasharray="5 4" opacity=".75" class="base"/>`;
    else { const st = linkStyle(l);
      if (st === 'trunk') base = `<line ${c} stroke="var(--ink)" stroke-width="6" class="base"/><line ${c} stroke="var(--canvas)" stroke-width="2" stroke-dasharray="7 5"/>`;
      else if (st === 'routed') base = `<line ${c} stroke="var(--muted)" stroke-width="2.5" class="base"/>`;
      else base = `<line ${c} stroke="${vc(st.slice(1))}" stroke-width="3.5" class="base"/>`; }
    if (down) base += `<line ${c} stroke="var(--bad)" stroke-width="2" stroke-dasharray="2 6"/>`;
    const lab = (P, Q, d, k) => { const t = .27, x = P.x + (Q.x - P.x) * t, y = P.y + (Q.y - P.y) * t; return `<text class="plab" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${esc(spn(d, k))}</text>`; };
    const la = +A.ports[l.a.k].lag, lb = +B.ports[l.b.k].lag;
    const lagT = kind || !(la || lb) ? '' : `<text class="lagtag" x="${((A.x + B.x) / 2).toFixed(1)}" y="${((A.y + B.y) / 2 - 5).toFixed(1)}">${esc([la ? E.lagShort(A, la) : '', lb ? E.lagShort(B, lb) : ''].filter(Boolean).join(' ⇄ '))}</text>`;
    h += `<g class="lk${on ? ' on' : ''}" data-link="${l.id}"><line ${c} class="hit"/>${base}${kind === 'internal' ? '' : (kind === 'mgmt' && !on ? '' : lab(A, B, A, l.a.k) + lab(B, A, B, l.b.k))}${lagT}</g>`; });
  $('#gLinks').innerHTML = h;
  let p = ''; const seg = (ids, cls) => ids.forEach(id => { const l = S.links.find(x => x.id === id); if (!l) return; const A = dev(l.a.dev), B = dev(l.b.dev); if (A && B) p += `<line class="path ${cls}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`; });
  seg(UI.hl.f, ''); seg(UI.hl.r, 'rev'); $('#gPath').innerHTML = p;
  let n = ''; S.devices.forEach(d => { if (d.type === 'chassis') return; const sel = UI.sel && UI.sel.kind === 'dev' && UI.sel.id === d.id, from = UI.linkFrom === d.id; const f = nodeIf(d), m = modelOf(d);
    const up = d.ports.some((pp, k) => !pp.shut && linkAt(d.id, k) && !isInternal(d, k)) || d.ports.some((pp, k) => !pp.shut && linkAt(d.id, k));
    const form = m && m.form; const ty = form === 'blade' ? 40 : isHost(d.type) ? 40 : 36; const hh = 72 + ((m && !d.parent) || d.bgp || d.os || d.type === 'cloud' ? 12 : 0) + (f ? 13 : 0);
    const led = form === 'rack' ? [34, -18] : form === 'blade' ? [13, -24] : isHost(d.type) ? [20, -20] : [31, -15];
    n += `<g class="node" data-node="${d.id}" transform="translate(${d.x},${d.y})"><rect class="hov" x="-46" y="-32" width="92" height="${hh}" rx="8"/>`
      + `${sel ? `<rect x="-46" y="-32" width="92" height="${hh}" rx="8" class="sel"/>` : ''}${from ? `<rect x="-46" y="-32" width="92" height="${hh}" rx="8" class="from"/>` : ''}`
      + `${glyphOf(d)}<circle class="led" cx="${led[0]}" cy="${led[1]}" r="4" fill="${up ? 'var(--good)' : 'var(--v0)'}"/>`
      + `<text class="nm" y="${ty}">${esc(d.name)}</text>${(m && !d.parent) || d.bgp || d.vxlan || d.os || d.type === 'cloud' || (d.vpns || []).length ? `<text class="md" y="${ty + 12}">${esc([m && !d.parent && d.type !== 'cloud' ? m.vendor + ' ' + m.name : '', d.type === 'cloud' ? osLabel(d) : '', d.os && !d.k8sRole ? osShort(d) : '', d.k8sRole ? d.k8sRole : '', d.bgp && d.bgp.asn ? 'AS ' + d.bgp.asn : '', d.vxlan ? 'VTEP' : '', (d.ports || []).some(p => p.mpls) ? 'MPLS' : '', (d.vpns || []).length ? 'VPN' : '', d.ctOn ? 'container' : ''].filter(Boolean).join(' · '))}</text>` : ''}${f ? `<text class="ip" y="${ty + ((m && !d.parent) || d.bgp || d.os || d.type === 'cloud' || (d.vpns || []).length ? 25 : 13)}">${esc(cidrStr(f.c))}</text>` : ''}</g>`; });
  $('#gNodes').innerHTML = n;
  $('#empty').hidden = S.devices.length > 0 || UI.view2 === 'rack';
  const hint = $('#hint'); if (UI.tool === 'link' && UI.view2 !== 'rack') { hint.hidden = false; hint.textContent = UI.linkFrom ? `Clique no segundo equipamento para ligar a ${dev(UI.linkFrom)?.name}. Esc cancela.` : 'Modo conectar: clique no primeiro equipamento.'; } else hint.hidden = true;
  $('#tSel').setAttribute('aria-pressed', String(UI.tool === 'select')); $('#tLink').setAttribute('aria-pressed', String(UI.tool === 'link'));
  $('#tCon').setAttribute('aria-pressed', String(UI.clickConsole)); $('#tMg').setAttribute('aria-pressed', String(UI.showMg));
  $('#vTopo').setAttribute('aria-pressed', String(UI.view2 !== 'rack')); $('#vRack').setAttribute('aria-pressed', String(UI.view2 === 'rack'));
}

/* ---------- elevação dos racks ---------- */
const RU = 18;
function rackCls(d) { return 'k-' + (d.type === 'chassis' ? 'chassis' : isSw(d.type) ? 'sw' : d.type === 'rtr' ? 'rtr' : d.type === 'fw' ? 'fw' : 'srv') + (E.unitsOf(d) === 1 ? ' u1' : ''); }
function renderRacks() {
  const el = $('#rackView'), on = UI.view2 === 'rack'; el.hidden = !on; cv().style.visibility = on ? 'hidden' : ''; if (!on) return;
  const racks = S.racks || []; const unr = S.devices.filter(d => E.unitsOf(d) > 0 && !racks.some(r => r.id === d.rack));
  let h = `<div class="unracked" data-drop="out"><h4>Fora do rack</h4><p class="note">Arraste para uma posição de U.</p>${unr.map(d => `<div class="rchip" draggable="true" data-rdev="${d.id}" title="${esc((modelOf(d) ? modelOf(d).vendor + ' ' + modelOf(d).name : TYPES[d.type].label))}"><span>${esc(d.name)}</span><small>${E.unitsOf(d)}U</small></div>`).join('') || '<p class="note">Todos os equipamentos estão instalados.</p>'}</div>`;
  racks.forEach(r => { const w = E.rackPower(r), pct = w / (r.kw * 1000), sel = UI.sel && UI.sel.kind === 'rack' && UI.sel.id === r.id;
    const used = S.devices.filter(d => d.rack === r.id).reduce((a, d) => a + E.unitsOf(d), 0);
    let rows = ''; for (let u = r.u; u >= 1; u--) rows += `<div class="ru" data-drop="${r.id}" data-u="${u}">${u}</div>`;
    const ds = S.devices.filter(d => d.rack === r.id && E.unitsOf(d) > 0).map(d => { const u = E.unitsOf(d), top = (r.u - (d.ru + u - 1)) * RU, m = modelOf(d);
      const on2 = UI.sel && UI.sel.kind === 'dev' && UI.sel.id === d.id;
      return `<div class="rdev ${rackCls(d)}${on2 ? ' on' : ''}" draggable="true" data-rdev="${d.id}" style="top:${top + 1}px;height:${u * RU - 2}px" title="${esc(d.name)} · U${d.ru}${u > 1 ? '–' + (d.ru + u - 1) : ''}"><b>${esc(d.name)}</b><small>${esc(m ? m.vendor + ' ' + m.name : TYPES[d.type].label)}</small></div>`; }).join('');
    h += `<div class="rack"><div class="rh${sel ? ' on' : ''}" data-rack="${r.id}"><h4>${esc(r.name)}</h4><small>${used}/${r.u}U · ${(w / 1000).toFixed(2)}/${r.kw} kW</small></div>
      <div class="pbar${pct > 1 ? ' over' : pct > .8 ? ' hot' : ''}" title="Consumo estimado"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div>
      <div class="rbody">${rows}${ds}</div></div>`; });
  h += `<button class="radd" data-ract="add">+ Adicionar rack</button>`;
  el.innerHTML = h;
}
function wireRacks() {
  const el = $('#rackView'); let over = null;
  const clr = () => { if (over) over.classList.remove('over'); over = null; };
  el.addEventListener('dragstart', e => { const t = e.target.closest('[data-rdev]'); if (t) { e.dataTransfer.setData('text/plain', 'rdev:' + t.dataset.rdev); e.dataTransfer.effectAllowed = 'move'; } });
  el.addEventListener('dragover', e => { const t = e.target.closest('.ru,[data-drop="out"]') || (e.target.closest('.rdev') ? null : null); if (!t) return; e.preventDefault(); if (over !== t) { clr(); over = t; t.classList.add('over'); } });
  el.addEventListener('dragleave', e => { if (over && !over.contains(e.relatedTarget)) clr(); });
  el.addEventListener('drop', e => { const t = e.target.closest('.ru,[data-drop="out"]'); clr(); if (!t) return; e.preventDefault();
    const data = e.dataTransfer.getData('text/plain') || ''; let d = null;
    if (data.startsWith('rdev:')) d = dev(data.slice(5));
    else if (data.startsWith('model:')) { d = addModel(data.slice(6), undefined, undefined, true); }
    else if (TYPES[data] && data !== 'chassis') { d = E.mkDev(data, E.uniqName(data), Math.round(UI.view.cx), Math.round(UI.view.cy)); }
    if (!d) return;
    if (t.dataset.drop === 'out') { delete d.rack; delete d.ru; UI.sel = { kind: 'dev', id: d.id }; commit(); return; }
    const r = (S.racks || []).find(x => x.id === t.dataset.drop); if (!r) return; const u = E.unitsOf(d);
    if (!u) { toast('Este equipamento não ocupa espaço de rack.', 'bad'); if (data.startsWith('model:') || TYPES[data]) commit(); return; }
    const prev = { rack: d.rack, ru: d.ru }; const err = E.rackPlace(d, r, Math.max(1, +t.dataset.u - u + 1));
    if (err) { d.rack = prev.rack; d.ru = prev.ru; toast(err, 'bad'); if (data.startsWith('model:') || TYPES[data]) commit(); else renderRacks(); return; }
    UI.sel = { kind: 'dev', id: d.id }; commit(); toast(`${d.name} em ${r.name}, U${d.ru}${u > 1 ? '–' + (d.ru + u - 1) : ''}.`); });
  el.addEventListener('click', e => { const a = e.target.closest('[data-ract]'); if (a) { const r = E.addRack(); UI.sel = { kind: 'rack', id: r.id }; commit(); return; }
    const rh = e.target.closest('[data-rack]'); if (rh) { select({ kind: 'rack', id: rh.dataset.rack }); renderRacks(); return; }
    const t = e.target.closest('[data-rdev]'); if (t) { select({ kind: 'dev', id: t.dataset.rdev }); renderRacks(); } });
  el.addEventListener('dblclick', e => { const t = e.target.closest('[data-rdev]'); if (t && dev(t.dataset.rdev).type !== 'chassis') openTerm(t.dataset.rdev); });
}
function setView2(v) { UI.view2 = v; if (v === 'rack') UI.linkFrom = null; renderCanvas(); if (v !== 'rack') { $('#rackView').hidden = true; cv().style.visibility = ''; applyView(); } }

/* ---------- consoles ---------- */
const TERMS = new Map(); let zTop = 10, focused = null;
function openTerm(id, focus = true) {
  const d = dev(id); if (!d) return; let t = TERMS.get(id);
  if (!t) {
    const el = document.createElement('div'); el.className = 'tw'; el.dataset.term = id;
    el.innerHTML = `<div class="tw-head"><span class="dot"></span><b></b><small></small><button data-ta="min" title="Minimizar" aria-label="Minimizar">${ICON.min}</button><button data-ta="close" title="Fechar" aria-label="Fechar console">${ICON.x}</button></div>`
      + `<div class="tw-out" aria-live="polite"></div><div class="tw-in"><span></span><input autocomplete="off" spellcheck="false" autocapitalize="off" aria-label="Comando para ${esc(d.name)}"></div>`;
    const layer = $('#terms'), lw = layer.clientWidth, lh = layer.clientHeight, n = [...TERMS.values()].filter(x => !x.el.hidden).length;
    const w = Math.min(580, lw - 20), h = Math.min(360, lh - 20);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.left = Math.max(10, lw - w - 14 - n * 26) + 'px'; el.style.top = Math.max(10, Math.min(lh - h - 10, 52 + n * 26)) + 'px';
    layer.appendChild(el); t = { el }; TERMS.set(id, t); wireTerm(id, t);
    const st = E.cs(id); if (!st.log.length) E.banner(d).forEach(s => st.log.push({ t: 'dim', s }));
  }
  t.el.hidden = false; renderTerm(id); if (focus) focusTerm(id); renderDock();
}
function focusTerm(id) { const t = TERMS.get(id); if (!t) return; focused = id; t.el.style.zIndex = ++zTop;
  TERMS.forEach((x, k) => x.el.classList.toggle('focus', k === id)); const inp = t.el.querySelector('input'); try { inp.focus({ preventScroll: true }); } catch (_) { inp.focus(); } }
function closeTerm(id) { const t = TERMS.get(id); if (!t) return; t.el.remove(); TERMS.delete(id); if (focused === id) focused = null; renderDock(); }
function closeAllTerms() { [...TERMS.keys()].forEach(closeTerm); }
function renderTerm(id) {
  const t = TERMS.get(id), d = dev(id); if (!t) return; if (!d) return closeTerm(id);
  const st = E.cs(id); if (st.log.length > 2000) st.log.splice(0, st.log.length - 2000);
  t.el.querySelector('.tw-head b').textContent = d.name;
  const mm = modelOf(d); t.el.querySelector('.tw-head small').textContent = `${mm && !d.parent && d.type !== 'cloud' ? mm.vendor + ' ' + mm.name + ' · ' : ''}${osLabel(d)}${d.ctOn ? ' (container real)' : ''}${t.busy ? ' · executando…' : ''}`;
  t.el.querySelector('.tw-head .dot').style.background = d.ports.some((p, k) => !p.shut && linkAt(d.id, k)) ? 'var(--term-ok)' : 'var(--term-dim)';
  const out = t.el.querySelector('.tw-out');
  out.innerHTML = st.log.map(l => `<div class="${l.t === 'in' ? 'in' : l.t === 'dim' ? 'dim' : l.t === 'err' ? 'err' : l.t === 'ok' ? 'ok' : ''}">${esc(l.s) || '&nbsp;'}</div>`).join('');
  t.el.querySelector('.tw-in span').textContent = E.promptOf(d, st); out.scrollTop = out.scrollHeight;
}
function renderDock() { const hid = [...TERMS.entries()].filter(([, t]) => t.el.hidden);
  $('#tdock').innerHTML = hid.map(([id]) => `<button data-dock="${id}" title="Restaurar console">▸ ${esc(dev(id)?.name || '?')}</button>`).join(''); }
function syncTerms() { [...TERMS.keys()].forEach(id => renderTerm(id)); renderDock(); }
function runCli(id, line) { return runCliLines(id, [line]); }
function runCliLines(id, lines) {
  const d = dev(id); if (!d) return; let changed = false, sim = null, res;
  const ctx = netCtx({ vendor: UI.vendor, onChange: () => { changed = true; }, onSim: r => { sim = r; }, onSave: () => { saveLab({ silentPrompt: true }); } });
  const after = () => { if (sim) { UI.simRes = sim; UI.hl = { f: sim.f, r: sim.r }; } if (changed) commit(); else if (sim) { renderCanvas(); renderSimOut(); renderGuide(); } renderTerm(id); };
  let i = 0; const t = TERMS.get(id);
  const step = () => { while (i < lines.length) { const cur = dev(id); if (!cur) break; res = E.cliRun(cur, lines[i++], ctx) || {};
      if (res.edit) { after(); setTimeout(() => openEditor(res.edit), 0); }
      if (res.async) { if (t) { t.busy = true; t.el.classList.add('busy'); } renderTerm(id);
        return res.async.catch(e => { E.cs(id).log.push({ t: 'err', s: String((e && e.message) || e) }); }).then(() => { if (t) { t.busy = false; t.el.classList.remove('busy'); } after(); return step(); }); } }
    after(); return res; };
  return step();
}
function wireTerm(id, t) {
  const el = t.el, inp = el.querySelector('input'), head = el.querySelector('.tw-head'), out = el.querySelector('.tw-out');
  el.addEventListener('pointerdown', () => { if (focused !== id) { focused = id; el.style.zIndex = ++zTop; TERMS.forEach((x, k) => x.el.classList.toggle('focus', k === id)); } });
  out.addEventListener('mouseup', () => { const s = getSelection(); if (!s || s.isCollapsed) inp.focus({ preventScroll: true }); });
  head.addEventListener('click', e => { const b = e.target.closest('[data-ta]'); if (!b) return; if (b.dataset.ta === 'close') closeTerm(id); else { el.hidden = true; renderDock(); } });
  let mv = null;
  head.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const layer = $('#terms').getBoundingClientRect(); mv = { sx: e.clientX, sy: e.clientY, l: el.offsetLeft, t: el.offsetTop, lw: layer.width, lh: layer.height }; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', e => { if (!mv) return; const l = Math.max(-el.offsetWidth + 80, Math.min(mv.lw - 80, mv.l + e.clientX - mv.sx)), tp = Math.max(0, Math.min(mv.lh - 34, mv.t + e.clientY - mv.sy)); el.style.left = l + 'px'; el.style.top = tp + 'px'; });
  head.addEventListener('pointerup', () => { mv = null; });
  head.addEventListener('dblclick', e => { if (e.target.closest('button')) return; const layer = $('#terms'); if (el.dataset.max) { const o = JSON.parse(el.dataset.max); Object.assign(el.style, o); delete el.dataset.max; } else { el.dataset.max = JSON.stringify({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }); Object.assign(el.style, { left: '8px', top: '8px', width: (layer.clientWidth - 16) + 'px', height: (layer.clientHeight - 16) + 'px' }); } });
  inp.addEventListener('paste', e => { const tx = (e.clipboardData && e.clipboardData.getData('text')) || ''; if (!/\r?\n/.test(tx)) return; e.preventDefault();
    const lines = (inp.value + tx).replace(/\r/g, '').split('\n'); if (lines.length && !lines[lines.length - 1].trim()) lines.pop(); inp.value = '';
    if (lines.length > 3000) { toast('Texto grande demais para colar no console (máx. 3000 linhas). Use Importar config.', 'bad'); return; }
    runCliLines(id, lines); toast(`${lines.length} linhas executadas em ${dev(id)?.name}.`); });
  inp.addEventListener('keydown', e => {
    const d = dev(id); if (!d) return; const st = E.cs(id);
    if (e.key === 'Enter') { e.preventDefault(); if (t.busy) return; const v = inp.value; inp.value = ''; runCli(id, v); }
    else if (e.key === 'Tab') { e.preventDefault(); const r = E.cliComplete(d, inp.value); inp.value = r.line; if (r.opts.length > 1) { st.log.push({ t: 'in', s: E.promptOf(d, st) + ' ' + inp.value }, { t: 'dim', s: r.opts.join('   ') }); renderTerm(id); } }
    else if (e.key === '?' && !(isHost(d.type) && d.os)) { e.preventDefault(); const r = E.cliRun(d, inp.value + '?', {}); inp.value = r.keep ?? inp.value; renderTerm(id); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (st.hi > 0) { st.hi--; inp.value = st.hist[st.hi] || ''; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (st.hi < st.hist.length) { st.hi++; inp.value = st.hist[st.hi] || ''; } }
    else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); st.log = []; renderTerm(id); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'c' && inp.selectionStart === inp.selectionEnd) { e.preventDefault(); st.log.push({ t: 'in', s: E.promptOf(d, st) + ' ' + inp.value + '^C' }); inp.value = ''; renderTerm(id); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !inp.value) { e.preventDefault(); st.mode = 'exec'; st.log.push({ t: 'in', s: '^Z' }); renderTerm(id); }
  });
}


/* ---------- SO, nuvens, clusters e VPN ---------- */
const osShort = d => { const o = d.os && E.OSES[d.os]; if (!o) return ''; return o.name.replace(/ \(.*\)$/, '').replace(/ LTS$/, '').replace(/^Red Hat Enterprise Linux CoreOS.*/, 'RHCOS').replace(/^Red Hat Enterprise Linux/, 'RHEL').replace(/ Linux( \d)/, '$1').replace(/GNU\/Linux /, '').replace(/^(Ubuntu \d+\.\d+)\.\d+/, '$1').replace(/ Pro .*| Standard/, ''); };
const osLabel = d => isHost(d.type) ? (d.os ? osShort(d) : 'Linux') : d.type === 'cloud' ? (E.cloudKind(d) === 'real' ? 'Internet real' : 'Internet fake') : VN[vOf(d)];
const API = (path, o = {}) => fetch(path, { ...o, headers: { 'X-Bancada': '1', ...(o.body ? { 'Content-Type': 'application/json' } : {}) } }).then(async r => { let j = null; try { j = await r.json(); } catch (_) {} if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status)); return j; });
const ctName = d => ('bancada-' + slug(S.name || 'lab').slice(0, 30) + '-' + slug(d.name).slice(0, 30)).replace(/-+$/, '');
function netCtx(c) {
  c.resolve = async name => {
    if (Store.mode === 'server') { try { return await API('api/net/resolve?name=' + encodeURIComponent(name)); } catch (_) {} }
    try { const r = await fetch('https://dns.google/resolve?type=A&name=' + encodeURIComponent(name)).then(r => r.json()); const ips = (r.Answer || []).filter(a => a.type === 1).map(a => a.data); return ips.length ? { ips } : { err: 'NXDOMAIN' }; }
    catch (_) { return { err: 'sem acesso ao DNS real a partir deste navegador' }; } };
  c.fetch = async (url, o) => {
    if (Store.mode === 'server') { try { return await API('api/net/fetch', { method: 'POST', body: JSON.stringify({ url, head: !!(o && o.head) }) }); } catch (e) { return { err: e.message, code: 7 }; } }
    try { const r = await fetch(url, { method: o && o.head ? 'HEAD' : 'GET', mode: 'cors', redirect: 'manual' }); const body = o && o.head ? '' : (await r.text()).slice(0, 65536); return { status: r.status || 200, body, server: r.headers.get('server') || '', ctype: r.headers.get('content-type') || 'text/html' }; }
    catch (_) { return { err: 'o navegador bloqueou a requisição (CORS) — no executável da bancada ela sai pelo servidor local', code: 7 }; } };
  if (Store.mode === 'server') {
    c.ctApp = (op, d, ct) => ctAppCall(op, d, ct);
    c.ctAppFetch = (tg, path) => API('api/ct/app', { method: 'POST', body: JSON.stringify({ op: 'fetch', name: tg, path }) }).catch(e => ({ err: e.message }));
  }
  if (UI.net && UI.net.containers) {
    c.ctExec = async (d, line, cwd, stdin) => { const r = await API('api/ct/exec', { method: 'POST', body: JSON.stringify({ name: ctName(d), cmd: line, cwd, stdin: stdin || '' }) }); return { out: r.out, err: r.err, ports: r.ports }; };
    c.ctHttp = async (d, port, path) => { try { const r = await API('api/ct/http', { method: 'POST', body: JSON.stringify({ name: ctName(d), port, path }) }); const raw = String(r.raw || ''); const i = raw.search(/\r?\n\r?\n/); const head = i >= 0 ? raw.slice(0, i) : raw; const body = i >= 0 ? raw.slice(i).replace(/^\r?\n\r?\n/, '') : '';
      const m = head.match(/HTTP\/[\d.]+ (\d+)/); return m ? { code: +m[1], body, server: (head.match(/^server:\s*(.+)$/im) || [])[1] || 'container' } : { code: 200, body: raw || '(sem resposta HTTP — o container não tem curl/wget)', server: 'container' }; } catch (e) { return { code: 502, body: e.message }; } };
  }
  return c;
}
async function detectPub(d, loud) { if (Store.mode !== 'server') { try { const r = await fetch('https://api.ipify.org?format=json').then(r => r.json()); if (r.ip) { d.cloud.pub = r.ip; commit(); } } catch (_) { if (loud) toast('Não consegui descobrir o IP público por aqui — preencha no executável.', 'bad'); } return; }
  try { const r = await API('api/net/publicip'); if (r.ip) { d.cloud.pub = r.ip; commit(); if (loud) toast('IP público: ' + r.ip); } else if (loud) toast('Sem resposta dos serviços de IP público.', 'bad'); } catch (e) { if (loud) toast(e.message, 'bad'); } }

/* ---------- acesso de fora (SSH real → lab) ---------- */
const BR = new Map(); let brKey = '', brT = null; UI.brErr = {};
/* containers do lab rodando de verdade no Docker deste computador */
const appName = (d, ct) => `bancada-app${String(d.id).toLowerCase().replace(/[^a-z0-9]/g, '')}-${String(ct.name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'c'}`;
function ctAppCall(op, d, ct) { ct.rname = appName(d, ct);
  const body = { op, name: ct.rname, image: ct.image, ports: (ct.ports || []).map(p => p[2] === 'udp' ? `${p[1]}/udp` : String(p[1])), env: ct.env || [], args: ct.args || [], all: !!ct.pubAll, vols: ct.vols || [], user: ct.user || '', entry: ct.entry || '', workdir: ct.workdir || '', map: (ct.ports || []).map(([h, c, pr]) => `${h}:${c}${pr === 'udp' ? '/udp' : ''}`) };
  return API('api/ct/app', { method: 'POST', body: JSON.stringify(body) }).then(r => { if (op === 'start' && r.ports) { ct.real = 'ok'; ct.rmap = r.ports; } if (op === 'stop') ct.real = 'parado'; commit(); brKey = ''; bridgeSync(); })
    .catch(e => { ct.real = 'erro'; ct.realErr = e.message; toast(`Container real ${ct.name}: ${e.message}`, 'bad'); commit(); API('api/net/status').then(n => { UI.net = n; }).catch(() => {}); }); }
function appEvent(e) { let r; try { r = JSON.parse(e.body || '{}'); } catch (_) { return; }
  for (const d of S.devices) for (const ct of d.dockers || []) if (ct.rname === r.name) {
    if (r.state === 'ok') { ct.real = 'ok'; ct.rmap = r.ports || {}; ct.realErr = ''; if (ct.pubAll) (r.exposed || []).forEach(sp => { const [pt, pr] = String(sp).split('/'); if (!(ct.ports || []).some(p => +p[1] === +pt && (p[2] || 'tcp') === (pr || 'tcp'))) (ct.ports = ct.ports || []).push(pr === 'udp' ? [+pt, +pt, 'udp'] : [+pt, +pt]); }); toast(`${ct.name} (${ct.image}) está rodando de verdade em ${d.name} — portas ${(ct.ports || []).map(p => p[0]).join(', ')}.`); }
    else if (r.state === 'erro') { ct.real = 'erro'; ct.realErr = r.err || 'erro'; toast(`Container real ${ct.name} em ${d.name}: ${ct.realErr}`, 'bad'); }
    commit(); brKey = ''; bridgeSync(); return; } }
// destino real (127.0.0.1:porta) se o acesso de fora a ip:porta, pelo caminho do lab, cai num container real
function realTarget(cloud, ip, port, src) { try { const r = E.simulate(cloud.id, ip, 'tcp', +port, { srcIp: src }); if (!r || !r.ok || !r.svc || !r.svc.ct || r.svc.ct.real !== 'ok') return ''; const ct = r.svc.ct; const cp = ((ct.ports || []).find(([h]) => +h === +(r.svc.port || port)) || [])[1]; return (ct.rmap || {})[cp] || ''; } catch (_) { return ''; } }
const pubsOf = () => S.devices.filter(d => d.type === 'cloud' && E.cloudKind(d) === 'real').flatMap(c => (c.cloud.pubs || []).map(p => ({ ...p, bind: '', cloud: c.id })));
/* IPs do lab que ficam na rede real (modo "IPs reais") e as portas abertas em cada um */
function realIpsOf(c) { const cl = c.cloud; if (!cl || cl.mode !== 'host' || !cl.realIps || !pc(cl.lan || '')) return []; const lan = pc(cl.lan); const out = [];
  S.devices.forEach(x => { if (x.type === 'cloud') return; l3ifs(x).forEach(f => { if (f.mgmt && !isHost(x.type)) return; if (!['port', 'sub', 'svi'].includes(f.kind)) return; const ip = f.c.ip; if (!E.inNet(ip, lan) || E.i2ip(ip) === cl.gw || E.i2ip(ip) === cl.hostIp) return;
    const ports = new Set([22, 80, 443]); (x.dnat || []).forEach(r => ports.add(+r.port)); if (isHost(x.type) && x.os) { try { E.listenRows(x).forEach(r => { if (r.proto === 'tcp' && +r.port > 0) ports.add(+r.port); }); } catch (_) {} } out.push({ key: `${x.id}|${f.key}`, ip: E.i2ip(ip), len: f.c.len, dev: x, f, ports: [...ports].filter(p => p > 0 && p < 65536) }); }); }); return out; }
// troca o IP de uma interface do lab (lease DHCP do roteador de verdade)
function setIfIp(d, fkey, ip, len) { const cidr = `${ip}/${len}`; let m;
  if ((m = fkey.match(/^p(\d+)$/))) { const p = d.ports[+m[1]]; if (!p) return null; const old = p.ip; p.ip = cidr; return old; }
  if ((m = fkey.match(/^p(\d+)\.(\d+)$/))) { const s2 = (d.ports[+m[1]]?.subs || []).find(x => +x.vlan === +m[2]); if (!s2) return null; const old = s2.ip; s2.ip = cidr; return old; }
  if ((m = fkey.match(/^v(\d+)$/))) { const s2 = (d.svis || []).find(x => +x.vlan === +m[1]); if (!s2) return null; const old = s2.ip; s2.ip = cidr; return old; } return null; }
function lanEvent(st, quiet) { if (!st || !st.key) return; UI.lan = UI.lan || {}; const o = UI.lan[st.key]; if (o && (o.seq || 0) > (st.seq || 0)) return; UI.lan[st.key] = st;
  if (st.state === 'ok' && st.ip) { const [id, fk] = st.key.split('|'); const d = dev(id); const c = S.devices.find(x => x.type === 'cloud' && x.cloud && x.cloud.realIps && realIpsOf(x).some(r => r.key === st.key));
    if (d && c && (c.cloud.addr || 'dhcp') === 'dhcp') { const cur = realIpsOf(c).find(r => r.key === st.key); if (cur && (cur.ip !== st.ip || cur.len !== st.len)) { const old = setIfIp(d, fk, st.ip, st.len || pc(c.cloud.lan).len);
        const oip = String(old || '').split('/')[0]; (c.cloud.pubs || []).forEach(pb => { const [a, b] = String(pb.target || '').split(':'); if (a === oip) pb.target = `${st.ip}:${b}`; });
        toast(`${d.name} pegou ${st.ip} do DHCP do seu roteador.`); commit(); } }
    brKey = ''; bridgeSync(); }
  if (st.state === 'erro' && !(quiet && o && o.state === 'erro')) toast(`Rede real (${(dev(st.key.split('|')[0]) || {}).name || st.key}): ${st.err}`, 'bad');
  if (UI.sel && UI.sel.kind === 'dev' && dev(UI.sel.id)?.type === 'cloud') renderInspector(); }
function bridgeSync() { if (Store.mode !== 'server') return; clearTimeout(brT); brT = setTimeout(async () => {
  const ports = pubsOf().filter(p => +p.port && p.target).map(p => { const c = dev(p.cloud); const [ti, tp] = String(p.target).split(':'); return { bind: '', port: +p.port, pass: p.pass || '', target: p.target, real: c ? realTarget(c, ti, +tp || 22, c.cloud.hostIp || '') : '' }; }); const lan = [];
  S.devices.filter(d => d.type === 'cloud').forEach(c => { const cl = c.cloud; realIpsOf(c).forEach(r => { lan.push({ key: r.key, name: r.dev.name, mode: cl.addr === 'static' ? 'static' : 'dhcp', ip: r.ip, len: r.len, gw: cl.gw || '', iface: cl.iface || '', mac: cl.macMode === 'host' ? 'host' : 'own', ports: r.ports, pass: cl.sshPass || 'bancada', real: { ...Object.fromEntries(r.ports.map(pt => [String(pt), realTarget(c, r.ip, pt, cl.gw || '')]).filter(x => x[1])), ...Object.fromEntries((r.dev.dockers || []).filter(ct => ct.state === 'running' && ct.real === 'ok').flatMap(ct => (ct.ports || []).filter(p => p[2] === 'udp' && (ct.rmap || {})[`${p[1]}/udp`]).map(p => [`${p[0]}/udp`, ct.rmap[`${p[1]}/udp`]]))) } }); }); });
  const k = JSON.stringify([ports, lan]); if (k === brKey) return; brKey = k;
  try { const r = await API('api/bridge/config', { method: 'POST', body: JSON.stringify({ ports, lan }) }); UI.brErr = r.errors || {}; UI.lan = UI.lan || {}; const fresh = []; Object.values(r.lan || {}).forEach(x => { const o = UI.lan[x.key]; if (!o || (x.seq || 0) > (o.seq || 0)) fresh.push(x); }); Object.keys(UI.lan).forEach(k2 => { if (!lan.some(x => x.key === k2)) delete UI.lan[k2]; }); fresh.forEach(x => lanEvent(x, true)); UI.brBind = r.bind; UI.local = r.local || null;
    const pe = Object.keys(UI.brErr).filter(x => !/^\d+\.\d+\.\d+\.\d+:/.test(x) || !lan.some(l => x.startsWith(l.ip + ':'))); if (pe.length) toast('Não consegui abrir ' + pe.join(', ') + ' neste computador (porta em uso?).', 'bad');
    if (UI.sel && UI.sel.kind === 'dev' && dev(UI.sel.id)?.type === 'cloud') renderInspector(); } catch (_) { brKey = ''; } }, 400); }
const brOut = (sess, o) => API('api/bridge/out', { method: 'POST', body: JSON.stringify({ sess, lines: o.lines || [], prompt: o.prompt || '', close: !!o.close, status: o.status || 0, headers: o.headers || {}, body: o.body || '' }) }).catch(() => {});
function brCloudFor(e) { const ip = String(e.target || '').split(':')[0]; const cs2 = S.devices.filter(d => d.type === 'cloud' && E.cloudKind(d) === 'real'); return cs2.find(c => (c.cloud.pubs || []).some(p => +p.port === +e.port && !e.bind)) || cs2.find(c => c.cloud.lan && pc(c.cloud.lan) && E.inNet(ip2i(ip) ?? 0, pc(c.cloud.lan))) || cs2[0]; }
function brSrc(c, client) { const lan = c.cloud.lan && pc(c.cloud.lan); const ci = ip2i(client || ''); if (lan && ci !== null && E.inNet(ci, lan) && client !== c.cloud.hostIp) return client; return c.cloud.mode === 'host' && c.cloud.hostIp ? c.cloud.hostIp : '203.0.113.50'; }
const parseCookies = s => Object.fromEntries(String(s || '').split(/;\s*/).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
const parseForm = s => Object.fromEntries([...new URLSearchParams(String(s || ''))]);
const errPage = (t, why) => ({ status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: `<!doctype html><meta charset=utf-8><title>${esc(t)}</title><body style="font:15px Arial;margin:40px"><h2>${esc(t)}</h2><p>${esc(why)}</p><p style="color:#777">Bancada de Rede — a conexão de fora entrou no lab, mas o caminho simulado não chegou ao destino.</p></body>` });
async function bridgeEvent(e) {
  if (e.type === 'lan') return lanEvent(e.lan);
  if (e.type === 'app') return appEvent(e);
  if (e.type === 'local') { UI.local = e.local && e.local.state ? e.local : null; if (UI.local && UI.local.state === 'erro') toast('Acesso deste computador: ' + UI.local.err, 'bad'); if (UI.sel && UI.sel.kind === 'dev' && dev(UI.sel.id)?.type === 'cloud') renderInspector(); return; }
  if (e.type === 'close') { const b = BR.get(e.sess); BR.delete(e.sess); if (b) toast(`Sessão SSH de ${b.client} encerrada.`); return; }
  if (e.type === 'http') { const c = brCloudFor(e); if (!c) return brOut(e.sess, errPage('Sem nuvem Internet real', 'Adicione uma nuvem Internet real ao lab.'));
    const [ip, pp] = String(e.target).split(':'); const port = +pp || (e.tls ? 443 : 80); const r = E.simulate(c.id, ip, 'tcp', port, { srcIp: brSrc(c, e.client) }); UI.simRes = r; UI.hl = { f: r.f, r: r.r }; renderCanvas(); renderSimOut();
    if (!r.ok) return brOut(e.sess, errPage(r.refused ? 'Conexão recusada' : 'Tempo esgotado', r.why));
    const tg = dev(r.at); const head = e.head || {}; const wt = E.webTarget(tg, r.dstIp);
    if (wt) { const res = E.webUI(tg, { method: e.method, path: e.path, form: /urlencoded/.test(head['content-type'] || '') ? parseForm(e.body) : {}, cookies: parseCookies(head.cookie), bmc: wt.bmc, client: e.client }); if (res.async) { try { await res.async; } catch (_) {} } if (res.changed) commit(); return brOut(e.sess, { status: res.status, headers: res.headers, body: res.body }); }
    const u = { sc: e.tls ? 'https' : 'http', host: (head.host || ip).split(':')[0], port, path: e.path || '/' }; const h = E.httpServe(tg, r.svc, u, 0);
    if (h.nohttp) return brOut(e.sess, errPage('Não é HTTP', `A porta ${port} de ${tg.name} é ${h.proto}.`)); return brOut(e.sess, { status: h.code || 200, headers: { 'Content-Type': h.ctype || 'text/html; charset=utf-8', ...(h.server ? { Server: h.server } : {}) }, body: h.body || '' }); }
  if (e.type === 'open') {
    const c = brCloudFor(e); if (!c || !e.target) return brOut(e.sess, { lines: ['Porta não publicada neste lab.'], close: true });
    const [ip, pp] = String(e.target).split(':'); const src = brSrc(c, e.client);
    const r = E.simulate(c.id, ip, 'tcp', +pp || 22, { srcIp: src }); UI.simRes = r; UI.hl = { f: r.f, r: r.r }; renderCanvas(); renderSimOut();
    if (!r.ok) return brOut(e.sess, { lines: [`ssh: connect to host ${ip} port ${+pp || 22}: ${r.refused ? 'Connection refused' : 'Connection timed out'}`, '(no lab) ' + r.why], close: true });
    const tg = dev(r.at); if (!tg || r.ext) return brOut(e.sess, { lines: ['Destino fora do lab.'], close: true });
    if (r.svc && r.svc.web === 'bmc') return brOut(e.sess, { lines: [`${(modelOf(tg) || {}).bmc || 'BMC'} SSH: use a interface web (https://${ip}) — a CLI do BMC (racadm/SMASH) não é simulada.`], close: true });
    const st = E.newSt(); const sess = { dev: tg.id, st, client: e.client || '?' }; BR.set(e.sess, sess);
    const ctx = netCtx({ vendor: UI.vendor, onChange: () => { sess.changed = true; } });
    if (e.exec) { const res = E.cliRun(tg, e.line, { ...ctx, st }) || {}; if (res.async) await res.async; BR.delete(e.sess); return brOut(e.sess, { lines: st.log.filter(x => x.t !== 'in').map(x => x.s), close: true }); }
    const ban = (isHost(tg.type) && tg.os ? E.banner(tg).filter(l => l.trim() && !/Digite help|Bancada de Rede —/.test(l)) : [E.banner(tg)[0]]);
    toast(`SSH de fora: ${e.user || 'root'}@${e.client} entrou em ${tg.name} (${e.bind ? e.bind + ':' + e.port : 'porta ' + e.port} → ${e.target}).`);
    return brOut(e.sess, { lines: [...ban, `Last login: ${new Date().toUTCString().replace(' GMT', '')} from ${src}`], prompt: E.promptOf(tg, st) });
  }
  if (e.type === 'line') { const b = BR.get(e.sess); if (!b) return brOut(e.sess, { lines: ['Sessão expirada.'], close: true }); const tg = dev(b.dev); if (!tg) return brOut(e.sess, { lines: ['O equipamento foi removido do lab.'], close: true });
    const t = String(e.line || '').trim(); if (/^(exit|logout|quit)$/i.test(t) && !b.st.ssh && !b.st.here && (isHost(tg.type) || b.st.mode === 'exec')) { BR.delete(e.sess); return brOut(e.sess, { lines: ['logout', `Connection to ${tg.name} closed.`], close: true }); }
    let changed = false; const ctx = netCtx({ vendor: UI.vendor, onChange: () => { changed = true; } });
    const n0 = b.st.log.length; const res = E.cliRun(tg, e.line, { ...ctx, st: b.st }) || {}; if (res.async) { try { await res.async; } catch (er) { b.st.log.push({ t: 'err', s: String(er.message || er) }); } }
    if (res.edit) b.st.log.push({ t: 'dim', s: '(o editor só abre no navegador — pela sessão SSH use: cat <<EOF > arquivo)' });
    const lines = b.st.log.slice(n0).filter(x => x.t !== 'in').map(x => x.s); b.st.log.length = 0; if (changed) commit();
    return brOut(e.sess, { lines, prompt: E.promptOf(tg, b.st) }); }
}
async function bridgeLoop() { if (Store.mode !== 'server') return; for (;;) { try { const r = await API('api/bridge/poll'); for (const e of r.events || []) await bridgeEvent(e); } catch (_) { await new Promise(r => setTimeout(r, 3000)); } } }
async function ctToggle(d, on) {
  if (!UI.net || !UI.net.containers) return toast('Containers reais precisam do executável da bancada com Docker ou Podman instalado.', 'bad');
  const o = E.osInfo(d); if (!o || !o.img || E.isWin(d)) return toast('Este SO não tem imagem de container oficial.', 'bad');
  try { if (on) { toast(`Iniciando ${o.img} para ${d.name}… (a primeira vez baixa a imagem)`); const r = await API('api/ct/start', { method: 'POST', body: JSON.stringify({ name: ctName(d), image: o.img, host: d.name }) }); d.ct = o.img; d.ctOn = true; d.ctPorts = r.ports || []; toast(`${d.name} agora roda num container ${o.img} real.`); }
    else { await API('api/ct/stop', { method: 'POST', body: JSON.stringify({ name: ctName(d) }) }); d.ctOn = false; d.ctPorts = []; toast('Container removido; o host volta ao SO simulado.'); }
    const st = E.cs(d.id); st.log.push({ t: 'dim', s: on ? `— agora em container real ${o.img}: comandos comuns rodam de verdade; ip/ping/curl/ssh/systemctl continuam simulados na rede do lab —` : '— container real desligado —' }); commit(); syncTerms(); }
  catch (e) { toast('Container: ' + e.message, 'bad'); }
}
function openEditor(ed) {
  const d = dev(ed.dev); if (!d) return; const win = E.isWin(d);
  modal(`<h3>${esc(d.name)} — ${esc(win ? ed.path.replace(/\//g, '\\') : ed.path)}</h3><p class="note">Editor da bancada (${win ? 'Bloco de Notas' : 'nano/vi'}). Ctrl+S salva no equipamento.</p>
    <textarea id="edTxt" class="mono" spellcheck="false" style="width:100%;height:52vh;resize:vertical">${esc(ed.content)}</textarea>
    <div class="actions"><button class="btn" data-ed="cancel">Fechar sem salvar</button><button class="btn primary" data-ed="save">Salvar</button></div>`);
  const ta = $('#edTxt'); ta.focus(); try { ta.setSelectionRange(0, 0); } catch (_) {}
  const save = () => { E.fsWrite(d, ed.path, ta.value.replace(/\r/g, '').replace(/([^\n])$/, '$1\n')); E.cs(d.id).log.push({ t: 'dim', s: `"${ed.path}" gravado (${ta.value.length} bytes)` }); closeModal(); commit(); renderTerm(d.id); focusTerm(d.id); };
  $('#modalRoot').querySelector('[data-ed="save"]').onclick = save; $('#modalRoot').querySelector('[data-ed="cancel"]').onclick = () => { closeModal(); focusTerm(d.id); };
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); } if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); } });
}
const FW_NAME = { ufw: 'ufw', firewalld: 'firewalld', windows: 'Windows Defender Firewall', none: 'iptables' };
function tSistema(d) {
  if (!d.os) return `<p class="note">Este host usa o shell Linux genérico das versões anteriores. Escolha um sistema operacional na aba Geral para ter pacotes, serviços, firewall local, arquivos e VPN.</p>`;
  const o = E.osInfo(d), win = E.isWin(d), fw = E.hostFw(d); const svcs = Object.entries(d.svcs || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const def = E.osDefaults(d.os, d.type); const extra = (d.pkgs || []).filter(p => !def.pkgs.includes(p));
  const base = d.fs ? Object.keys(d.fs).filter(p => !p.endsWith('/') && d.fs[p] !== null) : [];
  let h = `<div class="kv"><span>Sistema</span><b>${esc(o.name)}</b><span>${win ? 'Build' : 'Kernel'}</span><b class="mono">${esc(win ? o.ver : o.kernel)}</b>${o.img ? `<span>Imagem</span><b class="mono">${esc(o.img)}</b>` : ''}</div>`;
  h += `<div class="sec"><h4>${win ? 'Recursos e programas' : 'Pacotes instalados'}</h4><p class="note">${extra.length ? extra.map(p => `<span class="chip mono">${esc(p)}</span>`).join(' ') : 'Só a instalação padrão.'}</p>
    <div class="row addr"><input type="text" id="np-pkg" class="mono" placeholder="${win ? 'Web-Server, DNS, DHCP' : o.pm === 'apt' ? 'nginx strongswan wireguard-tools' : o.pm === 'apk' ? 'nginx' : 'nginx bind-utils'}" aria-label="Pacotes"><button class="btn sm" data-act="pkgAdd">Instalar</button></div>
    <p class="note">${win ? 'Equivale a Install-WindowsFeature / Add-WindowsCapability.' : `Equivale a <span class="mono">${o.pm === 'apt' ? 'apt install' : o.pm === 'apk' ? 'apk add' : 'dnf install'}</span> no console${o.pm === 'apt' ? ' (o console exige apt update e acesso ao repositório)' : ''}.`}</p></div>`;
  h += `<div class="sec"><h4>Serviços</h4>${svcs.length ? `<div class="svl">${svcs.map(([n, s]) => `<div class="row sv3"><span class="mono">${esc(n)}</span><label title="Ativo agora"><input type="checkbox" data-s="svc" data-n="${esc(n)}" data-f="active"${s.active ? ' checked' : ''}> ativo</label><label title="Inicia no boot"><input type="checkbox" data-s="svc" data-n="${esc(n)}" data-f="enabled"${s.enabled ? ' checked' : ''}> no boot</label></div>`).join('')}</div>` : '<p class="note">Nenhum serviço além do básico.</p>'}
    <p class="note">Portas em escuta: <span class="mono">${esc(listenSummary(d))}</span></p></div>`;
  h += `<div class="sec"><h4>Firewall local — ${esc(FW_NAME[o.fw] || o.fw)}</h4><label class="field"><span>Ativo</span><input type="checkbox" data-s="hfw" data-f="on"${fw.on ? ' checked' : ''}></label>
    <label class="field"><span>Aceita ping (ICMP)</span><input type="checkbox" data-s="hfw" data-f="icmp"${fw.icmp !== false ? ' checked' : ''}></label>
    ${(fw.allow || []).map((x, i) => `<div class="row fw4"><span class="mono">${esc(String(x[0]))}</span><span class="mono">${esc(String(x[1]))}</span><span class="mono">${esc(x[2] || 'qualquer origem')}</span><button class="btn sm ghost" data-act="fwDel" data-i="${i}" aria-label="Remover regra">${ICON.x}</button></div>`).join('')}
    <div class="row addr"><select id="nf-proto" aria-label="Protocolo">${opt('tcp', 'TCP')}${opt('udp', 'UDP')}</select><input type="text" id="nf-port" class="mono tiny" placeholder="porta" aria-label="Porta"><input type="text" id="nf-src" class="mono" placeholder="origem (opcional) 10.0.0.0/8" aria-label="Origem"><button class="btn sm" data-act="fwAdd">Liberar</button></div>
    <p class="note">${fw.on ? 'Ligado: só entra o que estiver liberado acima.' : 'Desligado: todas as portas em escuta são alcançáveis.'}${o.fw === 'firewalld' ? ' (firewall-cmd --permanent só vale depois de --reload)' : ''}</p></div>`;
  if (base.length) h += `<div class="sec"><h4>Arquivos alterados</h4>${base.map(p => `<div class="row fl2"><span class="mono">${esc(win ? p.replace(/\//g, '\\') : p)}</span><button class="btn sm ghost" data-act="fsEdit" data-p="${esc(p)}">Editar</button></div>`).join('')}</div>`;
  h += `<div class="sec"><h4>Abrir arquivo</h4><div class="row addr"><input type="text" id="nfs-path" class="mono" placeholder="${win ? 'C:\\inetpub\\wwwroot\\index.html' : '/etc/hosts'}" aria-label="Caminho"><button class="btn sm" data-act="fsOpen">Editar</button></div></div>`;
  if ((d.dockers || []).length) h += `<div class="sec"><h4>Containers (docker simulado)</h4>${d.dockers.map(c => `<div class="row fl2"><span class="mono">${esc(c.name)} · ${esc(c.image)} · ${esc((c.ports || []).map(([a, b]) => a + '→' + b).join(', ') || 'sem portas')}</span><span class="${c.state === 'running' ? 'ok' : 'mute'}">${c.state === 'running' ? 'rodando' : 'parado'}</span></div>`).join('')}</div>`;
  if (o.img && !win) { const can = UI.net && UI.net.containers; h += `<div class="sec"><h4>Container real</h4><label class="field"><span>Rodar em ${esc(o.img)}</span><input type="checkbox" data-s="ctOn"${d.ctOn ? ' checked' : ''}${can ? '' : ' disabled'}></label>
    <p class="note">${can ? `Usa o ${esc(UI.net.engine || 'Docker')} desta máquina: os comandos do console rodam numa imagem ${esc(o.img)} de verdade (apt/dnf com Internet real, serviços, arquivos). Rede do lab — ip, ping, curl, ssh, VPN — continua simulada; portas abertas no container passam a valer no lab. Sem systemd: inicie serviços direto (ex.: <span class="mono">nginx</span>).` : 'Disponível no executável da bancada quando há Docker ou Podman instalado (no servidor headless, rode com -containers).'}</p></div>`; }
  return h;
}
function listenSummary(d) { const s = new Set(); Object.entries(d.svcs || {}).forEach(([n, x]) => { if (x.active) ((E.SVCDEF[n] || {}).ports || []).forEach(([p, port], i) => s.add(`${i === 0 && x.port ? x.port : port}/${p}`)); }); (d.listen || []).forEach(l => s.add(`${l.port}/${l.proto}`)); (d.dockers || []).forEach(c => c.state === 'running' && (c.ports || []).forEach(([h]) => s.add(h + '/tcp'))); (d.ctPorts || []).forEach(p => d.ctOn && s.add(`${p.port}/${p.proto}`)); return [...s].join('  ') || 'nenhuma'; }
function vpnStatusOf(d, t) { try { E.vpnStates(); const L = E.vpnState()[d.id] || []; return L.find(x => x.t === t) || null; } catch (_) { return null; } }
function tVpn(d) {
  const T = d.vpns || []; const enc = ['aes128', 'aes192', 'aes256', '3des'], hs = ['sha1', 'sha256', 'sha384', 'sha512', 'md5'], dhs = [['2', '2 (modp1024)'], ['5', '5 (modp1536)'], ['14', '14 (modp2048)'], ['15', '15 (modp3072)'], ['19', '19 (ecp256)'], ['20', '20 (ecp384)']];
  const host = isHost(d.type); const o = host && E.osInfo(d);
  let h = `<p class="note">${host ? `No host, o IPsec usa strongSwan (<span class="mono">/etc/ipsec.conf</span>) e o WireGuard usa <span class="mono">/etc/wireguard/wg0.conf</span> — editar aqui ou no console dá no mesmo.${o && !E.isWin(d) ? ' Os pacotes strongswan / wireguard-tools precisam estar instalados.' : ''}` : 'Túneis site-a-site. O tráfego entre as redes protegidas é cifrado e vai até o peer pela rede; a configuração sai no formato do sistema escolhido (crypto map, phase1/phase2, set security ike…).'} Use a Internet fake para ter IPs públicos dentro do lab.</p>`;
  T.forEach((t, i) => { const st = vpnStatusOf(d, t); const up = st && st.state === 'UP'; const wg = t.kind === 'wireguard';
    h += `<div class="sec vpn"><div class="row vh"><input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="name" value="${esc(t.name)}" aria-label="Nome do túnel"><span class="chip">${wg ? 'WireGuard' : 'IPsec ' + (t.ike === 'v1' ? 'IKEv1' : 'IKEv2')}</span><span class="${up ? 'ok' : t.shut ? 'mute' : 'bad'}">${t.shut ? 'desativado' : up ? '● UP' : '● DOWN'}</span><button class="btn sm ghost" data-act="vpnMirror" data-i="${i}" title="Cria o túnel correspondente no equipamento do peer">↔ outro lado</button><button class="btn sm ghost" data-act="vpnDel" data-i="${i}" aria-label="Remover túnel">${ICON.x}</button></div>
      ${st && !up && !t.shut ? `<p class="note bad">${esc(st.why)}</p>` : ''}
      <div class="kv2"><label>Peer (IP público)<input type="text" class="mono${t.peer && ip2i(t.peer) === null ? ' bad' : ''}" data-s="vpn" data-i="${i}" data-f="peer" value="${esc(t.peer || '')}" placeholder="200.10.0.10"></label>`
      + (wg ? `<label>Endereço do túnel<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="addr" value="${esc(t.addr || '')}" placeholder="10.99.0.1/24"></label>
        <label>Porta<input type="number" data-s="vpn" data-i="${i}" data-f="port" value="${esc(t.port || 51820)}"></label>
        <label>Chave privada<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="key" value="${esc(t.key || '')}"></label>
        <label>Sua chave pública<span class="mono sel">${esc(t.key ? E.wgPub(t.key) : '—')}</span></label>
        <label>Chave pública do peer<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="peerKey" value="${esc(t.peerKey || '')}"></label>
        <label>AllowedIPs (redes do outro lado)<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="rnets" value="${esc(t.rnets || '')}" placeholder="10.99.0.2/32 10.20.0.0/24"></label>`
      : `<label>Chave (PSK)<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="psk" value="${esc(t.psk || '')}"></label>
        <label>IKE<select data-s="vpn" data-i="${i}" data-f="ike">${opt('v2', 'IKEv2', t.ike || 'v2')}${opt('v1', 'IKEv1', t.ike)}</select></label>
        <label>Cifra<select data-s="vpn" data-i="${i}" data-f="enc">${enc.map(x => opt(x, x.toUpperCase(), t.enc || 'aes256')).join('')}</select></label>
        <label>Hash<select data-s="vpn" data-i="${i}" data-f="hash">${hs.map(x => opt(x, x.toUpperCase(), t.hash || 'sha256')).join('')}</select></label>
        <label>Grupo DH<select data-s="vpn" data-i="${i}" data-f="dh">${dhs.map(([v, l]) => opt(v, l, t.dh || '14')).join('')}</select></label>
        <label>Redes locais<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="lnets" value="${esc(t.lnets || '')}" placeholder="10.10.0.0/24"></label>
        <label>Redes remotas<input type="text" class="mono" data-s="vpn" data-i="${i}" data-f="rnets" value="${esc(t.rnets || '')}" placeholder="10.20.0.0/24"></label>`)
      + `<label class="cbx"><input type="checkbox" data-s="vpn" data-i="${i}" data-f="shut"${t.shut ? ' checked' : ''}> desativado</label></div>
      ${wg ? '' : `<p class="note">O outro lado precisa da mesma PSK, IKE e proposta, com as redes espelhadas (local ↔ remota).</p>`}</div>`; });
  h += `<div class="actions"><button class="btn sm" data-act="vpnAdd" data-v="ipsec">+ Túnel IPsec</button><button class="btn sm" data-act="vpnAdd" data-v="wireguard">+ Túnel WireGuard</button></div>`;
  return h;
}
function cloudPanel(d) {
  const c = d.cloud || {}; const real = c.kind === 'real';
  const host = real && c.mode === 'host';
  let h = `<div class="field"><span>Tipo</span><select data-s="cloud" data-f="kind">${opt('fake', 'Internet fake (fechada no lab)', c.kind)}${opt('real', 'Internet real (sai do lab)', c.kind)}</select></div>
    ${real ? `<div class="field"><span>Ligação</span><select data-s="cloud" data-f="mode">${opt('host', 'Ponte com a rede do computador', c.mode || 'pool')}${opt('pool', 'IP público direto (pool)', c.mode || 'pool')}</select></div>` : ''}
    ${host ? `<div class="field"><span>Sua rede (LAN)</span><input type="text" class="mono" data-s="cloud" data-f="lan" value="${esc(c.lan || '')}"></div>
    <div class="field"><span>Gateway (seu roteador)</span><input type="text" class="mono" data-s="cloud" data-f="gw" value="${esc(c.gw || '')}"></div>
    <div class="field"><span>IP público</span><span class="mono">${esc(c.pub || 'não detectado')} <button class="btn sm ghost" data-act="pubDetect">Detectar</button></span></div>
    <p class="note">${UI.net && UI.net.host && UI.net.host.ip ? `Detectado no computador: <span class="mono">${esc(UI.net.host.ip)}</span> em <span class="mono">${esc(UI.net.host.lan)}</span> (${esc(UI.net.host.iface)}), gateway <span class="mono">${esc(UI.net.host.gw)}</span>.` : 'A rede do computador é detectada pelo executável da bancada; aqui use os campos acima.'} Quem liga na nuvem recebe um IP livre dessa rede (a partir do .200), gateway e DNS = seu roteador; o tráfego para a Internet sai com NAT do seu roteador, com o seu IP público. Os IPs do lab não ocupam IPs de verdade na sua LAN.</p>` : ''}
    <div class="field"${host ? ' hidden' : ''}><span>Pool público</span><input type="text" class="mono${c.pool && !pc(c.pool) ? ' bad' : ''}" data-s="cloud" data-f="pool" value="${esc(c.pool || '')}" placeholder="200.10.0.0/16"></div>
    <p class="note"${host ? ' hidden' : ''}>${real ? 'O que não pertence ao lab sai pelo servidor da bancada: DNS e HTTP/HTTPS reais (curl, wget, Invoke-WebRequest, apt/dnf passam a exigir rota e NAT até aqui). Origens privadas são descartadas — faça NAT na borda.' : 'Uma Internet só do lab: endereços públicos, DNS próprio (8.8.8.8 / 1.1.1.1) e sites fake. Ideal para IPsec, WireGuard, NAT e publicação de serviços sem tocar a rede real.'} Ao ligar um equipamento numa porta da nuvem, os dois lados recebem um /30 do pool e o outro lado ganha rota padrão.</p>`;
  const att = d.ports.map((p, k) => ({ p, k, L: linkAt(d.id, k) })).filter(x => x.L);
  h += `<div class="sec"><h4>Clientes conectados</h4>${att.length ? att.map(x => { const pd = dev(x.L.peer), pp = pd.ports[x.L.peerK]; return `<div class="row fl2"><span class="mono">${esc(spn(d, x.k))} ${esc(x.p.ip || '')}</span><span>${esc(pd.name)} <span class="mono">${esc(pp.ip || '(sem IP)')}</span></span></div>`; }).join('') : '<p class="note">Ninguém ligado ainda. Use Conectar (C) a partir de um firewall, roteador ou host.</p>'}</div>`;
  if (real) { const pubs = c.pubs || []; const hip = (UI.net && UI.net.host && UI.net.host.ip) || c.hostIp || 'IP-deste-PC'; const local = !UI.brBind || /^127\./.test(UI.brBind);
    if (host) { const rips = realIpsOf(d); const ls = UI.lan || {}; const ifs = (UI.net && UI.net.ifaces) || [];
      const stTx = r => { const x = ls[r.key]; if (!x) return ['mute', '…']; if (x.state === 'ok') return ['ok', `na rede · MAC ${x.mac}`]; if (x.state === 'erro') return ['bad', x.err || 'erro']; return ['mute', c.addr === 'static' ? 'conferindo se o IP está livre…' : 'pedindo IP ao DHCP do roteador…']; };
      h += `<div class="sec"><h4>Equipamentos do lab na sua rede de verdade</h4><label class="field"><span>Colocar na minha rede</span><input type="checkbox" data-s="cloud" data-f="realIps"${c.realIps ? ' checked' : ''}${Store.mode === 'server' ? '' : ' disabled'}></label>
      <p class="note">Cada equipamento ligado a esta nuvem aparece na sua rede como um aparelho a mais, com MAC próprio: qualquer aparelho da casa faz <span class="mono">ping</span>, <span class="mono">ssh</span> e abre <span class="mono">http/https</span> no IP dele, e o acesso passa pelo NAT e pelas políticas do lab. <b>A configuração de rede do computador não é alterada.</b> No Windows precisa do <a href="https://npcap.com" target="_blank" rel="noopener">Npcap</a> (o mesmo do Wireshark); no Linux, rodar como root. No Windows (x64), o próprio computador também acessa esses IPs: com a bancada aberta como administrador ela usa o WinDivert (baixado na primeira vez) para entregar ao lab o que o PC manda para eles.</p>
      <div class="field"><span>Endereço</span><select data-s="cloud" data-f="addr"><option value="dhcp"${c.addr !== 'static' ? ' selected' : ''}>Automático — DHCP do seu roteador</option><option value="static"${c.addr === 'static' ? ' selected' : ''}>IP do lab (fixo, confere se está livre)</option></select></div>
      <div class="field"><span>Placa de rede</span><select data-s="cloud" data-f="iface"><option value="auto"${c.iface ? '' : ' selected'}>Automática${UI.net && UI.net.host && UI.net.host.iface ? ` (${esc(UI.net.host.iface)})` : ''}</option>${ifs.map(x => `<option value="${esc(x.iface)}"${c.iface === x.iface ? ' selected' : ''}>${esc(x.iface)} — ${esc(x.ip)} (${esc(x.lan)})</option>`).join('')}${c.iface && !ifs.some(x => x.iface === c.iface) ? `<option selected value="${esc(c.iface)}">${esc(c.iface)}</option>` : ''}</select></div>
      <div class="field"><span>MAC</span><select data-s="cloud" data-f="macMode"><option value="own"${c.macMode !== 'host' ? ' selected' : ''}>Um MAC próprio para cada equipamento</option><option value="host"${c.macMode === 'host' ? ' selected' : ''}>O MAC do computador (Wi-Fi que bloqueia outros MACs)</option></select></div>
      ${c.realIps ? (rips.length ? rips.map(r => { const [cl2, tx] = stTx(r); return `<div class="row fl2"><span class="mono">${esc(r.ip)}</span><span>${esc(r.dev.name)} · portas ${esc(r.ports.join(', '))}</span><span class="${cl2}">${esc(tx)}</span></div>`; }).join('') + (UI.local ? `<div class="row fl2"><span>Deste computador</span><span>${UI.local.state === 'ok' ? 'os IPs acima também respondem aqui' : ''}</span><span class="${UI.local.state === 'ok' ? 'ok' : 'bad'}">${esc(UI.local.state === 'ok' ? 'ativo' : UI.local.err)}</span></div>` : '') : '<p class="note">Nenhum equipamento ligado a esta nuvem ainda.</p>') : ''}
      <div class="field"><span>Senha SSH de fora</span><input type="text" class="mono" data-s="cloud" data-f="sshPass" value="${esc(c.sshPass || 'bancada')}"></div></div>`; }
    h += `<div class="sec"><h4>Portas publicadas neste computador (NAT)</h4><p class="note">Abre uma porta de verdade neste computador. Quem conectar com <span class="mono">ssh -p &lt;porta&gt; usuario@${esc(local ? 'localhost' : hip)}</span> entra no lab por esta nuvem — passando pelo NAT/encaminhamento de portas e pelas políticas do seu firewall do lab — e cai no shell do servidor/PC de destino.</p>
      ${pubs.map((p, i) => `<div class="row pb4"><input type="number" class="tiny" data-s="cpub" data-i="${i}" data-f="port" value="${esc(p.port)}" aria-label="Porta neste computador"><input type="text" class="mono" data-s="cpub" data-i="${i}" data-f="target" value="${esc(p.target)}" placeholder="192.168.1.200:22" aria-label="Destino no lab"><input type="text" class="mono" data-s="cpub" data-i="${i}" data-f="pass" value="${esc(p.pass || '')}" placeholder="senha" aria-label="Senha"><button class="btn sm ghost" data-act="cpubDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>${UI.brErr && UI.brErr[p.port] ? `<p class="note bad">Porta ${esc(p.port)}: ${esc(UI.brErr[p.port])}</p>` : ''}`).join('')}
      <div class="row pb4"><input type="number" id="npb-port" class="tiny" placeholder="2222" aria-label="Porta neste computador"><input type="text" id="npb-target" class="mono" placeholder="IP:porta no lab (ex. WAN do firewall:2222)" aria-label="Destino"><input type="text" id="npb-pass" class="mono" placeholder="senha" value="bancada" aria-label="Senha"><button class="btn sm" data-act="cpubAdd">Publicar</button></div>
      <p class="note">${Store.mode === 'server' ? (local ? 'Escutando só neste computador (127.0.0.1). Para aceitar de outras máquinas ou da Internet, ligue “Acesso pela rede” no painel da bancada e encaminhe a porta no seu roteador.' : `Escutando em ${esc(UI.brBind)} — outras máquinas da sua rede conseguem conectar.`) + ' Deixe a bancada aberta no navegador: é ela que executa a sessão.' : 'Disponível no executável da bancada (aqui no navegador não dá para abrir portas).'}</p></div>`; }
  if (!real) {
    h += `<div class="sec"><h4>DNS da nuvem</h4>${(c.dns || []).map((r, i) => `<div class="row dn3"><input type="text" class="mono" data-s="cdns" data-i="${i}" data-f="name" value="${esc(r.name)}" aria-label="Nome"><input type="text" class="mono" data-s="cdns" data-i="${i}" data-f="ip" value="${esc(r.ip)}" aria-label="IP"><button class="btn sm ghost" data-act="cdnsDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>`).join('')}
      <div class="row addr"><input type="text" id="ncd-name" class="mono" placeholder="vpn.empresa.com" aria-label="Nome"><input type="text" id="ncd-ip" class="mono" placeholder="200.10.0.6" aria-label="IP"><button class="btn sm" data-act="cdnsAdd">Adicionar</button></div>
      <p class="note">Respondido por 8.8.8.8 e 1.1.1.1 dentro do lab. Nomes de equipamentos e de clusters (api.*, *.apps.*) também resolvem.</p></div>
      <label class="field"><span>Espelho de pacotes</span><input type="checkbox" data-s="cloud" data-f="mirror"${c.mirror ? ' checked' : ''}></label><p class="note">Com o espelho, apt/dnf/apk, docker pull e winget funcionam dentro da Internet fake.</p>`;
  }
  h += loopSec(d);
  return h;
}
function clusterPanel(ch) {
  const k = ch.k8s; const ocp = k.dist === 'openshift'; const nodes = E.k8sNodes(ch);
  let h = `<div class="kv"><span>Distribuição</span><b>${ocp ? 'OpenShift' : 'Kubernetes'} ${esc(k.version)}</b><span>Rede dos nós</span><b class="mono">${esc(k.nodeNet || '')}</b><span>Pods / Services</span><b class="mono">${esc(k.podCidr)} · ${esc(k.svcCidr)}</b></div>
    <div class="field"><span>Domínio</span><input type="text" class="mono" data-s="k8s" data-f="domain" value="${esc(k.domain || '')}"></div>
    ${ocp ? `<div class="field"><span>VIP da API</span><input type="text" class="mono" data-s="k8s" data-f="apiVip" value="${esc(k.apiVip || '')}"></div><div class="field"><span>VIP do Ingress</span><input type="text" class="mono" data-s="k8s" data-f="ingressVip" value="${esc(k.ingressVip || '')}"></div>` : ''}
    <div class="field"><span>Pool LoadBalancer</span><input type="text" class="mono" data-s="k8s" data-f="lbPool" value="${esc(k.lbPool || '')}" placeholder="10.50.0.200-10.50.0.220"></div>
    <p class="note">${ocp ? `API em <span class="mono">api.${esc(k.domain)}:6443</span> e rotas em <span class="mono">*.apps.${esc(k.domain)}</span> (VIPs no primeiro master e no primeiro worker).` : 'O pool faz o papel do MetalLB: Services LoadBalancer recebem um IP dele, anunciado pelo primeiro worker.'} Ligue a porta uplink do switch do cluster a um roteador com o gateway <span class="mono">${esc(k.nodeNet ? E.i2ip(pc(k.nodeNet).net + 1) : '')}</span>.</p>`;
  h += `<div class="sec"><h4>Nós</h4>${nodes.map(n => { const r = E.nodeReady(ch, n); const f = l3ifs(n).find(x => !x.mgmt); return `<div class="row fl2"><button class="btn sm ghost" data-act="selDev" data-id="${n.id}">${esc(n.name)}</button><span class="mono">${esc(n.k8sRole || 'worker')} · ${esc(f ? cidrStr(f.c) : 'sem IP')}</span><span class="${r.ok ? 'ok' : 'bad'}" title="${esc(r.why || '')}">${r.ok ? 'Ready' : 'NotReady'}</span></div>`; }).join('')}</div>`;
  return h;
}
function tWork(ch) {
  const k = ch.k8s; const pods = E.podsOf(ch); const ocp = k.dist === 'openshift';
  let h = `<p class="note">Workloads simulados. Crie aqui ou com <span class="mono">${ocp ? 'oc' : 'kubectl'}</span> no console de um nó (create, apply -f, expose, scale, get, describe…).</p>`;
  h += `<div class="sec"><h4>Deployments</h4>${(k.deploys || []).map((dp, i) => { const r = pods.filter(p => p.dp === dp && p.status === 'Running').length; return `<div class="row kd5"><span class="mono">${esc(dp.ns)}/${esc(dp.name)}</span><span class="mono">${esc(dp.image)}</span><input type="number" min="0" max="20" class="tiny" data-s="kdp" data-i="${i}" data-f="replicas" value="${esc(dp.replicas)}" aria-label="Réplicas"><span class="${r === +dp.replicas ? 'ok' : 'bad'}">${r}/${dp.replicas}</span><button class="btn sm ghost" data-act="kdpDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>`; }).join('') || '<p class="note">Nenhum.</p>'}
    <div class="row addr"><input type="text" id="nk-ns" class="mono tiny" value="default" aria-label="Namespace"><input type="text" id="nk-name" class="mono" placeholder="web" aria-label="Nome"><input type="text" id="nk-img" class="mono" placeholder="nginx:1.27" aria-label="Imagem"><input type="number" id="nk-port" class="tiny" value="80" aria-label="Porta"><button class="btn sm" data-act="kdpAdd">Criar</button></div></div>`;
  h += `<div class="sec"><h4>Services</h4>${(k.svcs || []).map((s, i) => `<div class="row fw4"><span class="mono">${esc(s.ns)}/${esc(s.name)}</span><span class="mono">${esc(s.type)} ${esc(s.port)}${s.nodePort ? ':' + s.nodePort : ''}</span><span class="mono">${esc(s.lbIp || s.cip || '')}</span><button class="btn sm ghost" data-act="ksvDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>`).join('') || '<p class="note">Nenhum.</p>'}
    <div class="row addr"><select id="nks-dp" aria-label="Deployment">${(k.deploys || []).map((dp, i) => opt(i, dp.ns + '/' + dp.name)).join('')}</select><select id="nks-type" aria-label="Tipo">${opt('ClusterIP', 'ClusterIP')}${opt('NodePort', 'NodePort')}${opt('LoadBalancer', 'LoadBalancer')}</select><button class="btn sm" data-act="ksvAdd">Expor</button></div></div>`;
  h += `<div class="sec"><h4>${ocp ? 'Routes' : 'Ingress'}</h4>${(k.ings || []).map((r, i) => `<div class="row fw4"><span class="mono">${esc(r.ns)}/${esc(r.name)}</span><span class="mono">${esc(r.host)}</span><span class="mono">→ ${esc(r.svc)}</span><button class="btn sm ghost" data-act="kinDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>`).join('') || '<p class="note">Nenhuma.</p>'}
    ${(k.svcs || []).length ? `<div class="row addr"><select id="nki-svc" aria-label="Service">${k.svcs.map((s, i) => opt(i, s.ns + '/' + s.name)).join('')}</select><input type="text" id="nki-host" class="mono" placeholder="${ocp ? 'automático' : 'web.' + esc(k.domain)}" aria-label="Host"><button class="btn sm" data-act="kinAdd">${ocp ? 'Criar route' : 'Criar ingress'}</button></div>` : ''}
    ${!ocp && !k.ingressVip ? `<p class="note">Para o Ingress responder, defina um VIP do ingress controller:</p><div class="field"><span>VIP do Ingress</span><input type="text" class="mono" data-s="k8s" data-f="ingressVip" value="" placeholder="${esc(k.nodeNet ? E.i2ip(pc(k.nodeNet).net + 7) : '')}"></div>` : ''}</div>`;
  h += `<div class="sec"><h4>Pods</h4><pre class="cfg">${esc(pods.map(p => `${p.dp.ns.padEnd(10)} ${p.name.padEnd(28)} ${p.status.padEnd(8)} ${(p.ip != null ? E.i2ip(p.ip) : '').padEnd(14)} ${p.node ? p.node.name : '-'}`).join('\n') || 'Nenhum pod.')}</pre></div>`;
  return h;
}


/* ---------- interface web dos equipamentos (janela no app) ---------- */
let WEBV = null;
function webTargetOf(d) { if (isHost(d.type)) { const k = d.ports.findIndex((p, j) => isMgmt(d, j)); return k >= 0 ? { bmc: true, label: (modelOf(d) || {}).bmc || 'BMC', ip: (pc(d.ports[k].ip) ? E.i2ip(pc(d.ports[k].ip).ip) : '') } : null; }
  if ((fwd(d.type) || isSw(d.type)) && d.type !== 'cloud' && E.webSkinOf(d, false)) { const f = l3ifs(d, true).find(x => x.mgmt) || l3ifs(d).find(x => !x.mgmt); return { bmc: false, label: 'Interface web', ip: f ? E.i2ip(f.c.ip) : '' }; } return null; }
function openWeb(d) { const t = webTargetOf(d); if (!t) return; WEBV = { dev: d.id, bmc: t.bmc, path: '/', hist: [] };
  modal(`<div class="wv"><div class="wvbar"><button class="btn sm" data-wv="back" title="Voltar">←</button><button class="btn sm" data-wv="reload" title="Recarregar">⟳</button><span class="wvurl mono" id="wvUrl"></span><button class="btn sm" data-wv="close">Fechar</button></div><iframe id="wvFrame" sandbox="allow-same-origin allow-forms allow-downloads" title="Interface web de ${esc(d.name)}"></iframe></div>`, false, 'wide');
  $('#modalRoot').querySelector('.wvbar').addEventListener('click', e => { const b = e.target.closest('[data-wv]'); if (!b) return; const a = b.dataset.wv; if (a === 'close') { WEBV = null; closeModal(); } else if (a === 'back') { if (WEBV.hist.length) { WEBV.path = WEBV.hist.pop(); webRender(); } } else webRender(); });
  webRender(); }
async function webNav(method, path, form) { const d = dev(WEBV && WEBV.dev); if (!d) return; let res = E.webUI(d, { method, path, form, app: true, bmc: WEBV.bmc }); if (res.async) { try { await res.async; } catch (_) {} } if (res.changed) commit();
  let n = 0; while ((res.status === 303 || res.status === 302) && n++ < 5) { path = res.headers.Location; res = E.webUI(d, { method: 'GET', path, app: true, bmc: WEBV.bmc }); }
  if (res.headers && /attachment/.test(res.headers['Content-Disposition'] || '')) { const fn = (res.headers['Content-Disposition'].match(/filename="([^"]+)"/) || [])[1] || 'config.txt'; download(fn, res.body); return; }
  if (method === 'GET' || path !== WEBV.path) { if (WEBV.path !== path) WEBV.hist.push(WEBV.path); } WEBV.path = path; webShow(res); }
function webRender() { const d = dev(WEBV && WEBV.dev); if (!d) return; const res = E.webUI(d, { method: 'GET', path: WEBV.path, app: true, bmc: WEBV.bmc }); if (res.status === 303) { WEBV.path = res.headers.Location; return webRender(); } webShow(res); }
function webShow(res) { const d = dev(WEBV.dev); const t = webTargetOf(d); const f = $('#wvFrame'); if (!f) return; $('#wvUrl').textContent = `https://${t && t.ip ? t.ip : d.name}${WEBV.path}`;
  f.onload = () => { const doc = f.contentDocument; if (!doc) return; const o = doc.getElementById('out'); if (o) o.scrollTop = o.scrollHeight;
    doc.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; const h = a.getAttribute('href'); if (h && h.charAt(0) === '/') { e.preventDefault(); if (h === '/__term') { openTerm(WEBV.dev); return; } webNav('GET', h); } }, true);
    doc.addEventListener('submit', e => { e.preventDefault(); const fm = e.target, o2 = {}; new FormData(fm).forEach((v, k) => { o2[k] = v; }); if (e.submitter && e.submitter.name) o2[e.submitter.name] = e.submitter.value; webNav((fm.getAttribute('method') || 'GET').toUpperCase(), fm.getAttribute('action') || '/', o2); }, true);
    const inp = doc.querySelector('[autofocus]'); if (inp) inp.focus(); };
  f.srcdoc = /html/.test((res.headers || {})['Content-Type'] || 'text/html') ? String(res.body) : `<pre>${esc(res.body)}</pre>`; }
window.addEventListener('message', e => { const m = e.data || {}; if (m.webnav && WEBV) { const n = m.webnav; webNav(n.method, n.path, n.form); } if (m.bancadaOpenTerm && dev(m.bancadaOpenTerm)) openTerm(m.bancadaOpenTerm); });

/* ---------- inspetor ---------- */
function selDev() { return UI.sel && UI.sel.kind === 'dev' ? dev(UI.sel.id) : null; }
function renderInspector() {
  const el = $('#insp'); const body = el.querySelector('.ibody'); const st = body ? body.scrollTop : 0; const prevKey = el.dataset.key;
  let key = 'none';
  if (!UI.sel) el.innerHTML = overview();
  else if (UI.sel.kind === 'link') { key = 'l' + UI.sel.id; el.innerHTML = linkPanel(S.links.find(l => l.id === UI.sel.id)); }
  else if (UI.sel.kind === 'rack') { key = 'r' + UI.sel.id; const r = (S.racks || []).find(x => x.id === UI.sel.id); if (!r) { UI.sel = null; el.innerHTML = overview(); } else el.innerHTML = rackPanel(r); }
  else { const d = selDev(); if (!d) { UI.sel = null; el.innerHTML = overview(); }
    else { key = d.id + UI.tab;
      const tabs = d.type === 'chassis' ? [['geral', 'Geral'], ...(d.k8s ? [['work', 'Workloads']] : []), ['config', 'Resumo']] : isHost(d.type) ? [['geral', 'Geral'], ...(d.os ? [['so', 'Sistema']] : []), ...(d.ports.length > 1 ? [['portas', 'Portas']] : []), ['rotas', 'Rotas'], ...(d.os ? [['vpn', 'VPN']] : []), ['config', 'Config']] : d.type === 'cloud' ? [['geral', 'Geral'], ['portas', 'Portas'], ['rotas', 'Rotas'], ['config', 'Resumo']] : [['geral', 'Geral'], ['portas', 'Portas'], ...(isSw(d.type) ? [['vlans', 'VLANs']] : []), ...(fwd(d.type) ? [['rotas', 'Rotas'], ['vrf', 'VRF'], ['bgp', 'BGP'], ['rmap', 'Route-maps'], ['regras', d.type === 'fw' ? 'Políticas' : 'ACL'], ...(d.type === 'fw' || d.type === 'rtr' ? [['vpn', 'VPN']] : [])] : []), ['config', 'Config']];
      if (!tabs.some(t => t[0] === UI.tab)) UI.tab = 'geral';
      const mm = modelOf(d), np = d.ports.filter((p, k) => !isInternal(d, k)).length;
      el.innerHTML = `<div class="ihead"><span class="kind">${mm ? esc(mm.vendor + ' ' + mm.name) : TYPES[d.type].label}${d.type === 'chassis' ? ` · ${mm ? mm.bays : 0} baias` : ` · ${np} porta${np > 1 ? 's' : ''}`}</span><div class="nmrow"><span class="nm">${esc(d.name)}</span>${d.type === 'chassis' ? '' : `${webTargetOf(d) ? `<button class="btn sm ghost" data-act="openWeb" title="Abrir a interface web do equipamento">${esc(webTargetOf(d).bmc ? webTargetOf(d).label : 'Web')}</button>` : ''}${isHost(d.type) || d.type === 'cloud' ? '' : '<button class="btn sm ghost" data-act="importCfg" title="Importar ou colar config neste equipamento">Importar</button>'}<button class="btn sm" data-act="openCli">${ICON.term}Console</button>`}</div>
        <div class="itabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" data-act="tab" data-v="${k}" aria-selected="${UI.tab === k}">${l}</button>`).join('')}</div></div>
        <div class="ibody">${({ geral: tGeral, so: tSistema, vpn: tVpn, work: tWork, portas: tPortas, vlans: tVlans, rotas: tRotas, vrf: tVrf, bgp: tBgp, rmap: tRmap, regras: tRegras, config: tConfig })[UI.tab](d)}</div>`; } }
  el.dataset.key = key; const nb = el.querySelector('.ibody'); if (nb && prevKey === key) nb.scrollTop = st;
}
function overview() { const L = E.lint(), bad = L.filter(x => x[0] === 'bad').length;
  return `<div class="ihead"><span class="kind">Laboratório</span><div class="nmrow"><span class="nm">${esc(S.name || 'Sem nome')}</span></div></div><div class="ibody">
  <div class="stats"><div><b>${S.devices.length}</b><span>equipamentos</span></div><div><b>${S.links.length}</b><span>enlaces</span></div><div><b style="color:${bad ? 'var(--bad)' : 'var(--good)'}">${bad}</b><span>erros</span></div></div>
  ${(S.racks || []).length ? `<div class="sec"><h4>Racks</h4><div class="rows">${S.racks.map(r => { const w = E.rackPower(r), pct = w / (r.kw * 1000); return `<div><div style="display:flex;justify-content:space-between;font-size:12.5px"><b>${esc(r.name)}</b><span class="mono">${(w / 1000).toFixed(2)} / ${r.kw} kW</span></div><div class="pbar${pct > 1 ? ' over' : pct > .8 ? ' hot' : ''}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div></div>`; }).join('')}</div></div>` : ''}
  <div class="sec"><h4>Como usar</h4><ol class="steps-how">
    <li>Escolha modelos reais no catálogo (Cisco, Juniper, Arista, HPE, Dell, Huawei, Fortinet…), servidores de rack e chassis blade. Ligue com <b>Conectar</b> (tecla C).</li>
    <li>Monte a elevação física em <b>Racks</b> (tecla R): arraste os equipamentos para as posições de U e acompanhe o consumo.</li>
    <li><b>Importar config</b> lê a configuração de um equipamento real (colada ou de arquivo) e aplica no lab.</li>
    <li>Clique num equipamento para abrir o <b>console</b> dele. Tab completa comandos e <b>?</b> mostra as opções.</li>
    <li>Ou configure pelo inspetor: portas, VLANs, rotas, ACL e NAT.</li>
    <li>Teste com <span class="mono">ping</span> no console ou na gaveta de baixo. O caminho aparece na bancada.</li>
    <li><b>Salvar</b> guarda o lab ${Store.mode === 'server' ? 'no servidor, com as configs de todos os sistemas em disco' : 'neste navegador'}. <b>Exportar .zip</b> baixa as configs — em “Automático”, cada equipamento no seu sistema nativo.</li></ol></div>
  <div class="sec"><h4>Armazenamento</h4><p class="note">${Store.mode === 'server' ? `Servidor ativo · dados em <span class="mono">${esc(Store.info.storage)}</span>` : 'Sem servidor: os labs ficam no armazenamento deste navegador. Rode o executável da Bancada (ou o container) para guardar em disco.'}</p></div></div>`; }
function rackPanel(r) { const ds = S.devices.filter(d => d.rack === r.id).sort((a, b) => b.ru - a.ru); const w = E.rackPower(r);
  return `<div class="ihead"><span class="kind">Rack · ${r.u}U · ${(w / 1000).toFixed(2)} de ${r.kw} kW</span><div class="nmrow"><span class="nm">${esc(r.name)}</span></div></div><div class="ibody">
  <div class="field"><span>Nome</span><input type="text" id="rk-name" data-s="rack" data-f="name" value="${esc(r.name)}"></div>
  <div class="field"><span>Altura (U)</span><input type="number" id="rk-u" min="4" max="60" data-s="rack" data-f="u" value="${esc(r.u)}"></div>
  <div class="field"><span>Orçamento (kW)</span><input type="number" id="rk-kw" min="0.5" max="60" step="0.5" data-s="rack" data-f="kw" value="${esc(r.kw)}"></div>
  <div class="sec"><h4>Equipamentos</h4>${ds.length ? `<div class="rows">${ds.map(d => `<button class="rchip" data-act="selDev" data-id="${d.id}"><span>U${d.ru}${E.unitsOf(d) > 1 ? '–' + (d.ru + E.unitsOf(d) - 1) : ''} · ${esc(d.name)}</span><small>${E.wattsOf(d)} W</small></button>`).join('')}</div>` : '<p class="note">Rack vazio. Arraste equipamentos na vista Racks.</p>'}</div>
  <div class="actions"><button class="btn danger" data-act="del">Remover rack</button></div></div>`; }
function linkPanel(l) { if (!l) return overview(); const A = dev(l.a.dev), B = dev(l.b.dev);
  const ps = (d, e, end) => `<select id="lk-${end}" data-s="link" data-end="${end}">${d.ports.map((p, k) => { const L = linkAt(d.id, k); const busy = L && L.link.id !== l.id; return busy || (isInternal(d, k) && !l.internal) ? '' : opt(k, spn(d, k) + (E.portSpeed(d, k) ? ' · ' + E.portSpeed(d, k) : ''), e.k); }).join('')}</select>`;
  const st = l.internal ? 'internal' : lkKind(l, A, B) === 'mgmt' ? 'mgmt' : linkStyle(l);
  return `<div class="ihead"><span class="kind">Enlace · ${st === 'internal' ? 'backplane do chassis' : st === 'mgmt' ? 'gerência fora de banda' : st === 'trunk' ? 'trunk 802.1Q' : st === 'routed' ? 'roteado' : 'acesso VLAN ' + st.slice(1)}</span><div class="nmrow"><span class="nm">${esc(A.name)} ↔ ${esc(B.name)}</span></div></div><div class="ibody">
  <div class="field"><span>${esc(A.name)}</span>${ps(A, l.a, 'a')}</div><div class="field"><span>${esc(B.name)}</span>${ps(B, l.b, 'b')}</div>
  <p class="note">Só aparecem as portas livres. O modo de cada porta é configurado no equipamento.</p>
  <div class="actions"><button class="btn danger" data-act="del">Remover enlace</button></div></div>`; }
function modelCard(d) { const m = modelOf(d); if (!m) return '';
  return `<div class="mcard"><div class="t"><span class="vb ${vkey(m.vendor)}" style="font:700 9.5px/1 var(--f-display);text-transform:uppercase;color:#fff;border-radius:3px;padding:4px 5px;background:var(--ink)">${esc(m.vendor)}</span><b>${esc(m.name)}</b></div>
    <dl><dt>Função</dt><dd>${esc(m.role || '—')}</dd>${d.type === 'chassis' ? '' : `<dt>Sistema</dt><dd>${esc(isHost(d.type) ? (d.os ? E.osInfo(d).name : 'Linux') + (m.bmc ? ' + ' + m.bmc : '') : d.type === 'cloud' ? osLabel(d) : VN[E.osOf(d)])}</dd>`}${m.speeds ? `<dt>Portas</dt><dd>${esc(m.speeds)}</dd>` : ''}${m.bays ? `<dt>Baias</dt><dd>${m.bays}</dd>` : ''}<dt>Altura</dt><dd>${m.u ? m.u + 'U' : d.type === 'cloud' || m.k8s ? '—' : 'no chassi'}</dd><dt>Consumo</dt><dd>${m.w ? m.w + ' W' : '—'}</dd>${m.bmc ? `<dt>Gerência</dt><dd>${esc(m.bmc)}</dd>` : ''}</dl></div>`; }
function rackFields(d) { const u = E.unitsOf(d); if (!u) return ''; const r = (S.racks || []).find(x => x.id === d.rack);
  return `<div class="sec"><h4>Instalação física</h4><div class="field"><span>Rack</span><select id="g-rack" data-s="devrack">${opt('', '— fora do rack —', r ? r.id : '')}${(S.racks || []).map(x => opt(x.id, x.name, r ? r.id : '')).join('')}${opt('__new', '+ novo rack', '')}</select></div>
    ${r ? `<div class="field"><span>Posição (U)</span><input type="number" id="g-ru" min="1" max="${r.u}" data-s="devru" value="${esc(d.ru)}"></div><p class="note">Ocupa U${d.ru}${u > 1 ? '–' + (d.ru + u - 1) : ''} · ${E.wattsOf(d)} W. A vista Racks permite arrastar.</p>` : `<p class="note">Ocupa ${u}U. Escolha um rack para instalar.</p>`}</div>`; }
function chassisPanel(ch) { const m = modelOf(ch); if (!m) return ''; const bl = E.bladeSlots(ch), io = E.membersOf(ch).filter(x => modelOf(x)?.form === 'iom');
  let b = ''; for (let i = 1; i <= m.bays; i++) { const x = bl.find(y => +y.slot === i); b += x ? `<button class="bay" data-act="selDev" data-id="${x.id}"><b>${esc(x.name.replace(ch.name + '-', ''))}</b><small>baia ${i}</small></button>` : `<button class="bay free" data-act="addBlade" data-v="${i}">+ baia ${i}</button>`; }
  return `<div class="sec"><h4>Baias de lâminas</h4><div class="bays">${b}</div><p class="note">Lâmina: ${esc(CAT.BY[m.blade]?.vendor + ' ' + CAT.BY[m.blade]?.name)}. Cada lâmina sai ligada aos módulos de I/O pelo backplane.</p></div>
    <div class="sec"><h4>Módulos de I/O</h4><div class="rows">${io.map(x => `<button class="rchip" data-act="selDev" data-id="${x.id}"><span>${esc(x.name)}</span><small>${esc(modelOf(x)?.name || '')}</small></button>`).join('')}</div></div>`; }
function tGeral(d) { let h = `<div class="field"><span>Nome</span><input type="text" id="g-name" data-s="dev" data-f="name" value="${esc(d.name)}"></div>` + modelCard(d);
  const par = d.parent && dev(d.parent);
  if (par) h += `<div class="field"><span>Chassi</span><span><button class="btn sm" data-act="selDev" data-id="${par.id}">${esc(par.name)}</button> ${/^\d+$/.test(String(d.slot)) ? 'baia ' + d.slot : 'slot ' + esc(d.slot)}</span></div>`;
  if (d.type === 'chassis' && d.k8s) { h += clusterPanel(d) + `<div class="actions"><button class="btn danger" data-act="del">Remover cluster e nós</button></div>`; return h; }
  if (d.type === 'chassis') { h += chassisPanel(d) + rackFields(d) + `<div class="actions"><button class="btn danger" data-act="del">Remover chassi e componentes</button></div>`; return h; }
  if (d.type === 'cloud') { h += cloudPanel(d) + `<div class="actions"><button class="btn danger" data-act="del">Remover nuvem</button></div>`; return h; }
  if (isHost(d.type)) { const mg = d.ports.findIndex((p, k) => isMgmt(d, k));
    h += `<div class="field"><span>Sistema operacional</span><select data-s="os" aria-label="Sistema operacional">${d.os ? '' : opt('', 'Linux genérico (versão anterior)', '')}${E.OS_LIST.filter(([k]) => !(d.k8sRole && /^windows/.test(k))).map(([k, l]) => opt(k, l, d.os || '')).concat(d.os === 'rhcos-4.16' ? [opt('rhcos-4.16', 'Red Hat Enterprise Linux CoreOS', d.os)] : []).join('')}</select></div>`;
    if (d.os) h += `<div class="field"><span>DNS</span><input type="text" class="mono${d.dns && ip2i(d.dns) === null ? ' bad' : ''}" data-s="dev" data-f="dns" value="${esc(d.dns || '')}" placeholder="${esc(E.isWin(d) ? 'automático (8.8.8.8 se houver nuvem)' : 'via /etc/resolv.conf')}"></div>`;
    if (!modelOf(d)) { const p = d.ports[0]; const L = linkAt(d.id, 0);
      h += `<div class="field"><span>IP / prefixo</span><input type="text" id="g-ip" class="mono${ipCls(p.ip)}" data-s="port" data-k="0" data-f="ip" value="${esc(p.ip)}" placeholder="10.10.10.10/24"></div>
      <div class="field"><span>Conectado a</span><span>${L ? esc(dev(L.peer).name + ' ' + spn(dev(L.peer), L.peerK)) : '—'}</span></div>`; }
    h += `<div class="field"><span>Gateway</span><input type="text" id="g-gw" class="mono${d.gw && ip2i(d.gw) === null ? ' bad' : ''}" data-s="dev" data-f="gw" value="${esc(d.gw)}" placeholder="10.10.10.1"></div>`;
    if (modelOf(d)) { const ifs = l3ifs(d, true).filter(f => !f.mgmt); h += `<p class="note">${ifs.length ? 'Endereços: ' + ifs.map(f => `<span class="mono">${esc(E.ifName(d, f))} ${esc(cidrStr(f.c))}</span>`).join(', ') + '. ' : ''}NICs, bonds (LAG) e VLANs ficam na aba Portas — ou use <span class="mono">ip link</span> no console.</p>`; }
    if (mg >= 0) { const p = d.ports[mg]; h += `<div class="sec"><h4>${esc(modelOf(d)?.bmc || 'BMC')} — gerência fora de banda</h4>
      <div class="field"><span>IP / prefixo</span><input type="text" id="g-bmc" class="mono${ipCls(p.ip)}" data-s="port" data-k="${mg}" data-f="ip" value="${esc(p.ip)}" placeholder="10.254.0.101/24"></div>
      <div class="field"><span>Gateway</span><input type="text" id="g-bmcgw" class="mono" data-s="port" data-k="${mg}" data-f="gw" value="${esc(p.gw || '')}" placeholder="opcional"></div></div>`; }
    h += rackFields(d) + `<div class="actions"><button class="btn danger" data-act="del">Remover equipamento</button></div>`; return h; }
  if (d.type === 'sw2') h += `<div class="field"><span>Gateway de gerência</span><input type="text" id="g-gw" class="mono" data-s="dev" data-f="gw" value="${esc(d.gw)}" placeholder="10.10.30.1"></div><p class="note">O IP de gerência fica numa SVI, na aba VLANs${d.ports.some((p, k) => isMgmt(d, k)) ? ', ou na porta de gerência (aba Portas)' : ''}.</p>`;
  if (fwd(d.type)) h += loopSec(d);
  if (fwd(d.type)) h += `<div class="sec"><h4>OSPF</h4><label class="field"><span>Ativar</span><input type="checkbox" id="g-ospf" data-s="ospf" data-f="on"${d.ospf?.on ? ' checked' : ''}></label>
    <div class="field"><span>Área</span><input type="number" id="g-area" min="0" max="255" data-s="ospf" data-f="area" value="${esc(d.ospf?.area ?? 0)}"></div>
    <div class="field"><span>Router-ID</span><input type="text" id="g-rid" class="mono" data-s="ospf" data-f="rid" value="${esc(d.ospf?.rid || '')}" placeholder="automático"></div>
    <label class="field"><span>Anunciar default</span><input type="checkbox" id="g-dio" data-s="ospf" data-f="dio"${d.ospf?.dio ? ' checked' : ''}></label><p class="note">Anuncia as redes conectadas (exceto a gerência). “Anunciar default” propaga a rota padrão estática como O*E2.</p></div>`;
  if (d.type === 'fw') h += `<p class="note">Firewall: o que não for permitido nas Políticas é bloqueado. O retorno de conexões permitidas é liberado (stateful). Marque “NAT de saída” na porta WAN.</p>`;
  if (d.type === 'rtr' || d.type === 'sw3') h += `<p class="note">Sem ACL o tráfego roteado passa livre. Com qualquer regra na aba ACL, entra o deny implícito no final.</p>`;
  h += rackFields(d) + `<div class="actions"><button class="btn danger" data-act="del">Remover equipamento</button></div>`; return h; }
function portSummary(d, p, k) { const L = linkAt(d.id, k); const peer = L ? `${dev(L.peer).name} ${spn(dev(L.peer), L.peerK)}` : (p.desc || 'livre');
  let chip; if (p.shut) chip = '<span class="chip down">shutdown</span>'; else if (p.mode === 'access') chip = `<span class="chip access" style="background:${vc(p.vlan)}">VLAN ${esc(p.vlan)}</span>`; else if (p.mode === 'trunk') chip = `<span class="chip trunk">trunk ${allAllowed(p) ? 'all' : esc(p.allowed)}</span>`; else chip = `<span class="chip">${p.ip ? esc(p.ip) : 'sem IP'}${(p.subs || []).length ? ` +${p.subs.length} sub` : ''}</span>`;
  if (+p.lag && E.lagMaster(d, k) !== k) chip = `<span class="chip">membro</span>`;
  const sp = E.portSpeed(d, k); const lag = +p.lag ? `<span class="lagchip">${esc(E.lagShort(d, p.lag))}</span>` : '';
  return `<span class="pn">${spn(d, k)}${isMgmt(d, k) ? '<span class="speed">mgmt</span>' : isInternal(d, k) ? '<span class="speed">int</span>' : ''}</span><span class="peer">${sp ? `<span class="speed" style="margin:0 4px 0 0">${esc(sp)}</span>` : ''}${esc(peer)}${lag}</span>${chip}`; }
function portUsed(d, p, k) { return !!linkAt(d.id, k) || p.mode === 'routed' && (p.ip || (p.subs || []).length) || p.mode === 'trunk' || (p.mode === 'access' && +p.vlan !== 1) || +p.lag || p.desc || p.shut; }
function tPortas(d) { const sw = isSw(d.type), host = isHost(d.type); const many = d.ports.length > 12; const q = (UI.pq2 || '').toLowerCase();
  const list = d.ports.map((p, k) => k).filter(k => { const p = d.ports[k]; if (q && !spn(d, k).toLowerCase().includes(q) && !(p.desc || '').toLowerCase().includes(q)) return false; return !many || UI.pf === 'all' || portUsed(d, p, k) || isMgmt(d, k); });
  const lagNote = sw ? 'LAG = número do port-channel (LACP). Todas as portas com o mesmo número formam o agregado; a configuração fica no agregado.' : host ? 'LAG = bond (802.3ad). Portas com o mesmo número formam o bond; IPs e VLANs ficam no bond.' : 'LAG agrega portas roteadas (ae/Port-channel); o IP fica no agregado.';
  return `<p class="note">${sw ? 'Access coloca a porta numa VLAN. Trunk leva várias VLANs com tag 802.1Q.' : host ? 'Placas de rede do servidor. Use subinterfaces para as VLANs (ex.: bond0.100).' : 'Portas roteadas. Use subinterfaces para router-on-a-stick.'} ${lagNote}</p>
  ${many ? `<div class="pfilter"><input type="search" id="pq2" placeholder="Filtrar portas…" value="${esc(UI.pq2 || '')}" aria-label="Filtrar portas"><div class="seg"><button data-act="pf" data-v="used" aria-pressed="${UI.pf !== 'all'}">Em uso</button><button data-act="pf" data-v="all" aria-pressed="${UI.pf === 'all'}">Todas ${d.ports.length}</button></div></div>` : ''}
  <div class="rows">${list.map(k => { const p = d.ports[k]; const key = d.id + ':' + k; const mg = isMgmt(d, k), member = +p.lag && E.lagMaster(d, k) !== k;
  let b = '';
  if (mg) { b += `<div class="field"><span>IP / prefixo</span><input type="text" id="p${k}-ip" class="mono${ipCls(p.ip)}" data-s="port" data-k="${k}" data-f="ip" value="${esc(p.ip)}" placeholder="10.254.0.10/24"></div><div class="field"><span>Gateway (VRF mgmt)</span><input type="text" id="p${k}-gw" class="mono${p.gw && ip2i(p.gw) === null ? ' bad' : ''}" data-s="port" data-k="${k}" data-f="gw" value="${esc(p.gw || '')}" placeholder="opcional"></div><p class="note">Porta de gerência fora de banda: fica numa VRF separada e não participa do roteamento do plano de dados.</p>`; }
  else if (member) { const ms = E.lagMembers(d, p.lag); b += `<p class="note">Membro do ${esc(E.lagShort(d, p.lag))} (${ms.map(x => spn(d, x)).join(', ')}). A configuração fica em ${spn(d, ms[0])}.</p>`; }
  else {
    const modes = sw ? [['access', 'access'], ['trunk', 'trunk'], ...(d.type === 'sw3' ? [['routed', 'roteada (no switchport)']] : [])] : [['routed', 'roteada']];
    if (modes.length > 1) b += `<div class="field"><span>Modo</span><select id="p${k}-mode" data-s="port" data-k="${k}" data-f="mode">${modes.map(([v, l]) => opt(v, l, p.mode)).join('')}</select></div>`;
    if (p.mode === 'access') b += `<div class="field"><span>VLAN</span><input type="number" id="p${k}-vlan" min="1" max="4094" data-s="port" data-k="${k}" data-f="vlan" value="${esc(p.vlan)}"></div>`;
    if (p.mode === 'trunk') b += `<div class="field"><span>VLANs permitidas</span><input type="text" id="p${k}-allowed" class="mono" data-s="port" data-k="${k}" data-f="allowed" value="${esc(p.allowed)}" placeholder="todas · ex.: 10,20,30-35"></div><div class="field"><span>Native VLAN</span><input type="number" id="p${k}-native" min="1" max="4094" data-s="port" data-k="${k}" data-f="native" value="${esc(p.native || 1)}"></div>`;
    if (p.mode === 'routed') { if (fwd(d.type) && vrfNames(d).length) b += `<div class="field"><span>VRF</span>${vrfSel(d, p.vrf, `id="p${k}-vrf" data-s="port" data-k="${k}" data-f="vrf"`)}</div>`;
      b += `<div class="field"><span>IP / prefixo</span><input type="text" id="p${k}-ip" class="mono${ipCls(p.ip)}" data-s="port" data-k="${k}" data-f="ip" value="${esc(p.ip)}" placeholder="${host ? '10.100.0.11/24' : '10.0.0.1/30'}"></div>`;
      if (fwd(d.type) && !host) b += `<label class="field"><span>MPLS (LDP)</span><input type="checkbox" id="p${k}-mpls" data-s="port" data-k="${k}" data-f="mpls"${p.mpls ? ' checked' : ''}></label>`;
      if (!host) b += `<div class="field"><span>IP virtual (VRRP)</span><input type="text" id="p${k}-vip" class="mono${p.vip && ip2i(p.vip) === null ? ' bad' : ''}" data-s="port" data-k="${k}" data-f="vip" value="${esc(p.vip || '')}" placeholder="opcional"></div>`;
      if (d.type === 'rtr' || d.type === 'fw') b += `<label class="field"><span>NAT de saída</span><input type="checkbox" id="p${k}-nat" data-s="port" data-k="${k}" data-f="nat"${p.nat ? ' checked' : ''}></label>`;
      if (!sw) b += `<div class="sec"><h4>Subinterfaces 802.1Q</h4>${(p.subs || []).map((s, i) => `<div class="row ${!host && vrfNames(d).length ? 'r5' : 'r4'}"><input type="number" id="s${k}-${i}-vlan" min="1" max="4094" data-s="sub" data-k="${k}" data-i="${i}" data-f="vlan" value="${esc(s.vlan)}" aria-label="VLAN"><input type="text" id="s${k}-${i}-ip" class="mono${ipCls(s.ip)}" data-s="sub" data-k="${k}" data-i="${i}" data-f="ip" value="${esc(s.ip)}" placeholder="10.10.10.1/24" aria-label="IP">${host ? '<span></span>' : `<input type="text" id="s${k}-${i}-vip" class="mono" data-s="sub" data-k="${k}" data-i="${i}" data-f="vip" value="${esc(s.vip || '')}" placeholder="VIP" aria-label="IP virtual VRRP">`}${!host && vrfNames(d).length ? vrfSel(d, s.vrf, `id="s${k}-${i}-vrf" data-s="sub" data-k="${k}" data-i="${i}" data-f="vrf"`) : ''}<button class="btn sm ghost danger" data-act="delSub" data-k="${k}" data-i="${i}" aria-label="Remover">✕</button></div>`).join('')}
        <div class="actions"><button class="btn sm" data-act="addSub" data-k="${k}">+ subinterface</button></div></div>`; } }
  if (!mg && !isInternal(d, k)) b += `<div class="field"><span>LAG</span><input type="number" id="p${k}-lag" min="0" max="4096" data-s="port" data-k="${k}" data-f="lag" value="${esc(+p.lag || '')}" placeholder="${host ? 'bond: 1 = bond0' : 'nº do port-channel'}"></div>`;
  b += `<div class="field"><span>Descrição</span><input type="text" id="p${k}-desc" data-s="port" data-k="${k}" data-f="desc" value="${esc(p.desc)}"></div><label class="field"><span>Shutdown</span><input type="checkbox" id="p${k}-shut" data-s="port" data-k="${k}" data-f="shut"${p.shut ? ' checked' : ''}></label>`;
  return `<details class="prow" data-pk="${key}"${UI.open.has(key) ? ' open' : ''}><summary>${portSummary(d, p, k)}</summary><div class="pbody">${b}</div></details>`; }).join('') || '<p class="note">Nenhuma porta em uso. Mostre “Todas”.</p>'}</div>`; }
function tVlans(d) { return `<div class="sec"><h4>Banco de VLANs</h4><p class="note">A VLAN 1 (default) sempre existe.</p><div class="rows">${d.vlans.map((v, i) => `<div class="row r2"><span class="chip access" style="background:${vc(v.id)};text-align:center">${esc(v.id)}</span><input type="text" id="v${i}-name" data-s="vlan" data-i="${i}" data-f="name" value="${esc(v.name)}" aria-label="Nome da VLAN ${v.id}"><button class="btn sm ghost danger" data-act="delVlan" data-i="${i}" aria-label="Remover">✕</button></div>`).join('')}
  <div class="row r2"><input type="number" id="nv-id" min="2" max="4094" placeholder="ID" aria-label="ID"><input type="text" id="nv-name" placeholder="NOME" aria-label="Nome"><button class="btn sm pri" data-act="addVlan">Criar</button></div></div></div>
  <div class="sec"><h4>${d.type === 'sw3' ? 'SVIs (gateway das VLANs)' : 'SVI de gerência'}</h4>${d.type === 'sw3' ? '<p class="note">IP virtual (VRRP): use o mesmo VIP nos dois switches do par; o de IP real maior vira master.</p>' : ''}<div class="rows">${d.svis.map((s, i) => `<div class="row ${d.type === 'sw3' && vrfNames(d).length ? 'r5' : 'r4'}"><span class="mono">Vlan${esc(s.vlan)}</span><input type="text" id="sv${i}-ip" class="mono${ipCls(s.ip, true)}" data-s="svi" data-i="${i}" data-f="ip" value="${esc(s.ip)}" aria-label="IP da SVI">${d.type === 'sw3' ? `<input type="text" id="sv${i}-vip" class="mono${s.vip && ip2i(s.vip) === null ? ' bad' : ''}" data-s="svi" data-i="${i}" data-f="vip" value="${esc(s.vip || '')}" placeholder="VIP" aria-label="IP virtual VRRP">` : '<span></span>'}${d.type === 'sw3' && vrfNames(d).length ? vrfSel(d, s.vrf, `id="sv${i}-vrf" data-s="svi" data-i="${i}" data-f="vrf"`) : ''}<button class="btn sm ghost danger" data-act="delSvi" data-i="${i}" aria-label="Remover">✕</button></div>${d.type === 'sw3' ? `<div class="flags"><label><input type="checkbox" data-s="svi" data-i="${i}" data-f="agw"${s.agw ? ' checked' : ''}> anycast gateway</label><label><input type="checkbox" data-s="svi" data-i="${i}" data-f="mpls"${s.mpls ? ' checked' : ''}> MPLS</label></div>` : ''}`).join('')}
  <div class="row r2"><input type="number" id="ns-vlan" min="1" max="4094" placeholder="VLAN" aria-label="VLAN"><input type="text" id="ns-ip" class="mono" placeholder="10.10.10.1/24" aria-label="IP"><button class="btn sm pri" data-act="addSvi">Criar</button></div></div></div>${vxSec(d)}`; }
const vrfNames = d => (d.vrfs || []).map(v => v.name);
const vrfSel = (d, cur, attrs, label) => `<select ${attrs} aria-label="${label || 'VRF'}">${opt('', 'global', cur || '')}${vrfNames(d).map(n => opt(n, n, cur || '')).join('')}</select>`;
function tRotas(d) { const hasV = fwd(d.type) && vrfNames(d).length; const rv = hasV && vrfNames(d).includes(UI.rtVrf) ? UI.rtVrf : '';
  return `<div class="sec"><h4>Rotas estáticas</h4><p class="note">Próximo salto em IP ou <span class="mono">Null0</span> (blackhole — útil para anunciar um agregado no BGP).</p><div class="rows">${d.routes.map((r, i) => `<div class="row ${hasV ? 'rr4' : 'r3'}"><input type="text" id="r${i}-dst" class="mono${ipCls(r.dst, true)}" data-s="route" data-i="${i}" data-f="dst" value="${esc(r.dst)}" aria-label="Destino"><input type="text" id="r${i}-nh" class="mono${ip2i(r.nh) === null && !/^null0$/i.test(r.nh) ? ' bad' : ''}" data-s="route" data-i="${i}" data-f="nh" value="${esc(r.nh)}" aria-label="Próximo salto">${hasV ? vrfSel(d, r.vrf, `id="r${i}-vrf" data-s="route" data-i="${i}" data-f="vrf"`) : ''}<button class="btn sm ghost danger" data-act="delRoute" data-i="${i}" aria-label="Remover">✕</button></div>`).join('')}
  <div class="row ${hasV ? 'rr4' : 'r3'}"><input type="text" id="nr-dst" class="mono" placeholder="0.0.0.0/0" aria-label="Destino"><input type="text" id="nr-nh" class="mono" placeholder="próximo salto" aria-label="Próximo salto">${hasV ? vrfSel(d, rv, 'id="nr-vrf"') : ''}<button class="btn sm pri" data-act="addRoute">Adicionar</button></div></div></div>
  <div class="sec"><div style="display:flex;align-items:center;gap:8px"><h4 style="flex:1">Tabela de roteamento</h4>${hasV ? vrfSel(d, rv, 'id="rt-vrf" data-s="uivrf" data-f="rtVrf"', 'Tabela da VRF') : ''}</div><pre class="cfg">${esc(E.routeTable(d, null, rv))}</pre></div>${fwd(d.type) && E.mplsOn(d) ? `<div class="sec"><h4>MPLS / LDP</h4><p class="note">Liga MPLS na interface (aba Portas). O LDP distribui rótulos para as rotas do IGP; o LSP até o PE remoto precisa de MPLS em todas as interfaces do caminho.</p><pre class="cfg">${esc(E.showLdp(d) + '\n\n' + E.showLfib(d))}</pre></div>` : ''}`; }
function tVrf(d) { const vs = d.vrfs || [];
  const members = n => { const o = []; d.ports.forEach((p, k) => { if (isMgmt(d, k)) return; if ((p.vrf || '') === n && p.mode === 'routed' && !(+p.lag && E.lagMaster(d, k) !== k)) o.push(+p.lag ? E.lagShort(d, p.lag) : spn(d, k)); (p.subs || []).forEach(x => { if ((x.vrf || '') === n) o.push((+p.lag ? E.lagShort(d, p.lag) : spn(d, k)) + '.' + x.vlan); }); }); (d.svis || []).forEach(x => { if ((x.vrf || '') === n) o.push('Vlan' + x.vlan); }); return o; };
  return `<p class="note">Cada VRF tem tabela de roteamento própria e isolada. Com route-targets ela vira uma L3VPN: as rotas da VRF vão para os outros PEs por BGP VPNv4 (sobre MPLS/LDP) e voltam por importação; com L3VNI, vão por EVPN tipo 5 sobre VXLAN. Coloque interfaces na VRF pela aba Portas${isSw(d.type) ? ' (portas roteadas e SVIs na aba VLANs)' : ''}. Rotas estáticas, OSPF e BGP podem ser por VRF. A VRF de gerência fica só na porta de gerência.</p>
  <div class="rows">${vs.map((v, i) => `<div class="mcard"><div class="row r3"><input type="text" id="vf${i}-name" class="mono" data-s="vrfx" data-i="${i}" data-f="name" value="${esc(v.name)}" aria-label="Nome da VRF"><input type="text" id="vf${i}-rd" class="mono" data-s="vrfx" data-i="${i}" data-f="rd" value="${esc(v.rd || '')}" placeholder="RD" aria-label="Route distinguisher"><button class="btn sm ghost danger" data-act="delVrf" data-i="${i}" aria-label="Remover VRF">✕</button></div>
    <label class="field"><span>OSPF na VRF</span><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="vf${i}-ospf" data-s="vrfx" data-i="${i}" data-f="ospfOn"${v.ospf && v.ospf.on ? ' checked' : ''}> área <input type="number" id="vf${i}-area" min="0" max="255" style="width:70px" data-s="vrfx" data-i="${i}" data-f="ospfArea" value="${esc(v.ospf ? v.ospf.area || 0 : 0)}"> <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="vf${i}-dio" data-s="vrfx" data-i="${i}" data-f="ospfDio"${v.ospf && v.ospf.dio ? ' checked' : ''}>default</label></span></label>
    <div class="row r3"><input type="text" id="vf${i}-rti" class="mono${v.rtImp && !E.rtList(v.rtImp).length ? ' bad' : ''}" data-s="vrfx" data-i="${i}" data-f="rtImp" value="${esc(v.rtImp || '')}" placeholder="RT import (65000:101)" aria-label="Route-target de importação"><input type="text" id="vf${i}-rte" class="mono${v.rtExp && !E.rtList(v.rtExp).length ? ' bad' : ''}" data-s="vrfx" data-i="${i}" data-f="rtExp" value="${esc(v.rtExp || '')}" placeholder="RT export" aria-label="Route-target de exportação"><input type="number" id="vf${i}-l3" min="0" max="16777214" style="width:110px" data-s="vrfx" data-i="${i}" data-f="l3vni" value="${esc(v.l3vni || '')}" placeholder="L3VNI" aria-label="L3VNI (EVPN)"></div>
    <div class="note">Interfaces: ${members(v.name).map(x => `<span class="mono">${esc(x)}</span>`).join(', ') || 'nenhuma'}</div></div>`).join('')}
  <div class="row r3"><input type="text" id="nvrf-name" class="mono" placeholder="nome da VRF" aria-label="Nome da nova VRF"><input type="text" id="nvrf-rd" class="mono" placeholder="RD (opcional)" aria-label="RD"><button class="btn sm pri" data-act="addVrf">Criar VRF</button></div></div>`; }
function tBgp(d) { const b = d.bgp; if (!b) return `<p class="note">BGP desligado neste equipamento.</p><div class="row r3"><input type="number" id="nbgp-asn" min="1" max="4294967295" placeholder="ASN (ex.: 65020)" aria-label="Número do AS"><input type="text" id="nbgp-rid" class="mono" placeholder="router-id (opcional)" aria-label="Router-ID"><button class="btn sm pri" data-act="bgpOn">Ativar BGP</button></div>`;
  E.computeOspf(); const ss = (E.bgpState().BSESS[d.id] || []); const hasV = vrfNames(d).length;
  const stOf = n => ss.find(x => x.nb === n); const tbl = [['', 'global (IPv4)'], ...vrfNames(d).map(v => [v, 'VRF ' + v]), ...((b.neighbors || []).some(n => n.vpnv4) ? [['#vpnv4', 'VPNv4']] : []), ...((b.neighbors || []).some(n => n.evpn) ? [['#evpn', 'L2VPN EVPN']] : [])]; const bv = tbl.some(t => t[0] === UI.bgpVrf) ? UI.bgpVrf : '';
  const vrfs = ['', ...vrfNames(d)];
  return `<div class="field"><span>AS local</span><input type="number" id="bgp-asn" min="1" max="4294967295" data-s="bgp" data-f="asn" value="${esc(b.asn)}"></div><div class="field"><span>Router-ID</span><input type="text" id="bgp-rid" class="mono" data-s="bgp" data-f="rid" value="${esc(b.rid || '')}" placeholder="${esc(E.bgpRid(d))} (automático)"></div><div class="actions"><button class="btn sm ghost danger" data-act="bgpOff">Desligar BGP</button></div>
  <div class="sec"><h4>Vizinhos</h4><div class="rows">${(b.neighbors || []).map((n, i) => { const st = stOf(n); const up = st && st.state === 'Established';
    return `<div class="mcard"><div class="row ${hasV ? 'nbr' : 'r3'}"><input type="text" id="nb${i}-ip" class="mono${ip2i(n.ip) === null ? ' bad' : ''}" data-s="bnb" data-i="${i}" data-f="ip" value="${esc(n.ip)}" aria-label="IP do vizinho"><input type="number" id="nb${i}-ras" min="1" data-s="bnb" data-i="${i}" data-f="ras" value="${esc(n.ras)}" aria-label="AS remoto" title="remote-as">${hasV ? vrfSel(d, n.vrf, `id="nb${i}-vrf" data-s="bnb" data-i="${i}" data-f="vrf"`) : ''}<button class="btn sm ghost danger" data-act="delNb" data-i="${i}" aria-label="Remover vizinho">✕</button></div>
      <input type="text" id="nb${i}-desc" data-s="bnb" data-i="${i}" data-f="desc" value="${esc(n.desc || '')}" placeholder="descrição" aria-label="Descrição">
      ${n.vrf ? '' : `<div class="flags"><span class="mini">famílias:</span><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="v4"${n.noV4 ? '' : ' checked'}> IPv4</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="vpnv4"${n.vpnv4 ? ' checked' : ''}> VPNv4</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="evpn"${n.evpn ? ' checked' : ''}> EVPN</label></div>`}
      <div class="row nbx"><select data-s="bnb" data-i="${i}" data-f="us" aria-label="update-source">${opt('', 'origem: interface de saída', n.us ?? '')}${(d.loops || []).map(l => opt(String(l.id), `update-source Lo${l.id}`, n.us ?? '')).join('')}</select><select data-s="bnb" data-i="${i}" data-f="rmIn" aria-label="route-map de entrada">${opt('', 'sem route-map in', n.rmIn || '')}${(d.rmaps || []).map(m => opt(m.name, 'in: ' + m.name, n.rmIn || '')).join('')}</select><select data-s="bnb" data-i="${i}" data-f="rmOut" aria-label="route-map de saída">${opt('', 'sem route-map out', n.rmOut || '')}${(d.rmaps || []).map(m => opt(m.name, 'out: ' + m.name, n.rmOut || '')).join('')}</select></div>
      <div class="flags"><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="sc"${n.sc ? ' checked' : ''}> send-community</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="rrc"${n.rrc ? ' checked' : ''}> cliente do RR</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="mh"${n.mh ? ' checked' : ''}> ebgp-multihop</label></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px"><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="nhs"${n.nhs ? ' checked' : ''}> next-hop-self</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="dio"${n.dio ? ' checked' : ''}> default-originate</label><label><input type="checkbox" data-s="bnb" data-i="${i}" data-f="shut"${n.shut ? ' checked' : ''}> shutdown</label></div>
      <div style="font-size:12.5px"><span class="pill ${up ? 'ok' : 'warn'}">${esc(st ? st.state : '—')}</span> ${up ? `${+n.ras === +b.asn ? 'iBGP' : 'eBGP'} · recebidos ${st.rcv} · enviados ${st.sent}` : esc(st && st.why || '')}</div></div>`; }).join('')}
    <div class="row ${hasV ? 'nbr' : 'r3'}"><input type="text" id="nnb-ip" class="mono" placeholder="IP do vizinho" aria-label="IP do novo vizinho"><input type="number" id="nnb-ras" min="1" placeholder="AS remoto" aria-label="AS remoto">${hasV ? vrfSel(d, '', 'id="nnb-vrf"') : ''}<button class="btn sm pri" data-act="addNb">+</button></div></div></div>
  <div class="sec"><h4>Anúncios</h4><p class="note"><span class="mono">network</span> só anuncia se a rota exata existir na tabela (conectada, estática — inclusive Null0 — ou OSPF).</p><div class="rows">${(b.networks || []).map((n, i) => `<div class="row ${hasV ? 'r3' : 'r2n'}"><input type="text" id="bn${i}" class="mono${pc(n.pfx) ? '' : ' bad'}" data-s="bnet" data-i="${i}" data-f="pfx" value="${esc(n.pfx)}" aria-label="Rede anunciada">${hasV ? vrfSel(d, n.vrf, `data-s="bnet" data-i="${i}" data-f="vrf"`) : ''}<button class="btn sm ghost danger" data-act="delNet" data-i="${i}" aria-label="Remover">✕</button></div>`).join('')}
    <div class="row ${hasV ? 'r3' : 'r2n'}"><input type="text" id="nbn-pfx" class="mono" placeholder="10.100.0.0/16" aria-label="Nova rede">${hasV ? vrfSel(d, '', 'id="nbn-vrf"') : ''}<button class="btn sm pri" data-act="addNet">+ network</button></div></div>
    <div class="rows">${vrfs.map(v => `<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px;align-items:center"><span class="mono" style="min-width:90px">${v ? esc(v) : 'global'}</span>${['connected', 'static', 'ospf'].map(src => `<label><input type="checkbox" data-s="bred" data-src="${src}" data-vrf="${esc(v)}"${(b.redist || []).some(r => r.src === src && (r.vrf || '') === v) ? ' checked' : ''}> redistribute ${src}</label>`).join('')}</div>`).join('')}</div></div>
  <div class="sec"><div style="display:flex;align-items:center;gap:8px"><h4 style="flex:1">Tabela BGP</h4>${tbl.length > 1 ? `<select id="bgp-vrf" data-s="uivrf" data-f="bgpVrf" aria-label="Tabela BGP">${tbl.map(([v, l]) => opt(v, l, bv)).join('')}</select>` : ''}</div><pre class="cfg">${esc(bv === '#vpnv4' ? E.showVpn(d, 'vpnv4') : bv === '#evpn' ? E.showVpn(d, 'evpn') : E.showBgp(d, bv))}</pre></div>`; }
function renameVrf(d, a, b) { const fix = o => { if (o && o.vrf === a) o.vrf = b; }; d.ports.forEach(p => { fix(p); (p.subs || []).forEach(fix); }); (d.svis || []).forEach(fix); (d.routes || []).forEach(fix); if (d.bgp) ['neighbors', 'networks', 'redist'].forEach(k => (d.bgp[k] || []).forEach(fix)); }
function dropVrf(d, n) { d.vrfs = (d.vrfs || []).filter(v => v.name !== n); const clr = o => { if (o && o.vrf === n) o.vrf = ''; }; d.ports.forEach(p => { clr(p); (p.subs || []).forEach(clr); }); (d.svis || []).forEach(clr); d.routes = (d.routes || []).filter(r => (r.vrf || '') !== n); if (d.bgp) ['neighbors', 'networks', 'redist'].forEach(k => d.bgp[k] = (d.bgp[k] || []).filter(x => (x.vrf || '') !== n)); }
/* ---------- loopbacks, VXLAN e políticas BGP ---------- */
const seqSort = rs => (rs || []).map((r, j) => ({ r, j })).sort((a, b) => (+a.r.seq || 0) - (+b.r.seq || 0));
function loopSec(d) { const ls = d.loops || []; const hasV = vrfNames(d).length;
  return `<div class="sec"><h4>Loopbacks</h4><p class="note">Router-ID, origem das sessões iBGP (update-source), LSR-ID do LDP e endereço do VTEP VXLAN. Use máscara /32 e anuncie no OSPF.</p><div class="rows">${ls.map((l, i) => `<div class="row lo4"><span class="mono">Lo${esc(l.id)}</span><input type="text" id="lo${i}-ip" class="mono${ipCls(l.ip)}" data-s="loop" data-i="${i}" data-f="ip" value="${esc(l.ip)}" placeholder="10.255.0.1/32" aria-label="IP da Loopback${esc(l.id)}">${hasV ? vrfSel(d, l.vrf, `id="lo${i}-vrf" data-s="loop" data-i="${i}" data-f="vrf"`) : '<span></span>'}<input type="text" id="lo${i}-desc" data-s="loop" data-i="${i}" data-f="desc" value="${esc(l.desc || '')}" placeholder="descrição" aria-label="Descrição"><button class="btn sm ghost danger" data-act="delLoop" data-i="${i}" aria-label="Remover loopback">✕</button></div>`).join('')}
  <div class="actions"><button class="btn sm" data-act="addLoop">+ loopback</button></div></div></div>`; }
function vxSec(d) { if (d.type !== 'sw3') return ''; const vx = d.vxlan; const lo = d.loops || [];
  if (!vx) return `<div class="sec"><h4>VXLAN / EVPN</h4><p class="note">Estende VLANs entre leafs por cima do underlay IP, com o VTEP numa loopback. Os VTEPs remotos são aprendidos por BGP EVPN (rota tipo 3) ou listados à mão.</p><div class="actions"><button class="btn sm" data-act="vxOn">Ativar VXLAN</button></div></div>`;
  E.computeOspf(); const ev = E.EVX()[d.id] || {}; const vt = E.vtepIp(d); const l3 = new Set((d.vrfs || []).map(v => +v.l3vni).filter(Boolean));
  return `<div class="sec"><h4>VXLAN / EVPN</h4><div class="field"><span>VTEP (origem)</span><select id="vx-src" data-s="vx" data-f="src">${opt('', '— escolha a loopback —', vx.src == null ? '' : String(vx.src))}${lo.map(l => opt(String(l.id), `Lo${l.id} ${l.ip || '(sem IP)'}`, vx.src == null ? '' : String(vx.src))).join('')}</select></div>
  ${vt === null ? '<p class="note" style="color:var(--bad)">Sem VTEP: escolha uma loopback com IP (crie na aba Geral).</p>' : ''}
  <div class="row vx5 rulehd"><span>VLAN</span><span>VNI</span><span>Route-target</span><span>VTEPs estáticos</span><span></span></div>
  <div class="rows">${vx.vnis.map((x, i) => `<div><div class="row vx5"><input type="number" id="vx${i}-vlan" min="1" max="4094" data-s="vxn" data-i="${i}" data-f="vlan" value="${esc(x.vlan)}" aria-label="VLAN"><input type="number" id="vx${i}-vni" min="1" max="16777214" data-s="vxn" data-i="${i}" data-f="vni" value="${esc(x.vni)}" aria-label="VNI"><input type="text" id="vx${i}-rt" class="mono" data-s="vxn" data-i="${i}" data-f="rt" value="${esc(x.rt || '')}" placeholder="auto" aria-label="Route-target"><input type="text" id="vx${i}-peers" class="mono" data-s="vxn" data-i="${i}" data-f="peers" value="${esc(x.peers || '')}" placeholder="via EVPN" aria-label="VTEPs estáticos"><button class="btn sm ghost danger" data-act="delVni" data-i="${i}" aria-label="Remover VNI">✕</button></div>
    <div class="note" style="margin:2px 0 6px">${l3.has(+x.vni) ? 'L3VNI de uma VRF (IRB simétrico)' : 'VTEPs remotos: ' + ((ev[x.vni] || []).map(p => `${esc((dev(p.dev) || {}).name || '?')} ${i2ip(p.ip)}${p.how === 'static' ? ' (estático)' : ''}`).join(', ') || 'nenhum ainda')}</div></div>`).join('')}
  <div class="actions"><button class="btn sm" data-act="addVni">+ VNI</button><button class="btn sm ghost danger" data-act="vxOff">Remover VXLAN</button></div></div>
  <p class="note">Marque “anycast” nas SVIs para usar o mesmo gateway em todos os leafs. A L3VNI de cada VRF (roteamento entre leafs, rota EVPN tipo 5) fica na aba VRF. Ative a família EVPN nos vizinhos BGP.</p></div>`; }
function tRmap(d) { const pl = d.pfx || [], cl = d.clists || [], rm = d.rmaps || [];
  const plO = cur => opt('', '— qualquer rede —', cur || '') + pl.map(p => opt(p.name, p.name, cur || '')).join(''), clO = cur => opt('', '— qualquer —', cur || '') + cl.map(c => opt(c.name, c.name, cur || '')).join('');
  const actS = (attrs, cur) => `<select ${attrs} aria-label="Ação">${opt('permit', 'permit', cur)}${opt('deny', 'deny', cur)}</select>`;
  return `<p class="note">Políticas de BGP. A route-map é lida em ordem de sequência: a primeira que casa decide; sem nenhuma, a rota é negada. Aplique nos vizinhos (aba BGP) na entrada ou na saída.</p>
  <div class="sec"><h4>Prefix-lists</h4><div class="rows">${pl.map((p, i) => `<div class="mcard"><div class="row r2n"><input type="text" id="pl${i}-name" class="mono" data-s="pl" data-i="${i}" data-f="name" value="${esc(p.name)}" aria-label="Nome da prefix-list"><button class="btn sm ghost danger" data-act="delPl" data-i="${i}" aria-label="Remover prefix-list">✕</button></div>
    ${seqSort(p.rules).map(({ r, j }) => `<div class="rmrule"><div class="row pl4"><input type="number" min="1" data-s="plr" data-i="${i}" data-j="${j}" data-f="seq" value="${esc(r.seq)}" aria-label="Sequência" title="seq">${actS(`data-s="plr" data-i="${i}" data-j="${j}" data-f="act"`, r.act)}<input type="text" class="mono${ipCls(r.pfx, true)}" data-s="plr" data-i="${i}" data-j="${j}" data-f="pfx" value="${esc(r.pfx)}" aria-label="Rede"><button class="btn sm ghost danger" data-act="delPlr" data-i="${i}" data-j="${j}" aria-label="Remover linha">✕</button></div>
      <div class="flags"><label class="mini">ge <input type="number" min="0" max="32" class="tiny" data-s="plr" data-i="${i}" data-j="${j}" data-f="ge" value="${esc(r.ge)}" aria-label="ge (tamanho mínimo)"></label><label class="mini">le <input type="number" min="0" max="32" class="tiny" data-s="plr" data-i="${i}" data-j="${j}" data-f="le" value="${esc(r.le)}" aria-label="le (tamanho máximo)"></label><span class="mini">${!r.ge && !r.le ? 'só o prefixo exato' : `prefixos de /${r.ge || (pc(r.pfx) || {}).len || '?'} a /${r.le || 32}`}</span></div></div>`).join('')}
    <div class="actions"><button class="btn sm" data-act="addPlr" data-i="${i}">+ linha</button></div></div>`).join('')}
    <div class="row r2n"><input type="text" id="npl-name" class="mono" placeholder="PL-CLIENTES" aria-label="Nome da nova prefix-list"><button class="btn sm pri" data-act="addPl">Criar</button></div></div></div>
  <div class="sec"><h4>Community-lists</h4><div class="rows">${cl.map((c, i) => `<div class="mcard"><div class="row r2n"><input type="text" id="cl${i}-name" class="mono" data-s="cl" data-i="${i}" data-f="name" value="${esc(c.name)}" aria-label="Nome da community-list"><button class="btn sm ghost danger" data-act="delCl" data-i="${i}" aria-label="Remover community-list">✕</button></div>
    ${(c.rules || []).map((r, j) => `<div class="row cl3">${actS(`data-s="clr" data-i="${i}" data-j="${j}" data-f="act"`, r.act)}<input type="text" class="mono" data-s="clr" data-i="${i}" data-j="${j}" data-f="comm" value="${esc(r.comm)}" placeholder="65000:100 no-export" aria-label="Communities"><button class="btn sm ghost danger" data-act="delClr" data-i="${i}" data-j="${j}" aria-label="Remover linha">✕</button></div>`).join('')}
    <div class="actions"><button class="btn sm" data-act="addClr" data-i="${i}">+ linha</button></div></div>`).join('')}
    <div class="row r2n"><input type="text" id="ncl-name" class="mono" placeholder="CL-CLIENTE" aria-label="Nome da nova community-list"><button class="btn sm pri" data-act="addCl">Criar</button></div></div></div>
  <div class="sec"><h4>Route-maps</h4><div class="rows">${rm.map((m, i) => `<div class="mcard"><div class="row r2n"><input type="text" id="rm${i}-name" class="mono" data-s="rmn" data-i="${i}" data-f="name" value="${esc(m.name)}" aria-label="Nome da route-map"><button class="btn sm ghost danger" data-act="delRm" data-i="${i}" aria-label="Remover route-map">✕</button></div>
    ${seqSort(m.rules).map(({ r, j }) => { const at = f => `data-s="rmr" data-i="${i}" data-j="${j}" data-f="${f}"`; return `<div class="rmrule"><div class="row pl4"><input type="number" min="1" ${at('seq')} value="${esc(r.seq)}" aria-label="Sequência" title="seq">${actS(at('act'), r.act)}<span class="mini">sequência ${esc(r.seq)}</span><button class="btn sm ghost danger" data-act="delRmr" data-i="${i}" data-j="${j}" aria-label="Remover sequência">✕</button></div>
      <div class="kv"><span>match prefix-list</span><select ${at('mPfx')} aria-label="match prefix-list">${plO(r.mPfx)}</select><span>match community</span><select ${at('mComm')} aria-label="match community-list">${clO(r.mComm)}</select>
      ${r.act === 'deny' ? '' : `<span>set local-pref</span><input type="number" min="0" ${at('sLp')} value="${esc(r.sLp ?? '')}" placeholder="—" aria-label="set local-preference"><span>set MED</span><input type="number" min="0" ${at('sMed')} value="${esc(r.sMed ?? '')}" placeholder="—" aria-label="set metric"><span>set community</span><span class="kvc"><input type="text" class="mono" ${at('sComm')} value="${esc(r.sComm || '')}" placeholder="65000:100 no-export" aria-label="set community"><label class="mini"><input type="checkbox" ${at('sAdd')}${r.sAdd ? ' checked' : ''}> additive</label></span><span>as-path prepend</span><input type="text" class="mono" ${at('sPre')} value="${esc(r.sPre || '')}" placeholder="65000 65000" aria-label="set as-path prepend">`}</div></div>`; }).join('')}
    <div class="actions"><button class="btn sm" data-act="addRmr" data-i="${i}">+ sequência</button></div></div>`).join('')}
    <div class="row r2n"><input type="text" id="nrm-name" class="mono" placeholder="RM-CLIENTE-IN" aria-label="Nome da nova route-map"><button class="btn sm pri" data-act="addRm">Criar</button></div></div></div>`; }
function renameRef(d, kind, a, b) { (d.rmaps || []).forEach(m => m.rules.forEach(r => { if (kind === 'pl' && r.mPfx === a) r.mPfx = b; if (kind === 'cl' && r.mComm === a) r.mComm = b; }));
  if (kind === 'rm' && d.bgp) { (d.bgp.neighbors || []).forEach(n => { if (n.rmIn === a) n.rmIn = b; if (n.rmOut === a) n.rmOut = b; }); (d.bgp.redist || []).forEach(r => { if (r.rm === a) r.rm = b; }); } }
function tRegras(d) { return tRegras0(d) + (d.type === 'fw' || d.type === 'rtr' ? dnatSec(d) : ''); }
function dnatSec(d) { const R = d.dnat || []; const w = l3ifs(d).find(f => f.nat && !f.mgmt) || l3ifs(d).find(f => !f.mgmt && E.isPublic(f.c.ip));
  return `<div class="sec"><h4>Encaminhamento de portas (NAT de destino)</h4><p class="note">Quem chega no IP ${w ? `<span class="mono">${esc(E.i2ip(w.c.ip))}</span> (${esc(E.ifName(d, w))})` : 'da interface externa'} na porta externa é levado ao IP/porta interno. ${d.type === 'fw' ? 'Lembre de permitir o tráfego nas Políticas (destino = IP interno, porta interna).' : ''}</p>
    ${R.map((r, i) => `<div class="row dn5"><select data-s="dnat" data-i="${i}" data-f="proto" aria-label="Protocolo">${opt('tcp', 'TCP', r.proto)}${opt('udp', 'UDP', r.proto)}</select><input type="number" class="tiny" data-s="dnat" data-i="${i}" data-f="port" value="${esc(r.port)}" aria-label="Porta externa"><input type="text" class="mono" data-s="dnat" data-i="${i}" data-f="to" value="${esc(r.to)}" aria-label="IP interno"><input type="number" class="tiny" data-s="dnat" data-i="${i}" data-f="toPort" value="${esc(r.toPort || r.port)}" aria-label="Porta interna"><button class="btn sm ghost" data-act="dnatDel" data-i="${i}" aria-label="Remover">${ICON.x}</button></div>`).join('')}
    <div class="row dn5"><select id="ndn-proto" aria-label="Protocolo">${opt('tcp', 'TCP')}${opt('udp', 'UDP')}</select><input type="number" id="ndn-port" class="tiny" placeholder="2222" aria-label="Porta externa"><input type="text" id="ndn-to" class="mono" placeholder="10.10.0.10" aria-label="IP interno"><input type="number" id="ndn-tp" class="tiny" placeholder="22" aria-label="Porta interna"><button class="btn sm" data-act="dnatAdd">Adicionar</button></div></div>`; }
function tRegras0(d) { return `${d.aclName ? `<div class="field"><span>Nome da ACL</span><span class="mono">${esc(d.aclName)}</span></div>` : ''}<p class="note">${d.type === 'fw' ? 'Avaliadas de cima para baixo; a primeira que casar decide. O resto é bloqueado. Respostas de conexões permitidas voltam automaticamente.' : 'ACL aplicada na entrada das interfaces internas, de cima para baixo, com deny implícito no final.'}</p>
  <div class="row rule rulehd"><span>Ação</span><span>Proto</span><span>Origem</span><span>Destino</span><span>Porta</span><span></span></div>
  <div class="rows">${d.rules.map((r, i) => `<div class="row rule"><select id="ru${i}-act" data-s="rule" data-i="${i}" data-f="act">${opt('permit', 'permitir', r.act)}${opt('deny', 'negar', r.act)}</select><select id="ru${i}-proto" data-s="rule" data-i="${i}" data-f="proto">${['any', 'icmp', 'tcp', 'udp'].map(x => opt(x, x, r.proto)).join('')}</select>
    <input type="text" id="ru${i}-src" class="mono${ipCls(r.src)}" data-s="rule" data-i="${i}" data-f="src" value="${esc(r.src)}" aria-label="Origem"><input type="text" id="ru${i}-dst" class="mono${ipCls(r.dst)}" data-s="rule" data-i="${i}" data-f="dst" value="${esc(r.dst)}" aria-label="Destino"><input type="text" id="ru${i}-port" class="mono" data-s="rule" data-i="${i}" data-f="port" value="${esc(r.port)}" aria-label="Porta"${r.proto === 'tcp' || r.proto === 'udp' ? '' : ' disabled'}>
    <span class="actions"><button class="btn sm ghost" data-act="upRule" data-i="${i}" aria-label="Subir">↑</button><button class="btn sm ghost danger" data-act="delRule" data-i="${i}" aria-label="Remover">✕</button></span></div>`).join('')}</div>
  <div class="actions"><button class="btn sm pri" data-act="addRule">+ regra</button></div><p class="note">Origem e destino aceitam <span class="mono">any</span>, uma rede (<span class="mono">10.10.0.0/16</span>) ou um host (<span class="mono">10.10.40.10</span>).</p>`; }
function tConfig(d) { const host = isHost(d.type); if (d.type === 'chassis' || d.type === 'cloud') return `<div class="actions"><button class="btn" data-act="copyCfg">Copiar</button><button class="btn pri" data-act="dlCfg">Baixar</button></div><pre class="cfg" id="cfgOut">${esc(E.gen('auto', d))}</pre>`;
  return `<div class="field"><span>Sistema</span>${host ? `<span>${d.os ? esc(E.osInfo(d).name) + (E.isWin(d) ? ' — script PowerShell' : ' — script de provisionamento (pacotes, rede, serviços, firewall, VPN)') : 'Linux (netplan / iproute2)'}${modelOf(d)?.bmc ? ' + ' + esc(modelOf(d).bmc) : ''}</span>` : `<select id="vendorIn" data-s="vendor">${VENDORS.map(([v, l]) => opt(v, v === 'auto' ? `Automático — ${VN[E.osOf(d)]}` : l, UI.vendor)).join('')}</select>`}</div>
  <div class="actions"><button class="btn" data-act="copyCfg">Copiar</button><button class="btn pri" data-act="dlCfg">Baixar ${host && d.os ? (E.isWin(d) ? '.ps1' : '.sh') : '.txt'}</button>${host ? '' : '<button class="btn" data-act="importCfg">Importar / colar config</button>'}</div><pre class="cfg" id="cfgOut">${esc(E.gen(vOf(d), d))}</pre>`; }

/* ---------- gaveta, guia, topo ---------- */
function devOptions(cur, filter) { return S.devices.filter(filter || (() => true)).map(d => opt(d.id, d.name, cur)).join(''); }
function renderDrawer() {
  document.querySelectorAll('[data-dtab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dtab === UI.drawer)));
  $('#drawer').classList.toggle('closed', !UI.drawerOpen); $('#dToggle').textContent = UI.drawerOpen ? 'Recolher' : 'Expandir';
  $('#dSim').hidden = UI.drawer !== 'sim'; $('#dDiag').hidden = UI.drawer !== 'diag';
  const l3 = d => l3ifs(d).length > 0; const ss = $('#simSrc'), sd = $('#simDst'); const cs = ss.value, cd = sd.value;
  ss.innerHTML = devOptions(cs, l3); sd.innerHTML = S.devices.filter(l3).map(d => opt(d.id, `${d.name} (${i2ip(nodeIf(d).c.ip)})`, cd)).join('') + opt('ip', 'IP manual', cd);
  if (!cs || !dev(cs)) { const a = byName('PC-VENDAS') || byName('COMPUTE-01'); if (a) ss.value = a.id; } if (!cd || (cd !== 'ip' && !dev(cd))) { const b = byName('SRV-WEB') || byName('INTERNET') || byName('PC-TI'); if (b) sd.value = b.id; }
  syncSimIp(); $('#simPort').disabled = $('#simProto').value === 'icmp'; syncSimVrf();
  const L = E.lint(), bad = L.filter(x => x[0] === 'bad').length; const c = $('#diagCount'); c.hidden = !bad; c.textContent = bad;
  $('#diagList').innerHTML = L.length ? L.map(([k, t]) => `<li><span class="pill ${k}">${({ bad: 'erro', warn: 'atenção', info: 'nota' })[k]}</span><span>${esc(t)}</span></li>`).join('') : '<li><span class="pill ok">ok</span><span>Nenhum problema encontrado na topologia.</span></li>';
}
function syncSimVrf() { const d = dev($('#simSrc').value), w = $('#simVrfL'), sel = $('#simVrf'); const vs = d && fwd(d.type) ? vrfNames(d) : []; w.hidden = !vs.length; const cur = sel.value; sel.innerHTML = opt('', 'global', cur) + vs.map(n => opt(n, n, cur)).join(''); }
function syncSimIp() { const v = $('#simDst').value, ip = $('#simIp'); if (v && v !== 'ip') { const d = dev(v); if (d && nodeIf(d)) ip.value = i2ip(nodeIf(d).c.ip); ip.readOnly = true; } else ip.readOnly = false; }
function renderSimOut() { const r = UI.simRes, o = $('#simOut'); if (!r) { o.innerHTML = '<p class="note">Escolha origem e destino e envie um pacote. A ida aparece em âmbar e a volta em verde na bancada.</p>'; return; }
  o.innerHTML = `<div class="verdict ${r.ok ? 'ok' : 'no'}">${r.ok ? 'Sucesso — ida e volta completas' : 'Falhou — ' + esc(r.why || '')}</div>${r.lines.map(l => `<div>${esc(l)}</div>`).join('')}`; }
function renderGuide() { const g = $('#guide'); const G = S.guide && E.GUIDES[S.guide]; if (!G) { g.hidden = true; return; } g.hidden = false;
  const res = G.steps.map(s => { try { return !!s.ck(); } catch (e) { return false; } }); const n = res.filter(Boolean).length;
  g.innerHTML = `<header><h3>${esc(G.title)}</h3><button class="btn sm ghost" data-gact="min">${UI.guideMin ? 'Abrir' : 'Recolher'}</button></header><div class="prog" aria-label="${n} de ${G.steps.length}"><i style="width:${100 * n / G.steps.length}%"></i></div>
   ${UI.guideMin ? '' : `<p>${esc(G.intro)}</p><ol class="steps">${G.steps.map((s, i) => `<li class="${res[i] ? 'ok' : ''}"><span class="ck"></span><span class="tx">${esc(s.t)}</span><details><summary>ver solução</summary><pre>${esc(s.sol)}</pre></details></li>`).join('')}</ol>
   ${n === G.steps.length ? '<p style="color:var(--good);font-weight:600">Lab concluído. As VLANs estão isoladas e roteadas pelo core.</p>' : ''}<div><button class="btn sm ghost" data-gact="close">Sair do guia</button></div>`}`; }
function renderTop() {
  const ln = $('#labName'); if (document.activeElement !== ln) ln.value = S.name || '';
  const st = $('#status'); const where = Store.mode === 'server' ? 'servidor' : 'navegador';
  let tx; if (CUR.saving) tx = 'Salvando…'; else if (CUR.dirty) tx = CUR.id ? 'Alterações não salvas' : 'Ainda não salvo'; else if (CUR.id) tx = `Salvo no ${where}${CUR.savedAt ? ' às ' + CUR.savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`; else tx = 'Ainda não salvo';
  st.classList.toggle('dirty', CUR.dirty || !CUR.id); $('#statusTx').textContent = tx;
  $('#bUndo').disabled = !undo.length; $('#bRedo').disabled = !redo.length; $('#vendorTop').value = UI.vendor;
  $('#app').classList.toggle('noinsp', !UI.insp); $('#bInsp').setAttribute('aria-pressed', String(UI.insp));
}
function renderAll() { renderTop(); renderCanvas(); renderInspector(); renderDrawer(); renderSimOut(); renderGuide(); syncTerms(); }
function freeSpot() { let x = UI.view.cx, y = UI.view.cy, n = 0; while (S.devices.some(d => d.type !== 'chassis' && Math.abs(d.x - x) < 80 && Math.abs(d.y - y) < 80) && n < 30) { x += 90; y += 28; n++; } return [x, y]; }
function addModel(id, x, y, quiet) { const m = CAT.BY[id]; if (!m) return null; if (x === undefined) [x, y] = freeSpot(); let d;
  if (m.k8s) { const base = m.k8s === 'openshift' ? 'OCP' : m.k8s === 'k3s' ? 'K3S' : 'K8S'; let nm = base, n = 1; while (S.devices.some(x => x.name === nm || x.name.startsWith(nm + '-'))) nm = base + (++n); d = E.clusterNew(id, nm, Math.round(x), Math.round(y)); }
  else if (m.type === 'chassis') d = E.addChassis(id, E.uniqName('chassis', E.prefixFor(m, 'chassis')), Math.round(x), Math.round(y));
  else if (m.type === 'cloud') { let nm = m.kind === 'real' ? 'INTERNET' : 'INTERNET-FAKE', n = 1; while (byName(nm)) nm = (m.kind === 'real' ? 'INTERNET' : 'INTERNET-FAKE') + '-' + (++n); d = E.mkDev('cloud', nm, Math.round(x), Math.round(y), { model: id }); E.cloudNew(d, m.kind, UI.net && UI.net.host); if (m.kind === 'real') detectPub(d); }
  else { d = E.mkDev(m.type, E.uniqName(m.type, E.prefixFor(m, m.type)), Math.round(x), Math.round(y), { model: id }); if (isHost(d.type)) E.osSetup(d, 'ubuntu-24.04'); }
  UI.sel = { kind: 'dev', id: d.id }; UI.tab = 'geral'; if (!quiet) { commit(); toast(`${m.vendor === 'Internet' ? '' : m.vendor + ' '}${m.name} adicionado como ${d.name}.`); } return d; }

/* ---------- ações ---------- */
function select(s) { UI.sel = s; renderCanvas(); renderInspector(); }
function addDevice(t, x, y) { if (x === undefined) [x, y] = freeSpot();
  const d = E.mkDev(t, t === 'cloud' ? (byName('INTERNET-FAKE') ? E.uniqName(t) : 'INTERNET-FAKE') : E.uniqName(t), Math.round(x), Math.round(y)); if (t === 'cloud') E.cloudNew(d, 'fake'); if (t === 'srv') E.osSetup(d, 'ubuntu-24.04'); if (t === 'pc') E.osSetup(d, 'windows-11'); UI.sel = { kind: 'dev', id: d.id }; UI.tab = 'geral'; commit(); }
function linkClick(d) { if (d.type === 'chassis' && !E.clusterOf(d)) return; if (!UI.linkFrom) { UI.linkFrom = d.id; renderCanvas(); return; } if (UI.linkFrom === d.id) { UI.linkFrom = null; $('#gGhost').innerHTML = ''; renderCanvas(); return; }
  let a = dev(UI.linkFrom); UI.linkFrom = null; $('#gGhost').innerHTML = '';
  // nó de cluster (ou chassis) sem porta livre: liga na rede do cluster (uplink livre do switch)
  const viaSw = (x, o) => { const c = E.clusterOf(x); if (c && (x.type === 'chassis' || E.freePort(x, o) < 0)) { const sw = E.clusterSwitch(c); if (sw && sw.id !== o.id) return sw; } return x; };
  a = viaSw(a, d); d = viaSw(d, a); if (a.id === d.id) { renderCanvas(); return; }
  const ka = E.freePort(a, d), kb = E.freePort(d, a);
  if (ka < 0 || kb < 0) { toast(`${ka < 0 ? a.name : d.name} não tem porta livre.`, 'bad'); renderCanvas(); return; }
  const l = { id: E.uid('l'), a: { dev: a.id, k: ka }, b: { dev: d.id, k: kb } }; S.links.push(l); UI.sel = { kind: 'link', id: l.id }; const ca = E.cloudAttach(l); const kc = !ca && E.clusterAttach(l); commit();
  if (kc) return toast(kc.kept ? `Conectado à rede do cluster ${kc.cluster} (mantido o IP ${kc.ip}).` : `Conectado à rede do cluster ${kc.cluster}: recebeu ${kc.ip}${kc.dns ? `, DNS ${kc.dns} (resolve *.apps.${kc.domain} e api.${kc.domain})` : ''}.`);
  toast(ca ? `Conectado à nuvem: ${a.type === 'cloud' ? d.name : a.name} recebeu ${ca.peer || '(configure o IP)'} — gateway ${ca.cloud}` : `Conectado: ${a.name} ${spn(a, ka)} ↔ ${d.name} ${spn(d, kb)}`); }
function setLag(d, k, n) { const p = d.ports[k]; const old = +p.lag || 0; if (old === n) return;
  if (old) { const ms = E.lagMembers(d, old); if (ms[0] === k && ms.length > 1) { const nx = d.ports[ms[1]]; ['mode', 'vlan', 'allowed', 'native', 'ip', 'vip', 'nat'].forEach(f => nx[f] = p[f]); nx.subs = p.subs || []; p.subs = []; p.ip = ''; } }
  p.lag = 0;
  if (n) { const ms = E.lagMembers(d, n); if (ms.length) { const src = d.ports[ms[0]]; ['mode', 'vlan', 'allowed', 'native'].forEach(f => p[f] = src[f]);
      if (k < ms[0]) { p.ip = src.ip; p.vip = src.vip; p.nat = src.nat; p.subs = src.subs || []; src.ip = ''; src.subs = []; src.vip = ''; } else { p.ip = ''; p.subs = []; } }
    p.lag = n; } }
function delSel() { if (!UI.sel) return;
  if (UI.sel.kind === 'rack') { const rid2 = UI.sel.id; S.racks = (S.racks || []).filter(r => r.id !== rid2); S.devices.forEach(d => { if (d.rack === rid2) { delete d.rack; delete d.ru; } }); }
  else if (UI.sel.kind === 'dev') { const d0 = dev(UI.sel.id); const ids = new Set([UI.sel.id, ...(d0 && d0.type === 'chassis' ? E.membersOf(d0).map(x => x.id) : [])]);
    S.devices = S.devices.filter(d => !ids.has(d.id)); S.links = S.links.filter(l => !ids.has(l.a.dev) && !ids.has(l.b.dev)); ids.forEach(id => { closeTerm(id); delete E.CLI[id]; }); }
  else S.links = S.links.filter(l => l.id !== UI.sel.id); UI.sel = null; UI.hl = { f: [], r: [] }; commit(); }
function setTool(t) { UI.tool = t; UI.linkFrom = null; $('#gGhost').innerHTML = ''; renderCanvas(); }
async function exportZip() {
  if (!S.devices.length) return toast('Adicione equipamentos antes de exportar.');
  const fn = `lab-${slug(S.name)}-${UI.vendor === 'auto' ? 'nativo' : UI.vendor}.zip`; let ok = false;
  try {
    if (Store.mode === 'server') { const r = await fetch('api/export?vendor=' + encodeURIComponent(UI.vendor), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topology: S, files: E.exportFiles(UI.vendor) }) });
      if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); } ok = await download(fn, await r.blob()); }
    else if (window.JSZip) { const z = new window.JSZip(); E.exportFiles(UI.vendor).forEach(f => z.file(f.name, f.text)); ok = await download(fn, await z.generateAsync({ type: 'blob' })); }
    else return toast('Sem servidor e sem a biblioteca de compactação: baixe pela aba Config de cada equipamento.', 'bad');
  } catch (e) { return toast('Falha ao exportar: ' + e.message, 'bad'); }
  if (ok) { S.exported = true; saveDraft(); renderGuide(); }
}
async function saveLab(o = {}) {
  if (CUR.saving) return;
  if ((!CUR.id || o.asNew) && !o.name) return nameModal(!!o.asNew);
  CUR.saving = true; renderTop();
  try {
    const name = (o.name || S.name || 'Lab sem nome').trim(); S.name = name;
    let meta;
    try { meta = await Store.save(o.asNew ? null : CUR.id, name, JSON.parse(JSON.stringify(S))); }
    catch (e) { if (CUR.id && /não encontrado/.test(e.message)) meta = await Store.save(null, name, JSON.parse(JSON.stringify(S))); else throw e; }
    CUR.id = meta.id; CUR.dirty = false; CUR.savedAt = new Date(meta.updated); lastSnap = JSON.stringify(S); saveDraft();
    toast(Store.mode === 'server' ? `“${name}” salvo no servidor, com as configs de todos os sistemas.` : `“${name}” salvo neste navegador.`);
  } catch (e) { toast('Não foi possível salvar: ' + e.message, 'bad'); }
  finally { CUR.saving = false; renderTop(); renderInspector(); }
}

/* ---------- modais ---------- */
function modal(html, sm, cls) { const root = $('#modalRoot'); root.innerHTML = `<div class="scrim" data-scrim="1"><div class="modal${sm ? ' sm' : ''}${cls ? ' ' + cls : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const m = root.querySelector('.modal'); setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('input,button'); if (f) f.focus(); }, 0); return m; }
function closeModal() { $('#modalRoot').innerHTML = ''; }
function nameModal(asNew) {
  const m = modal(`<div class="mhead"><h3>${asNew ? 'Salvar como novo lab' : 'Salvar lab'}</h3></div>
    <form class="mbody" id="nmForm"><label class="field"><span>Nome do lab</span><input id="nmIn" type="text" maxlength="120" value="${esc(asNew ? (S.name || '') + ' (cópia)' : (S.name || ''))}" autofocus></label>
    <p class="note">${Store.mode === 'server' ? 'Fica guardado no servidor junto com as configurações geradas para Cisco IOS, NX-OS, Junos, EOS, AOS-CX, OS10, Huawei, RouterOS, FortiOS, VyOS e o sistema nativo de cada modelo.' : 'Fica guardado no armazenamento deste navegador.'}</p></form>
    <div class="mfoot"><button class="btn" data-m="cancel">Cancelar</button><button class="btn pri" data-m="ok">Salvar</button></div>`, true);
  const go = () => { const v = m.querySelector('#nmIn').value.trim(); if (!v) { m.querySelector('#nmIn').classList.add('bad'); return; } closeModal(); saveLab({ name: v, asNew }); };
  m.querySelector('#nmForm').addEventListener('submit', e => { e.preventDefault(); go(); });
  m.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'ok') go(); else closeModal(); });
}
async function labsModal() {
  const m = modal(`<div class="mhead"><h3>Laboratórios</h3><button class="btn sm" data-m="saveas">Salvar como cópia</button><button class="btn ghost icon" data-m="close" aria-label="Fechar">${ICON.x}</button></div>
    <div class="mbody">
      <div class="storage">${Store.mode === 'server' ? `<span class="pill ok">servidor</span><span>Labs e configs em <span class="mono">${esc(Store.info.storage)}</span> · versão ${esc(Store.info.version)}</span>` : '<span class="pill warn">navegador</span><span>Sem servidor: os labs ficam neste navegador. Rode o executável da Bancada (ou o container) para guardar em disco.</span>'}</div>
      <div class="sec"><h4>Começar um lab</h4><div class="starters">
        <button class="starter" data-m="new" data-v="pop"><b>POP Telco Cloud</b><span>Spine-leaf, PE Juniper, FortiGate, servidores Dell/HPE, chassi MX7000, OOB e racks</span></button>
        <button class="starter" data-m="new" data-v="mpls"><b>Backbone MPLS L3VPN</b><span>PEs Cisco/Huawei, P Juniper (route reflector) e Arista, LDP, dois clientes com IPs sobrepostos</span></button>
        <button class="starter" data-m="new" data-v="evpn"><b>Fabric EVPN/VXLAN</b><span>Spines NX-OS como RR, leafs NX-OS/EOS/Junos, VNIs L2, anycast gateway e L3VNI</span></button>
        <button class="starter" data-m="new" data-v="vpn"><b>IPsec e WireGuard pela Internet</b><span>FortiGate ↔ Cisco por IPsec IKEv2 na Internet fake, Ubuntu/Rocky/Windows nos sites e WireGuard entre hosts</span></button>
        <button class="starter" data-m="new" data-v="k8s"><b>Kubernetes e OpenShift</b><span>Cluster kubeadm 1+3 e OpenShift 4.16 3+2 atrás de um VyOS, com NodePort, LoadBalancer e Routes</span></button>
        <button class="starter" data-m="new" data-v="blank"><b>Lab vazio</b><span>Bancada limpa</span></button>
        <button class="starter" data-m="new" data-v="campus"><b>Campus de exemplo</b><span>VLANs, core L3, firewall com NAT</span></button>
        <button class="starter" data-m="new" data-v="department-vlan-build"><b>Guia: VLANs por departamento</b><span>Passo a passo com checklist</span></button></div></div>
      <div class="sec"><div style="display:flex;align-items:center;gap:8px"><h4 style="flex:1">Labs salvos</h4><button class="btn sm" data-m="import">Importar .json</button></div>
        <div class="lablist" id="mList"><p class="note">Carregando…</p></div></div></div>`);
  const fill = async () => { const box = m.querySelector('#mList'); if (!box) return;
    try { const list = await Store.list();
      box.innerHTML = list.length ? list.map(x => `<div class="labrow${x.id === CUR.id ? ' cur' : ''}"><div style="min-width:0"><b>${esc(x.name)}</b><small>${x.devices} equipamentos · ${x.links} enlaces · ${fmtDate(x.updated)}${x.id === CUR.id ? ' · aberto agora' : ''}</small></div>
        <div class="actions"><button class="btn sm pri" data-m="open" data-id="${x.id}">Abrir</button><button class="btn sm" data-m="dup" data-id="${x.id}">Duplicar</button><button class="btn sm" data-m="json" data-id="${x.id}">.json</button><button class="btn sm ghost danger" data-m="del" data-id="${x.id}">Excluir</button></div></div>`).join('')
        : '<p class="note">Nenhum lab salvo ainda. Monte uma topologia e use Salvar (Ctrl+S).</p>';
    } catch (e) { box.innerHTML = `<p class="note" style="color:var(--bad)">Não foi possível listar os labs: ${esc(e.message)}</p>`; } };
  fill();
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const a = b.dataset.m, id = b.dataset.id;
    const arm = (txt) => { if (b.dataset.armed) return true; b.dataset.armed = '1'; const t = b.querySelector('span') || b; b.dataset.orig = t.textContent; t.textContent = txt; return false; };
    try {
      if (a === 'close') return closeModal();
      if (a === 'saveas') { closeModal(); return nameModal(true); }
      if (a === 'import') return $('#fileIn').click();
      if (a === 'new') { if (CUR.dirty && !arm('Clique de novo para descartar as alterações atuais')) return;
        const v = b.dataset.v; const topo = v === 'pop' ? E.samplePOP() : v === 'mpls' ? E.sampleMPLS() : v === 'evpn' ? E.sampleEVPN() : v === 'vpn' ? E.sampleVPN() : v === 'k8s' ? E.sampleK8s() : v === 'campus' ? E.sampleCampus() : v === 'department-vlan-build' ? E.guideTopo() : E.blank('Novo lab'); closeModal(); loadState(topo);
        if (v === 'campus' || v === 'pop' || v === 'mpls' || v === 'evpn') runDemoPing(); return; }
      if (a === 'open') { if (CUR.dirty && id !== CUR.id && !arm('Descartar e abrir')) return; const r = await Store.get(id); closeModal(); loadState(r.topology, { id: r.meta.id, savedAt: new Date(r.meta.updated) }); toast(`“${r.meta.name}” aberto.`); return; }
      if (a === 'dup') { const r = await Store.get(id); const meta = await Store.save(null, r.meta.name + ' (cópia)', r.topology); toast(`Cópia criada: ${meta.name}`); return fill(); }
      if (a === 'json') { const r = await Store.get(id); return download(`${slug(r.meta.name)}.json`, JSON.stringify(r.topology, null, 2), 'application/json'); }
      if (a === 'del') { if (!arm('Confirmar exclusão')) return; await Store.remove(id); if (id === CUR.id) { CUR.id = null; CUR.dirty = true; saveDraft(); renderTop(); } toast('Lab excluído.'); return fill(); }
    } catch (err) { toast('Erro: ' + err.message, 'bad'); }
  });
}
function runDemoPing() { const a = byName('PC-VENDAS') || byName('COMPUTE-01') || byName('PC-A-SP') || byName('WEB-01'), b = byName('SRV-WEB') || byName('INTERNET') || byName('PC-A-RJ') || byName('DB-01'); if (!a || !b) return; const r = E.simulate(a.id, i2ip(nodeIf(b).c.ip), 'icmp'); UI.simRes = r; UI.hl = { f: r.f, r: r.r }; UI.drawer = 'sim'; renderCanvas(); renderDrawer(); $('#simSrc').value = a.id; $('#simDst').value = b.id; syncSimIp(); renderSimOut(); }

/* ---------- importar / colar config ---------- */
const GUESS = { nxos: 'cisco-n9k-93180yc-fx', eos: 'arista-7050sx3-48yc8', aoscx: 'hpe-aruba-8325-48y8c', os10: 'dell-s5248f-on', huawei: 'huawei-ce6881-48s6cq', vyos: 'vyos-virtual', fortios: 'fortinet-fg-600f' };
function guessModel(cfg) { const f = cfg.format, sw = cfg.vlans.length || cfg.svis.length;
  if (f === 'junos') return sw ? 'juniper-qfx5120-48y' : 'juniper-mx204'; if (f === 'cisco') return sw ? 'cisco-c9300-48p' : 'cisco-asr1001-x'; if (f === 'routeros') return 'gen:rtr'; return GUESS[f] || 'gen:sw3'; }
function importModal(target) {
  const d = target || selDev(); const okSel = d && !isHost(d.type) && d.type !== 'chassis';
  const models = CAT.MODELS.filter(m => !m.hidden && m.type !== 'srv' && m.type !== 'chassis');
  const fmts = Object.entries(E.FMT_NAMES);
  const m = modal(`<div class="mhead"><h3>Importar configuração</h3><button class="btn ghost icon" data-m="close" aria-label="Fechar">${ICON.x}</button></div>
    <div class="mbody">
      <p class="note">Cole a saída de <span class="mono">show running-config</span>, <span class="mono">show configuration | display set</span>, <span class="mono">display current-configuration</span>, <span class="mono">/export</span> ou <span class="mono">show full-configuration</span> — ou abra o arquivo de backup. Interfaces, VLANs, trunks, LAGs, SVIs, VRRP, VRFs, rotas (inclusive Null0), OSPF, BGP, ACLs e NAT entram no lab; os nomes de porta são convertidos para o modelo de destino.</p>
      <div class="actions" style="align-items:center"><button class="btn sm" data-m="file">Abrir arquivo…</button><label class="lbl" for="imFmt" style="margin-left:6px">Formato</label><select id="imFmt">${opt('auto', 'Detectar automaticamente', 'auto')}${fmts.map(([k, l]) => opt(k, l, '')).join('')}</select></div>
      <textarea class="paste" id="imTx" spellcheck="false" placeholder="hostname LEAF-01&#10;interface Ethernet1/1&#10; switchport mode trunk&#10; ..."></textarea>
      <div class="field"><span>Aplicar em</span><select id="imTgt">${okSel ? opt('sel', 'Equipamento selecionado — ' + d.name, 'sel') : ''}${opt('new', 'Novo equipamento', okSel ? 'sel' : 'new')}</select></div>
      <div class="field" id="imModelRow"${okSel ? ' hidden' : ''}><span>Modelo</span><select id="imModel">${CAT.CATS.filter(([c]) => !['rack', 'blade'].includes(c)).map(([c, l]) => `<optgroup label="${esc(l)}">${models.filter(x => x.cat === c).map(x => opt(x.id, x.vendor + ' ' + x.name, '')).join('')}</optgroup>`).join('')}<optgroup label="Genéricos">${['sw3', 'sw2', 'rtr', 'fw'].map(t => opt('gen:' + t, TYPES[t].label + ' genérico', '')).join('')}</optgroup></select></div>
      <label class="field"><span>Substituir config</span><input type="checkbox" id="imRep" checked></label>
      <div class="irep" id="imPrev">Aguardando o texto da configuração…</div>
    </div>
    <div class="mfoot"><button class="btn" data-m="close">Cancelar</button><button class="btn pri" data-m="apply" id="imGo" disabled>Aplicar no lab</button></div>`);
  const tx = m.querySelector('#imTx'), fmt = m.querySelector('#imFmt'), tgt = m.querySelector('#imTgt'), mdl = m.querySelector('#imModel'), prev = m.querySelector('#imPrev'), go = m.querySelector('#imGo');
  let touched = false, cfg = null, done = null;
  const parse = () => { const t = tx.value; if (!t.trim()) { cfg = null; go.disabled = true; prev.textContent = 'Aguardando o texto da configuração…'; return; }
    try { cfg = E.parseConfig(t, fmt.value); } catch (e) { cfg = null; go.disabled = true; prev.textContent = 'Não foi possível ler: ' + e.message; return; }
    const sm = E.summarize(cfg); go.disabled = !(sm.ifaces || sm.vlans || sm.svis || sm.routes || sm.hostname);
    if (!touched && tgt.value === 'new') mdl.value = guessModel(cfg);
    prev.textContent = `Formato: ${sm.format}${fmt.value === 'auto' ? ' (detectado)' : ''}\nHostname: ${sm.hostname || '—'}\nInterfaces: ${sm.ifaces} · LAGs: ${sm.lags} · VLANs: ${sm.vlans} · SVIs: ${sm.svis}\nRotas estáticas: ${sm.routes} · Regras/ACL: ${sm.rules} · OSPF: ${sm.ospf ? 'sim' : 'não'}\nVRFs: ${sm.vrfs || 0} · BGP: ${sm.bgp ? `AS ${sm.bgp.asn}, ${sm.bgp.neighbors} vizinho(s)` : 'não'}\nLoopbacks: ${sm.loops || 0} · MPLS: ${sm.mpls ? 'sim' : 'não'} · VNIs VXLAN: ${sm.vnis || 0} · Route-maps: ${sm.rmaps || 0}${cfg.warnings && cfg.warnings.length ? '\n' + cfg.warnings.map(w => '⚠ ' + w).join('\n') : ''}`; };
  let tm; tx.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(parse, 180); });
  fmt.addEventListener('change', parse); mdl.addEventListener('change', () => { touched = true; });
  tgt.addEventListener('change', () => { m.querySelector('#imModelRow').hidden = tgt.value !== 'new'; parse(); });
  tx.addEventListener('dragover', e => e.preventDefault());
  tx.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); f.text().then(t => { tx.value = t; parse(); }); });
  const fi = $('#cfgFile'); fi.onchange = () => { const f = fi.files[0]; fi.value = ''; if (!f) return; if (f.size > 4e6) return toast('Arquivo grande demais (máx. 4 MB).', 'bad'); f.text().then(t => { tx.value = t; parse(); }); };
  m.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const a = b.dataset.m;
    if (a === 'close') return closeModal();
    if (a === 'file') return fi.click();
    if (a === 'console' && done) { closeModal(); openTerm(done.id); return; }
    if (a !== 'apply' || !cfg) return;
    let tg = null;
    if (tgt.value === 'sel' && okSel) tg = d;
    else { const v = mdl.value; if (v.startsWith('gen:')) { const t = v.slice(4); const [x, y] = freeSpot(); tg = E.mkDev(t, E.uniqName(t), Math.round(x), Math.round(y)); } else tg = addModel(v, undefined, undefined, true); }
    if (!tg) return;
    let r; try { r = E.applyConfig(tg, cfg, { replace: m.querySelector('#imRep').checked }); } catch (er) { toast('Falha ao aplicar: ' + er.message, 'bad'); return; }
    UI.sel = { kind: 'dev', id: tg.id }; UI.tab = 'portas'; commit(); done = tg;
    prev.textContent = `✓ Aplicado em ${tg.name}${r.renamed ? ' (renomeado pelo hostname)' : ''}\n${r.applied.length} interface(s) mapeada(s):\n  ${r.applied.slice(0, 60).join('\n  ')}${r.applied.length > 60 ? '\n  …' : ''}`
      + (r.missing.length ? `\n\nSem porta correspondente neste modelo (${r.missing.length}):\n  ${r.missing.slice(0, 30).join(', ')}` : '')
      + (r.notes.length ? `\n\nNotas:\n  ${r.notes.join('\n  ')}` : '');
    m.querySelector('.mfoot').innerHTML = `<button class="btn" data-m="close">Fechar</button><button class="btn pri" data-m="console">Abrir console de ${esc(tg.name)}</button>`;
    toast(`Config importada em ${tg.name}: ${r.applied.length} interfaces${r.missing.length ? `, ${r.missing.length} sem correspondência` : ''}.`); });
}

/* ---------- catálogo ---------- */
const CATL = { dc: 'Data center', acc: 'Acesso / OOB', rtr: 'Roteadores', fw: 'Firewalls', rack: 'Servidores de rack', blade: 'Chassis blade', cloud: 'Nuvens (Internet)', k8s: 'Kubernetes / OpenShift' };
function renderPalette() { const q = UI.pq.trim().toLowerCase();
  $('#catalog').innerHTML = CAT.CATS.map(([c]) => { const ms = CAT.MODELS.filter(m => m.cat === c && !m.hidden && (!q || `${m.vendor} ${m.name} ${m.role} ${VN[m.os] || ''} ${m.speeds || ''}`.toLowerCase().includes(q)));
    if (!ms.length) return '';
    return `<details class="cat" data-cat="${c}"${q || UI.catOpen.has(c) ? ' open' : ''}><summary>${CATL[c] || c}<small>${ms.length}</small></summary><div class="mlist">${ms.map(m => `<button class="mbtn" draggable="true" data-model="${m.id}" title="${esc(`${m.vendor} ${m.name} — ${m.role}\n${m.speeds || ''}${m.u ? ' · ' + m.u + 'U' : ''}${m.w ? ' · ' + m.w + ' W' : ''}`)}"><span class="vb ${vkey(m.vendor)}">${esc(m.vendor.replace('HPE Aruba', 'Aruba'))}</span><b>${esc(m.name)}</b><small>${esc(m.type === 'chassis' ? `${m.bays} baias · ${m.u}U` : `${m.role} · ${m.u}U`)}</small></button>`).join('')}</div></details>`; }).join('') || '<p class="note">Nada encontrado.</p>'; }

/* ---------- eventos ---------- */
function applyTheme() { const r = document.documentElement; if (UI.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', UI.theme); }
function init() {
  const pf = lsGet(PKEY, {}) || {}; Object.assign(UI, { vendor: pf.vendor || 'auto', theme: pf.theme || 'system', clickConsole: pf.clickConsole !== false, insp: pf.insp !== false, drawerOpen: pf.drawerOpen !== false, showMg: pf.showMg !== false, pf: pf.pf || 'used' });
  if (Array.isArray(pf.catOpen)) UI.catOpen = new Set(pf.catOpen);
  if (!E.VN[UI.vendor] && UI.vendor !== 'auto') UI.vendor = 'auto'; applyTheme();
  renderPalette(); $('#genN').textContent = Object.keys(TYPES).filter(t => t !== 'chassis').length;
  $('#pSearch').addEventListener('input', e => { UI.pq = e.target.value; renderPalette(); });
  $('#catalog').addEventListener('toggle', e => { const c = e.target.dataset && e.target.dataset.cat; if (c && !UI.pq) { e.target.open ? UI.catOpen.add(c) : UI.catOpen.delete(c); savePrefs(); } }, true);
  $('#catalog').addEventListener('click', e => { const b = e.target.closest('[data-model]'); if (b) addModel(b.dataset.model); });
  $('#catalog').addEventListener('dragstart', e => { const b = e.target.closest('[data-model]'); if (b) e.dataTransfer.setData('text/plain', 'model:' + b.dataset.model); });
  wireRacks();
  $('#devList').innerHTML = Object.entries(TYPES).filter(([t]) => t !== 'chassis').map(([t, v]) => `<button class="devbtn" draggable="true" data-add="${t}" title="Adicionar ${v.label}"><svg viewBox="-36 -27 72 54" aria-hidden="true">${glyph(t)}</svg>${v.label}<small>${v.ports} porta${v.ports > 1 ? 's' : ''}</small></button>`).join('');
  $('#legend').innerHTML = [[10, 'Acesso (cor da VLAN)'], [1, 'VLAN 1 (default)']].map(([v, l]) => `<div><span class="sw" style="border-color:${vc(v)}"></span>${l}</div>`).join('') + '<div><span class="sw trunk"></span>Trunk 802.1Q</div><div><span class="sw routed"></span>Enlace roteado</div><div><span class="sw mgmt"></span>Gerência (OOB / BMC)</div><div><span class="sw internal"></span>Backplane do chassi</div><div><span class="lagchip" style="margin:0">Po</span>LAG / bond (LACP)</div>';
  $('#vendorTop').innerHTML = VENDORS.map(([v, l]) => `<option value="${v}">${v === 'auto' ? 'Automático (nativo de cada modelo)' : l}</option>`).join('');

  $('#devList').addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) addDevice(b.dataset.add); });
  $('#devList').addEventListener('dragstart', e => { const b = e.target.closest('[data-add]'); if (b) e.dataTransfer.setData('text/plain', b.dataset.add); });
  const can = $('#canvas'), svg = cv();
  can.addEventListener('dragover', e => e.preventDefault());
  can.addEventListener('drop', e => { if (UI.view2 === 'rack') return; e.preventDefault(); const t = e.dataTransfer.getData('text/plain') || ''; const p = toWorld(e); if (t.startsWith('model:')) return void addModel(t.slice(6), p.x, p.y); if (!TYPES[t] || t === 'chassis') return; addDevice(t, p.x, p.y); });

  let drag = null, pan = null;
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; const n = e.target.closest('[data-node]'), l = e.target.closest('[data-link]'), fh = e.target.closest('.fhead') && e.target.closest('[data-frame]');
    if (fh && UI.tool !== 'link') { const ch = dev(fh.dataset.frame), p = toWorld(e); drag = { id: ch.id, frame: true, p0: p, start: [ch, ...E.membersOf(ch)].map(x => [x.id, x.x, x.y]), sx: e.clientX, sy: e.clientY, moved: false }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} return; }
    if (n) { const d = dev(n.dataset.node); if (UI.tool === 'link') { linkClick(d); return; } const p = toWorld(e); drag = { id: d.id, dx: d.x - p.x, dy: d.y - p.y, sx: e.clientX, sy: e.clientY, moved: false }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} return; }
    if (l) { select({ kind: 'link', id: l.dataset.link }); return; }
    pan = { sx: e.clientX, sy: e.clientY, cx: UI.view.cx, cy: UI.view.cy, moved: false }; try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  });
  svg.addEventListener('pointermove', e => {
    if (drag) { if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return; drag.moved = true; const p = toWorld(e);
      if (drag.frame) { const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y; drag.start.forEach(([id, x, y]) => { const q = dev(id); if (q) { q.x = Math.round(x + dx); q.y = Math.round(y + dy); } }); renderCanvas(); return; }
      const d = dev(drag.id); d.x = Math.round(p.x + drag.dx); d.y = Math.round(p.y + drag.dy); renderCanvas(); return; }
    if (pan) { if (!pan.moved && Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) < 4) return; pan.moved = true; svg.classList.add('panning'); UI.view.cx = pan.cx - (e.clientX - pan.sx) / UI.view.k; UI.view.cy = pan.cy - (e.clientY - pan.sy) / UI.view.k; applyView(); return; }
    if (UI.linkFrom) { const a = dev(UI.linkFrom), p = toWorld(e); if (a) $('#gGhost').innerHTML = `<line class="ghost" x1="${a.x}" y1="${a.y}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`; }
  });
  const up = () => {
    if (drag) { const id = drag.id; if (drag.moved) commit(); else { select({ kind: 'dev', id }); if (UI.clickConsole && !drag.frame) openTerm(id); } drag = null; }
    if (pan) { svg.classList.remove('panning'); if (!pan.moved) { if (UI.linkFrom) { UI.linkFrom = null; $('#gGhost').innerHTML = ''; renderCanvas(); } else if (UI.sel) select(null); } pan = null; }
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0018)), e.clientX, e.clientY); }, { passive: false });
  svg.addEventListener('dblclick', e => { const n = e.target.closest('[data-node]'); if (n) openTerm(n.dataset.node); });
  new ResizeObserver(() => applyView()).observe(can);

  $('#tSel').onclick = () => setTool('select'); $('#tLink').onclick = () => setTool('link');
  $('#vTopo').onclick = () => setView2('topo'); $('#vRack').onclick = () => setView2('rack');
  $('#tMg').onclick = () => { UI.showMg = !UI.showMg; savePrefs(); renderCanvas(); };
  $('#bImp').onclick = () => importModal();
  $('#tCon').onclick = () => { UI.clickConsole = !UI.clickConsole; savePrefs(); renderCanvas(); toast(UI.clickConsole ? 'Clicar num equipamento abre o console.' : 'Clique só seleciona. Duplo clique abre o console.'); };
  $('#zIn').onclick = () => zoomAt(1.2); $('#zOut').onclick = () => zoomAt(1 / 1.2); $('#zVal').onclick = fit;
  $('#tdock').addEventListener('click', e => { const b = e.target.closest('[data-dock]'); if (b) openTerm(b.dataset.dock); });

  $('#bUndo').onclick = doUndo; $('#bRedo').onclick = doRedo; $('#bLabs').onclick = labsModal; $('#bSave').onclick = () => saveLab();
  $('#bZip').onclick = exportZip;
  $('#bInsp').onclick = () => { UI.insp = !UI.insp; savePrefs(); renderTop(); setTimeout(applyView, 0); };
  $('#bTheme').onclick = () => { UI.theme = UI.theme === 'system' ? 'dark' : UI.theme === 'dark' ? 'light' : 'system'; applyTheme(); savePrefs(); toast('Tema: ' + ({ system: 'do sistema', dark: 'escuro', light: 'claro' })[UI.theme]); };
  $('#vendorTop').onchange = e => { UI.vendor = e.target.value; savePrefs(); renderInspector(); syncTerms(); };
  $('#labName').addEventListener('change', e => { const v = e.target.value.trim(); if (v && v !== S.name) { S.name = v; commit(); } else e.target.value = S.name; });
  $('#labName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#fileIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { try { const o = JSON.parse(r.result); const err = E.validate(o); if (err) throw new Error(err); closeModal(); loadState(o, { dirty: true }); toast(`Importado: ${o.devices.length} equipamentos. Salve para guardar.`); } catch (er) { toast('Arquivo inválido: ' + er.message, 'bad'); } };
    r.readAsText(f); e.target.value = ''; };

  const insp = $('#insp');
  insp.addEventListener('change', e => { const el = e.target, s = el.dataset.s; if (!s) return; const val = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (s === 'vendor') { UI.vendor = val; savePrefs(); renderTop(); renderInspector(); syncTerms(); return; }
    if (s === 'link') { const l = S.links.find(x => x.id === UI.sel.id); l[el.dataset.end].k = +val; commit(); return; }
    if (s === 'uivrf') { UI[el.dataset.f] = val; renderInspector(); return; }
    if (['os', 'svc', 'hfw', 'ctOn', 'vpn', 'cloud', 'cdns', 'k8s', 'kdp', 'cpub', 'dnat'].includes(s)) { const d = selDev(); if (!d) return; const i = +el.dataset.i, f = el.dataset.f;
      if (s === 'os') { if (!val || val === d.os) return; if (d.ctOn) { toast('Desligue o container real antes de trocar o SO.', 'bad'); return renderInspector(); } const keepV = d.vpns; E.osSetup(d, val); if (keepV) d.vpns = keepV; const st = E.cs(d.id); st.log = []; st.cwd = null; st.env = null; E.banner(d).forEach(x => st.log.push({ t: 'dim', s: x })); toast(`${d.name} agora roda ${E.OSES[val].name}.`); UI.tab = 'geral'; }
      else if (s === 'svc') { const n = el.dataset.n; const x = (d.svcs || {})[n]; if (!x) return; x[f] = val; if (n === 'firewalld') { const fw = d.hfw || (d.hfw = JSON.parse(JSON.stringify(E.hostFw(d)))); if (f === 'active') fw.on = val; } }
      else if (s === 'hfw') { const fw = d.hfw || (d.hfw = JSON.parse(JSON.stringify(E.hostFw(d)))); fw[f] = val; if (f === 'on' && d.svcs && d.svcs.firewalld) d.svcs.firewalld.active = val; }
      else if (s === 'ctOn') { ctToggle(d, val); return; }
      else if (s === 'vpn') { const t = (d.vpns || [])[i]; if (!t) return; if (f === 'shut') t.shut = val; else if (f === 'port') t.port = Math.max(1, Math.min(65535, Math.round(+val) || 51820)); else if (f === 'peer' && val && ip2i(val) === null) { toast('Peer: informe o IP público do outro lado.', 'bad'); return renderInspector(); } else if ((f === 'lnets' || f === 'rnets') && val && !E.netsOf(val).length) { toast('Redes no formato 10.10.0.0/24 (separe várias com espaço).', 'bad'); return renderInspector(); } else if (f === 'addr' && val && !pc(val)) { toast('Endereço do túnel com prefixo, ex.: 10.99.0.1/24.', 'bad'); return renderInspector(); } else if (f === 'name') { const n = val.replace(/[^\w.-]/g, '').slice(0, 30); if (!n) return renderInspector(); t.name = n; } else t[f] = val;
        if (t.kind === 'wireguard' && f === 'addr') t.lnets = val; if (d.fs) { delete d.fs['/etc/ipsec.conf']; delete d.fs['/etc/ipsec.secrets']; Object.keys(d.fs).filter(k => /^\/etc\/wireguard\/.+\.conf$/.test(k)).forEach(k => delete d.fs[k]); } }
      else if (s === 'cloud') { const c = d.cloud = d.cloud || { kind: 'fake', pool: '200.10.0.0/16', dns: [] };
        if (f === 'kind') { if (val === 'real') { c.dns = []; c.mirror = false; if (c.pool === '200.10.0.0/16') c.pool = '177.10.0.0/16'; E.cloudSetHost(d, UI.net && UI.net.host); detectPub(d); } else { const pool = c.pool; E.cloudNew(d, 'fake'); d.cloud.pool = pool === '177.10.0.0/16' ? '200.10.0.0/16' : pool; } }
        else if (f === 'realIps') { c.realIps = val; if (val && Store.mode === 'server') API('api/net/status').then(n => { UI.net = n; const L = pc(c.lan || ''); const ok = !L || (n.ifaces || []).some(x => { const v = ip2i(x.ip); return v !== null && ((v & L.mask) >>> 0) === L.net; }); if (!c.iface && !ok) toast(`Nenhuma placa deste computador está em ${c.lan}. Escolha a placa de rede abaixo ou ajuste a rede da nuvem.`, 'bad'); renderInspector(); }).catch(() => {}); }
        else if (f === 'iface') c.iface = val === 'auto' ? '' : val;
        else if (f === 'addr') c.addr = val === 'static' ? 'static' : 'dhcp';
        else if (f === 'macMode') c.macMode = val;
        else if (f === 'sshPass') c.sshPass = val || 'bancada';
        else if (f === 'mode') { if (val === 'host') { E.cloudSetHost(d, UI.net && UI.net.host); detectPub(d); } else c.mode = 'pool'; }
        else if (f === 'lan') { if (!pc(val) || !val.includes('/')) { toast('Rede no formato 192.168.1.0/24.', 'bad'); return renderInspector(); } c.lan = E.netStr(pc(val)); }
        else if (f === 'gw' || f === 'pub') { if (val && ip2i(val) === null) { toast('IP inválido.', 'bad'); return renderInspector(); } c[f] = val; }
        else if (f === 'pool') { if (!pc(val) || !val.includes('/')) { toast('Pool no formato 200.10.0.0/16.', 'bad'); return renderInspector(); } c.pool = E.netStr(pc(val)); }
        else if (f === 'mirror') { c.mirror = val; d.loops = (d.loops || []).filter(l => !String(l.ip).startsWith(E.MIRROR_IP + '/')); if (val) { let id = 0; while (d.loops.some(l => +l.id === id)) id++; d.loops.push({ id, ip: E.MIRROR_IP + '/32', vrf: '', desc: 'espelho de pacotes / registry (fake)' }); } } }
      else if (s === 'cpub') { const r = (d.cloud.pubs || [])[i]; if (!r) return; if (f === 'port') { const n = Math.round(+val); if (!(n >= 1 && n <= 65535)) { toast('Porta entre 1 e 65535.', 'bad'); return renderInspector(); } r.port = n; } else if (f === 'target') { const [a0, b0] = val.split(':'); if (ip2i(a0) === null) { toast('Destino no formato IP:porta, ex.: 192.168.1.200:22.', 'bad'); return renderInspector(); } r.target = `${a0}:${+b0 || 22}`; } else r.pass = val; }
      else if (s === 'dnat') { const r = (d.dnat || [])[i]; if (!r) return; if (f === 'to' && ip2i(val) === null) { toast('IP interno inválido.', 'bad'); return renderInspector(); } if (f === 'port' || f === 'toPort') { const n = Math.round(+val); if (!(n >= 1 && n <= 65535)) { toast('Porta entre 1 e 65535.', 'bad'); return renderInspector(); } r[f] = n; } else r[f] = val; }
      else if (s === 'cdns') { const r = d.cloud.dns[i]; if (!r) return; if (f === 'ip' && ip2i(val) === null) { toast('IP inválido.', 'bad'); return renderInspector(); } r[f] = f === 'name' ? val.toLowerCase() : val; }
      else if (s === 'k8s') { if (f !== 'domain' && f !== 'lbPool' && val && ip2i(val) === null) { toast('IP inválido.', 'bad'); return renderInspector(); } if (f === 'lbPool' && val && !/^\d+\.\d+\.\d+\.\d+(-\d+\.\d+\.\d+\.\d+)?$/.test(val)) { toast('Pool no formato 10.50.0.200-10.50.0.220.', 'bad'); return renderInspector(); } d.k8s[f] = val; }
      else if (s === 'kdp') { const x = d.k8s.deploys[i]; if (x) x[f] = Math.max(0, Math.min(20, Math.round(+val) || 0)); }
      commit(); return; }
    if (['loop', 'vx', 'vxn', 'pl', 'plr', 'cl', 'clr', 'rmn', 'rmr'].includes(s)) { const d = selDev(); if (!d) return; const i = +el.dataset.i, j = +el.dataset.j, f = el.dataset.f;
      if (s === 'loop') { const l = d.loops[i]; if (!l) return; if (f === 'ip' && val && !pc(val)) { toast('IP inválido (use 10.255.0.1/32).', 'bad'); return renderInspector(); } l[f] = val; }
      else if (s === 'vx') { d.vxlan.src = val === '' ? null : +val; }
      else if (s === 'vxn') { const x = d.vxlan.vnis[i]; if (!x) return; if (f === 'vlan' || f === 'vni') { const n = Math.round(+val); if (!(n >= 1 && n <= (f === 'vlan' ? 4094 : 16777214))) { toast(f === 'vlan' ? 'VLAN entre 1 e 4094.' : 'VNI entre 1 e 16777214.', 'bad'); return renderInspector(); } x[f] = n; if (f === 'vlan' && n !== 1 && !d.vlans.some(v => +v.id === n)) { d.vlans.push({ id: n, name: 'VLAN' + String(n).padStart(4, '0') }); d.vlans.sort((a, b) => a.id - b.id); toast(`VLAN ${n} criada.`); } } else if (f === 'rt') { if (val && !E.rtList(val).length) { toast('Route-target no formato ASN:nn.', 'bad'); return renderInspector(); } x.rt = E.rtList(val)[0] || ''; } else x.peers = val.split(/[\s,]+/).filter(p => ip2i(p) !== null).join(' '); }
      else if (s === 'pl' || s === 'cl' || s === 'rmn') { const k = { pl: 'pfx', cl: 'clists', rmn: 'rmaps' }[s]; const o = d[k][i]; const n = val.replace(/[^\w.:-]/g, '').slice(0, 40); if (!n || (n !== o.name && d[k].some(x => x.name === n))) { toast('Nome inválido ou repetido.', 'bad'); return renderInspector(); } renameRef(d, s === 'rmn' ? 'rm' : s, o.name, n); o.name = n; }
      else if (s === 'plr') { const r = d.pfx[i].rules[j]; if (f === 'pfx') { if (!pc(val) || !val.includes('/')) { toast('Rede com prefixo, ex.: 10.0.0.0/8.', 'bad'); return renderInspector(); } r.pfx = netStr(pc(val)); } else if (f === 'seq') r.seq = Math.max(1, Math.round(+val) || 5); else if (f === 'ge' || f === 'le') r[f] = val === '' ? '' : Math.max(0, Math.min(32, Math.round(+val))); else r[f] = val; }
      else if (s === 'clr') { const r = d.clists[i].rules[j]; if (f === 'comm') { const c = E.commList(val); if (!c.length) { toast('Communities no formato ASN:nn (ou no-export, no-advertise).', 'bad'); return renderInspector(); } r.comm = c.join(' '); } else r[f] = val; }
      else if (s === 'rmr') { const r = d.rmaps[i].rules[j]; if (f === 'seq') r.seq = Math.max(1, Math.round(+val) || 10); else if (f === 'sComm') r.sComm = E.commList(val).join(' '); else if (f === 'sPre') r.sPre = String(val).split(/[\s,]+/).filter(x => /^\d+$/.test(x)).join(' '); else if (f === 'sLp' || f === 'sMed') r[f] = val === '' ? '' : String(Math.max(0, Math.round(+val) || 0)); else r[f] = val; }
      commit(); return; }
    if (s === 'vrfx' || s === 'bgp' || s === 'bnb' || s === 'bnet' || s === 'bred') { const d = selDev(); if (!d) return; const i = +el.dataset.i, f = el.dataset.f;
      if (s === 'vrfx') { const v = d.vrfs[i]; if (!v) return;
        if (f === 'name') { const n = val.replace(/[^\w.:-]/g, '').slice(0, 32); if (!n || (n !== v.name && vrfNames(d).includes(n)) || /^(mgmt|management)$/i.test(n)) { toast('Nome de VRF inválido ou repetido.', 'bad'); return renderInspector(); } renameVrf(d, v.name, n); v.name = n; }
        else if (f === 'rd') v.rd = val; else if (f === 'rtImp' || f === 'rtExp') { if (val && !E.rtList(val).length) { toast('Route-target no formato ASN:nn (separe vários com espaço).', 'bad'); return renderInspector(); } v[f] = E.rtList(val).join(' '); } else if (f === 'l3vni') v.l3vni = Math.max(0, Math.round(+val) || 0); else if (f === 'ospfOn') v.ospf = { area: 0, ...(v.ospf || {}), on: val }; else if (f === 'ospfArea') v.ospf = { on: false, ...(v.ospf || {}), area: Math.max(0, +val || 0) }; else if (f === 'ospfDio') v.ospf = { on: false, area: 0, ...(v.ospf || {}), dio: val }; }
      else if (s === 'bgp') { if (f === 'asn') { const n = Math.round(+val); if (!(n >= 1 && n <= 4294967295)) { toast('ASN entre 1 e 4294967295.', 'bad'); return renderInspector(); } d.bgp.asn = n; } else d.bgp.rid = ip2i(val) !== null ? val : ''; }
      else if (s === 'bnb') { const n = d.bgp.neighbors[i]; if (!n) return; if (f === 'ras') n.ras = Math.max(0, Math.round(+val) || 0); else if (f === 'ip') { if (ip2i(val) === null) { toast('IP de vizinho inválido.', 'bad'); return renderInspector(); } n.ip = val; } else if (f === 'v4') n.noV4 = !val; else n[f] = val; }
      else if (s === 'bnet') { const n = d.bgp.networks[i]; if (!n) return; if (f === 'pfx') { if (!pc(val)) { toast('Rede inválida.', 'bad'); return renderInspector(); } n.pfx = netStr(pc(val)); } else n.vrf = val; }
      else if (s === 'bred') { const src = el.dataset.src, v = el.dataset.vrf || ''; d.bgp.redist = (d.bgp.redist || []).filter(r => !(r.src === src && (r.vrf || '') === v)); if (val) d.bgp.redist.push({ src, vrf: v }); }
      commit(); return; }
    if (s === 'rack') { const r = (S.racks || []).find(x => x.id === UI.sel.id); if (!r) return; const f = el.dataset.f;
      if (f === 'name') { if (!val) return renderInspector(); r.name = val.slice(0, 40); }
      else if (f === 'u') { const u = Math.max(4, Math.min(60, Math.round(+val) || 42)); if (S.devices.some(d => d.rack === r.id && d.ru + E.unitsOf(d) - 1 > u)) { toast('Há equipamentos acima dessa altura. Mova-os antes.', 'bad'); return renderInspector(); } r.u = u; }
      else r.kw = Math.max(.5, Math.min(60, +val || 8)); commit(); return; }
    if (s === 'devrack' || s === 'devru') { const d = selDev(); if (!d) return;
      if (s === 'devrack') { if (!val) { delete d.rack; delete d.ru; return commit(); } let r = val === '__new' ? E.addRack() : (S.racks || []).find(x => x.id === val); const err = E.rackPlace(d, r); if (err) { toast(err, 'bad'); if (val === '__new') commit(); else renderInspector(); return; } return commit(); }
      const r = (S.racks || []).find(x => x.id === d.rack); const pr = d.ru; const err = r && E.rackPlace(d, r, Math.max(1, Math.round(+val) || 1)); if (err) { d.ru = pr; d.rack = r.id; toast(err, 'bad'); return renderInspector(); } return commit(); }
    const d = selDev(); if (!d) return; const f = el.dataset.f, k = +el.dataset.k, i = +el.dataset.i; const num = ['vlan', 'native'].includes(f); const v = num ? Math.max(1, Math.min(4094, +val || 1)) : val;
    if (s === 'dev') { if (f === 'name') { const nm = val.replace(/\s+/g, '-').replace(/[^\w.-]/g, ''); if (!nm) return renderInspector(); if (byName(nm) && byName(nm) !== d) { toast('Já existe um equipamento com esse nome.', 'bad'); return renderInspector(); } d.name = nm; } else d[f] = val; }
    else if (s === 'port') { const p = d.ports[k];
      if (f === 'lag') { const n = Math.max(0, Math.min(4096, Math.round(+val) || 0)); setLag(d, k, n); }
      else if (f === 'vrf') { const t = +p.lag ? d.ports[E.lagMaster(d, k)] : p; t.vrf = val; }
      else { const targets = (+p.lag && ['mode', 'vlan', 'allowed', 'native'].includes(f)) ? E.lagMembers(d, p.lag) : [k];
        targets.forEach(j => { const q = d.ports[j]; q[f] = v; if (f === 'mode' && v !== 'routed') { q.subs = []; q.nat = false; } });
        if (f === 'nat' && v) d.ports.forEach((q, j) => { if (j !== k) q.nat = false; }); } }
    else if (s === 'sub') d.ports[k].subs[i][f] = v;
    else if (s === 'vlan') d.vlans[i][f] = val.replace(/\s+/g, '_');
    else if (s === 'svi') d.svis[i][f] = val;
    else if (s === 'route') { if (f === 'nh' && /^null0?$/i.test(val)) d.routes[i].nh = 'Null0'; else d.routes[i][f] = val; if (f === 'vrf' && !val) delete d.routes[i].vrf; }
    else if (s === 'rule') { d.rules[i][f] = val; if (f === 'proto' && !(val === 'tcp' || val === 'udp')) d.rules[i].port = ''; }
    else if (s === 'ospf') d.ospf[f] = f === 'on' || f === 'dio' ? val : f === 'rid' ? (ip2i(val) !== null ? val : '') : (+val || 0);
    commit(); });
  insp.addEventListener('input', e => { if (e.target.id === 'pq2') { UI.pq2 = e.target.value; const pos = e.target.selectionStart; renderInspector(); const n = $('#pq2'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } } });
  insp.addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.pk; if (k) e.target.open ? UI.open.add(k) : UI.open.delete(k); }, true);
  insp.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, d = selDev(), i = +b.dataset.i, k = +b.dataset.k;
    if (a === 'tab') { UI.tab = b.dataset.v; renderInspector(); return; }
    if (a === 'del') { delSel(); return; }
    if (a === 'openCli') { openTerm(d.id); return; }
    if (a === 'openWeb') { openWeb(d); return; }
    if (a === 'importCfg') { importModal(d); return; }
    if (a === 'selDev') { const t = dev(b.dataset.id); if (t) { select({ kind: 'dev', id: t.id }); if (UI.view2 === 'rack') renderRacks(); } return; }
    if (a === 'pf') { UI.pf = b.dataset.v; savePrefs(); renderInspector(); return; }
    if (a === 'addBlade') { const bl = E.addBlade(d, +b.dataset.v); if (!bl) return toast('Baia ocupada.', 'bad'); toast(`${bl.name} instalada na baia ${b.dataset.v}.`); commit(); return; }
    if (a === 'copyCfg') { const txt = E.gen(vOf(d), d); try { await navigator.clipboard.writeText(txt); toast('Configuração copiada.'); } catch (_) { const r = document.createRange(); r.selectNodeContents($('#cfgOut')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Texto selecionado — use Ctrl+C.'); } return; }
    if (a === 'dlCfg') { if (await download(fname(d), E.gen(vOf(d), d))) { S.exported = true; saveDraft(); renderGuide(); } return; }
    if (a === 'addVlan') { const id = +$('#nv-id').value, nm = ($('#nv-name').value.trim() || 'VLAN' + String(id).padStart(4, '0')).replace(/\s+/g, '_'); if (!(id >= 2 && id <= 4094)) return toast('ID de VLAN entre 2 e 4094.', 'bad'); if (d.vlans.some(v => +v.id === id)) return toast(`A VLAN ${id} já existe.`, 'bad'); d.vlans.push({ id, name: nm }); d.vlans.sort((x, y) => x.id - y.id); }
    else if (a === 'delVlan') d.vlans.splice(i, 1);
    else if (a === 'addSvi') { const v = +$('#ns-vlan').value, ip = $('#ns-ip').value.trim(); if (!(v >= 1 && v <= 4094) || !pc(ip)) return toast('Informe a VLAN e o IP com prefixo, ex.: 10.10.10.1/24.', 'bad'); if (d.svis.some(s => +s.vlan === v)) return toast(`Já existe a Vlan${v}.`, 'bad'); d.svis.push({ vlan: v, ip, vip: '' }); d.svis.sort((x, y) => x.vlan - y.vlan); }
    else if (a === 'delSvi') d.svis.splice(i, 1);
    else if (a === 'addRoute') { const dst = $('#nr-dst').value.trim(); let nh = $('#nr-nh').value.trim(); const nv = $('#nr-vrf') ? $('#nr-vrf').value : ''; if (/^null0?$/i.test(nh)) nh = 'Null0'; if (!pc(dst) || (ip2i(nh) === null && nh !== 'Null0')) return toast('Destino com prefixo (ex.: 0.0.0.0/0) e próximo salto IPv4 ou Null0.', 'bad'); d.routes.push({ dst: netStr(pc(dst)), nh, ...(nv ? { vrf: nv } : {}) }); }
    else if (a === 'addVrf') { const n = $('#nvrf-name').value.trim().replace(/[^\w.:-]/g, '').slice(0, 32); if (!n) return toast('Informe o nome da VRF.', 'bad'); if (vrfNames(d).includes(n) || /^(mgmt|management|mgmt-vrf)$/i.test(n)) return toast('Essa VRF já existe ou é reservada.', 'bad'); (d.vrfs = d.vrfs || []).push({ name: n, rd: $('#nvrf-rd').value.trim() }); }
    else if (a === 'delVrf') { const v = d.vrfs[i]; if (v) dropVrf(d, v.name); }
    else if (a === 'bgpOn') { const n = Math.round(+$('#nbgp-asn').value); if (!(n >= 1 && n <= 4294967295)) return toast('Informe o número do AS.', 'bad'); const rid = $('#nbgp-rid').value.trim(); d.bgp = { asn: n, rid: ip2i(rid) !== null ? rid : '', neighbors: [], networks: [], redist: [] }; }
    else if (a === 'bgpOff') { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmar'; return; } delete d.bgp; }
    else if (a === 'addNb') { const ip = $('#nnb-ip').value.trim(), ras = Math.round(+$('#nnb-ras').value), v = $('#nnb-vrf') ? $('#nnb-vrf').value : ''; if (ip2i(ip) === null || !(ras >= 1)) return toast('IP do vizinho e AS remoto.', 'bad'); if (d.bgp.neighbors.some(n => n.ip === ip && (n.vrf || '') === v)) return toast('Esse vizinho já existe.', 'bad'); d.bgp.neighbors.push({ ip, ras, vrf: v, desc: '', dio: false, nhs: false, shut: false, us: '', mh: false, rrc: false, sc: true, vpnv4: false, evpn: false, noV4: false, rmIn: '', rmOut: '' }); }
    else if (a === 'delNb') d.bgp.neighbors.splice(i, 1);
    else if (a === 'addNet') { const c = pc($('#nbn-pfx').value.trim()), v = $('#nbn-vrf') ? $('#nbn-vrf').value : ''; if (!c || !$('#nbn-pfx').value.includes('/')) return toast('Rede com prefixo, ex.: 10.100.0.0/16.', 'bad'); d.bgp.networks.push({ pfx: netStr(c), vrf: v }); }
    else if (a === 'delNet') d.bgp.networks.splice(i, 1);
    else if (a === 'delRoute') d.routes.splice(i, 1);
    else if (a === 'addLoop') { const ls = d.loops = d.loops || []; let id = 0; while (ls.some(l => +l.id === id)) id++; ls.push({ id, ip: '', vrf: '', desc: '' }); }
    else if (a === 'delLoop') d.loops.splice(i, 1);
    else if (a === 'vxOn') { const lo = (d.loops || []).find(l => +l.id === 1) || (d.loops || [])[0]; d.vxlan = { src: lo ? +lo.id : null, vnis: [] }; if (!lo) toast('Crie uma loopback (aba Geral) para servir de VTEP.'); }
    else if (a === 'vxOff') { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmar'; return; } delete d.vxlan; }
    else if (a === 'addVni') { const used = new Set(d.vxlan.vnis.map(x => +x.vlan)); const v = (d.vlans || []).map(x => +x.id).find(x => !used.has(x)) || 10; d.vxlan.vnis.push({ vlan: v, vni: 10000 + v, rt: '', peers: '' }); if (!d.vlans.some(x => +x.id === v)) d.vlans.push({ id: v, name: 'VLAN' + String(v).padStart(4, '0') }); }
    else if (a === 'delVni') d.vxlan.vnis.splice(i, 1);
    else if (a === 'addPl' || a === 'addCl' || a === 'addRm') { const k = { addPl: 'pfx', addCl: 'clists', addRm: 'rmaps' }[a], inp = { addPl: '#npl-name', addCl: '#ncl-name', addRm: '#nrm-name' }[a]; const n = $(inp).value.trim().replace(/[^\w.:-]/g, '').slice(0, 40); if (!n) return toast('Informe o nome.', 'bad'); d[k] = d[k] || []; if (d[k].some(x => x.name === n)) return toast('Esse nome já existe.', 'bad');
      d[k].push({ name: n, rules: a === 'addPl' ? [{ seq: 5, act: 'permit', pfx: '10.0.0.0/8', ge: '', le: 24 }] : a === 'addCl' ? [{ act: 'permit', comm: '65000:100' }] : [{ seq: 10, act: 'permit', mPfx: '', mComm: '', sLp: '', sMed: '', sComm: '', sAdd: false, sPre: '' }] }); }
    else if (a === 'delPl' || a === 'delCl' || a === 'delRm') d[{ delPl: 'pfx', delCl: 'clists', delRm: 'rmaps' }[a]].splice(i, 1);
    else if (a === 'addPlr') { const rs = d.pfx[i].rules; rs.push({ seq: Math.max(0, ...rs.map(r => +r.seq || 0)) + 5, act: 'permit', pfx: '0.0.0.0/0', ge: '', le: '' }); }
    else if (a === 'addClr') d.clists[i].rules.push({ act: 'permit', comm: '65000:100' });
    else if (a === 'addRmr') { const rs = d.rmaps[i].rules; rs.push({ seq: Math.max(0, ...rs.map(r => +r.seq || 0)) + 10, act: 'permit', mPfx: '', mComm: '', sLp: '', sMed: '', sComm: '', sAdd: false, sPre: '' }); }
    else if (a === 'delPlr' || a === 'delClr' || a === 'delRmr') d[{ delPlr: 'pfx', delClr: 'clists', delRmr: 'rmaps' }[a]][i].rules.splice(+b.dataset.j, 1);
    else if (a === 'pkgAdd') { const names = $('#np-pkg').value.trim().split(/[\s,]+/).filter(Boolean); if (!names.length) return toast('Informe o(s) pacote(s).', 'bad'); const r = E.pkgAddDirect(d, names); if (r.bad.length) toast(`Não existe em ${E.osInfo(d).name}: ${r.bad.join(', ')}`, 'bad'); else toast(`Instalado: ${r.ok.join(', ')}`); if (!r.ok.length) return; }
    else if (a === 'fwAdd') { const pr = $('#nf-proto').value, port = Math.round(+$('#nf-port').value), src = $('#nf-src').value.trim(); if (!(port >= 1 && port <= 65535)) return toast('Porta entre 1 e 65535.', 'bad'); if (src && !pc(src)) return toast('Origem no formato 10.0.0.0/8.', 'bad'); const fw = d.hfw || (d.hfw = JSON.parse(JSON.stringify(E.hostFw(d)))); const x = [pr, port, src ? E.netStr(pc(src)) : '']; fw.allow.push(x); if (fw.perm) fw.perm.push(x.slice()); }
    else if (a === 'fwDel') { const fw = d.hfw; if (!fw) return; const [x] = fw.allow.splice(i, 1); if (fw.perm && x) fw.perm = fw.perm.filter(y => !(y[0] === x[0] && String(y[1]) === String(x[1]) && (y[2] || '') === (x[2] || ''))); }
    else if (a === 'fsEdit' || a === 'fsOpen') { const p0 = a === 'fsEdit' ? b.dataset.p : $('#nfs-path').value.trim(); if (!p0) return toast('Informe o caminho.', 'bad'); const p = E.fsNorm(d, p0, null); openEditor({ dev: d.id, path: p, content: E.fsRead(d, p) ?? '' }); return; }
    else if (a === 'vpnAdd') { const T = d.vpns = d.vpns || []; const host = isHost(d.type); const lan = l3ifs(d).filter(f => !f.mgmt && !E.isPublic(f.c.ip)).map(f => E.netStr(f.c))[0] || '';
      if (b.dataset.v === 'ipsec') { let n = 1; while (T.some(t => t.name === 'VPN' + n)) n++; T.push({ name: 'VPN' + n, kind: 'ipsec', peer: '', psk: 'Bancada-' + Math.random().toString(36).slice(2, 10), ike: 'v2', enc: 'aes256', hash: 'sha256', dh: '14', lnets: lan, rnets: '' });
        if (host && !E.isWin(d)) { E.pkgAddDirect(d, ['strongswan']); } }
      else { let n = 0; while (T.some(t => t.name === 'wg' + n)) n++; T.push({ name: 'wg' + n, kind: 'wireguard', key: E.wgKey(), addr: `10.99.${n}.1/24`, lnets: `10.99.${n}.1/24`, port: 51820 + n, peer: '', pport: 51820, peerKey: '', rnets: `10.99.${n}.2/32` });
        if (host) { E.pkgAddDirect(d, [E.isWin(d) ? 'wireguard' : 'wireguard-tools']); if (!E.isWin(d)) d.svcs['wg-quick@wg' + n] = { active: true, enabled: true }; } } }
    else if (a === 'vpnDel') { d.vpns.splice(i, 1); if (d.fs) { delete d.fs['/etc/ipsec.conf']; delete d.fs['/etc/ipsec.secrets']; } }
    else if (a === 'vpnMirror') { const t = d.vpns[i]; if (!t || ip2i(t.peer) === null) return toast('Preencha o IP do peer antes.', 'bad'); const P = S.devices.find(x => x.id !== d.id && l3ifs(x).some(f => !f.mgmt && f.c.ip === ip2i(t.peer))); if (!P) return toast(`Nenhum equipamento tem o IP ${t.peer}.`, 'bad');
      if (!(fwd(P.type) || isHost(P.type))) return toast(`${P.name} não termina VPN.`, 'bad'); const q = E.simulate(d.id, t.peer, 'udp', t.kind === 'wireguard' ? 51820 : 500, { noVpn: true, noAccept: true }); const me = q.srcAtDst != null ? E.i2ip(q.srcAtDst) : ((l3ifs(d).find(f => !f.mgmt) || {}).c ? E.i2ip(l3ifs(d).find(f => !f.mgmt).c.ip) : '');
      P.vpns = P.vpns || []; let nt;
      if (t.kind === 'ipsec') { nt = { name: ('VPN-' + d.name).slice(0, 30), kind: 'ipsec', peer: me, psk: t.psk, ike: t.ike, enc: t.enc, hash: t.hash, dh: t.dh, lnets: t.rnets || l3ifs(P).filter(f => !f.mgmt && !E.isPublic(f.c.ip)).map(f => E.netStr(f.c))[0] || '', rnets: t.lnets }; if (!t.rnets) t.rnets = nt.lnets; if (isHost(P.type) && P.os && !E.isWin(P)) E.pkgAddDirect(P, ['strongswan']); }
      else { const k = E.wgKey(); const a0 = pc(t.addr || '10.99.0.1/24'); const peerAddr = `${E.i2ip(a0.net + (a0.ip === a0.net + 1 ? 2 : 1))}/${a0.len}`; nt = { name: isHost(P.type) ? 'wg0' : ('wg-' + d.name).slice(0, 30), kind: 'wireguard', key: k, addr: peerAddr, lnets: peerAddr, port: 51820, peer: me, pport: t.port || 51820, peerKey: E.wgPub(t.key), rnets: `${E.i2ip(a0.ip)}/32` }; t.peerKey = E.wgPub(k); t.rnets = t.rnets || `${E.i2ip(pc(peerAddr).ip)}/32`;
        if (isHost(P.type) && P.os) { E.pkgAddDirect(P, [E.isWin(P) ? 'wireguard' : 'wireguard-tools']); if (!E.isWin(P)) P.svcs['wg-quick@wg0'] = { active: true, enabled: true }; } }
      P.vpns = P.vpns.filter(x => !(x.kind === nt.kind && x.peer === nt.peer)); P.vpns.push(nt); toast(`Túnel criado em ${P.name} (${nt.name}). Confira o status nas duas pontas.`); }
    else if (a === 'pubDetect') { detectPub(d, true); return; }
    else if (a === 'cpubAdd') { const port = Math.round(+$('#npb-port').value), tg = $('#npb-target').value.trim(), pass = $('#npb-pass').value; const [a0, b0] = tg.split(':'); if (!(port >= 1 && port <= 65535) || ip2i(a0) === null) return toast('Porta neste computador e destino IP:porta.', 'bad'); d.cloud.pubs = (d.cloud.pubs || []).filter(x => +x.port !== port); d.cloud.pubs.push({ port, target: `${a0}:${+b0 || 22}`, pass }); }
    else if (a === 'cpubDel') d.cloud.pubs.splice(i, 1);
    else if (a === 'dnatAdd') { const port = Math.round(+$('#ndn-port').value), to = $('#ndn-to').value.trim(), tp = Math.round(+$('#ndn-tp').value) || port, pr = $('#ndn-proto').value; if (!(port >= 1 && port <= 65535) || ip2i(to) === null) return toast('Porta externa e IP interno.', 'bad'); d.dnat = (d.dnat || []).filter(r => !(r.proto === pr && +r.port === port)); d.dnat.push({ proto: pr, port, to, toPort: tp, desc: '' }); }
    else if (a === 'dnatDel') d.dnat.splice(i, 1);
    else if (a === 'cdnsAdd') { const n = $('#ncd-name').value.trim().toLowerCase(), ip = $('#ncd-ip').value.trim(); if (!n || ip2i(ip) === null) return toast('Nome e IP.', 'bad'); d.cloud.dns = (d.cloud.dns || []).filter(r => r.name !== n); d.cloud.dns.push({ name: n, ip }); }
    else if (a === 'cdnsDel') d.cloud.dns.splice(i, 1);
    else if (a === 'kdpAdd' || a === 'ksvAdd' || a === 'kinAdd') { const k = d.k8s, ocp = k.dist === 'openshift', tool = ocp ? 'oc' : 'kubectl'; let argv, ns;
      if (a === 'kdpAdd') { ns = $('#nk-ns').value.trim() || 'default'; const n = $('#nk-name').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''), img = $('#nk-img').value.trim(), port = Math.round(+$('#nk-port').value) || 80; if (!n || !img) return toast('Nome e imagem.', 'bad'); if (!k.ns.includes(ns)) k.ns.push(ns); argv = [tool, 'create', 'deployment', n, '--image=' + img, '--port=' + port, '--replicas=2', '-n', ns]; }
      else if (a === 'ksvAdd') { const dp = k.deploys[+$('#nks-dp').value]; if (!dp) return toast('Crie um deployment antes.', 'bad'); ns = dp.ns; argv = [tool, 'expose', 'deployment', dp.name, '--type=' + $('#nks-type').value, '--port=' + (dp.port || 80), '-n', ns]; }
      else { const sv = k.svcs[+$('#nki-svc').value]; if (!sv) return; ns = sv.ns; const host = $('#nki-host').value.trim(); argv = ocp ? ['oc', 'expose', 'svc/' + sv.name, '-n', ns, ...(host ? ['--hostname=' + host] : [])] : ['kubectl', 'create', 'ingress', sv.name, `--rule=${host || sv.name + '.' + k.domain}/*=${sv.name}:${sv.port}`, '-n', ns]; }
      const out = E.k8sCmd(d, {}, argv, argv.join(' '), () => null); toast(out.split('\n')[0], /^error|Error/.test(out) ? 'bad' : ''); }
    else if (a === 'kdpDel') d.k8s.deploys.splice(i, 1);
    else if (a === 'ksvDel') d.k8s.svcs.splice(i, 1);
    else if (a === 'kinDel') d.k8s.ings.splice(i, 1);
    else if (a === 'addRule') d.rules.push({ act: 'permit', proto: 'tcp', src: 'any', dst: 'any', port: '443', desc: '' });
    else if (a === 'delRule') d.rules.splice(i, 1);
    else if (a === 'upRule') { if (i > 0) [d.rules[i - 1], d.rules[i]] = [d.rules[i], d.rules[i - 1]]; }
    else if (a === 'addSub') { const p = d.ports[k]; let v = 10; while (p.subs.some(s => +s.vlan === v)) v += 10; p.subs.push({ vlan: v, ip: '', nat: false, vip: '' }); UI.open.add(d.id + ':' + k); }
    else if (a === 'delSub') d.ports[k].subs.splice(i, 1);
    else return; commit(); });

  document.querySelectorAll('[data-dtab]').forEach(b => b.onclick = () => { UI.drawer = b.dataset.dtab; UI.drawerOpen = true; savePrefs(); renderDrawer(); });
  $('#dToggle').onclick = () => { UI.drawerOpen = !UI.drawerOpen; savePrefs(); renderDrawer(); setTimeout(applyView, 0); };
  $('#simDst').onchange = syncSimIp; $('#simSrc').onchange = syncSimVrf; $('#simProto').onchange = () => { $('#simPort').disabled = $('#simProto').value === 'icmp'; };
  $('#simForm').addEventListener('submit', e => { e.preventDefault(); const src = $('#simSrc').value; if (!src) return toast('Escolha a origem.'); const vs = $('#simVrf'); const r = E.simulate(src, $('#simIp').value.trim(), $('#simProto').value, +$('#simPort').value || 0, { vrf: vs && !vs.hidden ? vs.value : '' }); UI.simRes = r; UI.hl = { f: r.f, r: r.r }; renderCanvas(); renderSimOut(); renderGuide(); });
  $('#simClear').onclick = () => { UI.hl = { f: [], r: [] }; UI.simRes = null; renderCanvas(); renderSimOut(); };
  $('#guide').addEventListener('click', e => { const b = e.target.closest('[data-gact]'); if (!b) return; if (b.dataset.gact === 'min') { UI.guideMin = !UI.guideMin; renderGuide(); } else { S.guide = null; commit(); } });
  $('#modalRoot').addEventListener('pointerdown', e => { if (e.target.dataset && e.target.dataset.scrim) closeModal(); });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase(); const typing = tag === 'input' || tag === 'textarea' || tag === 'select'; const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveLab(); return; }
    if (e.key === 'Escape' && $('#modalRoot').firstChild) { closeModal(); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') { if (UI.tool === 'link') setTool('select'); else select(null); return; }
    if (k === 'c') { if (UI.view2 === 'rack') setView2('topo'); setTool('link'); } else if (k === 'v') setTool('select'); else if (k === 'f') { if (UI.view2 === 'rack') setView2('topo'); fit(); } else if (k === 'r') setView2(UI.view2 === 'rack' ? 'topo' : 'rack');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && UI.sel) { e.preventDefault(); delSel(); }
  });
  window.addEventListener('beforeunload', e => { if (CUR.dirty && CUR.id) { e.preventDefault(); e.returnValue = ''; } });
}

async function start() {
  init();
  await Store.init(); bridgeLoop();
  const h = (location.hash || '').slice(1); const dr = lsGet(DKEY, null);
  if (h && E.GUIDES[h]) loadState(E.guideTopo());
  else if (dr && dr.S && !E.validate(dr.S)) { loadState(dr.S, { id: dr.cur && dr.cur.id, dirty: dr.cur && dr.cur.dirty }); }
  else { loadState(E.sampleCampus()); runDemoPing(); }
  if (Store.mode === 'local' && dr && dr.cur && dr.cur.id && !Store.lall()[dr.cur.id]) { CUR.id = null; CUR.dirty = true; renderTop(); }
}
start();
})();
