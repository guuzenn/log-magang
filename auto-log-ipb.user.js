// ==UserScript==
// @name         Logmager: Auto Logbook Magang IPB
// @namespace    https://github.com/guuzenn/log-magang
// @version      1.2.0
// @description  Isi logbook IPB (Log Aktivitas Kampus Merdeka) sekaligus: paste dari spreadsheet, pilih folder bukti, kirim.
// @match        https://studentportal.ipb.ac.id/Kegiatan/LogAktivitasKampusMerdeka/Index/*
// @grant        none
// @homepageURL  https://github.com/guuzenn/logmager
// @supportURL   https://github.com/guuzenn/logmager/issues
// @updateURL    https://github.com/guuzenn/logmager/releases/latest/download/auto-log-ipb.user.js
// @downloadURL  https://github.com/guuzenn/logmager/releases/latest/download/auto-log-ipb.user.js
// ==/UserScript==

/*
 * Tool tidak resmi. Berjalan di tab yang sudah kamu login-kan: tidak pernah membaca/menyimpan password,
 * tidak mengirim data ke server lain selain studentportal.ipb.ac.id.
 */
(function () {
  "use strict";
  // Kalau userscript dan extension Chrome sama-sama terpasang, cukup satu panel.
  if (document.getElementById("alog-host")) return;

  const STORE = "autolog-ipb-v1";
  const BULAN = {
    januari: 1, jan: 1, january: 1, februari: 2, feb: 2, february: 2, maret: 3, mar: 3, march: 3,
    april: 4, apr: 4, mei: 5, may: 5, juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7,
    agustus: 8, agu: 8, agt: 8, aug: 8, august: 8, september: 9, sep: 9, sept: 9,
    oktober: 10, okt: 10, oct: 10, october: 10, november: 11, nov: 11,
    desember: 12, des: 12, dec: 12, december: 12,
  };
  const BULAN_PORTAL = ["januari", "februari", "maret", "april", "mei", "juni", "juli",
    "agustus", "september", "oktober", "november", "desember"];
  // Chrome/Edge bisa membuat folder langsung di komputer (showDirectoryPicker). Firefox belum, jadi di sana hanya ZIP.
  const CAN_DIR = typeof window.showDirectoryPicker === "function";

  const tambahLink = [...document.querySelectorAll("a")].find((a) => /Tambah/.test(a.textContent));
  const tambahUrl = tambahLink && (tambahLink.getAttribute("onclick") || "").match(/OpenModal\('([^']+)'/)?.[1];
  if (!tambahUrl) return;

  // ------------------------------------------------------------------ util
  let UI = document; // diganti ke shadow root panel setelah UI dibuat
  const $ = (sel, root = UI) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function iso(y, m, d) {
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function parseDate(raw) {
    const s = String(raw).trim().toLowerCase();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) return iso(m[3], m[2], m[1]); // DD/MM/YYYY
    if ((m = s.match(/(\d{1,2})[\s\-]+([a-z]+)[\s\-,]+(\d{4})/)) && BULAN[m[2]]) return iso(m[3], BULAN[m[2]], m[1]);
    if ((m = s.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/)) && BULAN[m[1]]) return iso(m[3], BULAN[m[1]], m[2]);
    return null;
  }

  // TSV hasil copy dari Google Sheets / Excel (sel multi-baris dibungkus tanda kutip)
  function parseTSV(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === "\t") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function cleanText(s) {
    return s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  }

  function datesFromDoc(doc) {
    const found = new Set();
    doc.querySelectorAll("table tbody tr td:nth-child(2)").forEach((td) => {
      const m = td.textContent.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
      const mi = m && BULAN_PORTAL.indexOf(m[2].toLowerCase());
      if (m && mi >= 0) found.add(iso(m[3], mi + 1, m[1]));
    });
    return found;
  }

  async function fetchDoc(url) {
    const html = await (await fetch(url, { credentials: "same-origin" })).text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  // ------------------------------------------------------------------ bukti
  function dateOfPath(path) {
    const m = path.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? iso(m[1], m[2], m[3]) : null;
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  // 1 file -> dipakai langsung (gambar besar dikompres). Banyak gambar -> disusun vertikal jadi 1 JPG.
  async function buildUpload(files, date) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length) {
      if (files.length > 1) throw new Error("folder berisi PDF + file lain; sisakan 1 PDF saja");
      return pdfs[0];
    }
    if (files.length === 1 && files[0].size < 1.5 * 1024 * 1024) return files[0];
    const imgs = await Promise.all(files.map(loadImage));
    const W = 1200;
    const sizes = imgs.map((im) => {
      const s = Math.min(1, W / im.naturalWidth);
      return [Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)];
    });
    let total = sizes.reduce((a, [, h]) => a + h, 0);
    const k = Math.min(1, 14000 / total);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(Math.max(...sizes.map(([w]) => w)) * k);
    canvas.height = Math.round(total * k);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    imgs.forEach((im, i) => {
      const [w, h] = sizes[i].map((v) => Math.round(v * k));
      ctx.drawImage(im, 0, y, w, h);
      y += h;
    });
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return new File([blob], `bukti-${date}.jpg`, { type: "image/jpeg" });
  }

  // ------------------------------------------------------------------ kirim
  async function submitOne(entry, cfg) {
    const doc = await fetchDoc(tambahUrl);
    const form = $("#main_form", doc);
    if (!form) throw new Error("form Tambah tidak ditemukan (sesi login habis?)");
    const file = await buildUpload(entry.files, entry.date);
    const [y, m, d] = entry.date.split("-");
    const set = {
      Waktu: `${d}/${m}/${y}`,
      Tmw: cfg.jamMulai,
      Tsw: cfg.jamSelesai,
      JenisLogbookKegiatanKampusMerdekaId: cfg.jenis,
      Lokasi: cfg.lokasi,
      Keterangan: entry.ket,
    };
    const fd = new FormData();
    for (const el of form.elements) {
      if (!el.name || el.type === "file" || el.type === "submit") continue;
      if (el.type === "checkbox") {
        const label = (el.closest(".form-check, div") || el.parentElement).textContent;
        const on = cfg.dosen.length === 0 || cfg.dosen.some((n) => label.includes(n));
        if (on) fd.append(el.name, el.value);
        continue;
      }
      if (el.type === "radio") {
        if (el.name === "IsLuring" && el.value === cfg.tipe) fd.append(el.name, el.value);
        continue;
      }
      fd.append(el.name, el.name in set ? set[el.name] : el.value);
    }
    fd.append("File", file, file.name);

    const res = await fetch(form.getAttribute("action"), {
      method: "POST", body: fd, credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    let msg = null;
    try {
      const j = JSON.parse((await res.text()).replace(/^<textarea>|<\/textarea>$/g, ""));
      if (!j.status) msg = j.message || "ditolak server";
    } catch (_) { /* respon HTML: cek lewat tabel */ }
    const existing = datesFromDoc(await fetchDoc(location.href));
    return existing.has(entry.date) ? { ok: true, existing } : { ok: false, msg: msg || "tidak muncul di tabel portal", existing };
  }

  // ------------------------------------------------------------------ UI
  // Panel dirender di Shadow DOM supaya CSS portal tidak bocor ke panel (dan sebaliknya).
  const ICON = {
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
    sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M10 9H8"/>',
    paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    check: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  };
  const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  const css = `
  :host{all:initial}
  *{box-sizing:border-box;margin:0;font-family:Poppins,Inter,"Segoe UI",system-ui,sans-serif}
  [hidden]{display:none!important}
  .root{
    --primary:#1e3a8a;--primary-600:#172554;--primary-50:#eff6ff;--primary-100:#dbeafe;
    --grad:linear-gradient(135deg,#0b2a5b,#1e40af);
    --ink:#0f172a;--text:#334155;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;
    --ok:#047857;--ok-bg:#ecfdf5;--warn:#b45309;--warn-bg:#fffbeb;--err:#be123c;--err-bg:#fff1f2;--skip-bg:#f1f5f9;
    color:var(--text);font-size:14px;line-height:1.5}
  .fab{position:fixed;right:24px;bottom:24px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;
    padding:12px 20px;border:0;border-radius:999px;cursor:pointer;color:#fff;font-weight:600;font-size:14px;
    background:var(--grad);box-shadow:0 10px 30px rgba(30,58,138,.4);transition:transform .15s}
  .fab:hover{transform:translateY(-2px)}
  .overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.35);opacity:0;pointer-events:none;transition:opacity .2s}
  .panel{position:fixed;top:0;right:0;z-index:2147483002;width:min(720px,100vw);height:100vh;display:flex;flex-direction:column;
    background:var(--bg);box-shadow:-20px 0 60px rgba(15,23,42,.25);transform:translateX(100%);transition:transform .25s ease}
  .root.open .panel{transform:none}
  .root.open .overlay{opacity:1;pointer-events:auto}
  .hd{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;color:#fff;
    background:var(--grad)}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.18)}
  .title{font-size:17px;font-weight:700}
  .sub{font-size:12.5px;opacity:.85}
  .icon-btn{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:10px;cursor:pointer;color:inherit;background:transparent}
  .icon-btn:hover{background:rgba(255,255,255,.18)}
  .body{flex:1;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
  .card.highlight{border-color:var(--primary-100);box-shadow:0 0 0 4px var(--primary-50)}
  .card-hd{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
  .step{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--primary-50);color:var(--primary)}
  .card-title{font-size:15px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px}
  .card-desc{font-size:12.5px;color:var(--muted);margin-top:2px}
  .tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--primary-50);color:var(--primary)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .field{display:flex;flex-direction:column;gap:6px}
  .field+.field,.grid+.field,.field+.grid,.pill+.field{margin-top:14px}
  .grid>.field{margin-top:0}
  .label{font-size:12.5px;font-weight:600;color:var(--text)}
  input[type=text],input[type=time],input[type=date],select,textarea{width:100%;height:42px;padding:0 12px;font-size:14px;color:var(--ink);
    background:#fff;border:1px solid var(--line);border-radius:10px;outline:none;transition:border-color .15s,box-shadow .15s}
  textarea{height:140px;padding:10px 12px;resize:vertical;font-size:13px;line-height:1.5}
  input:focus,select:focus,textarea:focus{border-color:var(--primary);box-shadow:0 0 0 4px var(--primary-50)}
  .seg{display:flex;gap:4px;padding:4px;border-radius:12px;background:#f1f5f9}
  .seg label{flex:1;position:relative;text-align:center;padding:8px 0;border-radius:9px;cursor:pointer;font-weight:500;color:var(--muted);transition:all .15s}
  .seg label:has(input:checked){background:#fff;color:var(--primary);box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{position:relative;display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--line);border-radius:999px;
    cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);background:#fff;transition:all .15s}
  .chip:has(input:checked){border-color:var(--primary);background:var(--primary-50);color:var(--primary-600)}
  .seg input,.chip input{position:absolute;opacity:0;pointer-events:none}
  .seg label:has(input:focus-visible),.chip:has(input:focus-visible){outline:2px solid var(--primary);outline-offset:2px}
  .note{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--muted);margin-top:12px}
  .note svg{flex:none;margin-top:2px}
  code{font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:1px 6px;border-radius:6px;background:#f1f5f9;color:var(--primary-600)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 18px;border-radius:10px;border:1px solid var(--line);
    cursor:pointer;font-size:14px;font-weight:600;color:var(--ink);background:#fff;transition:all .15s}
  .btn:hover:not(:disabled){border-color:#cbd5e1;background:#f8fafc}
  .btn.primary{border:0;color:#fff;background:var(--primary)}
  .btn.primary:hover:not(:disabled){background:var(--primary-600)}
  .btn.soft{border:0;color:var(--primary-600);background:var(--primary-50)}
  .btn.soft:hover:not(:disabled){background:var(--primary-100)}
  .btn.danger{color:var(--err);border-color:#fecdd3}
  .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn.block{width:100%}
  .tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .tile{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 12px;border:1.5px dashed #cbd5e1;border-radius:14px;
    cursor:pointer;background:#fff;color:var(--text);transition:all .15s;font-size:13px}
  .tile:hover{border-color:var(--primary);background:var(--primary-50);color:var(--primary-600)}
  .tile b{font-size:14px;color:var(--ink)}
  .tile span{font-size:12px;color:var(--muted)}
  .pill{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:500;background:#f1f5f9;color:var(--muted)}
  .pill.ok{background:var(--ok-bg);color:var(--ok)}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .stat{padding:6px 12px;border-radius:10px;font-size:12.5px;font-weight:600}
  .stat.ok{background:var(--ok-bg);color:var(--ok)}.stat.skip{background:var(--skip-bg);color:var(--muted)}
  .stat.warn{background:var(--warn-bg);color:var(--warn)}.stat.err{background:var(--err-bg);color:var(--err)}
  .table-wrap{max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{position:sticky;top:0;background:#f8fafc;text-align:left;font-weight:600;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--line)}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tr:last-child td{border-bottom:0}
  .badge{display:inline-block;white-space:nowrap;padding:2px 10px;border-radius:999px;font-size:11.5px;font-weight:600}
  .badge.ok{background:var(--ok-bg);color:var(--ok)}.badge.skip{background:var(--skip-bg);color:var(--muted)}
  .badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.err{background:var(--err-bg);color:var(--err)}
  .empty{padding:24px;text-align:center;color:var(--muted);font-size:13px;border:1.5px dashed var(--line);border-radius:12px}
  .progress{height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden;margin-bottom:12px}
  .progress div{height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#1e3a8a,#3b82f6);transition:width .3s}
  .log{max-height:180px;overflow:auto;padding:12px;border-radius:12px;background:#0f172a;color:#e2e8f0;
    font:12px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap}
  .ft{display:flex;gap:10px;padding:14px 24px;border-top:1px solid var(--line);background:#fff}
  .ft .btn.primary{flex:1}
  .disclaimer{font-size:11.5px;color:var(--muted);text-align:center;padding-bottom:4px}
  @media (max-width:560px){.grid,.tiles{grid-template-columns:1fr}.body{padding:16px}.hd,.ft{padding-left:16px;padding-right:16px}}`;

  const card = (n, ic, title, desc, body, extra = "") => `
    <section class="card ${extra}">
      <div class="card-hd"><div class="step">${icon(ic)}</div>
        <div><div class="card-title">${n}. ${title}${extra === "highlight" ? ' <span class="tag">Sekali di awal</span>' : ""}</div>
        <div class="card-desc">${desc}</div></div></div>
      ${body}
    </section>`;

  const host = document.createElement("div");
  host.id = "alog-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  UI = shadow;
  shadow.innerHTML = `<style>${css}</style>
  <div class="root" id="alog">
    <button class="fab" id="alog-btn">${icon("zap")} Logmager</button>
    <div class="overlay" id="alog-overlay"></div>
    <aside class="panel" role="dialog" aria-label="Logmager">
      <header class="hd">
        <div class="brand"><div class="logo">${icon("zap", 22)}</div>
          <div><div class="title">Logmager</div><div class="sub">Isi logbook IPB sekaligus dari spreadsheet</div></div></div>
        <button class="icon-btn" id="alog-x" title="Tutup">${icon("x", 20)}</button>
      </header>
      <main class="body">
        ${card(0, "calendar", "Persiapan", "Buat folder bukti per hari & template spreadsheet untuk seluruh periode magang.", `
          <div class="grid">
            <label class="field"><span class="label">Tanggal mulai magang</span><input type="date" id="alog-tmulai"></label>
            <label class="field"><span class="label">Tanggal selesai</span><input type="date" id="alog-tselesai"></label>
          </div>
          <div class="field"><span class="label">Hari kerja</span>
            <div class="chips" id="alog-hari">${["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
              .map((h, i) => `<label class="chip"><input type="checkbox" value="${i}">${h}</label>`).join("")}</div></div>
          <div class="pill" id="alog-prep-info"></div>
          <div class="field">${CAN_DIR ? `<button class="btn soft block" id="alog-prepdir">${icon("folder")} Buat folder persiapan</button>` : ""}
            <button class="btn block" id="alog-zip"${CAN_DIR ? ' style="margin-top:8px"' : ""}>${icon("download")} ${CAN_DIR ? "Atau unduh sebagai .zip" : "Unduh paket persiapan (.zip)"}</button></div>
          <p class="note">${icon("info", 15)}<span>Isinya: folder <code>bukti/</code> dengan subfolder tiap hari kerja (<code>bukti/2026-07-13/</code> dst.)
            dan <code>template-log-magang.xlsx</code> (kolom Tanggal &amp; Kegiatan). ${CAN_DIR
              ? "<b>Buat folder persiapan</b>: pilih <b>subfolder</b>, mis. buat folder baru <code>Magang</code> di dalam Documents. Chrome tidak mengizinkan memilih Documents/Desktop/Downloads langsung. Template yang sudah ada tidak ditimpa. Kalau gagal, otomatis ditawari unduh .zip."
              : "Klik kanan ZIP lalu <b>Extract All</b>."} Buka template di Excel/Google Sheets dan isi kegiatan tiap hari.</span></p>
        `, "highlight")}
        ${card(1, "sliders", "Pengaturan default", "Dipakai untuk semua log. Tersimpan otomatis di browser ini.", `
          <div class="grid">
            <label class="field"><span class="label">Jam mulai</span><input type="time" id="alog-mulai"></label>
            <label class="field"><span class="label">Jam selesai</span><input type="time" id="alog-selesai"></label>
          </div>
          <label class="field"><span class="label">Jenis kegiatan</span><select id="alog-jenis"></select></label>
          <div class="field"><span class="label">Tipe penyelenggaraan</span>
            <div class="seg" id="alog-tipe">
              <label><input type="radio" name="alog-tipe" value="">Hybrid</label>
              <label><input type="radio" name="alog-tipe" value="true">Offline</label>
              <label><input type="radio" name="alog-tipe" value="false">Online</label>
            </div></div>
          <label class="field"><span class="label">Lokasi</span><input type="text" id="alog-lokasi" placeholder="Nama kantor, alamat lengkap"></label>
          <div class="field"><span class="label">Dosen penggerak</span><div class="chips" id="alog-dosen"><span class="card-desc">Memuat…</span></div></div>
        `)}
        ${card(2, "sheet", "Data dari spreadsheet", "Blok kolom <b>Tanggal</b> &amp; <b>Kegiatan</b> di Excel/Google Sheets, salin (Ctrl+C), lalu tempel di sini (Ctrl+V).", `
          <textarea id="alog-data" placeholder="Senin, 13 Juli 2026&#9;- Onboarding dan setup environment&#10;Selasa, 14 Juli 2026&#9;- Mapping ERD ke Prisma schema"></textarea>
          <p class="note">${icon("info", 15)}<span>Baris judul dan baris tanpa kegiatan otomatis dilewati. Sel berisi beberapa baris tetap terbaca utuh.</span></p>
        `)}
        ${card(3, "paperclip", "Bukti aktivitas", "Pilih folder <code>bukti</code> (subfolder per tanggal) atau file yang namanya diawali tanggal.", `
          <div class="tiles">
            <button class="tile" id="alog-pickdir">${icon("folder", 26)}<b>Pilih folder</b><span>bukti/2026-08-11/foto.jpg</span></button>
            <button class="tile" id="alog-pickfiles">${icon("image", 26)}<b>Pilih file</b><span>2026-08-11.jpg</span></button>
          </div>
          <input type="file" id="alog-dir" webkitdirectory multiple hidden>
          <input type="file" id="alog-files" multiple accept=".pdf,.png,.jpg,.jpeg" hidden>
          <div class="pill" id="alog-bukti-info">Belum ada bukti dipilih</div>
          <p class="note">${icon("info", 15)}<span>Beberapa foto di satu tanggal otomatis digabung jadi 1 gambar. Format: JPG, PNG, atau 1 PDF.</span></p>
        `)}
        ${card(4, "check", "Cek &amp; kirim", "Periksa dulu sebelum dikirim. Tanggal yang sudah ada di portal otomatis dilewati.", `
          <div id="alog-progress" class="progress" hidden><div id="alog-bar"></div></div>
          <div id="alog-preview"><div class="empty">Klik <b>Cek data</b> untuk melihat log yang siap dikirim.</div></div>
          <pre class="log" id="alog-log" hidden></pre>
        `)}
        <p class="disclaimer">Tool tidak resmi. Isi log tetap tanggung jawabmu, tulis sesuai kegiatan asli.</p>
      </main>
      <footer class="ft">
        <button class="btn" id="alog-cek">${icon("search")} Cek data</button>
        <button class="btn primary" id="alog-kirim" disabled>${icon("send")} <span id="alog-kirim-label">Kirim</span></button>
        <button class="btn danger" id="alog-stop" hidden>${icon("stop")} Stop</button>
      </footer>
    </aside>
  </div>`;

  const panel = $("#alog");
  const state = { files: [], ready: [], stop: false };
  const defaults = { jamMulai: "08:00", jamSelesai: "17:00", jenis: "3", tipe: "true", lokasi: "", dosen: [], data: "",
    tglMulai: "", tglSelesai: "", hari: [1, 2, 3, 4, 5] };
  let cfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE) || "{}"));
  const save = () => localStorage.setItem(STORE, JSON.stringify(cfg));

  function bindInputs() {
    $("#alog-mulai").value = cfg.jamMulai;
    $("#alog-selesai").value = cfg.jamSelesai;
    $("#alog-lokasi").value = cfg.lokasi;
    $("#alog-data").value = cfg.data;
    $("#alog-tmulai").value = cfg.tglMulai;
    $("#alog-tselesai").value = cfg.tglSelesai;
    panel.querySelectorAll("#alog-hari input").forEach((b) => { b.checked = cfg.hari.includes(+b.value); });
    updatePrepInfo();
    const r = panel.querySelector(`input[name=alog-tipe][value="${cfg.tipe}"]`);
    if (r) r.checked = true;
    panel.addEventListener("input", () => {
      cfg.jamMulai = $("#alog-mulai").value;
      cfg.jamSelesai = $("#alog-selesai").value;
      cfg.lokasi = $("#alog-lokasi").value;
      cfg.data = $("#alog-data").value;
      cfg.tglMulai = $("#alog-tmulai").value;
      cfg.tglSelesai = $("#alog-tselesai").value;
      cfg.hari = [...panel.querySelectorAll("#alog-hari input:checked")].map((b) => +b.value);
      updatePrepInfo();
      cfg.jenis = $("#alog-jenis").value || cfg.jenis;
      cfg.tipe = panel.querySelector("input[name=alog-tipe]:checked")?.value ?? "true";
      const boxes = [...panel.querySelectorAll("#alog-dosen input")];
      cfg.dosen = boxes.every((b) => b.checked) ? [] : boxes.filter((b) => b.checked).map((b) => b.value);
      save();
      $("#alog-kirim").disabled = true; // data berubah: wajib cek ulang
    });
  }

  async function loadFormOptions() {
    const doc = await fetchDoc(tambahUrl);
    const sel = $("#JenisLogbookKegiatanKampusMerdekaId", doc);
    $("#alog-jenis").innerHTML = [...(sel?.options || [])].filter((o) => o.value)
      .map((o) => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join("");
    $("#alog-jenis").value = cfg.jenis;
    const dosen = [...doc.querySelectorAll("#main_form input[type=checkbox][name^='ListDosenPembimbing']")]
      .map((b) => (b.closest(".form-check, div") || b.parentElement).textContent.trim().replace(/\s+/g, " "));
    $("#alog-dosen").innerHTML = dosen.map((n) => {
      const nama = n.split(" - ")[0];
      const on = cfg.dosen.length === 0 || cfg.dosen.includes(nama);
      return `<label class="chip"><input type="checkbox" value="${esc(nama)}" ${on ? "checked" : ""}>${esc(n)}</label>`;
    }).join("") || `<span class="card-desc">Tidak ada dosen di form.</span>`;
  }

  // ------------------------------------------------------------------ persiapan
  const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

  function workdays() {
    if (!cfg.tglMulai || !cfg.tglSelesai) return [];
    const out = [];
    const end = Date.parse(cfg.tglSelesai + "T00:00:00Z");
    for (let t = Date.parse(cfg.tglMulai + "T00:00:00Z"); t <= end && out.length < 400; t += 864e5) {
      const d = new Date(t);
      if (cfg.hari.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function updatePrepInfo() {
    const n = workdays().length;
    const el = $("#alog-prep-info");
    el.className = "pill" + (n ? " ok" : "");
    el.innerHTML = n ? `${icon("calendar", 14)} ${n} hari kerja · ${cfg.tglMulai} s.d. ${cfg.tglSelesai}` : "Isi tanggal mulai & selesai magang";
  }

  function tanggalPanjang(iso) {
    const d = new Date(iso + "T00:00:00Z");
    const bulan = BULAN_PORTAL[d.getUTCMonth()];
    return `${HARI_ID[d.getUTCDay()]}, ${d.getUTCDate()} ${bulan[0].toUpperCase() + bulan.slice(1)} ${d.getUTCFullYear()}`;
  }

  // Template .xlsx minimal (kolom Tanggal & Kegiatan), dirakit manual tanpa library luar.
  // Tanggal disimpan sebagai teks supaya formatnya sama persis saat di-copy ke panel.
  function templateXLSX(days) {
    const NS = "http://schemas.openxmlformats.org/";
    const xml = (body) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body;
    const str = (ref, text, style) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${text}</t></is></c>`;
    const rows = [
      `<row r="1">${str("A1", "Tanggal", 1)}${str("B1", "Kegiatan", 1)}</row>`,
      ...days.map((iso, i) => `<row r="${i + 2}">${str("A" + (i + 2), tanggalPanjang(iso), 2)}<c r="B${i + 2}" s="2"/></row>`),
    ];
    return zipBytes([
      { name: "[Content_Types].xml", data: xml(`<Types xmlns="${NS}package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
      { name: "_rels/.rels", data: xml(`<Relationships xmlns="${NS}package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: "xl/workbook.xml", data: xml(`<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships">` +
        `<sheets><sheet name="Log Magang" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: xml(`<Relationships xmlns="${NS}package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      { name: "xl/styles.xml", data: xml(`<styleSheet xmlns="${NS}spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
      { name: "xl/worksheets/sheet1.xml", data: xml(`<worksheet xmlns="${NS}spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="80" customWidth="1"/></cols>` +
        `<sheetData>${rows.join("")}</sheetData></worksheet>`) },
    ]);
  }

  // ZIP minimal tanpa kompresi (folder kosong + beberapa file kecil), tanpa library luar.
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipBytes(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const { name, data } of entries) {
      const nameBytes = enc.encode(name);
      const body = data == null ? new Uint8Array(0) : typeof data === "string" ? enc.encode(data) : data;
      const crc = body.length ? crc32(body) : 0;
      const isDir = name.endsWith("/");
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nama file UTF-8
      local.setUint16(8, 0, true);      // tanpa kompresi
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, body.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(local, nameBytes, body);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true);
      cd.setUint32(24, body.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(38, isDir ? 0x10 : 0x20, true); // atribut DOS: folder / file
      cd.setUint32(42, offset, true);
      central.push(cd, nameBytes);
      offset += 30 + nameBytes.length + body.length;
    }
    const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, end].map((p) => (p instanceof DataView ? new Uint8Array(p.buffer) : p));
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  function paketEntries(days) {
    return [
      { name: "bukti/" },
      ...days.map((d) => ({ name: `bukti/${d}/` })),
      { name: "template-log-magang.xlsx", data: templateXLSX(days) },
    ];
  }

  function unduhPaket() {
    const days = workdays();
    if (!days.length) return alert("Isi tanggal mulai & selesai magang dulu.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([zipBytes(paketEntries(days))], { type: "application/zip" }));
    a.download = `persiapan-log-magang-${cfg.tglMulai}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function buatFolder(btn) {
    const days = workdays();
    if (!days.length) return alert("Isi tanggal mulai & selesai magang dulu.");
    // Gagal karena apa pun (izin ditolak, folder diblokir, antivirus, dll.) → tawarkan ZIP.
    const fallback = (e) => {
      console.warn("[Logmager] buat folder gagal:", e);
      if (confirm(`Folder tidak bisa dibuat (${e.name}: ${e.message}).\n\nUnduh paket persiapan sebagai .zip saja?`)) unduhPaket();
    };
    let root;
    try {
      // Chrome menolak Documents/Desktop/Downloads itu sendiri, jadi user perlu pilih/buat subfolder.
      root = await window.showDirectoryPicker({ id: "logmager", mode: "readwrite", startIn: "documents" });
    } catch (e) {
      // AbortError = jendela ditutup tanpa folder. Sering terjadi setelah Chrome menolak folder
      // ("berisi file sistem") dan user menekan Batal, jadi tetap tawarkan ZIP.
      if (e.name === "AbortError") {
        if (confirm("Belum ada folder yang dipilih (atau foldernya ditolak browser).\n\nUnduh paket persiapan sebagai .zip saja?")) unduhPaket();
      } else fallback(e);
      return;
    }
    btn.disabled = true;
    try {
      const name = `persiapan-log-magang-${cfg.tglMulai}`;
      const base = await root.getDirectoryHandle(name, { create: true });
      const bukti = await base.getDirectoryHandle("bukti", { create: true });
      for (const d of days) await bukti.getDirectoryHandle(d, { create: true }); // folder yang sudah ada tidak diubah
      let template = "dibuat";
      try {
        await base.getFileHandle("template-log-magang.xlsx");
        template = "sudah ada, tidak ditimpa"; // jangan hapus kegiatan yang sudah ditulis
      } catch (e) {
        if (e.name !== "NotFoundError") throw e;
        const w = await (await base.getFileHandle("template-log-magang.xlsx", { create: true })).createWritable();
        await w.write(templateXLSX(days));
        await w.close();
      }
      alert(`Selesai! Di folder "${root.name}/${name}":\n• bukti/ dengan ${days.length} subfolder tanggal\n• template-log-magang.xlsx (${template})`);
    } catch (e) {
      fallback(e);
    } finally {
      btn.disabled = false;
    }
  }

  function setFiles(list) {
    state.files = [...list].filter((f) => /\.(pdf|png|jpe?g)$/i.test(f.name));
    const dates = new Set(state.files.map((f) => dateOfPath(f.webkitRelativePath || f.name)).filter(Boolean));
    const el = $("#alog-bukti-info");
    el.className = "pill" + (state.files.length ? " ok" : "");
    el.innerHTML = `${icon("check", 14)} ${state.files.length} file bukti untuk ${dates.size} tanggal`;
    $("#alog-kirim").disabled = true;
  }

  function collect() {
    const byDate = new Map();
    for (const f of state.files) {
      const d = dateOfPath(f.webkitRelativePath || f.name);
      if (d) byDate.set(d, [...(byDate.get(d) || []), f]);
    }
    const entries = [], seen = new Set();
    for (const row of parseTSV(cfg.data)) {
      const date = parseDate(row[0] || "");
      const ket = cleanText(row[1] || "");
      if (!date || !ket) continue;
      if (seen.has(date)) { entries.push({ date, ket, status: "err", note: "tanggal dobel di data" }); continue; }
      seen.add(date);
      entries.push({ date, ket, files: byDate.get(date) || [] });
    }
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderPreview(entries) {
    const label = { ok: "Siap", skip: "Sudah ada", warn: "Bukti belum ada", err: "Error" };
    const n = (s) => entries.filter((e) => e.status === s).length;
    $("#alog-preview").innerHTML = `
      <div class="stats">
        <span class="stat ok">${n("ok")} siap dikirim</span><span class="stat skip">${n("skip")} sudah ada</span>
        <span class="stat warn">${n("warn")} bukti belum ada</span>${n("err") ? `<span class="stat err">${n("err")} error</span>` : ""}
      </div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Kegiatan</th><th>Bukti</th><th>Status</th></tr></thead><tbody>${
      entries.map((e) => `<tr><td style="white-space:nowrap">${e.date}</td><td>${esc(e.ket.slice(0, 90))}${e.ket.length > 90 ? "…" : ""}</td>
        <td>${e.files ? e.files.length : "-"}</td><td><span class="badge ${e.status}">${e.status === "err" ? esc(e.note) : label[e.status]}</span></td></tr>`).join("")
    }</tbody></table></div>`;
  }

  async function cek() {
    if (!cfg.jamMulai || !cfg.jamSelesai || !cfg.lokasi.trim()) return alert("Lengkapi jam & lokasi di Pengaturan default dulu.");
    const existing = datesFromDoc(await fetchDoc(location.href));
    const entries = collect();
    for (const e of entries) {
      if (e.status) continue;
      if (existing.has(e.date)) { e.status = "skip"; continue; }
      if (!e.files.length) { e.status = "warn"; e.note = "bukti belum ada"; continue; }
      e.status = "ok";
    }
    state.ready = entries.filter((e) => e.status === "ok");
    renderPreview(entries);
    $("#alog-kirim-label").textContent = state.ready.length ? `Kirim ${state.ready.length} log` : "Kirim";
    $("#alog-kirim").disabled = !state.ready.length;
    if (!entries.length) $("#alog-preview").innerHTML = `<div class="empty">Tidak ada baris valid. Pastikan kolom pertama berisi tanggal dan kolom kedua kegiatan.</div>`;
  }

  async function kirim() {
    const todo = state.ready;
    if (!confirm(`Kirim ${todo.length} log ke Student Portal?\n${todo[0].date} … ${todo[todo.length - 1].date}`)) return;
    state.stop = false;
    const log = $("#alog-log"), bar = $("#alog-bar");
    log.hidden = false; $("#alog-progress").hidden = false; log.textContent = ""; bar.style.width = "0";
    for (const b of ["#alog-kirim", "#alog-cek"]) $(b).disabled = true;
    $("#alog-stop").hidden = false;
    let done = 0;
    let ok = 0;
    for (const e of todo) {
      if (state.stop) { log.textContent += "Dihentikan.\n"; break; }
      try {
        const r = await submitOne(e, cfg);
        ok += r.ok;
        log.textContent += `${r.ok ? "✅" : "❌"} ${e.date}${r.ok ? "" : ": " + r.msg}\n`;
      } catch (err) {
        log.textContent += `❌ ${e.date}: ${err.message}\n`;
      }
      log.scrollTop = log.scrollHeight;
      bar.style.width = `${(++done / todo.length) * 100}%`;
      await sleep(1500);
    }
    log.textContent += `\nSelesai: ${ok}/${todo.length} tersimpan. Halaman akan di-refresh…`;
    $("#alog-stop").hidden = true;
    sessionStorage.setItem(STORE + "-open", "1");
    setTimeout(() => location.reload(), 2500);
  }

  $("#alog-btn").onclick = () => panel.classList.toggle("open");
  $("#alog-zip").onclick = () => unduhPaket();
  if (CAN_DIR) $("#alog-prepdir").onclick = (e) => buatFolder(e.currentTarget);
  $("#alog-x").onclick = () => panel.classList.remove("open");
  $("#alog-overlay").onclick = () => panel.classList.remove("open");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") panel.classList.remove("open"); });
  $("#alog-pickdir").onclick = () => $("#alog-dir").click();
  $("#alog-pickfiles").onclick = () => $("#alog-files").click();
  $("#alog-dir").onchange = (e) => setFiles(e.target.files);
  $("#alog-files").onchange = (e) => setFiles(e.target.files);
  $("#alog-cek").onclick = () => cek().catch((e) => alert(e.message));
  $("#alog-kirim").onclick = () => kirim();
  $("#alog-stop").onclick = () => { state.stop = true; };
  bindInputs();
  loadFormOptions().catch(() => { $("#alog-dosen").innerHTML = `<span class="err">Gagal memuat form. Refresh halaman.</span>`; });
  if (sessionStorage.getItem(STORE + "-open")) { sessionStorage.removeItem(STORE + "-open"); panel.classList.add("open"); }
})();
