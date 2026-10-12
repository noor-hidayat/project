"use strict";

// ── .env manual (tanpa dependensi) ────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");
(function loadEnv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch { /* abaikan */ }
})();

const http = require("node:http");
const zlib = require("node:zlib");
const auth = require("./lib/auth");
const { cached, invalidate } = require("./lib/cache");
const sb = require("./lib/supabase");
const { extractBarcodes, DEFAULT_BARCODE_PATTERNS } = require("./lib/barcode");

const PORT = Number(process.env.PORT || 3000);
const PER_PAGE = 20;

// CSS dibaca sekali saat boot (jangan readFileSync per request — block event loop).
const STATIC_ASSETS = {};
for (const f of ["style.css", "bootstrap.min.css"]) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, "public", f));
    STATIC_ASSETS["/" + f] = {
      buf,
      gzip: buf.length ? zlib.gzipSync(buf) : Buffer.alloc(0),
      type: "text/css; charset=utf-8",
    };
  } catch { /* abaikan, nanti 404 */ }
}
// Versi CSS — naikkan tiap ubah public/style.css. Navigasi fragment otomatis
// reload penuh bila versi server beda, jadi tab lama tidak terjebak CSS basi.
const CSS_V = 29;

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const fmtD = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const fmtDT = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
function fDate(d) { if (!d) return "-"; try { return fmtD.format(new Date(d)); } catch { return "-"; } }
function fDT(d) { if (!d) return "-"; try { return fmtDT.format(new Date(d)); } catch { return "-"; } }

function wantsGzip(req) {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
}

function sendHTML(req, res, code, html, headers) {
  const buf = Buffer.from(html, "utf8");
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "no-store", ...(headers || {}) });
    return res.end(zlib.gzipSync(buf));
  }
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(headers || {}) });
  res.end(buf);
}
function sendJSON(req, res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  // JSON preview transit bisa MB-an — gzip wajib biar tidak lemot.
  if (buf.length > 512 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "no-store" });
    return res.end(zlib.gzipSync(buf));
  }
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(buf);
}
function redirect(res, loc, cookie) {
  const h = { Location: loc };
  if (cookie) h["Set-Cookie"] = cookie;
  res.writeHead(302, h);
  res.end();
}
function sendCSV(res, filename, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\n");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(csv);
}

function readBody(req, limit) {
  const max = limit || 600 * 1024;
  return new Promise((resolve, reject) => {
    let n = 0;
    const ch = [];
    req.on("data", (c) => { n += c.length; if (n > max) reject(new Error("BODY_TOO_LARGE")); else ch.push(c); });
    req.on("end", () => resolve(Buffer.concat(ch).toString("utf8")));
    req.on("error", reject);
  });
}
async function parseBody(req) {
  const ct = req.headers["content-type"] || "";
  const raw = await readBody(req);
  if (ct.includes("application/json")) {
    try { return { type: "json", data: JSON.parse(raw || "{}") }; }
    catch { return { type: "json", data: {} }; }
  }
  const sp = new URLSearchParams(raw);
  const data = {};
  for (const k of sp.keys()) {
    const all = sp.getAll(k);
    data[k] = all.length > 1 ? all : (all[0] ?? "");
  }
  return { type: "form", data };
}
function arr(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }

// Kode pallet mengandung "/" (PLT/2610/0001) → segmen path disambung lagi.
// Kompatibel mundur dengan format lama PLT-YYYYMMDD-XXXXX (tanpa slash).
function palletRoute(seg) {
  if (seg[0] !== "pallets" || !seg[1]) return null;
  const last = seg[seg.length - 1];
  if (seg.length > 2 && (last === "print" || last === "notes" || last === "delete")) {
    return { code: seg.slice(1, -1).join("/"), action: last };
  }
  return { code: seg.slice(1).join("/"), action: null };
}
// Link ke detail pallet — kode selalu di-encode (%2F untuk slash).
const purl = (code) => "/pallets/" + encodeURIComponent(code);

async function getSession(req) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.COOKIE_NAME];
  if (!token) return null;
  return auth.getSessionFromToken(token);
}

// ── Layout ───────────────────────────────────────────────────────────────────
const NAV = [
  { href: "/", label: "Dashboard", icon: "chart", roles: ["ADMIN", "PRODUCTION", "TRANSIT"], group: "Menu Utama" },
  { href: "/pallets", label: "Pallet", icon: "box", roles: ["ADMIN", "PRODUCTION"], group: "Menu Utama" },
  { href: "/transit", label: "Transit", icon: "truck", roles: ["ADMIN", "TRANSIT"], group: "Menu Utama" },
  { href: "/tracking", label: "Tracking", icon: "search", roles: ["ADMIN", "PRODUCTION", "TRANSIT"], group: "Menu Utama" },
  { href: "/reports", label: "Laporan", icon: "doc", roles: ["ADMIN", "PRODUCTION", "TRANSIT"], group: "Menu Utama" },
  { href: "/master", label: "Master", icon: "archive", roles: ["ADMIN"], group: "Pengaturan" },
  { href: "/users", label: "Users", icon: "users", roles: ["ADMIN"], group: "Pengaturan" },
  { href: "/settings", label: "Setting", icon: "gear", roles: ["ADMIN"], group: "Pengaturan" },
];

function layout(session, active, body, title) {
  const mine = NAV.filter((m) => m.roles.includes(session.role));
  const grp = (g) => mine.filter((m) => m.group === g)
    .map((m) => `<a href="${m.href}" class="nav-link ${active === m.href ? "active" : ""}">${ic(m.icon || 'box')} ${esc(m.label)}</a>`).join("");
  const mainNav = grp("Menu Utama"), adminNav = grp("Pengaturan");
  const initials = String(session.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || "Pallet Tracking")}</title><link rel="stylesheet" href="/bootstrap.min.css?v=1"><link rel="stylesheet" href="/style.css?v=${CSS_V}"></head><body>
<div class="app">
<aside class="sidebar no-print">
<div class="side-brand">${ic('box')} <span>Pallet Tracking</span></div>
<div class="side-cap">Menu Utama</div>
<nav class="nav nav-pills side-nav">${mainNav}</nav>
${adminNav ? `<div class="side-cap">Pengaturan</div><nav class="nav nav-pills side-nav">${adminNav}</nav>` : ""}
<div class="side-foot">v1.0 · css${CSS_V}</div>
</aside>
<main class="main">
<header class="topbar no-print">
<form class="topsearch" method="get" action="/tracking"><span>${ic('search')}</span><input name="q" placeholder="Cari kode pallet / barcode…" autocomplete="off"></form>
<div class="topuser"><span class="avatar">${esc(initials)}</span><span class="tu-id"><b>${esc(session.name)}</b><span class="mut">${esc(session.role)}</span></span>
<form class="inline" method="post" action="/logout"><button class="btn btn-outline-secondary btn-sm" type="submit">Keluar</button></form></div>
</header>
<div class="wrap" id="wrap">${body}</div>
</main>
</div>
<script>
(function(){
window.ICONS=${JSON.stringify(ICONS)};
window.__cssV=${CSS_V};
var wrap=document.getElementById('wrap');
function skeleton(){
  var h='<div class="skel skel-title"></div><div class="grid g4">';
  for(var i=0;i<4;i++)h+='<div class="card"><div class="skel skel-line"></div><div class="skel skel-num"></div></div>';
  h+='</div><div class="card" style="margin-top:10px"><div class="skel skel-line"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>';
  return h;
}
function setActive(active){
  var as=document.querySelectorAll('.nav-pills a');
  for(var i=0;i<as.length;i++){as[i].classList.toggle('active',as[i].getAttribute('href')===active);}
}
function runScripts(root){
  var ss=root.querySelectorAll('script');
  for(var i=0;i<ss.length;i++){var n=document.createElement('script');n.textContent=ss[i].textContent;document.body.appendChild(n);n.parentNode.removeChild(n);}
}
// Date picker neobrutalism: bangun grid kalender di tiap [data-dp].
function initDatePickers(root){
  (root||document).querySelectorAll('[data-dp]').forEach(function(dp){
    var inp=dp.querySelector('.dp-input'),pop=dp.querySelector('[data-pop]'),
        grid=dp.querySelector('[data-grid]'),title=dp.querySelector('[data-title]');
    var dow=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    var mo=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    function pad(n){return(n<10?'0':'')+n;}
    function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
    function parse(v){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
    var sel=parse(inp.value),view=sel?new Date(sel.getFullYear(),sel.getMonth(),1):new Date();
    view.setDate(1);
    function label(){return sel?(sel.getDate()+' '+mo[sel.getMonth()]+' '+sel.getFullYear()):inp.getAttribute('data-ph');}
    function render(){
      title.textContent=mo[view.getMonth()]+' '+view.getFullYear();
      var first=new Date(view.getFullYear(),view.getMonth(),1),start=first.getDay(),
          days=new Date(view.getFullYear(),view.getMonth()+1,0).getDate(),
          prevDays=new Date(view.getFullYear(),view.getMonth(),0).getDate(),
          ts=iso(new Date()),h='';
      for(var i=0;i<start;i++){h+='<button type="button" class="dp-cell out" data-off="1">'+(prevDays-start+i+1)+'</button>';}
      for(var d=1;d<=days;d++){
        var dd=new Date(view.getFullYear(),view.getMonth(),d),di=iso(dd),
            cls='dp-cell'+(di===ts?' today':'')+(sel&&di===iso(sel)?' sel':'');
        h+='<button type="button" class="'+cls+'" data-day="'+di+'">'+d+'</button>';
      }
      var total=start+days,rem=(7-total%7)%7;
      for(var j=1;j<=rem;j++){h+='<button type="button" class="dp-cell out" data-off="1">'+j+'</button>';}
      grid.innerHTML=h;
    }
    function paint(){inp.value=sel?iso(sel):'';inp.setAttribute('data-label',label());inp.title=label();}
    inp.addEventListener('focus',function(){inp.readOnly=true;});
    inp.addEventListener('click',function(){var open=pop.classList.contains('open');
      document.querySelectorAll('.dp-pop.open').forEach(function(p){p.classList.remove('open');});
      if(!open){render();pop.classList.add('open');}});
    dp.querySelector('[data-nav="-1"]').addEventListener('click',function(){view.setMonth(view.getMonth()-1);render();});
    dp.querySelector('[data-nav="1"]').addEventListener('click',function(){view.setMonth(view.getMonth()+1);render();});
    dp.querySelector('[data-today]').addEventListener('click',function(){var n=new Date();sel=new Date(n.getFullYear(),n.getMonth(),n.getDate());view=new Date(sel.getFullYear(),sel.getMonth(),1);paint();pop.classList.remove('open');});
    dp.querySelector('[data-clear]').addEventListener('click',function(){sel=null;paint();pop.classList.remove('open');});
    grid.addEventListener('click',function(e){var b=e.target.closest('[data-day]');if(!b)return;sel=parse(b.getAttribute('data-day'));paint();pop.classList.remove('open');});
  });
}
function paint(path,push){
  if(push!==false){try{history.pushState({fp:path},'',path);}catch(e){}}
  wrap.innerHTML=skeleton();
  fetch('/api/fragment?path='+encodeURIComponent(path),{headers:{'Accept':'application/json'}}).then(function(r){
    if(r.status===401){window.location.href='/login';return null;}
    if(!r.ok){window.location.href=path;return null;}
    return r.json();
  }).then(function(d){
    if(!d)return;
    if(d.redirect){window.location.href=d.redirect;return;}
    if(d.cssV&&d.cssV!==window.__cssV){window.location.reload();return;}
    setActive(d.active);
    if(d.title)document.title=d.title;
    wrap.innerHTML=d.body;
    runScripts(wrap);
    initDatePickers(wrap);
    window.scrollTo(0,0);
  }).catch(function(){window.location.href=path;});
}
document.addEventListener('click',function(e){
  var t=e.target, a=(t&&t.closest)?t.closest('a[href^="/"]'):null;
  if(!a||a.target||a.hasAttribute('download'))return;
  var u=new URL(a.getAttribute('href'),window.location.origin);
  if(u.pathname==='/style.css'||u.pathname==='/bootstrap.min.css'||u.pathname==='/favicon.ico')return;
  if(u.pathname.indexOf('/print')===u.pathname.length-6)return;
  if(u.searchParams.has('dl'))return;
  e.preventDefault();
  if(u.pathname+u.search===window.location.pathname+window.location.search)return;
  paint(u.pathname+u.search,true);
});
document.addEventListener('submit',function(e){
  var f=e.target;
  if(!f||f.tagName!=='FORM'||(f.method||'get').toLowerCase()!=='get')return;
  var act=f.getAttribute('action');
  var u=new URL(act||window.location.pathname,window.location.origin);
  if(u.origin!==window.location.origin)return;
  e.preventDefault();
  var qs=new URLSearchParams(new FormData(f)).toString();
  paint(u.pathname+(qs?'?'+qs:''),true);
});
window.addEventListener('popstate',function(){paint(window.location.pathname+window.location.search,false);});
document.addEventListener('click',function(e){if(!e.target.closest('.dp')){document.querySelectorAll('.dp-pop.open').forEach(function(p){p.classList.remove('open');});}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.querySelectorAll('.dp-pop.open').forEach(function(p){p.classList.remove('open');});}});
window.initDatePickers=initDatePickers;
initDatePickers(document);
})();
</script>
</body></html>`;
}

function statusLabel(status) {
  if (status === "IN_PRODUCTION") return "Belum keluar dari produksi";
  if (status === "IN_TRANSIT_WAREHOUSE") return "Sudah keluar dari produksi";
  return status;
}

// Ikon neobrutalism: SVG inline (garis hitam tebal + isi flat peach/mint/pink).
// Tanpa CDN/font eksternal. window.ICONS dipakai skrip inline (menu Transit).
const ICONS = {
  chart: '<rect x="4" y="12" width="4" height="8" fill="#A3E4D7"/><rect x="10" y="7" width="4" height="13" fill="#FFB088"/><rect x="16" y="3" width="4" height="17" fill="#FF6B97"/><line x1="2" y1="21" x2="22" y2="21"/>',
  box: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" fill="#FFB088"/><path d="M4 6.5l8 4.5 8-4.5M12 11v9"/>',
  truck: '<rect x="1.5" y="6" width="12" height="9" fill="#A3E4D7"/><path d="M13.5 10h4l3 3v2h-7z" fill="#FFB088"/><circle cx="6" cy="17.5" r="1.8" fill="#111111"/><circle cx="17" cy="17.5" r="1.8" fill="#111111"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="#ffffff"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke-width="2.5"/>',
  doc: '<path d="M6 2h8l4 4v16H6z" fill="#ffffff"/><path d="M14 2v4h4"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  archive: '<rect x="3" y="4" width="18" height="5" fill="#FFB088"/><path d="M5 9v11h14V9" fill="#ffffff"/><line x1="5" y1="13" x2="19" y2="13"/>',
  users: '<circle cx="9" cy="8" r="3.5" fill="#A3E4D7"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" fill="#A3E4D7"/><circle cx="17" cy="9" r="2.6" fill="#FFB088"/><path d="M16.2 14.2c2.8.4 5.3 2.4 5.3 5.3" fill="none"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="#FFB088"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  factory: '<path d="M3 21V10l5 3.5V10l5 3.5V10l5 3.5V21H3z" fill="#ffffff"/><rect x="17" y="3" width="3" height="8" fill="#FFB088"/><line x1="7.5" y1="16.5" x2="7.5" y2="18"/><line x1="12" y1="16.5" x2="12" y2="18"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="#ffffff"/><path d="M12 7v5l3.5 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" fill="#ffffff"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2.5" x2="8" y2="6"/><line x1="16" y1="2.5" x2="16" y2="6"/>',
  save: '<path d="M5 2h11l3 3v17H5z" fill="#A3E4D7"/><rect x="8" y="2" width="8" height="5" fill="#ffffff"/><rect x="8" y="14" width="8" height="8" fill="#ffffff"/>',
  tag: '<path d="M3 3h7l11 11-7 7L3 10V3z" fill="#FF6B97"/><circle cx="8" cy="8" r="1.5" fill="#ffffff"/>',
  receipt: '<path d="M6 2h12v20l-2-1.5-2 1.5-2-1.5L10 22l-2-1.5L6 22V2z" fill="#ffffff"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>',
  trend: '<path d="M2 2v20h20"/><path d="M6 15l4-4 3 3 5-6"/><path d="M14 8h4v4"/>',
  print: '<path d="M7 8V2h10v6" fill="#ffffff"/><rect x="3" y="8" width="18" height="9" fill="#A3E4D7"/><rect x="7" y="14" width="10" height="8" fill="#ffffff"/>',
  check: '<circle cx="12" cy="12" r="9" fill="#A3E4D7"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
  clip: '<rect x="5" y="4" width="14" height="18" fill="#ffffff"/><rect x="9" y="2" width="6" height="4" fill="#FFB088"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" fill="none"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  minus: '<rect x="2" y="2" width="20" height="20" rx="4" fill="#FF6B97"/><line x1="7" y1="12" x2="17" y2="12" stroke="#ffffff" stroke-width="2.5"/>',
  plus: '<rect x="2" y="2" width="20" height="20" rx="4" fill="#A3E4D7"/><path d="M12 7v10M7 12h10"/>',
  pin: '<path d="M12 22s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" fill="#FF6B97"/><circle cx="12" cy="10" r="2.5" fill="#ffffff"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" fill="#FFB088"/><path d="M14.5 6.5l3 3"/>',
  help: '<circle cx="12" cy="12" r="9" fill="#ffffff"/><text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="800" fill="#111111" stroke="none">?</text>',
  up: '<rect x="2" y="2" width="20" height="20" rx="4" fill="#ffffff"/><path d="M12 19V5M6 11l6-6 6 6"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" fill="#ffffff"/><circle cx="12" cy="12" r="2.5" fill="#111111"/>',
  down: '<rect x="2" y="2" width="20" height="20" rx="4" fill="#ffffff"/><path d="M12 5v14M6 13l6 6 6-6"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="#FFB088"/>',
  key: '<circle cx="8" cy="8" r="4.5" fill="#FFB088"/><path d="M11.5 11.5L20 20M16.5 16.5l2.5-.5M18.5 18.5l.5-2.5"/>',
  link: '<rect x="8" y="8" width="12" height="8" rx="4" transform="rotate(-45 14 12)" fill="#A3E4D7"/><rect x="4" y="8" width="12" height="8" rx="4" transform="rotate(-45 10 12)" fill="#ffffff"/>',
  send: '<path d="M3 12l18-8-8 18-2.5-7.5L3 12z" fill="#FFB088"/><path d="M10.5 14.5L21 4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" stroke-width="2.5"/>',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;

// Date picker neobrutalism (ala neobrutalism.dev) — tiruan vanilla JS.
// Input teks + popover kalender. Kalau JS mati, input tanggal native tetap jalan.
// monthLabel server-side cuma untuk tampilan awal (JS menggantinya saat dibuka).
function monthLabel(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
  const names = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return m ? `${names[Number(m[2]) - 1]} ${m[1]}` : "";
}
function datePickerField(name, value, placeholder) {
  const v = String(value || "");
  const label = v ? fDate(v) : (placeholder || "Pilih tanggal");
  const mv = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
  return `<div class="dp" data-dp>
<input type="text" class="dp-input" name="${esc(name)}" value="${esc(v)}" placeholder="${esc(placeholder || "Pilih tanggal…")}" data-label="${esc(label)}" data-ph="${esc(placeholder || "Pilih tanggal")}" autocomplete="off" readonly>
<div class="dp-pop" data-pop>
<div class="dp-head"><button type="button" class="dp-nav" data-nav="-1" aria-label="Bulan sebelumnya">‹</button><span class="dp-title" data-title>${esc(monthLabel(mv))}</span><button type="button" class="dp-nav" data-nav="1" aria-label="Bulan berikutnya">›</button></div>
<div class="dp-dow"><span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span></div>
<div class="dp-grid" data-grid></div>
<div class="dp-foot"><button type="button" class="dp-today" data-today>Hari ini</button><button type="button" class="dp-clear" data-clear>Hapus</button></div>
</div></div>`;
}

// Native select neobrutalism (ala neobrutalism.dev): bungkus <select> dengan
// wrapper relatif + chevron-down absolut (SVG), appearance:none lihat style.css.
const ICON_CHEVRON = '<svg class="ns-chev" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function selWrap(selectHtml, { sm = true, cls = "", full = false } = {}) {
  return `<div class="nselect${sm ? " sm" : ""}${full ? " full" : ""}${cls ? " " + cls : ""}">${selectHtml}${ICON_CHEVRON}</div>`;
}

// Pilihan shift: 1, 2, atau 3. `any` menambah opsi kosong "Semua shift"
// untuk filter (dipakai di Tracking & Laporan).
function shiftSelect(name, value, { any = false } = {}) {
  const cur = String(value || "");
  const o = (v, label) => `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return selWrap(`<select name="${esc(name)}" title="Shift"${any ? "" : " required"}>`
    + (any ? `<option value="" ${cur === "" ? "selected" : ""}>Semua shift</option>` : "")
    + o("1", "Shift 1") + o("2", "Shift 2") + o("3", "Shift 3")
    + (any || cur === "" || ["1", "2", "3"].includes(cur) ? "" : o(cur, `Shift ${esc(cur)}`))
    + `</select>`);
}

function badge(status) {
  const tone = status === "IN_TRANSIT_WAREHOUSE" || status === "COMPLETE" ? "text-bg-success"
    : status === "IN_PRODUCTION" || status === "PENDING" ? "text-bg-warning"
    : status === "MISMATCH" ? "text-bg-danger" : "text-bg-secondary";
  return `<span class="badge ${tone}">${esc(statusLabel(status))}</span>`;
}

// ── Login ────────────────────────────────────────────────────────────────────
function loginView(err) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Masuk — Pallet Tracking</title><link rel="stylesheet" href="/bootstrap.min.css?v=1"><link rel="stylesheet" href="/style.css?v=${CSS_V}"></head><body>
<div class="login"><div class="card shadow-sm">
<h1 class="h4 mb-1">${ic('box')} Pallet Tracking</h1>
<p class="mut mb-3">Masuk untuk mengelola pallet produksi & transit.</p>
${err ? `<div class="alert alert-danger py-2">${esc(err)}</div>` : ""}
<form method="post" action="/login">
<label class="form-label mt-2" for="u">Username</label><input id="u" class="form-control" name="username" autocomplete="username" required>
<label class="form-label mt-2" for="p">Password</label><input id="p" class="form-control" name="password" type="password" autocomplete="current-password" required>
<div class="d-grid mt-3"><button class="btn btn-primary" type="submit">Masuk</button></div>
</form></div></div></body></html>`;
}

async function handleLogin(req, res) {
  if (req.method === "GET") return sendHTML(req, res, 200, loginView(""));
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  const { data } = await parseBody(req);
  const username = String(data.username || "").trim().toLowerCase();
  const password = String(data.password || "");
  if (!username || !password) return sendHTML(req, res, 200, loginView("Username dan password wajib diisi."));
  const user = await sb.one("users", [sb.eq("username", username), sb.selCols("id,username,name,role,is_active,password_hash")]);
  if (!user || !user.is_active || !(await auth.verifyPassword(password, user.password_hash))) {
    return sendHTML(req, res, 200, loginView("Username atau password salah."));
  }
  const token = auth.createSession({ sub: user.id, username: user.username, name: user.name, role: user.role });
  await auth.audit(user.id, "LOGIN", "users", user.id, `Login ${username}`);
  redirect(res, "/", auth.setSessionCookie(token));
}

// ── Dashboard ────────────────────────────────────────────────────────────────
// Rentang filter dari mode: harian (1 hari) · mingguan (Senin–Minggu) · bulanan.
function dashRange(mode, dateStr, monthStr) {
  const today = new Date().toISOString().slice(0, 10);
  if (mode === "bulanan") {
    const m = /^\d{4}-\d{2}$/.test(monthStr || "") ? monthStr : today.slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const from = `${m}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { mode: "bulanan", from, to: `${m}-${String(last).padStart(2, "0")}`, month: m };
  }
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || "") ? dateStr : today;
  if (mode === "harian") return { mode: "harian", from: ref, to: ref, date: ref };
  // mingguan: Senin–Minggu yang memuat tanggal acuan.
  const d = new Date(ref + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Senin=0
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { mode: "mingguan", from: iso(mon), to: iso(sun), date: ref };
}

// Grafik garis produksi box per hari — SVG server-side (tanpa library/JS,
// tetap tampil saat fallback full-load tanpa JS).
function lineChart(daily) {
  if (!daily.length) return `<p class="mut" style="margin-top:6px">Belum ada data produksi pada periode ini.</p>`;
  const W = 620, H = 230, PL = 40, PR = 14, PT = 16, PB = 32;
  const max = Math.max(...daily.map((d) => d.box), 1);
  const ceil = Math.max(1, Math.ceil(max / 4) * 4 || max);
  const n = daily.length;
  const X = (i) => (n === 1 ? PL + (W - PL - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1));
  const Y = (v) => PT + (1 - v / ceil) * (H - PT - PB);
  const pts = daily.map((d, i) => `${X(i).toFixed(1)},${Y(d.box).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = (PT + (1 - f) * (H - PT - PB)).toFixed(1);
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" class="gl"/>`
      + `<text x="${PL - 5}" y="${Number(y) + 4}" text-anchor="end" class="ga">${Math.round(ceil * f)}</text>`;
  }).join("");
  const step = Math.max(1, Math.ceil(n / 12));
  const labels = daily.map((d, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    let s = d.date;
    try { s = new Date(d.date + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" }); } catch { /* pakai apa adanya */ }
    return `<text x="${X(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="ga">${esc(s)}</text>`;
  }).join("");
  const dots = daily.map((d, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(d.box).toFixed(1)}" r="4" class="ld"/>`
    + (n <= 14 ? `<text x="${X(i).toFixed(1)}" y="${(Y(d.box) - 9).toFixed(1)}" text-anchor="middle" class="lv">${d.box}</text>` : "")).join("");
  return `<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik produksi box per hari">`
    + grid
    + `<polygon points="${PL},${Y(0).toFixed(1)} ${pts} ${X(n - 1).toFixed(1)},${Y(0).toFixed(1)}" class="la"/>`
    + `<polyline points="${pts}" class="ll"/>` + dots + labels + `</svg>`;
}

// Grafik batang produksi box per shift — batang CSS murni (tanpa JS).
function shiftBars(perShift) {
  if (!perShift.length) return `<p class="mut" style="margin-top:6px">Belum ada data shift pada periode ini.</p>`;
  const max = Math.max(...perShift.map((s) => s.box), 1);
  return `<div class="shiftbars">${perShift.map((s) => `
    <div class="sb-col"><div class="sb-val">${s.box}</div>`
    + `<div class="sb-track"><div class="sb-fill" style="height:${Math.max(4, Math.round((s.box / max) * 100))}%"></div></div>`
    + `<div class="sb-lab">Shift ${esc(s.shift)}</div></div>`).join("")}</div>`;
}

// Fallback bila RPC dashboard_overview belum dijalankan di project Supabase
// (retensi kompatibilitas): hitung agregat yang sama via REST.
async function dashboardFallback(from, to, shift, productId, status) {
  const det = await sb.selPaged("pallet_production_details", [
    sb.gte("production_date", from), sb.lte("production_date", to),
    ...(shift ? [sb.eq("shift", shift)] : []),
    sb.selCols("pallet_id,production_date,shift,box_quantity"),
    sb.orderBy("production_date", "asc"),
  ], { max: 10000 });
  const ids = [...new Set(det.map((d) => d.pallet_id))];
  const pmap = new Map();
  await Promise.all(sb.chunk(ids, 150).map(async (part) => {
    if (!part.length) return;
    const rows = await sb.sel("pallets", [
      sb.inList("id", part),
      ...(productId ? [sb.eq("product_id", productId)] : []),
      ...(status ? [sb.eq("status", status)] : []),
      sb.selCols("id,status"),
    ]);
    for (const r of rows) pmap.set(r.id, r.status);
  }));
  const rows = det.filter((d) => pmap.has(d.pallet_id));
  const sum = (f) => rows.filter(f).reduce((s, d) => s + d.box_quantity, 0);
  const grp = (key) => {
    const m = new Map();
    for (const d of rows) {
      const k = key(d);
      if (!m.has(k)) m.set(k, { box: 0, pallets: new Set() });
      const e = m.get(k);
      e.box += d.box_quantity; e.pallets.add(d.pallet_id);
    }
    return m;
  };
  const byDay = grp((d) => d.production_date);
  const byShift = grp((d) => d.shift);
  const byBoth = grp((d) => d.production_date + "|" + d.shift);
  const pset = new Set(rows.map((d) => d.pallet_id));
  const st = (s) => new Set(rows.filter((d) => pmap.get(d.pallet_id) === s).map((d) => d.pallet_id));
  return {
    total_box: sum(() => true),
    prod_box: sum((d) => pmap.get(d.pallet_id) === "IN_PRODUCTION"),
    transit_box: sum((d) => pmap.get(d.pallet_id) === "IN_TRANSIT_WAREHOUSE"),
    pallet_total: pset.size,
    in_prod: st("IN_PRODUCTION").size,
    in_transit: st("IN_TRANSIT_WAREHOUSE").size,
    daily: [...byDay.entries()].map(([date, e]) => ({ date, box: e.box, pallets: e.pallets.size })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    per_shift: [...byShift.entries()].map(([shift, e]) => ({ shift, box: e.box })).sort((a, b) => (a.shift < b.shift ? -1 : 1)),
    detail: [...byBoth.entries()].map(([k, e]) => { const [date, shift] = k.split("|"); return { date, shift, box: e.box, pallets: e.pallets.size }; }).sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.shift < b.shift ? -1 : 1))).slice(0, 100),
  };
}

async function dashboardPage(qs, q) {
  // Body di-cache 30 dtk (key = filter). Buka ulang menu = tanpa query DB.
  const { val: body, hit } = await cached(`dash:${qs}`, 30 * 1000, async () => {
  // Kompatibel mundur: ?productionDate=… lama dianggap mode harian.
  const modeRaw = ["harian", "mingguan", "bulanan"].includes(q.mode) ? q.mode : (q.productionDate ? "harian" : "mingguan");
  const r = dashRange(modeRaw, q.date || q.productionDate || "", q.month || "");
  const { shift, productId, status } = q;
  const s = await sb.rpc("dashboard_overview", {
    p_from: r.from, p_to: r.to,
    p_shift: shift || null,
    p_product_id: productId ? Number(productId) : null,
    p_status: status || null,
  }).catch(() => dashboardFallback(r.from, r.to, shift || "", productId ? Number(productId) : null, status || ""));
  const totalBox = Number(s.total_box ?? 0);
  const prodBox = Number(s.prod_box ?? 0);
  const transitBox = Number(s.transit_box ?? 0);
  const palletTotal = Number(s.pallet_total ?? 0);
  const daily = (s.daily || []).map((d) => ({ date: d.date, box: Number(d.box), pallets: Number(d.pallets) }));
  const perShift = (s.per_shift || []).map((x) => ({ shift: x.shift, box: Number(x.box) }));
  const detail = (s.detail || []).map((d) => ({ date: d.date, shift: d.shift, box: Number(d.box), pallets: Number(d.pallets) }));
  const bars = (hs) => `<div class="bars">${hs.map((h) => `<i style="height:${h}%"></i>`).join("")}</div>`;
  const rangeLbl = r.from === r.to ? fDate(r.from) : `${fDate(r.from)} – ${fDate(r.to)}`;
  const today = new Date().toISOString().slice(0, 10);

  const body = `<h1 class="mb-1">${ic('chart')} Dashboard</h1>
<p class="mut mb-3">Pantau hasil produksi box per hari &amp; per shift. Pilih periode cepat di bawah ini.</p>
<div class="d-flex flex-wrap gap-2 mb-3 align-items-center">
<a class="btn btn-secondary btn-sm" href="/?mode=harian&date=${today}">${ic('cal')} Hari ini</a>
<a class="btn btn-secondary btn-sm" href="/?mode=mingguan&date=${today}">${ic('cal')} Minggu ini</a>
<a class="btn btn-secondary btn-sm" href="/?mode=bulanan&month=${today.slice(0, 7)}">${ic('cal')} Bulan ini</a>
<span class="mut">Menampilkan <b>${esc(rangeLbl)}</b> · ${totalBox} box dari ${palletTotal} pallet</span>
</div>
<div class="grid g4">
<div class="stat-card stat-orange"><div class="n">${totalBox}</div><div class="t">${ic('box')} Jumlah Box</div>${bars([45,70,55,85,60])}</div>
<div class="stat-card stat-blue"><div class="n">${prodBox}</div><div class="t">${ic('factory')} Box di Produksi</div>${bars([70,50,75,60,80])}</div>
<div class="stat-card stat-green"><div class="n">${transitBox}</div><div class="t">${ic('truck')} Box di Transit</div>${bars([50,65,80,55,90])}</div>
<div class="stat-card stat-teal"><div class="n">${palletTotal}</div><div class="t">${ic('receipt')} Jumlah Pallet</div>${bars([55,80,60,70,50])}</div>
</div>
<div class="grid g2" style="margin-top:10px">
<div class="card"><b>${ic('trend')} Produksi Box Per Hari</b><div class="mut">${esc(rangeLbl)}</div><div style="margin-top:8px">${lineChart(daily)}</div></div>
<div class="card"><b>${ic('chart')} Produksi Box Per Shift</b><div class="mut">${esc(rangeLbl)}</div><div style="margin-top:8px">${shiftBars(perShift)}</div></div>
</div>
<div class="card" style="margin-top:10px;overflow-x:auto"><b>${ic('cal')} Rincian Produksi per Tanggal &amp; Shift</b> <span class="mut">(${detail.length} baris · ${esc(rangeLbl)})</span>
${!detail.length ? `<p class="mut" style="margin-top:6px">Belum ada data pada periode ini. Coba ubah periode atau filter.</p>` : `<table class="table table-striped table-hover table-sm align-middle" style="margin-top:6px"><thead><tr><th>Tanggal</th><th>Shift</th><th style="text-align:right">Box</th><th style="text-align:right">Pallet</th></tr></thead><tbody>${detail.map((t) => `<tr><td>${fDate(t.date)}</td><td>${esc(t.shift)}</td><td style="text-align:right">${t.box}</td><td style="text-align:right">${t.pallets}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="2"><b>Total</b></td><td style="text-align:right"><b>${detail.reduce((a, t) => a + t.box, 0)}</b></td><td style="text-align:right"><b>${palletTotal}</b></td></tr></tfoot></table>`}
</div>`;
  return body;
  });
  return { body, hit, active: "/", title: "Dashboard — Pallet Tracking" };
}

async function handleDashboard(req, res, session, q) {
  const qs = new URL(req.url || "/", "http://x").search;
  const p = await dashboardPage(qs, q);
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

// ── Pallets ──────────────────────────────────────────────────────────────────
async function palletsPage(qs, q, role) {
  const canDeletePallet = role === "ADMIN";
  const { val: body, hit } = await cached(`pl:${role}:${qs}`, 30 * 1000, async () => {
  const page = Math.max(1, parseInt(q.page || "1", 10) || 1);
  const { total, pallets } = await sb.palletPage(
    { status: q.status || "", codeLike: q.q ? q.q.trim().toUpperCase() : "" },
    { take: PER_PAGE, skip: (page - 1) * PER_PAGE }
  );
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const keep = `q=${encodeURIComponent(q.q || "")}&status=${encodeURIComponent(q.status || "")}`;
  const body = `<h1 class="mb-1">${ic('box')} Pallet <span class="mut">(${total})</span></h1>
<p class="mut mb-3">Daftar pallet produksi. Klik kode pallet untuk lihat rincian & cetak label.</p>
<form class="d-flex flex-wrap gap-2 mb-3 align-items-center" method="get">
<input name="q" placeholder="Cari kode… cth ${esc("PLT/2610/0001")}" value="${esc(q.q || "")}" class="mono">
${selWrap(`<select name="status"><option value="">Semua status</option><option value="IN_PRODUCTION" ${q.status === "IN_PRODUCTION" ? "selected" : ""}>Belum keluar dari produksi</option><option value="IN_TRANSIT_WAREHOUSE" ${q.status === "IN_TRANSIT_WAREHOUSE" ? "selected" : ""}>Sudah keluar dari produksi</option></select>`)}
<button class="btn btn-secondary btn-sm" type="submit">${ic('search')} Cari</button>
<a class="btn btn-primary btn-sm" href="/pallets/new">${ic('plus')} Buat Pallet</a>
</form>
<div class="card" style="padding:0;overflow-x:auto">
<form id="palletForm" method="post" action="/pallets/print-bulk" target="_blank">
<div class="no-print" id="bulkBar" style="display:none;padding:8px 10px;gap:8px;align-items:center;border-bottom:2px solid var(--ink)"><span class="mut"><b id="selCount">0</b> pallet dipilih</span><button class="btn btn-primary btn-sm" type="submit">${ic('print')} Cetak Label Terpilih</button><button class="btn btn-secondary btn-sm" type="button" onclick="clearSel()">Batal</button></div>
<table class="table table-striped table-hover table-sm align-middle"><thead><tr><th style="width:32px"><input type="checkbox" id="chkAll" title="Pilih semua"></th><th>Kode Pallet</th><th>Produk</th><th style="text-align:right">Jumlah Box</th><th>Status</th><th>Dibuat</th><th style="text-align:right">Aksi</th></tr></thead><tbody>
${pallets.map((p) => { const ex = p.details.reduce((s, d) => s + d.boxQuantity, 0); const pc = purl(p.palletCode); return `<tr><td><input type="checkbox" class="rowChk" name="codes" value="${esc(p.palletCode)}"></td><td class="mono"><a href="${pc}"><b>${esc(p.palletCode)}</b></a></td><td>${esc(p.product.productName)}</td><td style="text-align:right">${ex}</td><td>${badge(p.status)}</td><td class="mut">${fDT(p.createdAt)}</td><td style="text-align:right;white-space:nowrap"><a class="btn btn-secondary btn-sm" href="${pc}/print" title="Cetak label" target="_blank">${ic('print')}</a> <a class="btn btn-secondary btn-sm" href="${pc}" title="Edit / rincian">${ic('pencil')}</a>${canDeletePallet ? ` <form class="inline" method="post" action="${pc}/delete" onsubmit="return confirm('Hapus pallet ${esc(p.palletCode)}?')"><button class="btn btn-danger btn-sm" type="submit" title="Hapus">${ic('trash')}</button></form>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="7" class="mut">Belum ada pallet. Klik “Buat Pallet” untuk mulai.</td></tr>`}
</tbody></table>
</form></div>
<script>
(function(){
  var form=document.getElementById('palletForm'); if(!form) return;
  var all=document.getElementById('chkAll'), bar=document.getElementById('bulkBar'), cnt=document.getElementById('selCount');
  function rows(){ return [].slice.call(form.querySelectorAll('.rowChk')); }
  function sync(){ var n=rows().filter(function(c){return c.checked}).length; cnt.textContent=n; bar.style.display=n?'flex':'none'; }
  all&&(all.onchange=function(){ rows().forEach(function(c){c.checked=all.checked}); sync(); });
  form.addEventListener('change',function(e){ if(e.target.classList.contains('rowChk')){ if(!e.target.checked&&all) all.checked=false; sync(); } });
  window.clearSel=function(){ rows().forEach(function(c){c.checked=false}); if(all) all.checked=false; sync(); };
})();
</script>
<div class="pager"><span>Halaman ${page} / ${pages}</span>${page > 1 ? `<a href="/pallets?${keep}&page=${page - 1}">‹ Prev</a>` : ""}${page < pages ? `<a href="/pallets?${keep}&page=${page + 1}">Next ›</a>` : ""}</div>`;
  return body;
  });
  return { body, hit, active: "/pallets", title: "Pallet — Pallet Tracking" };
}

async function handlePallets(req, res, session, q) {
  if (!auth.canAccess(session.role, ["ADMIN", "PRODUCTION"])) { res.writeHead(403); return res.end("Forbidden"); }
  const qs = new URL(req.url || "/", "http://x").search;
  const p = await palletsPage(qs, q, session.role);
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

async function palletNewPage() {
  const products = (await getProductsCached()).filter((p) => p.isActive);
  const today = new Date().toISOString().slice(0, 10);
  const body = `<h1 class="mb-1">${ic('plus')} Buat Pallet</h1>
<p class="mut mb-3">Pilih produk, lalu isi tanggal produksi, shift, dan jumlah box per baris. Kode pallet dibuat otomatis.</p>
<div class="card">
<form method="post" action="/pallets">
<label class="mut">Produk *</label>
${selWrap(`<select name="productId" required><option value="">— Pilih produk —</option>${products.map((p) => `<option value="${p.id}">${esc(p.productName)}</option>`).join("")}</select>`, { cls: "block", full: true })}
<label class="mut">Rincian produksi * <span class="mut">(tanggal · shift · jumlah box)</span></label>
<div id="rows" style="margin-top:4px">
<div class="rowline">${datePickerField("productionDate", today, "Tanggal")}${shiftSelect("shift", "1")}<input name="boxQuantity" type="number" min="1" placeholder="Box" required style="width:100px"><button type="button" class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()">${ic('x')} Hapus</button></div>
</div>
<button type="button" class="btn btn-secondary btn-sm" id="add">${ic('plus')} Tambah baris</button>
<div style="margin-top:12px"><label class="mut">Catatan (opsional)</label><textarea name="notes" rows="2" style="margin-top:4px" placeholder="cth: lot khusus, instruksi gudang…"></textarea></div>
<div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" type="submit">${ic('save')} Simpan Pallet</button><a class="btn btn-secondary btn-sm" href="/pallets">Batal</a></div>
</form></div>
<script>
document.getElementById('add').onclick=function(){var d=document.createElement('div');d.className='rowline';d.innerHTML=${JSON.stringify(datePickerField("productionDate", today, "Tanggal") + shiftSelect("shift", "1"))}+'<input name="boxQuantity" type="number" min="1" placeholder="Box" required style="width:100px"><button type="button" class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()">X</button>';document.getElementById('rows').appendChild(d);window.initDatePickers&&window.initDatePickers(d);};
</script>`;
  return { body, hit: false, active: "/pallets", title: "Pallet Baru — Pallet Tracking" };
}

async function handlePalletNew(req, res, session) {
  if (!auth.canAccess(session.role, ["ADMIN", "PRODUCTION"])) { res.writeHead(403); return res.end("Forbidden"); }
  const p = await palletNewPage();
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title));
}

async function handlePalletCreate(req, res, session) {
  if (!auth.canAccess(session.role, ["ADMIN", "PRODUCTION"])) { res.writeHead(403); return res.end("Forbidden"); }
  const { type, data } = await parseBody(req);
  if (type !== "form") { res.writeHead(400); return res.end("Bad request"); }
  const productId = String(data.productId || "");
  const notes = String(data.notes || "").trim();
  const dates = arr(data.productionDate), shifts = arr(data.shift), boxes = arr(data.boxQuantity);
  const clean = [];
  for (let i = 0; i < dates.length; i++) {
    const bq = Math.floor(Number(boxes[i]));
    if (dates[i] && String(shifts[i] || "").trim() && bq > 0) {
      clean.push({ productionDate: String(dates[i]), shift: String(shifts[i]).trim(), boxQuantity: bq });
    }
  }
  if (!productId || !clean.length) {
    res.writeHead(400); return res.end("Produk dan minimal 1 baris detail (box > 0) wajib diisi.");
  }
  const product = await sb.one("products", [sb.eq("id", productId), sb.selCols("id,is_active")]);
  if (!product || !product.is_active) { res.writeHead(400); return res.end("Produk tidak valid."); }
  // Atomik via RPC (pengganti $transaction — PostgREST tidak punya transaksi).
  const result = await sb.rpc("create_pallet", {
    p_product_id: Number(productId),
    p_notes: notes || null,
    p_created_by: session.sub,
    p_details: clean.map((d) => ({ production_date: d.productionDate, shift: d.shift, box_quantity: d.boxQuantity })),
  });
  await auth.audit(session.sub, "CREATE_PALLET", "pallets", result.id, `Pallet ${result.pallet_code} dibuat`);
  invalidate("dash:", "pl:", "tr:", "rp:", `pd:${result.pallet_code}:`, `pa:${result.pallet_code}`);
  redirect(res, purl(result.pallet_code));
}

async function palletDetailPage(code, role) {
  const palletCode = decodeURIComponent(code).toUpperCase();
  // Key pakai role karena tombol Hapus/form notes hanya untuk ADMIN.
  const { val: body, hit } = await cached(`pd:${palletCode}:${role}`, 20 * 1000, async () => {
  const full = await sb.palletFull(palletCode);
  if (!full) return null; // 404 tidak di-cache
  const { pallet, details, barcodeRows, totalBarcodes, verifications, movements } = full;
  pallet.details = details;
  pallet.barcodes = barcodeRows;
  pallet.verifications = verifications;
  pallet.movements = movements;
  const expected = details.reduce((s, d) => s + d.boxQuantity, 0);
  const verified = totalBarcodes;
  const diff = expected - verified;
  const canDelete = role === "ADMIN" && verified === 0;
  const bars = (hs) => `<div class="bars">${hs.map((h) => `<i style="height:${h}%"></i>`).join("")}</div>`;
  const body = `<h1 class="mono">${esc(pallet.palletCode)}</h1>
<p class="mut">${esc(pallet.product.productName)} · ${fDT(pallet.createdAt)} · ${esc(pallet.creator.name)} · ${badge(pallet.status)}</p>
<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap" class="no-print">
<a class="btn btn-secondary btn-sm" href="${purl(pallet.palletCode)}/print">${ic('print')} Cetak Label A5</a>
<a class="btn btn-secondary btn-sm" href="/tracking/${encodeURIComponent(pallet.palletCode)}">${ic('search')} Tracking</a>
${canDelete ? `<form class="inline" method="post" action="${purl(pallet.palletCode)}/delete" onsubmit="return confirm('Hapus pallet ${esc(pallet.palletCode)}? Data yang sudah diverifikasi tidak bisa dihapus.')"><button class="btn btn-danger btn-sm" type="submit">${ic('trash')} Hapus</button></form>` : ""}
</div>
<div class="grid g4">
<div class="stat-card stat-orange"><div class="n">${expected}</div><div class="t">${ic('box')} Total box</div>${bars([45,70,55,85,60])}</div>
<div class="stat-card stat-green"><div class="n">${verified}</div><div class="t">${ic('check')} Terverifikasi</div>${bars([50,65,80,55,90])}</div>
<div class="stat-card stat-pink"><div class="n">${diff}</div><div class="t">${ic('minus')} Selisih (kurang)</div>${bars([60,45,70,50,65])}</div>
<div class="stat-card stat-teal"><div class="n" style="font-size:16px">${pallet.status === "IN_TRANSIT_WAREHOUSE" ? "Gudang Transit" : "Gudang Produksi"}</div><div class="t">${ic('pin')} Posisi sekarang</div>${bars([55,80,60,70,50])}</div>
</div>
<div class="grid g2" style="margin-top:10px">
<div class="card"><b>${ic('cal')} Rincian tanggal &amp; shift</b>
<table class="table table-striped table-hover table-sm align-middle" style="margin-top:6px"><thead><tr><th>Tanggal</th><th>Shift</th><th style="text-align:right">Box</th></tr></thead><tbody>
${pallet.details.map((d) => `<tr><td>${fDate(d.productionDate)}</td><td>${esc(d.shift)}</td><td style="text-align:right">${d.boxQuantity}</td></tr>`).join("")}
</tbody></table>
${pallet.notes ? `<p style="margin-top:6px">${ic('pencil')} ${esc(pallet.notes)}</p>` : ""}
${role === "ADMIN" ? `<form method="post" action="${purl(pallet.palletCode)}/notes" style="margin-top:8px;display:flex;gap:6px"><input name="notes" value="${esc(pallet.notes || "")}" placeholder="Ubah catatan…" style="flex:1"><button class="btn btn-secondary btn-sm" type="submit">Simpan</button></form>` : ""}
</div>
<div class="card"><b>${ic('clock')} Riwayat perpindahan</b>
<div style="margin-top:6px;font-size:13px">
${pallet.movements.map((m) => `<div>• ${esc(m.fromLocation)} → <b>${esc(m.toLocation)}</b> <span class="mut">${fDT(m.performedAt)} · ${esc(m.performer.name)}${m.notes ? " · " + esc(m.notes) : ""}</span></div>`).join("") || `<p class="mut">Belum ada perpindahan.</p>`}
${pallet.verifications.map((v) => `<div>• ${ic('check')} Verifikasi ${v.uniqueBarcodeCount} barcode <span class="mut">${fDT(v.verifiedAt)} · ${esc(v.verifier.name)}</span> ${badge(v.verificationStatus)}</div>`).join("")}
</div></div></div>
<div class="card" style="margin-top:10px"><b>${ic('tag')} Daftar barcode (${verified})</b>
${!barcodeRows.length ? `<p class="mut" style="margin-top:6px">Belum ada barcode. Verifikasi dulu di menu Transit.</p>` : `<div class="box mono" style="margin-top:6px">${barcodeRows.map((b) => esc(b.barcode)).join("<br>")}</div>`}
${totalBarcodes > barcodeRows.length ? `<p class="mut">…menampilkan ${barcodeRows.length} dari ${totalBarcodes}.</p>` : ""}
</div>`;
  return body;
  });
  return { body, hit, active: "/pallets", title: `${palletCode} — Pallet Tracking` };
}

async function handlePalletDetail(req, res, session, code) {
  const p = await palletDetailPage(code, session.role);
  if (p.body === null) { res.writeHead(404); return res.end("Pallet tidak ditemukan."); }
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

// Render 1 label pallet (dipakai single & bulk print).
function renderLabel(full) {
  const pallet = { ...full.pallet, details: full.details };
  const total = pallet.details.reduce((s, d) => s + d.boxQuantity, 0);
  return `<div class="label">
<h1>${esc(pallet.palletCode)}</h1>
<table class="label-info" style="margin-top:12px"><tbody>
<tr><th>Nama Produk :</th><td>${esc(pallet.product.productName)}</td></tr>
<tr><th>Kode Produk :</th><td>${esc(pallet.product.productCode)}</td></tr>
<tr><th>Total Box :</th><td>${total} Box</td></tr>
</tbody></table>
<table style="margin-top:12px"><thead><tr><th>Tanggal</th><th>Box</th><th>Shift</th></tr></thead><tbody>
${pallet.details.map((d) => `<tr><td>${fDate(d.productionDate)}</td><td>${d.boxQuantity}</td><td>${esc(d.shift)}</td></tr>`).join("")}
</tbody></table>
${pallet.notes ? `<p class="label-notes"><b>Catatan :</b> ${esc(pallet.notes)}</p>` : `<p class="label-notes"><b>Catatan :</b></p>`}
</div>`;
}

async function handlePalletPrint(req, res, session, code) {
  const palletCode = decodeURIComponent(code).toUpperCase();
  const full = await sb.palletFull(palletCode);
  if (!full) { res.writeHead(404); return res.end("Pallet tidak ditemukan."); }
  sendHTML(req, res, 200, `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(palletCode)}</title><link rel="stylesheet" href="/bootstrap.min.css?v=1"><link rel="stylesheet" href="/style.css?v=${CSS_V}"></head><body>
<div class="print">
<div class="no-print" style="margin-bottom:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="window.print()">${ic('print')} Cetak</button><button class="btn btn-secondary btn-sm" onclick="history.back()">Kembali</button></div>
${renderLabel(full)}
</div></body></html>`);
}

// Cetak label beberapa pallet sekaligus (dari checkbox di daftar pallet).
// Disusun 2 label per lembar (atas-bawah).
async function handlePalletPrintBulk(req, res, session) {
  const { data } = await parseBody(req);
  const codes = [...new Set(arr(data.codes).map((c) => String(c).toUpperCase()).filter(Boolean))].slice(0, 100);
  if (!codes.length) { res.writeHead(400); return res.end("Tidak ada pallet yang dipilih."); }
  const fulls = await Promise.all(codes.map((c) => sb.palletFull(c)));
  const found = fulls.filter(Boolean);
  if (!found.length) { res.writeHead(404); return res.end("Pallet tidak ditemukan."); }
  const sheets = [];
  for (let i = 0; i < found.length; i += 2) {
    sheets.push(`<div class="label-sheet">${renderLabel(found[i])}${found[i + 1] ? renderLabel(found[i + 1]) : ""}</div>`);
  }
  sendHTML(req, res, 200, `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cetak ${found.length} Label</title><link rel="stylesheet" href="/bootstrap.min.css?v=1"><link rel="stylesheet" href="/style.css?v=${CSS_V}"></head><body>
<div class="print">
<div class="no-print" style="margin-bottom:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="window.print()">${ic('print')} Cetak ${found.length} Label</button><button class="btn btn-secondary btn-sm" onclick="history.back()">Kembali</button></div>
${sheets.join("")}
</div></body></html>`);
}

// ── Transit ──────────────────────────────────────────────────────────────────
async function getPatterns() {
  const row = await sb.one("app_settings", [sb.eq("key", "barcode_patterns"), sb.selCols("value")]);
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

// Cache daftar produk 60 detik — tabel kecil & jarang berubah. 1 roundtrip
// REST ~100ms, jadi tiap halaman yg butuh dropdown produk hemat 1 query.
let PRODUCT_CACHE = { at: 0, rows: null };
async function getProductsCached() {
  if (PRODUCT_CACHE.rows && Date.now() - PRODUCT_CACHE.at < 60 * 1000) return PRODUCT_CACHE.rows;
  const rows = (await sb.productsAll()).map((p) => ({ id: p.id, productCode: p.productCode, productName: p.productName, isActive: p.isActive }));
  if (PRODUCT_CACHE.rows && PRODUCT_CACHE.rows.length && !rows.length) return PRODUCT_CACHE.rows; // jangan timpa cache bagus dgn hasil kosong
  PRODUCT_CACHE = { at: Date.now(), rows };
  return rows;
}
function invalidateProductsCache() { PRODUCT_CACHE.at = 0; }

async function transitPage() {
  return { body: transitView(), hit: false, active: "/transit", title: "Transit — Pallet Tracking" };
}

function transitView(session) {
  return `<h1 class="mb-1">${ic('truck')} Verifikasi Transit</h1>
<p class="mut mb-3">Terima pallet dari produksi: cek kode → tempel hasil scan → proses → simpan.</p>
<div class="grid g2">
<div class="card">
<div class="mut"><b>Langkah 1 — Kode pallet *</b> <span class="mut">tujuan barang ini</span></div>
<div style="position:relative;margin-top:4px">
<input id="pc" class="mono" placeholder="cari kode… cth: 0003" autocomplete="off" style="width:100%">
<div id="sugg" class="sugg-list" style="display:none"></div>
</div>
<div id="info" style="margin-top:8px"></div>
<div class="mut" style="margin-top:10px"><b>Langkah 2 — Hasil scan *</b> <span class="mut">tempel semua baris dari alat scan</span></div>
<textarea id="raw" rows="12" class="mono" style="font-size:12px;margin-top:4px" placeholder="Tempel hasil scan di sini, satu barcode per baris…"></textarea>
<div style="margin-top:8px"><button class="btn btn-primary btn-sm" id="go" type="button">${ic('gear')} Langkah 3 — Proses Barcode</button></div>
</div>
<div class="card"><b>${ic('clip')} Langkah 4 — Hasil &amp; simpan</b><div id="out" style="margin-top:6px"><p class="mut">Isi kode pallet + hasil scan, lalu klik Proses Barcode.</p></div></div>
</div>
<script>
var pc=document.getElementById('pc'),raw=document.getElementById('raw'),info=document.getElementById('info'),out=document.getElementById('out');
var sugg=document.getElementById('sugg');
var cache=[];
async function lookup(){
  var c=pc.value.trim().toUpperCase();info.innerHTML='';if(!c)return;
  try{var r=await fetch('/api/pallets/'+encodeURIComponent(c));var d=await r.json();
    if(!r.ok){info.innerHTML='<div class="alert alert-danger py-2">'+d.error+'</div>';return;}
    var st=d.status==='IN_TRANSIT_WAREHOUSE'?'Sudah keluar dari produksi':(d.status==='IN_PRODUCTION'?'Belum keluar dari produksi':d.status);
    info.innerHTML='<div class="box"><b>'+d.productName+'</b><br>Total box: <b>'+d.expected+'</b> · Terverifikasi: <b>'+d.verified+'</b> · '+st+'</div>';
  }catch(e){info.innerHTML='<div class="alert alert-danger py-2">Gagal memeriksa pallet.</div>';}
}
// Autocomplete: ketik potongan kode (mis. "0003") → muncul daftar pallet yang cocok.
var suggTimer=null;
function hideSugg(){sugg.style.display='none';sugg.innerHTML='';}
function escS(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pickSugg(code){pc.value=code;hideSugg();lookup();}
pc.addEventListener('input',function(){
  var q=pc.value.trim().toUpperCase().split(' ').join('');
  clearTimeout(suggTimer);
  if(q.length<2){hideSugg();return;}
  suggTimer=setTimeout(async function(){
    try{
      var r=await fetch('/api/pallets/search?q='+encodeURIComponent(q));var list=await r.json();
      if(!Array.isArray(list)||!list.length){sugg.innerHTML='<div class="sugg-empty">Tidak ada kode cocok</div>';sugg.style.display='block';return;}
      sugg.innerHTML=list.map(function(p){
        var st=p.status==='IN_TRANSIT_WAREHOUSE'?'Sudah keluar':'Belum keluar';
        return '<div class="sugg-item" data-code="'+escS(p.palletCode)+'"><b class="mono">'+escS(p.palletCode)+'</b><span class="mut">'+escS(p.productName)+' · '+p.expected+' box · '+st+'</span></div>';
      }).join('');
      sugg.style.display='block';
    }catch(e){hideSugg();}
  },200);
});
sugg.addEventListener('click',function(e){var it=e.target.closest('.sugg-item');if(it)pickSugg(it.getAttribute('data-code'));});
pc.addEventListener('keydown',function(e){if(e.key==='Enter'){hideSugg();lookup();}if(e.key==='Escape')hideSugg();});
document.addEventListener('click',function(e){if(!e.target.closest('#sugg')&&e.target!==pc)hideSugg();});
document.getElementById('go').onclick=async function(){
  out.innerHTML='<p class="mut">Memproses…</p>';cache=[];
  try{var r=await fetch('/api/transit/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:raw.value})});
    var d=await r.json();if(!r.ok){out.innerHTML='<div class="alert alert-danger py-2">'+(d.error||'Gagal')+'</div>';return;}
    cache=d.barcodes;
    // Hasil ekstrak menggantikan isi kolom scan (Langkah 2) sebagai bahan verifikasi.
    raw.value=d.barcodes.join(String.fromCharCode(10));
    var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
    // Render max 200 baris agar DOM tidak freeze (sebelumnya join semua → ribuan node).
    var shown=d.barcodes.slice(0,200).map(esc).join('<br>');
    if(d.barcodes.length>200)shown+='<br><span class="mut">…+'+(d.barcodes.length-200)+' lagi (pakai Copy untuk lihat semua)</span>';
    var bars='<div class="bars"><i style="height:45%"></i><i style="height:70%"></i><i style="height:55%"></i><i style="height:85%"></i><i style="height:60%"></i></div>';
    out.innerHTML='<div class="grid g4">'
      +'<div class="stat-card stat-blue"><div class="n" style="font-size:20px">'+d.nonEmptyLines+'/'+d.totalLines+'</div><div class="t">'+window.ICONS.doc+' Baris terbaca</div>'+bars+'</div>'
      +'<div class="stat-card stat-green"><div class="n">'+d.uniqueCount+'</div><div class="t">'+window.ICONS.tag+' Barcode unik</div>'+bars+'</div>'
      +'<div class="stat-card stat-amber"><div class="n">'+d.duplicateCount+'</div><div class="t">'+window.ICONS.clip+' Duplikat</div>'+bars+'</div>'
      +'<div class="stat-card stat-pink"><div class="n">'+d.unrecognizedLines+'</div><div class="t">'+window.ICONS.help+' Tak dikenali</div>'+bars+'</div></div>'
      +'<div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="cp" type="button">'+window.ICONS.clip+' Salin Hasil</button></div><div id="msg" style="margin-top:8px"></div>';
    document.getElementById('cp').onclick=function(){
      // Salin ke clipboard, lalu langsung simpan verifikasi.
      // (Langkah 1 & 2 dikosongkan oleh confirmSave saat simpan sukses.)
      try{if(navigator.clipboard)navigator.clipboard.writeText(cache.join('\\n'));}catch(e){}
      confirmSave(false);
    };
  }catch(e){out.innerHTML='<div class="alert alert-danger py-2">Gagal memproses.</div>';}
};
async function confirmSave(force){
  var msg=document.getElementById('msg');msg.innerHTML='<p class="mut">Menyimpan…</p>';
  try{var r=await fetch('/api/transit/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({palletCode:pc.value.trim().toUpperCase(),rawScanData:raw.value,force:force})});
    var d=await r.json();
    if(!r.ok){msg.innerHTML='<div class="alert alert-danger py-2">'+d.error+'</div>'+(String(d.error||'').indexOf('MISMATCH')===0?'<button class="btn btn-danger btn-sm" id="fc" type="button">Konfirmasi paksa (Admin)</button>':'');var f=document.getElementById('fc');if(f)f.onclick=function(){confirmSave(true);};return;}
    msg.innerHTML='<div class="alert alert-success py-2">Tersimpan: '+d.uniqueCount+' barcode'+(d.mismatch?' (MISMATCH)':'')+'.</div>';
    // Sukses → kosongkan Langkah 1 & 2, siap untuk verifikasi berikutnya.
    pc.value='';raw.value='';cache=[];info.innerHTML='';
  }catch(e){msg.innerHTML='<div class="alert alert-danger py-2">Gagal menyimpan.</div>';}
}
</script>`;
}

async function handleTransitConfirm(session, input) {
  if (!auth.canAccess(session.role, ["ADMIN", "TRANSIT"])) throw new Error("FORBIDDEN");
  const palletCode = String(input.palletCode || "").trim().toUpperCase();
  const rawScanData = String(input.rawScanData || "");
  const force = input.force === true;
  if (!palletCode) throw new Error("Pallet ID wajib diisi.");
  if (!rawScanData.trim()) throw new Error("Raw scan data kosong.");
  if (rawScanData.length > 500000) throw new Error("Data terlalu besar (maks 500KB).");

  const prow = await sb.one("pallets", [sb.eq("pallet_code", palletCode), sb.selCols("id")]);
  if (!prow) throw new Error(`Pallet ${palletCode} tidak ditemukan.`);
  const palletId = prow.id;

  const patterns = await getPatterns();
  const parsed = extractBarcodes(rawScanData, patterns.length ? patterns : undefined);
  if (parsed.uniqueCount === 0) throw new Error("Tidak ada barcode valid yang dikenali.");

  // Total box harapan + barcode yang sudah ada (2 query ringan paralel).
  const [detRows, existRows] = await Promise.all([
    sb.sel("pallet_production_details", [sb.eq("pallet_id", palletId), sb.selCols("box_quantity")]),
    sb.sel("pallet_barcodes", [sb.eq("pallet_id", palletId), sb.selCols("barcode"), ...sb.range(0, 10000)]),
  ]);
  const exist = new Set(existRows.map((b) => b.barcode));
  const newBarcodes = parsed.barcodes.filter((b) => !exist.has(b));

  const expectedTotal = detRows.reduce((s, d) => s + d.box_quantity, 0);
  const mismatch = parsed.uniqueCount !== expectedTotal;
  if (mismatch && !force) {
    throw new Error(`MISMATCH: barcode unik (${parsed.uniqueCount}) ≠ total box (${expectedTotal}).`);
  }

  // Atomik via RPC: cek konflik + insert + verifikasi + status (1 roundtrip).
  await sb.rpc("confirm_transit", {
    p_pallet_id: palletId,
    p_verified_by: session.sub,
    p_new_barcodes: newBarcodes,
    p_all_barcodes: parsed.barcodes,
    p_raw: rawScanData.slice(0, 200000),
    p_unique_count: parsed.uniqueCount,
    p_mismatch: mismatch,
  });

  await auth.audit(session.sub, "TRANSIT_VERIFY", "pallets", palletId, `${palletCode}: ${parsed.uniqueCount} barcode${mismatch ? " (MISMATCH)" : ""}`);
  invalidate("dash:", "tr:", "rp:", `pd:${palletCode}:`, `pa:${palletCode}`);
  return { ok: true, uniqueCount: parsed.uniqueCount, mismatch };
}

// ── Tracking ─────────────────────────────────────────────────────────────────
async function trackingPage(qs, q) {
  const { val: body, hit } = await cached(`tr:${qs}`, 30 * 1000, async () => {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.productId) where.productId = q.productId;
  if (q.q) where.codeLike = q.q.trim().toUpperCase();
  const hasFilter = q.q || q.barcode || q.productId || q.productionDate || q.shift || q.status;
  // 3 query independen jalan paralel.
  const [links, det, products] = await Promise.all([
    q.barcode
      ? sb.sel("pallet_barcodes", [sb.ilikeContains("barcode", q.barcode.trim()), sb.selCols("pallet_id"), ...sb.range(0, 500)])
      : null,
    q.productionDate || q.shift
      ? sb.sel("pallet_production_details", [
          ...(q.productionDate ? [sb.eq("production_date", q.productionDate)] : []),
          ...(q.shift ? [sb.eq("shift", q.shift)] : []),
          sb.selCols("pallet_id"), ...sb.range(0, 2000),
        ])
      : null,
    getProductsCached(),
  ]);
  if (links) {
    const ids = links.map((l) => l.pallet_id);
    where.ids = ids.length ? ids : ["__none__"];
  }
  if (det) {
    const ids = new Set(det.map((d) => d.pallet_id));
    if (where.ids) where.ids = where.ids.filter((id) => ids.has(id));
    else where.ids = [...ids];
  }
  let pallets = [], total = 0;
  if (hasFilter) {
    ({ total, pallets } = await sb.palletPage(where, { take: 50 }));
  }
  const body = `<h1 class="mb-1">${ic('search')} Tracking Pallet</h1>
<p class="mut mb-3">Lacak posisi & kelengkapan pallet lewat kode, barcode, produk, atau tanggal produksi.</p>
<div class="card"><form class="d-flex flex-wrap gap-2 align-items-center" method="get" style="margin:0">
<input name="q" placeholder="Kode pallet (cth PLT/2610/0001)" class="mono" value="${esc(q.q || "")}">
<input name="barcode" placeholder="Nomor barcode box" class="mono" value="${esc(q.barcode || "")}">
${selWrap(`<select name="productId"><option value="">Semua produk</option>${products.map((p) => `<option value="${p.id}" ${q.productId === p.id ? "selected" : ""}>${esc(p.productName)}</option>`).join("")}</select>`)}
${datePickerField("productionDate", q.productionDate || "", "Tanggal produksi")}
${shiftSelect("shift", q.shift || "", { any: true })}
${selWrap(`<select name="status"><option value="">Semua status</option><option value="IN_PRODUCTION" ${q.status === "IN_PRODUCTION" ? "selected" : ""}>Belum keluar dari produksi</option><option value="IN_TRANSIT_WAREHOUSE" ${q.status === "IN_TRANSIT_WAREHOUSE" ? "selected" : ""}>Sudah keluar dari produksi</option></select>`)}
<button class="btn btn-primary btn-sm" type="submit">${ic('search')} Cari</button>
</form></div>
<div style="margin-top:10px">
${!hasFilter ? `<div class="card mut">${ic('up')} Isi salah satu kolom di atas lalu klik Cari. Hasilnya muncul di sini.</div>`
: !pallets.length ? `<div class="card mut">${ic('help')} Tidak ketemu. Coba kata kunci lain atau longgarkan filter.</div>`
: `<p class="mut" style="margin-bottom:8px">Ditemukan <b>${total}</b> pallet — klik untuk buka rincian:</p><div class="list">${pallets.map((p) => { const ex = p.details.reduce((s, d) => s + d.boxQuantity, 0); return `<a class="item" href="${purl(p.palletCode)}"><span class="mono"><b>${esc(p.palletCode)}</b></span> ${badge(p.status)}<div style="font-size:13px;margin-top:4px">${esc(p.product.productName)} · butuh ${ex} box · terverifikasi ${p._count.barcodes} · kurang ${ex - p._count.barcodes}</div></a>`; }).join("")}</div>`}
</div>`;
  return body;
  });
  return { body, hit, active: "/tracking", title: "Tracking — Pallet Tracking" };
}

async function handleTracking(req, res, session, q) {
  const qs = new URL(req.url || "/", "http://x").search;
  const p = await trackingPage(qs, q);
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

// ── Reports ──────────────────────────────────────────────────────────────────
const REPORTS = [
  { key: "exit", title: "Box Keluar Produksi", icon: "send", desc: "Box per pallet yang sudah dikirim + statusnya." },
  { key: "remaining", title: "Sisa Stok Produksi", icon: "box", desc: "Sisa box yang belum keluar per pallet." },
  { key: "receiving", title: "Penerimaan Transit", icon: "truck", desc: "Kapan & siapa menerima tiap pallet di gudang transit." },
  { key: "traceability", title: "Traceability Tgl & Shift", icon: "link", desc: "Rincian box per tanggal-shift untuk telusur balik." },
  { key: "movements", title: "Histori Perpindahan", icon: "clock", desc: "Semua perpindahan pallet antar gudang." },
  { key: "barcodes", title: "Detail Barcode", icon: "tag", desc: "Daftar barcode per pallet + waktu verifikasi." },
];

async function getReportRows(type, f, preview) {
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const palletTake = preview ? 100 : 1000;

  // Filter tanggal/shift → daftar pallet id (1 query ringan).
  let dateIds = null;
  if (f.productionDate || f.shift) {
    const det = await sb.sel("pallet_production_details", [
      ...(f.productionDate ? [sb.eq("production_date", f.productionDate)] : []),
      ...(f.shift ? [sb.eq("shift", f.shift)] : []),
      sb.selCols("pallet_id"), ...sb.range(0, 5000),
    ]);
    const ids = [...new Set(det.map((d) => d.pallet_id))];
    dateIds = ids.length ? ids : ["__none__"];
  }
  const base = { status: f.status || "", productId: f.productId || "", ids: dateIds };

  if (type === "barcodes") {
    const { pallets } = await sb.palletPage(base, { take: 1000 });
    const pmap = new Map(pallets.map((p) => [p.id, p]));
    const perChunk = preview ? 100 : 5000;
    const all = [];
    await Promise.all(sb.chunk([...pmap.keys()], 150).map(async (part) => {
      const rows = await sb.selPaged("pallet_barcodes", [
        sb.inList("pallet_id", part), sb.selCols("barcode,created_at,pallet_id"),
        sb.orderBy("created_at", "desc"),
      ], { max: perChunk });
      all.push(...rows);
    }));
    all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const out = [["Pallet ID", "Produk", "Barcode", "Waktu Verifikasi"]];
    for (const b of all.slice(0, perChunk)) {
      const p = pmap.get(b.pallet_id);
      if (!p) continue;
      out.push([p.palletCode, p.product.productName, b.barcode, new Date(b.created_at).toISOString()]);
    }
    return out;
  }

  if (type === "movements") {
    const { pallets } = await sb.palletPage(base, { take: 1000 });
    const pmap = new Map(pallets.map((p) => [p.id, p.palletCode]));
    const perChunk = preview ? 100 : 5000;
    const all = [];
    await Promise.all(sb.chunk([...pmap.keys()], 150).map(async (part) => {
      const rows = await sb.selPaged("pallet_movements", [
        sb.inList("pallet_id", part),
        sb.selCols("pallet_id,from_location,to_location,from_status,to_status,performed_at,notes,performed_by"),
        sb.orderBy("performed_at", "desc"),
      ], { max: perChunk });
      all.push(...rows);
    }));
    all.sort((a, b) => (a.performed_at < b.performed_at ? 1 : -1));
    const umap = await sb.usersByIds(all.map((m) => m.performed_by));
    const out = [["Pallet ID", "Dari", "Ke", "Dari Status", "Ke Status", "Oleh", "Waktu", "Catatan"]];
    for (const m of all.slice(0, perChunk)) {
      out.push([pmap.get(m.pallet_id) ?? "?", m.from_location, m.to_location, m.from_status, m.to_status, umap.get(m.performed_by)?.name ?? "?", new Date(m.performed_at).toISOString(), m.notes ?? ""]);
    }
    return out;
  }

  const { pallets } = await sb.palletPage(base, { take: palletTake });
  if (type === "receiving") {
    const movs = [];
    await Promise.all(sb.chunk(pallets.map((p) => p.id), 150).map(async (part) => {
      movs.push(...await sb.sel("pallet_movements", [sb.inList("pallet_id", part), sb.selCols("pallet_id,to_status,performed_at,performed_by"), sb.orderBy("performed_at", "asc")]));
    }));
    const umap = await sb.usersByIds(movs.map((m) => m.performed_by));
    const mm = new Map();
    for (const m of movs) {
      if (!mm.has(m.pallet_id)) mm.set(m.pallet_id, []);
      mm.get(m.pallet_id).push(m);
    }
    for (const p of pallets) {
      p.movements = (mm.get(p.id) || []).map((m) => ({ toStatus: m.to_status, performedAt: m.performed_at, performer: { name: umap.get(m.performed_by)?.name ?? "?" } }));
    }
  }
  if (type === "traceability") {
    const det = [];
    await Promise.all(sb.chunk(pallets.map((p) => p.id), 150).map(async (part) => {
      det.push(...await sb.sel("pallet_production_details", [sb.inList("pallet_id", part), sb.selCols("pallet_id,production_date,shift,box_quantity")]));
    }));
    const dm = new Map();
    for (const d of det) {
      if (!dm.has(d.pallet_id)) dm.set(d.pallet_id, []);
      dm.get(d.pallet_id).push({ productionDate: d.production_date, shift: d.shift, boxQuantity: d.box_quantity });
    }
    for (const p of pallets) if (dm.has(p.id)) p.details = dm.get(p.id);
  }
  let rows = [];
  if (type === "exit") {
    rows = [["Pallet ID", "Produk", "Total Box", "Box Keluar", "Status", "Dibuat"]];
    for (const p of pallets) rows.push([p.palletCode, p.product.productName, p.details.reduce((a, d) => a + d.boxQuantity, 0), p._count.barcodes, p.status, iso(p.createdAt)]);
  } else if (type === "remaining") {
    rows = [["Pallet ID", "Produk", "Total Box", "Terverifikasi", "Sisa", "Status"]];
    for (const p of pallets) { const ex = p.details.reduce((a, d) => a + d.boxQuantity, 0); rows.push([p.palletCode, p.product.productName, ex, p._count.barcodes, Math.max(0, ex - p._count.barcodes), p.status]); }
  } else if (type === "receiving") {
    rows = [["Pallet ID", "Produk", "Diterima", "Waktu Terima", "Oleh"]];
    for (const p of pallets.filter((x) => x.status === "IN_TRANSIT_WAREHOUSE")) {
      const mv = (p.movements || []).find((m) => m.toStatus === "IN_TRANSIT_WAREHOUSE");
      rows.push([p.palletCode, p.product.productName, p._count.barcodes, mv ? new Date(mv.performedAt).toISOString() : "", mv?.performer.name ?? ""]);
    }
  } else if (type === "traceability") {
    rows = [["Pallet ID", "Produk", "Tanggal", "Shift", "Box", "Terverifikasi (pallet)"]];
    for (const p of pallets) for (const d of p.details) {
      rows.push([p.palletCode, p.product.productName, iso(d.productionDate), d.shift, d.boxQuantity, p._count.barcodes]);
      if (preview && rows.length > 100) break;
    }
  } else {
    rows = [["Pallet ID", "Produk", "Barcode", "Waktu Verifikasi"]];
    for (const p of pallets) rows.push([p.palletCode, p.product.productName, `(${p._count.barcodes} barcode — pakai CSV)`, ""]);
  }
  return rows;
}

async function reportsPage(qs, q) {
  const f = { productionDate: q.productionDate || "", shift: q.shift || "", productId: q.productId || "", status: q.status || "" };
  const { val: body, hit } = await cached(`rp:${qs}`, 60 * 1000, async () => {
  let preview = "";
  if (q.type) {
    const rows = await getReportRows(q.type, f, true);
    preview = `<div class="card" style="margin-top:10px;overflow-x:auto"><b>Preview (${rows.length - 1} baris)</b>
<table class="table table-striped table-hover table-sm align-middle" style="margin-top:6px"><thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${rows.slice(1, 101).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}
</tbody></table>${rows.length > 101 ? `<p class="mut">…${rows.length - 101} baris lagi, unduh CSV.</p>` : ""}</div>`;
  }
  const fq = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString();
  const link = (type, dl) => `/reports?type=${type}${fq ? "&" + fq : ""}${dl ? "&dl=1" : ""}`;
  const body = `<h1 class="mb-1">${ic('doc')} Laporan</h1>
<p class="mut mb-3">Pilih jenis laporan di bawah. Bisa filter dulu, lalu lihat di layar atau unduh CSV.</p>
<div class="card"><form class="d-flex flex-wrap gap-2 align-items-center" method="get" style="margin:0">
${datePickerField("productionDate", f.productionDate, "Tanggal produksi")}
${shiftSelect("shift", f.shift, { any: true })}
<input name="productId" placeholder="ID produk (opsional)" class="mono" value="${esc(f.productId)}">
${selWrap(`<select name="status"><option value="">Semua status</option><option value="IN_PRODUCTION" ${f.status === "IN_PRODUCTION" ? "selected" : ""}>Belum keluar dari produksi</option><option value="IN_TRANSIT_WAREHOUSE" ${f.status === "IN_TRANSIT_WAREHOUSE" ? "selected" : ""}>Sudah keluar dari produksi</option></select>`)}
<button class="btn btn-secondary btn-sm" type="submit">${ic('search')} Terapkan Filter</button>
</form></div>
<div class="grid g2" style="margin-top:10px">
${REPORTS.map((r) => `<div class="card"><b>${ic(r.icon || 'doc')} ${r.title}</b><div class="mut" style="margin:4px 0 8px">${r.desc}</div><div style="display:flex;gap:8px"><a class="btn btn-secondary btn-sm" href="${link(r.key, false)}">${ic('eye')} Lihat</a><a class="btn btn-primary btn-sm" href="${link(r.key, true)}">${ic('down')} Unduh CSV</a></div></div>`).join("")}
</div>${preview}`;
  return body;
  });
  return { body, hit, active: "/reports", title: "Laporan — Pallet Tracking" };
}

async function handleReports(req, res, session, q) {
  const f = { productionDate: q.productionDate || "", shift: q.shift || "", productId: q.productId || "", status: q.status || "" };
  const fkey = JSON.stringify(f);
  if (q.dl && q.type) {
    // CSV ikut di-cache 60 dtk — pembangkitnya yang paling berat.
    const { val: rows } = await cached(`rp:csv:${q.type}:${fkey}`, 60 * 1000, () => getReportRows(q.type, f, false));
    return sendCSV(res, `${q.type}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }
  const qs = new URL(req.url || "/", "http://x").search;
  const p = await reportsPage(qs, q);
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

// ── Master ───────────────────────────────────────────────────────────────────
async function handleMaster(req, res, session) {
  if (session.role !== "ADMIN") { res.writeHead(403); return res.end("Forbidden"); }
  if (req.method === "POST") {
    const { data } = await parseBody(req);
    if (data.action === "add") {
      const code = String(data.productCode || "").trim().toUpperCase();
      const name = String(data.productName || "").trim();
      if (!code || !name) { res.writeHead(400); return res.end("Kode dan nama wajib diisi."); }
      try {
        const ins = await sb.ins("products", [{ product_code: code, product_name: name }]);
        await auth.audit(session.sub, "CREATE_PRODUCT", "products", ins?.[0]?.id ?? code, code);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Hanya laporkan duplikat kalau memang unique violation; selain itu tampilkan error asli.
        if (/duplicate key|already exists|unique/i.test(msg)) {
          res.writeHead(400); return res.end("Kode produk sudah ada.");
        }
        console.error("Gagal tambah produk:", msg);
        res.writeHead(500); return res.end("Gagal menyimpan produk: " + msg);
      }
    } else if (data.action === "toggle") {
      await sb.upd("products", { is_active: data.isActive === "1" }, [sb.eq("id", String(data.id))]);
      await auth.audit(session.sub, "UPDATE_PRODUCT", "products", String(data.id), `isActive=${data.isActive}`);
    }
    invalidateProductsCache();
    invalidate("ad:master");
    return redirect(res, "/master");
  }
  const p = await masterPage();
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

async function masterPage() {
  const { val: body, hit } = await cached("ad:master", 30 * 1000, async () => {
  const items = (await sb.productsAll()).map((p) => ({ id: p.id, productCode: p.productCode, productName: p.productName, isActive: p.isActive }));
  const body = `<h1 class="mb-1">${ic('archive')} Master Produk</h1>
<p class="mut mb-3">Daftar produk yang bisa dipilih saat buat pallet. Nonaktifkan produk lama biar nggak kepilih.</p>
<div class="card"><form class="d-flex flex-wrap gap-2 align-items-center" method="post" style="margin:0">
<input type="hidden" name="action" value="add">
<input name="productCode" placeholder="Kode produk * (cth: RKC-180)" class="mono" required>
<input name="productName" placeholder="Nama produk * (cth: Tray RKC 180gr)" required style="flex:1;min-width:200px">
<button class="btn btn-primary btn-sm" type="submit">${ic('plus')} Tambah Produk</button>
</form></div>
<div class="card" style="margin-top:10px;padding:0"><table class="table table-striped table-hover table-sm align-middle"><thead><tr><th>Kode</th><th>Nama Produk</th><th>ID</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
${items.map((p) => `<tr><td class="mono"><b>${esc(p.productCode)}</b></td><td>${esc(p.productName)}</td><td class="mono mut" style="font-size:11px">${esc(p.id)}</td><td>${p.isActive ? `<span class="badge text-bg-success">Aktif</span>` : `<span class="badge text-bg-secondary">Nonaktif</span>`}</td>
<td><form class="inline" method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="isActive" value="${p.isActive ? "0" : "1"}"><button style="background:none;border:0;color:#1d4ed8;cursor:pointer;font-size:12px" type="submit">${p.isActive ? "Nonaktifkan" : "Aktifkan"}</button></form></td></tr>`).join("")}
</tbody></table></div>`;
  return body;
  });
  return { body, hit, active: "/master", title: "Master Produk — Pallet Tracking" };
}

// ── Users ────────────────────────────────────────────────────────────────────
async function handleUsers(req, res, session) {
  if (session.role !== "ADMIN") { res.writeHead(403); return res.end("Forbidden"); }
  if (req.method === "POST") {
    const { data } = await parseBody(req);
    if (data.action === "add") {
      const username = String(data.username || "").trim().toLowerCase();
      const password = String(data.password || "");
      if (!username || password.length < 6) { res.writeHead(400); return res.end("Username dan password (min 6) wajib diisi."); }
      try {
        const ins = await sb.ins("users", [{
          name: String(data.name || "").trim() || username, username,
          password_hash: await auth.hashPassword(password),
          role: ["ADMIN", "PRODUCTION", "TRANSIT"].includes(data.role) ? data.role : "PRODUCTION",
        }]);
        await auth.audit(session.sub, "CREATE_USER", "users", ins?.[0]?.id ?? username, username);
      } catch { res.writeHead(400); return res.end("Username sudah dipakai."); }
    } else if (data.action === "toggle") {
      const id = String(data.id);
      if (id === session.sub) { res.writeHead(400); return res.end("Tidak dapat menonaktifkan akun sendiri."); }
      await sb.upd("users", { is_active: data.isActive === "1" }, [sb.eq("id", id)]);
      await auth.audit(session.sub, "UPDATE_USER", "users", id, `isActive=${data.isActive}`);
    } else if (data.action === "reset") {
      const password = String(data.password || "");
      if (password.length < 6) { res.writeHead(400); return res.end("Password minimal 6 karakter."); }
      await sb.upd("users", { password_hash: await auth.hashPassword(password) }, [sb.eq("id", String(data.id))]);
      await auth.audit(session.sub, "RESET_PASSWORD", "users", String(data.id), "Reset admin");
    }
    invalidate("ad:users");
    return redirect(res, "/users");
  }
  const p = await usersPage();
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title), { "X-Cache": p.hit ? "HIT" : "MISS" });
}

async function usersPage() {
  const { val: body, hit } = await cached("ad:users", 30 * 1000, async () => {
  const rows = await sb.sel("users", [sb.orderBy("created_at", "desc"), sb.selCols("id,name,username,role,is_active")]);
  const items = rows.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, isActive: u.is_active }));
  const body = `<h1 class="mb-1">${ic('users')} Kelola User</h1>
<p class="mut mb-3">Tambah akun tim gudang & atur hak aksesnya. Password baru minimal 6 karakter.</p>
<div class="card"><form class="d-flex flex-wrap gap-2 align-items-center" method="post" style="margin:0">
<input type="hidden" name="action" value="add">
<input name="name" placeholder="Nama lengkap">
<input name="username" placeholder="Username * (cth: budi)" required>
<input name="password" type="password" placeholder="Password * (min 6)" required>
${selWrap(`<select name="role" title="Hak akses"><option value="PRODUCTION">PRODUCTION</option><option value="TRANSIT">TRANSIT</option><option value="ADMIN">ADMIN</option></select>`)}
<button class="btn btn-primary btn-sm" type="submit">${ic('plus')} Tambah User</button>
</form></div>
<div class="card" style="margin-top:10px;padding:0;overflow-x:auto"><table class="table table-striped table-hover table-sm align-middle"><thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
${items.map((u) => `<tr><td>${esc(u.name)}</td><td class="mono">@${esc(u.username)}</td><td><span class="badge ${u.role === "ADMIN" ? "text-bg-primary" : "text-bg-secondary"}">${esc(u.role)}</span></td><td>${u.isActive ? `<span class="badge text-bg-success">Aktif</span>` : `<span class="badge text-bg-danger">Nonaktif</span>`}</td>
<td><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
<form class="inline" method="post"><input type="hidden" name="action" value="toggle"><input type="hidden" name="id" value="${u.id}"><input type="hidden" name="isActive" value="${u.isActive ? "0" : "1"}"><button style="background:none;border:0;color:#1d4ed8;cursor:pointer;font-size:12px" type="submit">${u.isActive ? "Nonaktifkan" : "Aktifkan"}</button></form>
<form class="inline" method="post"><input type="hidden" name="action" value="reset"><input type="hidden" name="id" value="${u.id}"><input name="password" type="password" placeholder="Password baru" style="width:120px;padding:4px 8px"><button style="background:none;border:0;color:#52525b;cursor:pointer;font-size:12px" type="submit">${ic('key')} Reset password</button></form>
</div></td></tr>`).join("")}
</tbody></table></div>`;
  return body;
  });
  return { body, hit, active: "/users", title: "Users — Pallet Tracking" };
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function handleSettings(req, res, session) {
  if (session.role !== "ADMIN") { res.writeHead(403); return res.end("Forbidden"); }
  if (req.method === "POST") {
    const { data } = await parseBody(req);
    const patterns = String(data.patterns || "").split("\n").map((p) => p.trim()).filter(Boolean);
    for (const p of patterns) { try { new RegExp(p, "g"); } catch { res.writeHead(400); return res.end(`Pattern tidak valid: ${esc(p)}`); } }
    await sb.ins("app_settings", [{ key: "barcode_patterns", value: JSON.stringify(patterns) }], { onConflict: "key" });
    await auth.audit(session.sub, "UPDATE_SETTINGS", "app_settings", "barcode_patterns", patterns.join(" | "));
    return redirect(res, "/settings");
  }
  const p = await settingsPage();
  sendHTML(req, res, 200, layout(session, p.active, p.body, p.title));
}

async function settingsPage() {
  const row = await sb.one("app_settings", [sb.eq("key", "barcode_patterns"), sb.selCols("value")]);
  let patterns = [];
  if (row) { try { const v = JSON.parse(row.value); if (Array.isArray(v)) patterns = v; } catch { /* abaikan */ } }
  if (!patterns.length) patterns = DEFAULT_BARCODE_PATTERNS.map((p) => p.regex);
  const logRows = await sb.sel("audit_logs", [sb.orderBy("created_at", "desc"), sb.selCols("created_at,actor_id,action,detail"), ...sb.range(0, 50)]);
  const actorMap = await sb.usersByIds(logRows.map((l) => l.actor_id).filter(Boolean));
  const logs = logRows.map((l) => ({ createdAt: l.created_at, action: l.action, detail: l.detail, actor: l.actor_id ? { username: actorMap.get(l.actor_id)?.username ?? "?" } : null }));
  const body = `<h1 class="mb-1">${ic('gear')} Setting</h1>
<p class="mut mb-3">Atur pola barcode yang dikenali sistem + pantau aktivitas user.</p>
<div class="card"><form method="post">
<label class="mut"><b>Pola barcode</b> — satu pola per baris. Dipakai saat memproses hasil scan di menu Transit.</label>
<textarea name="patterns" rows="4" class="mono" style="font-size:12px;margin-top:4px">${esc(patterns.join("\n"))}</textarea>
<div style="margin-top:8px"><button class="btn btn-primary btn-sm" type="submit">${ic('save')} Simpan Pola</button></div>
</form></div>
<div class="card" style="margin-top:10px"><b>${ic('clock')} Aktivitas terakhir (50)</b>
<div class="box" style="margin-top:6px"><table class="table table-striped table-hover table-sm align-middle"><thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Keterangan</th></tr></thead><tbody>
${logs.map((l) => `<tr><td class="mut">${esc(new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " "))}</td><td>${esc(l.actor?.username ?? "-")}</td><td><b>${esc(l.action)}</b></td><td class="mut">${esc(l.detail || "")}</td></tr>`).join("")}
</tbody></table></div></div>`;
  return { body, hit: false, active: "/settings", title: "Setting — Pallet Tracking" };
}

// ── JSON API ─────────────────────────────────────────────────────────────────
async function handleApiPallet(req, res, code) {
  const session = await getSession(req);
  if (!session) return sendJSON(req, res, 401, { error: "Unauthorized" });
  const palletCode = decodeURIComponent(code).toUpperCase();
  const { val: data } = await cached(`pa:${palletCode}`, 15 * 1000, async () => {
  const full = await sb.palletFull(palletCode);
  if (!full) return null;
  const { pallet, details, totalBarcodes } = full;
  return {
    palletCode: pallet.palletCode,
    productName: pallet.product.productName,
    status: pallet.status,
    expected: details.reduce((s, d) => s + d.boxQuantity, 0),
    verified: totalBarcodes,
  };
  });
  if (!data) return sendJSON(req, res, 404, { error: "Pallet tidak ditemukan" });
  sendJSON(req, res, 200, data);
}

async function handleApiProducts(req, res) {
  const session = await getSession(req);
  if (!session) return sendJSON(req, res, 401, []);
  const products = (await getProductsCached())
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, productName: p.productName, productCode: p.productCode }));
  sendJSON(req, res, 200, products);
}

// Cari pallet berdasarkan potongan kode (mis. "0003" → semua PLT/.../0003).
async function handleApiPalletSearch(req, res) {
  const session = await getSession(req);
  if (!session) return sendJSON(req, res, 401, { error: "Unauthorized" });
  const q = String(new URL(req.url || "/", "http://x").searchParams.get("q") || "").trim().toUpperCase().replace(/\s+/g, "");
  if (q.length < 2) return sendJSON(req, res, 200, []);
  const { pallets } = await sb.palletPage({ codeLike: q }, { take: 15 });
  sendJSON(req, res, 200, pallets.map((p) => ({
    palletCode: p.palletCode,
    productName: p.product.productName,
    status: p.status,
    expected: p.details.reduce((s, d) => s + d.boxQuantity, 0),
  })));
}

// ── Fragment: isi halaman saja (JSON) untuk navigasi skeleton ───────────────
// Shell + skeleton langsung tampil, body diisi async. Otorisasi sama persis
// seperti route halaman penuh di bawah.
async function handleFragment(req, res) {
  const session = await getSession(req);
  if (!session) return sendJSON(req, res, 401, { error: "Unauthorized" });
  let target;
  try {
    target = new URL(String(new URL(req.url || "/", "http://x").searchParams.get("path") || "/"), "http://x");
  } catch {
    return sendJSON(req, res, 400, { error: "Bad request" });
  }
  const pathname = target.pathname;
  const qs = target.search || "";
  const q = Object.fromEntries(target.searchParams.entries());
  const seg = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const done = (p) => sendJSON(req, res, 200, { body: p.body, active: p.active, title: p.title, cssV: CSS_V });
  const need = (roles) => auth.canAccess(session.role, roles)
    ? null
    : sendJSON(req, res, 403, { error: "Forbidden" });
  try {
    if (pathname === "/") return done(await dashboardPage(qs, q));
    if (pathname === "/pallets") {
      if (need(["ADMIN", "PRODUCTION"])) return;
      return done(await palletsPage(qs, q, session.role));
    }
    if (pathname === "/pallets/new") {
      if (need(["ADMIN", "PRODUCTION"])) return;
      return done(await palletNewPage());
    }
    const fpr = palletRoute(seg);
    if (fpr && !fpr.action) {
      const p = await palletDetailPage(fpr.code, session.role);
      if (p.body === null) return sendJSON(req, res, 404, { error: "Tidak ditemukan" });
      return done(p);
    }
    if (pathname === "/transit") {
      if (need(["ADMIN", "TRANSIT"])) return;
      return done(await transitPage());
    }
    if (pathname === "/tracking") return done(await trackingPage(qs, q));
    if (seg[0] === "tracking" && seg[1]) {
      return sendJSON(req, res, 200, { redirect: purl(seg.slice(1).join("/").toUpperCase()) });
    }
    if (pathname === "/reports") {
      if (q.dl) return sendJSON(req, res, 200, { redirect: pathname + qs });
      return done(await reportsPage(qs, q));
    }
    if (pathname === "/master") {
      if (need(["ADMIN"])) return;
      return done(await masterPage());
    }
    if (pathname === "/users") {
      if (need(["ADMIN"])) return;
      return done(await usersPage());
    }
    if (pathname === "/settings") {
      if (need(["ADMIN"])) return;
      return done(await settingsPage());
    }
    return sendJSON(req, res, 404, { error: "Tidak ditemukan" });
  } catch (e) {
    return sendJSON(req, res, 500, { error: "Gagal memuat." });
  }
}

// ── Router ───────────────────────────────────────────────────────────────────
// Diekstrak sebagai fungsi agar bisa dipakai ulang oleh serverless (Vercel:
// api/index.js memanggil handleRequest langsung, tanpa listen).
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", "http://x");
    const pathname = url.pathname;
    const seg = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const q = Object.fromEntries(url.searchParams.entries());

    // Statis (cache memori + gzip — sebelumnya readFileSync tiap request, block event loop)
    const asset = STATIC_ASSETS[pathname];
    if (req.method === "GET" && asset) {
      if (!asset.buf.length) { res.writeHead(404); return res.end(); }
      if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
        res.writeHead(200, { "Content-Type": asset.type, "Content-Encoding": "gzip", "Cache-Control": "public, max-age=86400" });
        return res.end(asset.gzip);
      }
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "public, max-age=86400" });
      return res.end(asset.buf);
    }
    if (pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }

    // Auth
    if (pathname === "/login") return handleLogin(req, res);
    if (pathname === "/logout") {
      if (req.method === "GET" || req.method === "POST") {
        res.writeHead(302, { Location: "/login", "Set-Cookie": auth.clearSessionCookie() });
        return res.end();
      }
      res.writeHead(405); return res.end();
    }

    // API JSON (cek sesi sendiri)
    if (pathname === "/api/pallets/search" && req.method === "GET") return handleApiPalletSearch(req, res);
    if (seg[0] === "api" && seg[1] === "pallets" && seg[2] && req.method === "GET") return handleApiPallet(req, res, seg[2]);
    if (pathname === "/api/products" && req.method === "GET") return handleApiProducts(req, res);
    if (pathname === "/api/fragment" && req.method === "GET") return handleFragment(req, res);
    if (pathname === "/api/transit/preview" && req.method === "POST") {
      const session = await getSession(req);
      if (!session) return sendJSON(req, res, 401, { error: "Unauthorized" });
      const { data } = await parseBody(req);
      const patterns = await getPatterns();
      const r = extractBarcodes(String(data.raw || ""), patterns.length ? patterns : undefined);
      // perLine tidak dipakai frontend → jangan dikirim (sebelumnya bikin JSON MB-an + lemot).
      const { perLine, ...slim } = r;
      return sendJSON(req, res, 200, slim);
    }
    if (pathname === "/api/transit/confirm" && req.method === "POST") {
      const session = await getSession(req);
      if (!session) return sendJSON(req, res, 401, { error: "Unauthorized" });
      const { data } = await parseBody(req);
      try {
        const r = await handleTransitConfirm(session, data);
        return sendJSON(req, res, 200, r);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gagal menyimpan.";
        return sendJSON(req, res, e instanceof Error && e.message === "FORBIDDEN" ? 403 : 400, { error: msg });
      }
    }

    // Halaman butuh sesi
    const session = await getSession(req);
    if (!session) return redirect(res, "/login");

    if (pathname === "/" && req.method === "GET") return handleDashboard(req, res, session, q);
    if (pathname === "/pallets" && req.method === "GET") return handlePallets(req, res, session, q);
    if (pathname === "/pallets" && req.method === "POST") return handlePalletCreate(req, res, session);
    if (pathname === "/pallets/print-bulk" && req.method === "POST") {
      if (!auth.canAccess(session.role, ["ADMIN", "PRODUCTION"])) { res.writeHead(403); return res.end("Forbidden"); }
      return handlePalletPrintBulk(req, res, session);
    }
    if (pathname === "/pallets/new" && req.method === "GET") return handlePalletNew(req, res, session);
    const pr = palletRoute(seg);
    if (pr && pr.action === "print" && req.method === "GET") return handlePalletPrint(req, res, session, pr.code);
    if (pr && pr.action === "notes" && req.method === "POST") {
      if (session.role !== "ADMIN") { res.writeHead(403); return res.end("Forbidden"); }
      const { data } = await parseBody(req);
      const p = await sb.one("pallets", [sb.eq("pallet_code", pr.code.toUpperCase()), sb.selCols("id,pallet_code")]);
      if (!p) { res.writeHead(404); return res.end("Tidak ditemukan."); }
      await sb.upd("pallets", { notes: String(data.notes || "") || null }, [sb.eq("id", p.id)]);
      await auth.audit(session.sub, "ADJUSTMENT", "pallets", p.id, "Koreksi notes");
      invalidate(`pd:${p.pallet_code}:`, `pa:${p.pallet_code}`);
      return redirect(res, purl(p.pallet_code));
    }
    if (pr && pr.action === "delete" && req.method === "POST") {
      if (session.role !== "ADMIN") { res.writeHead(403); return res.end("Forbidden"); }
      const p = await sb.one("pallets", [sb.eq("pallet_code", pr.code.toUpperCase()), sb.selCols("id,pallet_code")]);
      if (!p) { res.writeHead(404); return res.end("Tidak ditemukan."); }
      const bc = await sb.count("pallet_barcodes", [sb.eq("pallet_id", p.id)]);
      if (bc > 0) { res.writeHead(400); return res.end("Sudah ada barcode, tidak dapat dihapus."); }
      // FK Cascade (details, barcodes, verifications, movements) ikut terhapus.
      await sb.del("pallets", [sb.eq("id", p.id)]);
      await auth.audit(session.sub, "DELETE_PALLET", "pallets", p.id, `Hapus ${p.pallet_code}`);
      invalidate("dash:", "pl:", "tr:", "rp:", `pd:${p.pallet_code}:`, `pa:${p.pallet_code}`);
      return redirect(res, "/pallets");
    }
    if (pr && !pr.action && req.method === "GET") return handlePalletDetail(req, res, session, pr.code);

    if (pathname === "/transit" && req.method === "GET") {
      if (!auth.canAccess(session.role, ["ADMIN", "TRANSIT"])) { res.writeHead(403); return res.end("Forbidden"); }
      const p = await transitPage();
      return sendHTML(req, res, 200, layout(session, p.active, p.body, p.title));
    }
    if (pathname === "/tracking" && req.method === "GET") return handleTracking(req, res, session, q);
    if (seg[0] === "tracking" && seg[1] && req.method === "GET") return redirect(res, purl(seg.slice(1).join("/").toUpperCase()));
    if (pathname === "/reports" && req.method === "GET") return handleReports(req, res, session, q);
    if (pathname === "/master") return handleMaster(req, res, session);
    if (pathname === "/users") return handleUsers(req, res, session);
    if (pathname === "/settings") return handleSettings(req, res, session);

    res.writeHead(404);
    res.end("Tidak ditemukan.");
  } catch (e) {
    if (e instanceof Error && e.message === "BODY_TOO_LARGE") { res.writeHead(413); return res.end("Data terlalu besar."); }
    safe500(res, e);
  }
}

// 500 yang aman dipanggil 2x (inner catch + outer wrapper) tanpa dobel-kirim.
function safe500(res, e) {
  console.error(e);
  try {
    if (!res.headersSent) { res.writeHead(500); res.end("Terjadi kesalahan server."); }
    else if (!res.writableEnded) res.end();
  } catch { /* abaikan */ }
}

// Bungkus: rejection dari `return handleX(...)` lolos dari try/catch di dalam
// (return promise ≠ await) — tanpa ini 1 error DB = proses crash.
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => safe500(res, e));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`trace-barcode jalan di port ${PORT} (Node polos, tanpa framework)`);
    // Pemanasan koneksi HTTPS (TLS + edge) — request pertama tidak menanggung biaya connect.
    sb.sel("app_settings", [sb.selCols("key"), ...sb.range(0, 1)])
      .then(() => console.log("db siap (REST)"))
      .catch((e) => console.error("db gagal:", e.message));
  });
}

// Untuk Vercel serverless (api/index.js). Lokal tetap `node server.js`.
module.exports = { handleRequest, server };
