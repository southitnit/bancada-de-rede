/* Bancada de Rede — idiomas (português / English).
   O app é escrito em português; em inglês, os textos mostrados na tela são traduzidos
   por um dicionário de frases (i18n/en.json) aplicado ao DOM, inclusive ao que aparece depois. */
(function () {
  'use strict';
  const DICT = window.I18N_EN || {};
  let lang = 'pt';
  try { lang = localStorage.getItem('bancada.lang') || ''; } catch (_) {}
  // ?lang=en|pt — o painel do executável abre o navegador já no idioma escolhido nele
  try {
    const u = new URL(location.href); const q = u.searchParams.get('lang');
    if (q === 'pt' || q === 'en') { lang = q; try { localStorage.setItem('bancada.lang', q); } catch (_) {} u.searchParams.delete('lang'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  } catch (_) {}
  if (lang !== 'pt' && lang !== 'en') lang = /^pt/i.test(navigator.language || '') ? 'pt' : 'en';
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';

  const exact = new Map(); const long = [];
  const FMT = []; const VERB = /%[svdq]/g; const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [k, v] of Object.entries(DICT)) { const t = k.trim(); if (!t || t === v) continue;
    if (/%[svdq]/.test(t)) { const a = t.match(VERB), b = v.match(VERB) || []; if (a.length === b.length) { let r = '^', last = 0; t.replace(VERB, (m, i) => { r += reEsc(t.slice(last, i)) + (m === '%d' ? '(-?\\d+)' : '([\\s\\S]+?)'); last = i + m.length; return m; }); try { FMT.push([new RegExp(r + reEsc(t.slice(last)) + '$'), v.trim().split(VERB)]); } catch (_) {} } continue; }
    exact.set(t, v.trim()); if (t.length >= 4 || /[^\x00-\x7f]/.test(t) && t.length >= 3) long.push(t); }
  // árvore de prefixos: em cada posição, a frase mais longa do dicionário que começa ali
  const W = /[\p{L}\p{N}_]/u; const isW = c => !!c && W.test(c);
  const TRIE = new Map(); const END = Symbol('end');
  for (const k of long) { let n = TRIE; for (const ch of k) { let x = n.get(ch); if (!x) { x = new Map(); n.set(ch, x); } n = x; } n.set(END, k); }
  function replaceAll(s) {
    let out = '', last = 0, i = 0; const L = s.length;
    while (i < L) {
      const c = s[i]; let n = TRIE.get(c);
      if (n && !(isW(c) && isW(s[i - 1]))) {
        let j = i + 1, best = -1, bestK = null;
        for (;;) { const e = n.get(END); if (e !== undefined && !(isW(e[e.length - 1]) && isW(s[j]))) { best = j; bestK = e; } if (j >= L) break; const nx = n.get(s[j]); if (!nx) break; n = nx; j++; }
        if (best > 0) { out += s.slice(last, i) + exact.get(bestK); last = i = best; continue; }
      }
      i++;
    }
    return last ? out + s.slice(last) : s;
  }
  function tr(s) {
    if (lang !== 'en' || typeof s !== 'string' || !s) return s;
    const t = s.trim(); if (!t) return s;
    const e = exact.get(t); if (e !== undefined) return s.replace(t, e);
    if (t.includes(' ')) for (const [re, parts] of FMT) { const m = re.exec(t); if (m) return s.replace(t, parts.map((p, i) => p + (i < parts.length - 1 ? (/[\/\\]/.test(m[i + 1]) || !m[i + 1].includes(' ') ? m[i + 1] : tr(m[i + 1])) : '')).join('')); }
    if (!/[A-Za-zÀ-ú]{2}/.test(t)) return s;
    return replaceAll(s);
  }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'NOSCRIPT']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const done = new WeakMap();
  function skip(el) { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (SKIP.has(e.tagName) || e.isContentEditable || (e.dataset && 'notr' in e.dataset)) return true; } return false; }
  function trText(n) { const v = n.nodeValue; if (done.get(n) === v) return; const o = tr(v); if (o !== v) n.nodeValue = o; done.set(n, n.nodeValue); }
  function trEl(el) { if (el.dataset && 'notr' in el.dataset) return; for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const o = tr(v); if (o !== v) el.setAttribute(a, o); } } }
  function walk(root) {
    if (lang !== 'en' || !root) return;
    if (root.nodeType === 3) { if (!skip(root.parentElement)) trText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (/^(INPUT|TEXTAREA)$/.test(root.tagName)) { trEl(root); return; } if (skip(root)) return; trEl(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && /^(INPUT|TEXTAREA)$/.test(n.tagName) ? (trEl(n), NodeFilter.FILTER_REJECT) : (n.nodeType === 1 && (SKIP.has(n.tagName) || (n.dataset && 'notr' in n.dataset))) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) trText(n); else trEl(n); }
  }
  let pend = new Set(), sched = false;
  function flush() { sched = false; const p = pend; pend = new Set(); p.forEach(walk); }
  function start() {
    if (lang !== 'en') return; walk(document.body); if (document.title) document.title = tr(document.title);
    new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') pend.add(m.target); else if (m.type === 'attributes') pend.add(m.target); else m.addedNodes.forEach(n => pend.add(n)); } if (!sched) { sched = true; queueMicrotask(flush); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function set(l) { try { localStorage.setItem('bancada.lang', l); } catch (_) {} location.reload(); }
  window.I18N = { get lang() { return lang; }, tr, set, walk, trLines: a => (a || []).map(tr) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
