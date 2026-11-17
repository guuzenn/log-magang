// ==UserScript==
// @name         Auto Log Aktivitas Kampus Merdeka (IPB)
// @namespace    https://github.com/guuzenn/log-magang
// @version      1.0.0
// @description  Isi banyak Log Aktivitas Kampus Merdeka sekaligus: paste dari spreadsheet, pilih folder bukti, kirim.
// @match        https://studentportal.ipb.ac.id/Kegiatan/LogAktivitasKampusMerdeka/Index/*
// @grant        none
// @homepageURL  https://github.com/guuzenn/log-magang
// @supportURL   https://github.com/guuzenn/log-magang/issues
// @updateURL    https://github.com/guuzenn/log-magang/releases/latest/download/auto-log-ipb.user.js
// @downloadURL  https://github.com/guuzenn/log-magang/releases/latest/download/auto-log-ipb.user.js
// ==/UserScript==

/*
 * Tool tidak resmi. Berjalan di tab yang sudah kamu login-kan: tidak pernah membaca/menyimpan password,
 * tidak mengirim data ke server lain selain studentportal.ipb.ac.id.
 */
(function () {
  "use strict";

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

  const tambahLink = [...document.querySelectorAll("a")].find((a) => /Tambah/.test(a.textContent));
  const tambahUrl = tambahLink && (tambahLink.getAttribute("onclick") || "").match(/OpenModal\('([^']+)'/)?.[1];
  if (!tambahUrl) return;

  // ------------------------------------------------------------------ util
  const $ = (sel, root = document) => root.querySelector(sel);
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
  const css = `
  #alog-btn{position:fixed;right:24px;bottom:24px;z-index:99999;background:#4f46e5;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 14px Poppins,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}
  #alog{position:fixed;top:0;right:0;width:560px;max-width:100vw;height:100vh;z-index:99999;background:#fff;box-shadow:-8px 0 30px rgba(0,0,0,.2);font:14px Poppins,sans-serif;color:#1f2937;display:none;flex-direction:column}
  #alog.open{display:flex}
  #alog header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#4f46e5;color:#fff}
  #alog header b{font-size:16px}
  #alog header button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer}
  #alog main{overflow:auto;padding:14px 18px;flex:1}
  #alog section{margin-bottom:16px}
  #alog h4{margin:0 0 8px;font-size:14px;color:#312e81}
  #alog label{display:block;font-size:12px;color:#4b5563;margin:6px 0 2px}
  #alog input[type=text],#alog input[type=time],#alog select,#alog textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font:inherit}
  #alog textarea{height:110px;font-size:12px}
  #alog .row{display:flex;gap:8px}#alog .row>*{flex:1}
  #alog .inline label{display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:13px;color:#1f2937}
  #alog .btn{border:0;border-radius:6px;padding:8px 14px;font:600 13px inherit;cursor:pointer;background:#e5e7eb}
  #alog .btn.primary{background:#4f46e5;color:#fff}#alog .btn:disabled{opacity:.5;cursor:default}
  #alog .hint{font-size:12px;color:#6b7280;margin:4px 0}
  #alog table{width:100%;border-collapse:collapse;font-size:12px}
  #alog td,#alog th{border-bottom:1px solid #eee;padding:4px;text-align:left;vertical-align:top}
  #alog .ok{color:#059669}#alog .warn{color:#b45309}#alog .skip{color:#6b7280}#alog .err{color:#dc2626}
  #alog progress{width:100%}
  #alog pre{background:#f9fafb;border:1px solid #eee;padding:8px;font-size:12px;max-height:160px;overflow:auto;white-space:pre-wrap}`;
  document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
  document.body.insertAdjacentHTML("beforeend", `
  <button id="alog-btn">⚡ Auto Log</button>
  <div id="alog">
    <header><b>⚡ Auto Log Aktivitas</b><button id="alog-x" title="Tutup">×</button></header>
    <main>
      <section>
        <h4>1. Pengaturan default</h4>
        <div class="row">
          <div><label>Jam mulai</label><input type="time" id="alog-mulai"></div>
          <div><label>Jam selesai</label><input type="time" id="alog-selesai"></div>
        </div>
        <label>Jenis kegiatan</label><select id="alog-jenis"></select>
        <label>Tipe penyelenggaraan</label>
        <div class="inline" id="alog-tipe">
          <label><input type="radio" name="alog-tipe" value=""> Hybrid</label>
          <label><input type="radio" name="alog-tipe" value="true"> Offline</label>
          <label><input type="radio" name="alog-tipe" value="false"> Online</label>
        </div>
        <label>Lokasi</label><input type="text" id="alog-lokasi" placeholder="Nama kantor, alamat">
        <label>Dosen penggerak</label><div class="inline" id="alog-dosen"><span class="hint">memuat…</span></div>
      </section>
      <section>
        <h4>2. Paste data dari spreadsheet</h4>
        <p class="hint">Blok 2 kolom <b>Tanggal</b> dan <b>Keterangan</b> di Google Sheets/Excel, Ctrl+C, lalu Ctrl+V di sini. Baris judul &amp; baris tanpa keterangan otomatis dilewati.</p>
        <textarea id="alog-data" placeholder="2026-08-11&#9;- Mengembangkan fitur registrasi…"></textarea>
      </section>
      <section>
        <h4>3. Pilih bukti</h4>
        <p class="hint">Folder berisi subfolder per tanggal (<code>bukti/2026-08-11/foto.jpg</code>) atau file bernama tanggal (<code>2026-08-11.jpg</code>). Beberapa foto di 1 tanggal otomatis digabung.</p>
        <div class="row">
          <button class="btn" id="alog-pickdir">📁 Pilih folder</button>
          <button class="btn" id="alog-pickfiles">🖼️ Pilih file</button>
        </div>
        <input type="file" id="alog-dir" webkitdirectory multiple hidden>
        <input type="file" id="alog-files" multiple accept=".pdf,.png,.jpg,.jpeg" hidden>
        <p class="hint" id="alog-bukti-info">Belum ada bukti dipilih.</p>
      </section>
      <section>
        <h4>4. Cek &amp; kirim</h4>
        <div class="row">
          <button class="btn" id="alog-cek">🔍 Cek data</button>
          <button class="btn primary" id="alog-kirim" disabled>🚀 Kirim</button>
          <button class="btn" id="alog-stop" disabled>⏹ Stop</button>
        </div>
        <progress id="alog-prog" value="0" max="1" hidden></progress>
        <div id="alog-preview"></div>
        <pre id="alog-log" hidden></pre>
      </section>
      <p class="hint">Tool tidak resmi. Isi log tetap tanggung jawabmu — tulis sesuai kegiatan asli.</p>
    </main>
  </div>`);

  const panel = $("#alog");
  const state = { files: [], ready: [], stop: false };
  const defaults = { jamMulai: "08:00", jamSelesai: "17:00", jenis: "3", tipe: "true", lokasi: "", dosen: [], data: "" };
  let cfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE) || "{}"));
  const save = () => localStorage.setItem(STORE, JSON.stringify(cfg));

  function bindInputs() {
    $("#alog-mulai").value = cfg.jamMulai;
    $("#alog-selesai").value = cfg.jamSelesai;
    $("#alog-lokasi").value = cfg.lokasi;
    $("#alog-data").value = cfg.data;
    const r = panel.querySelector(`input[name=alog-tipe][value="${cfg.tipe}"]`);
    if (r) r.checked = true;
    panel.addEventListener("input", () => {
      cfg.jamMulai = $("#alog-mulai").value;
      cfg.jamSelesai = $("#alog-selesai").value;
      cfg.lokasi = $("#alog-lokasi").value;
      cfg.data = $("#alog-data").value;
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
      return `<label><input type="checkbox" value="${esc(nama)}" ${on ? "checked" : ""}> ${esc(n)}</label>`;
    }).join("") || `<span class="hint">Tidak ada dosen di form.</span>`;
  }

  function setFiles(list) {
    state.files = [...list].filter((f) => /\.(pdf|png|jpe?g)$/i.test(f.name));
    const dates = new Set(state.files.map((f) => dateOfPath(f.webkitRelativePath || f.name)).filter(Boolean));
    $("#alog-bukti-info").textContent = `${state.files.length} file bukti untuk ${dates.size} tanggal.`;
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
    const label = { ok: "✅ siap", skip: "⏭️ sudah ada", warn: "⚠️", err: "❌" };
    $("#alog-preview").innerHTML = `<table><tr><th>Tanggal</th><th>Keterangan</th><th>Bukti</th><th>Status</th></tr>${
      entries.map((e) => `<tr><td>${e.date}</td><td>${esc(e.ket.slice(0, 70))}${e.ket.length > 70 ? "…" : ""}</td>
        <td>${e.files ? e.files.length : "-"}</td><td class="${e.status}">${label[e.status]} ${esc(e.note || "")}</td></tr>`).join("")
    }</table>`;
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
    const n = (s) => entries.filter((e) => e.status === s).length;
    $("#alog-preview").insertAdjacentHTML("afterbegin",
      `<p class="hint"><b>${n("ok")} siap</b> · ${n("skip")} sudah ada di portal · ${n("warn")} bukti belum ada · ${n("err")} error</p>`);
    $("#alog-kirim").textContent = `🚀 Kirim ${state.ready.length} log`;
    $("#alog-kirim").disabled = !state.ready.length;
    if (!entries.length) $("#alog-preview").innerHTML = `<p class="err">Tidak ada baris valid. Pastikan kolom pertama berisi tanggal.</p>`;
  }

  async function kirim() {
    const todo = state.ready;
    if (!confirm(`Kirim ${todo.length} log ke Student Portal?\n${todo[0].date} … ${todo[todo.length - 1].date}`)) return;
    state.stop = false;
    const log = $("#alog-log"), prog = $("#alog-prog");
    log.hidden = false; prog.hidden = false; log.textContent = ""; prog.max = todo.length; prog.value = 0;
    for (const b of ["#alog-kirim", "#alog-cek"]) $(b).disabled = true;
    $("#alog-stop").disabled = false;
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
      prog.value++;
      await sleep(1500);
    }
    log.textContent += `\nSelesai: ${ok}/${todo.length} tersimpan. Halaman akan di-refresh…`;
    $("#alog-stop").disabled = true;
    sessionStorage.setItem(STORE + "-open", "1");
    setTimeout(() => location.reload(), 2500);
  }

  $("#alog-btn").onclick = () => panel.classList.toggle("open");
  $("#alog-x").onclick = () => panel.classList.remove("open");
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
