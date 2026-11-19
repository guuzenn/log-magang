// ==UserScript==
// @name         Logmager: Auto Logbook Magang IPB
// @namespace    https://github.com/guuzenn/log-magang
// @version      1.3.0
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

  const NUM_DATE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/;

  // Tanggal angka seperti 8/7/2026 bisa berarti 8 Juli (Indonesia) atau 7 Agustus (Excel format US).
  // Tentukan sekali untuk seluruh data: kalau ada angka kedua > 12 (mis. 8/19/2026), berarti bulan/hari/tahun.
  function numericOrder(values) {
    let dmy = false, mdy = false;
    for (const v of values) {
      const m = String(v).trim().match(NUM_DATE);
      if (!m) continue;
      const [x, y] = [+m[1], +m[2]];
      if (x > 12 && y <= 12) dmy = true; // hanya masuk akal sebagai hari/bulan
      if (y > 12 && x <= 12) mdy = true; // hanya masuk akal sebagai bulan/hari (typo seperti 31/31 diabaikan)
    }
    return mdy && !dmy ? "mdy" : "dmy"; // tanpa petunjuk: pakai format Indonesia
  }

  function parseDate(raw, order = "dmy") {
    const s = String(raw).trim().toLowerCase();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(m[1], m[2], m[3]);
    if ((m = s.match(NUM_DATE))) return order === "mdy" ? iso(m[3], m[1], m[2]) : iso(m[3], m[2], m[1]);
    if ((m = s.match(/(\d{1,2})[\s\-]+([a-z]+)[\s\-,]+(\d{4})/)) && BULAN[m[2]]) return iso(m[3], BULAN[m[2]], m[1]);
    if ((m = s.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/)) && BULAN[m[1]]) return iso(m[3], BULAN[m[1]], m[2]);
    return null;
  }

  // TSV hasil copy dari Google Sheets / Excel (sel multi-baris dibungkus tanda kutip)
  // Pemisah default tab (hasil copy Excel/Sheets); readCsv memakai koma/titik koma.
  function parseTSV(text, sep = "\t") {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ------------------------------------------------------------------ baca spreadsheet (.xlsx / .csv) tanpa library
  // .xlsx = ZIP berisi XML. Isi ZIP dibuka dengan DecompressionStream bawaan browser.
  async function unzip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = buf.length - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error("bukan file .xlsx yang valid");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = buf.subarray(start, start + size);
      out[name] = async () => {
        if (method === 0) return new TextDecoder().decode(raw);
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(stream).text();
      };
      p += 46 + nameLen + extra + comment;
    }
    return out;
  }

  const xmlDoc = (s) => new DOMParser().parseFromString(s, "application/xml");
  const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)).toISOString().slice(0, 10);

  async function readXlsx(file) {
    const z = await unzip(file);
    const get = async (n) => (z[n] ? xmlDoc(await z[n]()) : null);
    // Sheet pertama sesuai urutan di workbook.
    let sheetPath = "xl/worksheets/sheet1.xml";
    const wb = await get("xl/workbook.xml"), rels = await get("xl/_rels/workbook.xml.rels");
    const first = wb?.getElementsByTagNameNS("*", "sheet")[0];
    const rid = first?.getAttribute("r:id") || first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = rid && [...(rels?.getElementsByTagNameNS("*", "Relationship") || [])].find((r) => r.getAttribute("Id") === rid);
    if (rel) sheetPath = "xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, "");
    const shared = [...((await get("xl/sharedStrings.xml"))?.getElementsByTagNameNS("*", "si") || [])]
      .map((si) => [...si.getElementsByTagNameNS("*", "t")].filter((t) => t.parentNode.localName !== "rPh").map((t) => t.textContent).join(""));
    // Style mana yang berformat tanggal (format bawaan 14-22, 45-47, atau format kustom berisi d/m/y).
    const styles = await get("xl/styles.xml");
    const custom = {};
    for (const f of styles?.getElementsByTagNameNS("*", "numFmt") || []) custom[f.getAttribute("numFmtId")] = f.getAttribute("formatCode");
    const xfs = styles?.getElementsByTagNameNS("*", "cellXfs")[0];
    const isDateStyle = [...(xfs?.getElementsByTagNameNS("*", "xf") || [])].map((xf) => {
      const id = +xf.getAttribute("numFmtId");
      const code = (custom[id] || "").replace(/\[[^\]]*\]|"[^"]*"/g, "");
      return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy]/i.test(code);
    });
    const sheet = await get(sheetPath);
    if (!sheet) throw new Error("sheet tidak ditemukan");
    return [...sheet.getElementsByTagNameNS("*", "row")].map((row) => {
      const cells = [];
      for (const c of row.getElementsByTagNameNS("*", "c")) {
        const t = c.getAttribute("t"), v = c.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
        let val;
        if (t === "s") val = shared[+v] ?? "";
        else if (t === "inlineStr") val = [...c.getElementsByTagNameNS("*", "t")].map((x) => x.textContent).join("");
        else if ((t === null || t === "n") && v !== "" && isDateStyle[+(c.getAttribute("s") || 0)]) val = serialToIso(+v);
        else val = v;
        cells[colIndex(c.getAttribute("r") || "A")] = val;
      }
      return Array.from(cells, (x) => x ?? "");
    });
  }

  function readCsv(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/)[0] || "";
    // Parser yang sama dengan paste, jadi sel berkutip yang berisi baris baru tetap utuh.
    return parseTSV(text, first.split(";").length > first.split(",").length ? ";" : ",");
  }

  // Ambil kolom Tanggal + Kegiatan dari tabel (baris judul dicari otomatis; kalau tidak ada, pakai kolom A & B).
  function pickColumns(rows) {
    const hi = rows.findIndex((r) => r.some((c) => /^\s*tanggal/i.test(c)));
    if (hi < 0) return rows.map((r) => [r[0] || "", r[1] || ""]);
    const h = rows[hi].map((c) => String(c).trim().toLowerCase());
    const di = h.findIndex((c) => c.startsWith("tanggal"));
    const ki = h.findIndex((c, i) => i !== di && /kegiatan|keterangan|aktivitas|report/.test(c));
    return rows.slice(hi + 1).map((r) => [r[di] || "", r[ki < 0 ? di + 1 : ki] || ""]);
  }

  async function readSheet(file) {
    try {
      const rows = /\.csv$/i.test(file.name) ? readCsv(await file.text()) : await readXlsx(file);
      return pickColumns(rows);
    } catch (e) {
      if (e.name === "NotReadableError") throw new Error(`${file.name} sedang dikunci. Simpan & tutup Excel dulu, lalu pilih lagi.`);
      throw new Error(`${file.name} tidak bisa dibaca (${e.message}).`);
    }
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
  // Pakai tanggal TERAKHIR di path: folder persiapan sendiri bernama "persiapan-log-magang-2026-08-03",
  // sedangkan tanggal bukti ada di subfolder/nama file sesudahnya.
  function dateOfPath(path) {
    const all = [...path.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)];
    const m = all[all.length - 1];
    return m ? iso(m[1], m[2], m[3]) : null;
  }
  const pathOf = (f) => f.relPath || f.webkitRelativePath || f.name;

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

  const isHeic = (f) => /\.(heic|heif)$/i.test(f.name);

  // Chrome/Edge umumnya belum bisa membuka HEIC (foto iPhone), Safari bisa. Dicek sekali dengan file asli.
  let heicSupport = null;
  async function canOpenHeic(file) {
    if (heicSupport === null) heicSupport = await loadImage(file).then(() => true, () => false);
    return heicSupport;
  }

  // 1 file -> dipakai langsung (gambar besar dikompres). Banyak gambar -> disusun vertikal jadi 1 JPG.
  async function buildUpload(files, date) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length) {
      if (files.length > 1) throw new Error("folder berisi PDF + file lain; sisakan 1 PDF saja");
      return pdfs[0];
    }
    // HEIC selalu digambar ulang jadi JPG, karena portal hanya menerima JPG/PNG/PDF.
    if (files.length === 1 && !isHeic(files[0]) && files[0].size < 1.5 * 1024 * 1024) return files[0];
    const imgs = await Promise.all(files.map((f) => loadImage(f).catch(() => {
      throw new Error(isHeic(f) ? `${f.name}: foto HEIC tidak bisa dibuka browser ini, ubah dulu ke JPG` : `${f.name}: gambar tidak bisa dibaca`);
    })));
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
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  };
  const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // Logo Logmager "logbook rebahan" (sama dengan extension/icons/logo.svg). simple = tanpa detail kecil, untuk ukuran mini.
  const logo = (simple = false) => `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#1e3a8a"/>
    <path d="M9 27c7-4 15-4 23 1v24c-8-5-16-5-23-1z" fill="#fff"/><path d="M55 27c-7-4-15-4-23 1v24c8-5 16-5 23-1z" fill="#dbeafe"/>
    ${simple ? "" : '<path d="M14 35c5-2 9-2 13 0M14 41c5-2 9-2 13 0" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/>'}
    <path d="M41 8h11L41 19h11" fill="none" stroke="#fbbf24" stroke-width="${simple ? 5 : 3.6}" stroke-linecap="round" stroke-linejoin="round"/>
    ${simple ? "" : '<path d="M30 12h6l-6 6h6" fill="none" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'}
  </svg>`;

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
  .logo{display:block;width:40px;height:40px;border-radius:10px;box-shadow:0 0 0 2px rgba(255,255,255,.3)}
  .fab .logo{width:26px;height:26px;border-radius:7px;box-shadow:none}
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
  .tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
  .tile.big{width:100%;padding:22px 12px;border-color:var(--primary);background:var(--primary-50);color:var(--primary-600)}
  .more{margin-top:12px;font-size:12.5px;color:var(--muted)}
  .linkbtn{display:block;margin:10px auto 0;padding:0;border:0;background:none;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--primary);text-decoration:underline}
  .more summary{cursor:pointer;font-weight:600;color:var(--primary)}
  .more p{margin:8px 0}
  .more textarea{margin-top:4px}
  #alog-lastprep,#alog-src-info,#alog-bukti-info{margin-top:10px}
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
        ${desc ? `<div class="card-desc">${desc}</div>` : ""}</div></div>
      ${body}
    </section>`;

  const host = document.createElement("div");
  host.id = "alog-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  UI = shadow;
  shadow.innerHTML = `<style>${css}</style>
  <div class="root" id="alog">
    <button class="fab" id="alog-btn">${logo(true)} Logmager</button>
    <div class="overlay" id="alog-overlay"></div>
    <aside class="panel" role="dialog" aria-label="Logmager">
      <header class="hd">
        <div class="brand">${logo()}
          <div><div class="title">Logmager</div><div class="sub">Isi logbook magang sekaligus</div></div></div>
        <button class="icon-btn" id="alog-x" title="Tutup">${icon("x", 20)}</button>
      </header>
      <main class="body">
        ${card(1, "calendar", "Persiapan", "", `
          <div class="grid">
            <label class="field"><span class="label">Mulai magang</span><input type="date" id="alog-tmulai"></label>
            <label class="field"><span class="label">Selesai</span><input type="date" id="alog-tselesai"></label>
          </div>
          <div class="field"><span class="label">Hari kerja</span>
            <div class="chips" id="alog-hari">${["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
              .map((h, i) => `<label class="chip"><input type="checkbox" value="${i}">${h}</label>`).join("")}</div></div>
          <div class="pill" id="alog-prep-info"></div>
          <div class="field">${CAN_DIR ? `<button class="btn soft block" id="alog-prepdir">${icon("folder")} Buat folder persiapan</button>` : ""}
            <button class="btn block" id="alog-zip"${CAN_DIR ? ' style="margin-top:8px"' : ""}>${icon("download")} ${CAN_DIR ? "Unduh .zip saja" : "Unduh paket persiapan (.zip)"}</button></div>
          <details class="more"><summary>Isinya apa?</summary>
            <p>Folder <code>bukti/</code> per tanggal + <code>template-log-magang.xlsx</code>. ${CAN_DIR
              ? "Pilih folder baru, mis. <code>Documents\Magang</code> (Documents/Desktop langsung tidak bisa dipilih)."
              : "Klik kanan ZIP, pilih <b>Extract All</b>."}</p></details>
        `, "highlight")}
        ${card(2, "sliders", "Pengaturan", "Isi sekali, tersimpan otomatis.", `
          <div class="grid">
            <label class="field"><span class="label" data-for="Tmw">Jam mulai</span><input type="time" id="alog-mulai"></label>
            <label class="field"><span class="label" data-for="Tsw">Jam selesai</span><input type="time" id="alog-selesai"></label>
          </div>
          <label class="field"><span class="label" data-for="JenisLogbookKegiatanKampusMerdekaId">Jenis kegiatan</span><select id="alog-jenis"></select></label>
          <div class="field"><span class="label" data-for="IsLuring">Tipe</span>
            <div class="seg" id="alog-tipe">
              <label><input type="radio" name="alog-tipe" value=""><span>Hybrid</span></label>
              <label><input type="radio" name="alog-tipe" value="true"><span>Offline</span></label>
              <label><input type="radio" name="alog-tipe" value="false"><span>Online</span></label>
            </div></div>
          <label class="field"><span class="label" data-for="Lokasi">Lokasi</span><input type="text" id="alog-lokasi" placeholder="Nama kantor"></label>
          <div class="field"><span class="label" data-for="ListDosenPembimbing">Dosen</span><div class="chips" id="alog-dosen"><span class="card-desc">Memuat…</span></div></div>
        `)}
        ${card(3, "sheet", "Data &amp; bukti", "Isi Excel, simpan, lalu pilih folder persiapanmu.", `
          <button class="tile big" id="alog-pickprep">${icon("folder", 28)}<b>Pilih folder persiapan</b><span>Ditanya “Upload”? Klik Upload, file tetap di laptopmu</span></button>
          <button class="btn block" id="alog-lastprep" hidden>${icon("refresh")} <span id="alog-lastprep-label">Pakai folder terakhir</span></button>
          ${CAN_DIR ? `<button class="linkbtn" id="alog-remember">Ingat folder ini, minggu depan tinggal 1 klik</button>` : ""}
          <input type="file" id="alog-prepin" webkitdirectory multiple hidden>
          <div class="pill" id="alog-src-info">Belum ada data</div>
          <div class="pill" id="alog-bukti-info" hidden></div>
          <details class="more"><summary>Pakai cara lain</summary>
            <p>Paste kolom Tanggal + Kegiatan dari Excel/Google Sheets:</p>
            <textarea id="alog-data" placeholder="Senin, 3 Agustus 2026&#9;Onboarding tim"></textarea>
            <div class="tiles">
              <button class="tile" id="alog-pickdir">${icon("folder", 22)}<b>Folder bukti</b></button>
              <button class="tile" id="alog-pickfiles">${icon("image", 22)}<b>File bukti</b></button>
            </div>
            <input type="file" id="alog-dir" webkitdirectory multiple hidden>
            <input type="file" id="alog-files" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.heif" hidden>
            <p>Bukti: JPG/PNG (beberapa foto digabung otomatis) atau 1 PDF per tanggal. Foto iPhone (HEIC) ubah dulu ke JPG kalau error.</p>
          </details>
        `)}
        ${card(4, "check", "Cek &amp; kirim", "Tanggal yang sudah ada otomatis dilewati.", `
          <div id="alog-progress" class="progress" hidden><div id="alog-bar"></div></div>
          <div id="alog-preview"><div class="empty">Pilih folder, lalu cek di sini.</div></div>
          <pre class="log" id="alog-log" hidden></pre>
        `)}
        <p class="disclaimer">Tool tidak resmi. Tulis sesuai kegiatan asli ya.</p>
      </main>
      <footer class="ft">
        <button class="btn primary block" id="alog-main"></button>
        <button class="btn danger" id="alog-stop" hidden>${icon("stop")} Stop</button>
      </footer>
    </aside>
  </div>`;

  const panel = $("#alog");
  const state = { files: [], ready: [], stop: false, dateNote: "", sheet: null, checked: false };
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
    panel.addEventListener("input", (e) => {
      // Mengetik/paste di kotak data = beralih dari file Excel ke data paste.
      if (e.target.id === "alog-data") { state.sheet = null; showSource("Data dari paste", !!e.target.value.trim()); }
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
      needCheck(); // data berubah: wajib cek ulang
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
    copyPortalLabels(doc);
  }

  // Samakan label panel dengan label asli di form Tambah portal (teks portal dipakai apa adanya, tanpa disingkat).
  function copyPortalLabels(doc) {
    const form = $("#main_form", doc);
    if (!form) return;
    const clean = (t) => (t || "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
    for (const span of panel.querySelectorAll("[data-for]")) {
      const n = span.dataset.for;
      const field = form.querySelector(`[name="${n}"], [id="${n}"], [name^="${n}"]`);
      if (!field) continue;
      const label = (field.id && form.querySelector(`label[for="${field.id}"]:not(.form-check-label)`))
        || field.closest(".form-group, .mb-3")?.querySelector("label:not(.form-check-label), .control-label, .form-label");
      const text = clean(label?.textContent);
      if (text && text.length <= 60) span.textContent = text;
    }
    // Pilihan tipe (Hybrid/Offline/Online) juga pakai teks portal.
    for (const radio of form.querySelectorAll("input[type=radio][name=IsLuring]")) {
      const own = (radio.id && form.querySelector(`label[for="${radio.id}"]`)) || radio.closest("label, .form-check");
      const text = clean(own?.textContent);
      const target = panel.querySelector(`input[name=alog-tipe][value="${radio.value}"] + span`);
      if (text && target && text.length <= 30) target.textContent = text;
    }
  }

  // ------------------------------------------------------------------ persiapan

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

  // Template .xlsx minimal (kolom Tanggal & Kegiatan), dirakit manual tanpa library luar.
  // Tanggal disimpan sebagai tanggal asli Excel (bisa diurutkan/difilter/diketik ulang), dengan format tampilan
  // Indonesia "Senin, 3 Agustus 2026" ([$-421]) yang ikut ter-copy apa adanya dan dikenali panel.
  function templateXLSX(days) {
    const NS = "http://schemas.openxmlformats.org/";
    const xml = (body) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body;
    const str = (ref, text, style) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${text}</t></is></c>`;
    const serial = (iso) => (Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000; // nomor tanggal Excel
    const rows = [
      `<row r="1">${str("A1", "Tanggal", 1)}${str("B1", "Kegiatan", 1)}</row>`,
      ...days.map((iso, i) => `<row r="${i + 2}"><c r="A${i + 2}" s="3"><v>${serial(iso)}</v></c><c r="B${i + 2}" s="2"/></row>`),
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
        `<numFmts count="1"><numFmt numFmtId="164" formatCode="[$-421]dddd, d mmmm yyyy"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf></cellXfs>` +
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
    state.files = [...list].filter((f) => /\.(pdf|png|jpe?g|heic|heif)$/i.test(f.name));
    const dates = new Set(state.files.map((f) => dateOfPath(pathOf(f))).filter(Boolean));
    const el = $("#alog-bukti-info");
    el.hidden = false;
    el.className = "pill" + (state.files.length ? " ok" : "");
    el.innerHTML = `${icon(state.files.length ? "check" : "info", 14)} ${state.files.length} bukti untuk ${dates.size} tanggal`;
    needCheck();
  }

  function showSource(text, ok) {
    const el = $("#alog-src-info");
    el.className = "pill" + (ok ? " ok" : "");
    el.innerHTML = `${icon(ok ? "check" : "info", 14)} ${text}`;
  }

  // Satu folder persiapan = Excel (kegiatan) + bukti/. Dipanggil dari pemilih folder biasa maupun folder yang diingat.
  async function loadFolder(list, folderName) {
    const files = [...list];
    const sheets = files.filter((f) => /\.(xlsx|csv)$/i.test(f.name) && !f.name.startsWith("~$") && !/(^|\/)bukti\//i.test(pathOf(f)));
    sheets.sort((a, b) => /template-log-magang/i.test(b.name) - /template-log-magang/i.test(a.name) || b.lastModified - a.lastModified);
    setFiles(files);
    if (!sheets.length) {
      state.sheet = null;
      showSource(`Tidak ada file Excel di ${folderName || "folder ini"}`, false);
      return;
    }
    try {
      const rows = await readSheet(sheets[0]);
      state.sheet = {name: sheets[0].name, rows};
      const n = rows.filter((r) => String(r[1] || "").trim()).length;
      showSource(`${n} kegiatan dari ${esc(sheets[0].name)}`, n > 0);
    } catch (e) {
      state.sheet = null;
      showSource(esc(e.message), false);
      return;
    }
    // Langsung cek kalau pengaturan sudah lengkap, supaya user tinggal klik Kirim.
    if (cfg.jamMulai && cfg.jamSelesai && cfg.lokasi.trim()) await cek().catch((e) => alert(e.message));
  }

  // ---- Chrome/Edge: folder persiapan diingat (IndexedDB), minggu depan tinggal klik "Pakai folder terakhir".
  const idb = () => new Promise((ok, err) => {
    const r = indexedDB.open("logmager", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
  async function kv(key, value) {
    const db = await idb();
    return new Promise((ok, err) => {
      const tx = db.transaction("kv", value === undefined ? "readonly" : "readwrite");
      const req = value === undefined ? tx.objectStore("kv").get(key) : tx.objectStore("kv").put(value, key);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => err(req.error);
    });
  }

  async function filesFromHandle(dir, prefix = "") {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") out.push(...(await filesFromHandle(h, `${prefix}${name}/`)));
      else if (/\.(xlsx|csv|pdf|png|jpe?g|heic|heif)$/i.test(name)) {
        const f = await h.getFile();
        Object.defineProperty(f, "relPath", {value: `${prefix}${name}`});
        out.push(f);
      }
    }
    return out;
  }

  async function loadHandle(handle) {
    let perm = await handle.queryPermission({mode: "read"});
    if (perm !== "granted") perm = await handle.requestPermission({mode: "read"});
    if (perm !== "granted") return showSource("Izin baca folder ditolak", false);
    showSource(`Membaca ${esc(handle.name)}…`, false);
    let files;
    try {
      files = await filesFromHandle(handle, `${handle.name}/`);
    } catch {
      return showSource("Folder tidak ditemukan (dipindah/dihapus?). Pilih ulang folder persiapan.", false);
    }
    await loadFolder(files, handle.name);
  }

  async function showLastFolder() {
    if (!CAN_DIR) return;
    const h = await kv("prepFolder").catch(() => null);
    if (!h) return;
    $("#alog-lastprep").hidden = false;
    $("#alog-lastprep-label").textContent = `Pakai folder terakhir: ${h.name}`;
  }

  // Kosongkan dulu sebelum membuka: kalau tidak, memilih folder/file yang SAMA lagi tidak memicu "change"
  // (gejalanya: pertama kali bisa, berikutnya tidak terbaca, padahal isi folder sudah ditambah).
  function openPicker(sel) {
    $(sel).value = "";
    $(sel).click();
  }

  async function pickPrep() {
    if (!CAN_DIR) return openPicker("#alog-prepin");
    let handle;
    const t0 = Date.now();
    try {
      handle = await window.showDirectoryPicker({id: "logmager-prep", mode: "read"});
    } catch (e) {
      // Ditolak dalam sekejap = bukan user yang membatalkan, tapi browser/OS yang memblokir fitur ini.
      const blocked = e.name !== "AbortError" || Date.now() - t0 < 400;
      if (blocked) showSource("Browser ini memblokir fitur ingat folder. Pakai tombol Pilih folder persiapan saja.", false);
      return;
    }
    await kv("prepFolder", handle).catch(() => {});
    showLastFolder();
    await loadHandle(handle);
  }

  function collect() {
    const byDate = new Map();
    for (const f of state.files) {
      const d = dateOfPath(pathOf(f));
      if (d) byDate.set(d, [...(byDate.get(d) || []), f]);
    }
    const entries = [], seen = new Set();
    const rows = state.sheet ? state.sheet.rows : parseTSV(cfg.data);
    const order = numericOrder(rows.map((r) => r[0] || ""));
    state.dateNote = rows.some((r) => NUM_DATE.test(String(r[0] || "").trim()))
      ? `Tanggal angka dibaca sebagai ${order === "mdy" ? "bulan/hari/tahun (format US)" : "hari/bulan/tahun"}.` : "";
    for (const row of rows) {
      const raw = String(row[0] || "").trim();
      const date = parseDate(raw, order);
      const ket = cleanText(row[1] || "");
      if (!ket) continue; // baris kosong / tanpa kegiatan
      if (!date) {
        if (/^(tanggal|tgl|date)\b/i.test(raw)) continue; // baris judul
        // Jangan dilewati diam-diam: tampilkan supaya user tahu ada baris yang tidak terbaca.
        entries.push({ date: raw || "(kosong)", ket, status: "err", note: raw ? "tanggal tidak dikenali" : "tanggal kosong" });
        continue;
      }
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
      </div>${state.dateNote ? `<p class="note">${icon("info", 15)}<span>${state.dateNote}</span></p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Kegiatan</th><th>Bukti</th><th>Status</th></tr></thead><tbody>${
      entries.map((e) => `<tr><td style="white-space:nowrap">${esc(e.date)}</td><td>${esc(e.ket.slice(0, 90))}${e.ket.length > 90 ? "…" : ""}</td>
        <td>${e.files ? e.files.length : "-"}</td><td><span class="badge ${e.status}">${e.status === "err" ? esc(e.note) : label[e.status]}</span></td></tr>`).join("")
    }</tbody></table></div>`;
  }

  function setMain() {
    const b = $("#alog-main");
    b.disabled = false;
    if (!state.checked) b.innerHTML = `${icon("search")} Cek data`;
    else if (state.ready.length) b.innerHTML = `${icon("send")} Kirim ${state.ready.length} log`;
    else b.innerHTML = `${icon("refresh")} Cek ulang`;
  }

  function needCheck() {
    state.checked = false;
    state.ready = [];
    setMain();
  }

  async function cek() {
    if (!cfg.jamMulai || !cfg.jamSelesai || !cfg.lokasi.trim()) return alert("Lengkapi jam & lokasi di Pengaturan dulu.");
    // cfg.dosen kosong berarti "semua", jadi kalau semua centang dihapus jangan sampai terkirim ke semua dosen.
    const dosenBoxes = [...panel.querySelectorAll("#alog-dosen input")];
    if (dosenBoxes.length && !dosenBoxes.some((b) => b.checked)) return alert("Pilih minimal satu dosen di Pengaturan.");
    // Belum ada data (mis. halaman baru di-refresh setelah Kirim): pakai folder terakhir kalau ada, atau minta pilih folder.
    if (!state.sheet && !cfg.data.trim()) {
      const h = CAN_DIR && (await kv("prepFolder").catch(() => null));
      if (h) return loadHandle(h); // loadFolder akan menjalankan cek lagi setelah data terbaca
      $("#alog-preview").innerHTML = `<div class="empty">Belum ada data. Klik <b>Pilih folder persiapan</b> dulu,
        atau paste data di <b>Pakai cara lain</b>.</div>`;
      state.checked = false;
      return setMain();
    }
    const existing = datesFromDoc(await fetchDoc(location.href));
    const entries = collect();
    for (const e of entries) {
      if (e.status) continue;
      if (existing.has(e.date)) { e.status = "skip"; continue; }
      if (!e.files.length) { e.status = "warn"; e.note = "bukti belum ada"; continue; }
      const heic = e.files.find(isHeic);
      if (heic && !(await canOpenHeic(heic))) {
        e.status = "err"; e.note = "foto HEIC tidak bisa dibuka browser ini, ubah dulu ke JPG"; continue;
      }
      e.status = "ok";
    }
    state.ready = entries.filter((e) => e.status === "ok");
    renderPreview(entries);
    state.checked = true;
    setMain();
    if (!entries.length) $("#alog-preview").innerHTML = `<div class="empty">Tidak ada kegiatan terbaca. Cek kolom Tanggal &amp; Kegiatan di Excel, lalu simpan.</div>`;
  }

  async function kirim() {
    const todo = state.ready;
    if (!confirm(`Kirim ${todo.length} log ke Student Portal?\n${todo[0].date} … ${todo[todo.length - 1].date}`)) return;
    state.stop = false;
    const log = $("#alog-log"), bar = $("#alog-bar");
    log.hidden = false; $("#alog-progress").hidden = false; log.textContent = ""; bar.style.width = "0";
    $("#alog-main").disabled = true;
    $("#alog-main").innerHTML = `${icon("send")} Mengirim…`;
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
  $("#alog-pickdir").onclick = () => openPicker("#alog-dir");
  $("#alog-pickfiles").onclick = () => openPicker("#alog-files");
  $("#alog-dir").onchange = (e) => setFiles(e.target.files);
  $("#alog-files").onchange = (e) => setFiles(e.target.files);
  // Tombol utama pakai pemilih folder klasik: jalan di semua browser dan tidak terpengaruh kebijakan yang memblokir
  // File System Access (mis. Chrome yang diatur ketat oleh OS/admin). "Ingat folder" jadi opsi tambahan.
  $("#alog-pickprep").onclick = () => openPicker("#alog-prepin");
  if (CAN_DIR) $("#alog-remember").onclick = () => pickPrep().catch((e) => showSource(esc(e.message), false));
  $("#alog-prepin").onchange = (e) => { const f = e.target.files; loadFolder(f, f[0]?.webkitRelativePath.split("/")[0]); };
  $("#alog-lastprep").onclick = async () => { const h = await kv("prepFolder").catch(() => null); if (h) await loadHandle(h).catch((e) => alert(e.message)); };
  showLastFolder().then(async () => {
    // Setelah Kirim halaman di-refresh. Kalau izin folder masih aktif, baca ulang otomatis tanpa bertanya.
    const h = CAN_DIR && (await kv("prepFolder").catch(() => null));
    if (h && (await h.queryPermission({mode: "read"}).catch(() => "")) === "granted") await loadHandle(h).catch(() => {});
  });
  if (cfg.data.trim()) showSource("Data dari paste", true);
  // Satu tombol utama: "Cek data" dulu, lalu berubah jadi "Kirim N log". Tidak ada tombol abu-abu yang membingungkan.
  $("#alog-main").onclick = () => (state.checked && state.ready.length ? kirim() : cek().catch((e) => alert(e.message)));
  setMain();
  $("#alog-stop").onclick = () => { state.stop = true; };
  bindInputs();
  loadFormOptions().catch(() => { $("#alog-dosen").innerHTML = `<span class="err">Gagal memuat form. Refresh halaman.</span>`; });
  if (sessionStorage.getItem(STORE + "-open")) { sessionStorage.removeItem(STORE + "-open"); panel.classList.add("open"); }
})();
