"""
Auto-isi Log Aktivitas Kampus Merdeka (Student Portal IPB).

  py main.py init               -> buat log.csv (semua hari kerja) + folder bukti/<tanggal>/
  py main.py cek                -> cek kesiapan data (tanpa buka browser)
  py main.py run --dry-run      -> isi form 1 entri tanpa klik Simpan, untuk dicek
  py main.py run                -> isi & simpan semua entri yang siap

Tool tidak resmi. Kamu login sendiri di jendela browser; script tidak pernah menyimpan password.
"""
import argparse
import csv
import datetime as dt
import io
import re
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).parent
PROFILE_DIR = ROOT / ".browser-profile"   # session login disimpan di sini (jangan di-commit)
HEIC_EXT = {".heic", ".heif"}  # foto iPhone; dikonversi lewat pillow-heif
IMG_EXT = {".jpg", ".jpeg", ".png"} | HEIC_EXT
OK_EXT = IMG_EXT | {".pdf"}


def heic_ready():
    """Aktifkan pembaca HEIC untuk Pillow. False kalau pillow-heif belum terpasang."""
    try:
        from pillow_heif import register_heif_opener
    except ImportError:
        return False
    register_heif_opener()
    return True
HARI = ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu"]
BULAN = ["januari", "februari", "maret", "april", "mei", "juni", "juli",
         "agustus", "september", "oktober", "november", "desember"]
JENIS = {  # value <select> di form portal
    "berita acara pembimbingan": "1",
    "berita acara ujian": "2",
    "berita acara kegiatan": "3",
}
TIPE = {"hybrid": "", "offline": "true", "online": "false"}  # radio IsLuring


# ---------------------------------------------------------------- data lokal
def load_config():
    path = ROOT / "config.yaml"
    if not path.exists():
        sys.exit("config.yaml belum ada. Copy config.example.yaml -> config.yaml lalu isi.")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


BULAN_ALIAS = {
    **{b: i + 1 for i, b in enumerate(BULAN)},
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "agu": 8, "agt": 8, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "okt": 10, "oct": 10, "october": 10, "nov": 11, "des": 12, "dec": 12, "december": 12,
}
OVERRIDE_COLS = ("jam_mulai", "jam_selesai", "jenis_kegiatan", "tipe", "lokasi")


NUM_DATE = re.compile(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})")


def numeric_order(values):
    """8/7/2026 bisa 8 Juli (Indonesia) atau 7 Agustus (Excel format US). Kalau ada angka kedua > 12
    (mis. 8/19/2026), seluruh data dibaca bulan/hari/tahun. Tanpa petunjuk: hari/bulan/tahun."""
    dmy = mdy = False
    for v in values:
        if isinstance(v, (dt.date, dt.datetime)):
            continue
        if m := NUM_DATE.match(str(v).strip()):
            x, y = int(m.group(1)), int(m.group(2))
            dmy |= x > 12 and y <= 12  # hanya masuk akal sebagai hari/bulan
            mdy |= y > 12 and x <= 12  # hanya masuk akal sebagai bulan/hari (typo seperti 31/31 diabaikan)
    return "mdy" if mdy and not dmy else "dmy"


def parse_date(s, order="dmy"):
    """Terima date/datetime (dari Excel), 2026-08-11, 11/08/2026, '11 Agustus 2026', 'Senin, 11 Agustus 2026',
    'August 11, 2026'. Format angka dibaca hari/bulan/tahun, atau bulan/hari/tahun kalau order="mdy"."""
    if isinstance(s, dt.datetime):
        return s.date()
    if isinstance(s, dt.date):
        return s
    t = str(s).strip().lower()
    if m := re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", t):
        y, mo, d = m.groups()
    elif m := NUM_DATE.match(t):
        d, mo, y = m.groups()
        if order == "mdy":
            d, mo = mo, d
    elif (m := re.search(r"(\d{1,2})[\s\-]+([a-z]+)[\s\-,]+(\d{4})", t)) and m.group(2) in BULAN_ALIAS:
        d, mo, y = m.group(1), BULAN_ALIAS[m.group(2)], m.group(3)
    elif (m := re.search(r"([a-z]+)\s+(\d{1,2}),?\s+(\d{4})", t)) and m.group(1) in BULAN_ALIAS:
        mo, d, y = BULAN_ALIAS[m.group(1)], m.group(2), m.group(3)
    else:
        raise ValueError(f"Format tanggal tidak dikenali: {s!r}")
    try:
        return dt.date(int(y), int(mo), int(d))
    except ValueError:
        raise ValueError(f"Tanggal tidak valid: {s!r}") from None


def cell_str(v):
    if v is None:
        return ""
    if isinstance(v, dt.time):
        return v.strftime("%H:%M")
    return str(v).strip()


def _rows_csv(path):
    text = path.read_text(encoding="utf-8-sig")
    first = text.splitlines()[0] if text else ""
    delim = ";" if first.count(";") > first.count(",") else ","
    for i, r in enumerate(csv.DictReader(io.StringIO(text, newline=""), delimiter=delim), start=2):
        yield i, {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}


def _rows_xlsx(path, sheet):
    """Cari baris judul yang punya kolom 'Tanggal'; kolom keterangan = 'Keterangan'/'Aktivitas'/'Report'."""
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if sheet and sheet not in wb.sheetnames:
        sys.exit(f"Sheet {sheet!r} tidak ada di {path.name}. Pilihan: {', '.join(wb.sheetnames)}")
    ws = wb[sheet] if sheet else wb.active
    rows = ws.iter_rows(values_only=True)
    cols = None
    for i, row in enumerate(rows, start=1):
        if cols is None:
            heads = [cell_str(c).lower() for c in row]
            if not any(h.startswith("tanggal") for h in heads):
                if i > 30:
                    break
                continue
            cols = {}
            for j, h in enumerate(heads):
                key = h.replace(" ", "_")
                if key in OVERRIDE_COLS:
                    cols[j] = key
                elif h.startswith("tanggal") and "tanggal" not in cols.values():
                    cols[j] = "tanggal"
                elif "keterangan" not in cols.values() and re.search(r"keterangan|aktivitas|report|kegiatan", h):
                    cols[j] = "keterangan"
            continue
        r = {name: row[j] if j < len(row) else None for j, name in cols.items()}
        yield i, {k: (v if k == "tanggal" else cell_str(v)) for k, v in r.items()}
    if cols is None:
        sys.exit(f"Tidak menemukan baris judul berisi kolom 'Tanggal' di sheet {ws.title!r}.")


def read_rows(cfg):
    path = ROOT / cfg.get("file_log", "log.csv")
    if not path.exists():
        sys.exit(f"{path.name} belum ada. Jalankan: py main.py init")
    source = _rows_xlsx(path, cfg.get("sheet")) if path.suffix.lower() in (".xlsx", ".xlsm") else _rows_csv(path)
    default = cfg.get("default", {})
    dosen = default.get("dosen", "semua")
    if isinstance(dosen, str) and dosen.strip().lower() != "semua":
        dosen = [dosen]  # satu nama ditulis tanpa [ ]
    if isinstance(dosen, list):
        dosen = [str(n).strip() for n in dosen if str(n).strip()]  # list kosong -> ditolak di check_row
    else:
        dosen = "semua"
    rows = []
    seen = {}  # tanggal -> nomor baris, untuk menolak tanggal dobel
    source = list(source)
    order = numeric_order(r.get("tanggal") for _, r in source if r.get("tanggal"))
    if order == "mdy":
        print(f"Catatan: tanggal angka di {path.name} dibaca sebagai bulan/hari/tahun (format US).")
    for i, r in source:
        if not r.get("tanggal"):
            continue
        try:
            tgl = parse_date(r["tanggal"], order)
        except ValueError as e:
            if not r.get("keterangan"):
                continue  # baris catatan/kosong di spreadsheet
            sys.exit(f"{path.name} baris {i}: {e}")
        r["keterangan"] = "\n".join(l.strip() for l in (r.get("keterangan") or "").splitlines() if l.strip())
        if r["keterangan"]:
            if tgl in seen:
                # Kalau dibiarkan, dua-duanya terkirim dan portal berisi log dobel.
                sys.exit(f"{path.name} baris {i}: tanggal {tgl.isoformat()} dobel (sudah ada di baris {seen[tgl]}). "
                         "Gabungkan atau hapus salah satu.")
            seen[tgl] = i
        get = lambda k: r.get(k) or str(default.get(k, "") or "")
        rows.append({
            "tanggal": tgl,
            "keterangan": r.get("keterangan", ""),
            "jam_mulai": get("jam_mulai"),
            "jam_selesai": get("jam_selesai"),
            "jenis_kegiatan": get("jenis_kegiatan"),
            "tipe": get("tipe").lower(),
            "lokasi": get("lokasi"),
            "dosen": dosen,
        })
    return rows


def find_bukti(cfg, tgl):
    """Ambil isi bukti/<YYYY-MM-DD>/. 1 file -> dipakai langsung, banyak gambar -> digabung jadi 1 PDF."""
    folder = ROOT / cfg.get("folder_bukti", "bukti") / tgl.isoformat()
    if not folder.is_dir():
        return None, "folder bukti tidak ada"
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in OK_EXT)
    if not files:
        return None, "folder bukti kosong"
    if any(p.suffix.lower() in HEIC_EXT for p in files) and not heic_ready():
        return None, "ada foto HEIC; pasang dulu: py -m pip install pillow-heif"
    if len(files) == 1 and files[0].suffix.lower() not in HEIC_EXT:
        return files[0], None  # HEIC tetap lewat merge_images supaya jadi format yang diterima portal
    imgs = [p for p in files if p.suffix.lower() in IMG_EXT]
    if len(imgs) != len(files):
        return None, "isi folder campur PDF + file lain; sisakan 1 PDF atau gambar saja"
    return imgs, None  # digabung saat upload


def merge_images(paths, tgl):
    from PIL import Image
    heic_ready()
    pages = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.thumbnail((1600, 1600))
        pages.append(im)
    out = Path(tempfile.gettempdir()) / f"bukti-{tgl.isoformat()}.pdf"
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=100)
    return out


def check_row(cfg, row):
    problems = []
    if not row["keterangan"]:
        problems.append("keterangan kosong")
    if row["jenis_kegiatan"].lower() not in JENIS:
        problems.append(f"jenis_kegiatan tidak dikenal: {row['jenis_kegiatan']!r}")
    if row["tipe"] not in TIPE:
        problems.append(f"tipe harus hybrid/offline/online, bukan {row['tipe']!r}")
    for k in ("jam_mulai", "jam_selesai"):
        if not re.fullmatch(r"\d{2}:\d{2}", row[k]):
            problems.append(f"{k} harus format HH:MM")
    if not row["lokasi"]:
        problems.append("lokasi kosong")
    if row["dosen"] != "semua" and not row["dosen"]:
        problems.append('dosen kosong: isi "semua" atau minimal satu nama di config.yaml')
    bukti, err = find_bukti(cfg, row["tanggal"])
    if err:
        problems.append(err)
    return bukti, problems


# ---------------------------------------------------------------- perintah
def cmd_init(cfg, args):
    start, end = parse_date(cfg["tanggal_mulai"]), parse_date(cfg["tanggal_selesai"])
    hari_kerja = {HARI.index(h.lower()) for h in cfg.get("hari_kerja", HARI[:5])}
    days = [start + dt.timedelta(n) for n in range((end - start).days + 1)]
    days = [d for d in days if d.weekday() in hari_kerja]

    log = ROOT / cfg.get("file_log", "log.csv")
    if log.suffix.lower() != ".csv":
        print(f"file_log memakai {log.name}; log.csv tidak dibuat (data dibaca langsung dari spreadsheet).")
    elif log.exists() and not args.force:
        print(f"{log.name} sudah ada, tidak ditimpa (pakai --force untuk menimpa).")
    else:
        with log.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["tanggal", "keterangan", "jam_mulai", "jam_selesai", "tipe", "lokasi"])
            for d in days:
                w.writerow([d.isoformat(), "", "", "", "", ""])
        print(f"{log.name} dibuat: {len(days)} hari kerja ({start} s.d. {end}).")
        print("  Isi kolom 'keterangan'. Kolom lain kosongkan kalau sama dengan default di config.yaml.")

    bukti = ROOT / cfg.get("folder_bukti", "bukti")
    for d in days:
        (bukti / d.isoformat()).mkdir(parents=True, exist_ok=True)
    print(f"Folder {bukti.name}/<tanggal>/ disiapkan untuk {len(days)} hari. Taruh foto/PDF bukti di sana.")


def cmd_cek(cfg, args):
    rows = read_rows(cfg)
    ready = 0
    for row in rows:
        _, problems = check_row(cfg, row)
        if problems:
            if row["keterangan"] or args.verbose:
                print(f"  [-] {row['tanggal']}: {', '.join(problems)}")
        else:
            ready += 1
    skipped = sum(1 for r in rows if not r["keterangan"])
    print(f"\n{ready} siap, {len(rows) - ready} belum ({skipped} karena keterangan kosong, tidak ditampilkan"
          f"{'' if args.verbose else '; pakai -v untuk lihat'}).")


def existing_dates(page):
    return dates_from_texts(page.eval_on_selector_all(
        "table tbody tr td:nth-child(2)", "els => els.map(e => e.textContent)"))


def dates_from_texts(texts):
    found = set()
    for t in texts:
        m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", t)
        if m and m.group(2).lower() in BULAN:
            found.add(dt.date(int(m.group(3)), BULAN.index(m.group(2).lower()) + 1, int(m.group(1))))
    return found


def wait_for_login(page, url):
    page.goto(url)
    if "LogAktivitasKampusMerdeka" not in page.url:
        try:  # beri waktu kalau portal login otomatis (SSO masih aktif)
            page.wait_for_url("**/LogAktivitasKampusMerdeka/Index/**", timeout=8_000)
        except Exception:
            print(">> Silakan login di jendela browser yang terbuka. Script menunggu (maks 5 menit)...")
            page.wait_for_url("**/LogAktivitasKampusMerdeka/Index/**", timeout=300_000)
        if page.url.rstrip("/") != url.rstrip("/"):
            page.goto(url)
    page.wait_for_selector("text=Tambah")


def fill_form(page, row, file_path):
    page.click("a:has-text('Tambah')")
    page.wait_for_selector("#main_form #Waktu", state="visible")
    jenis = JENIS[row["jenis_kegiatan"].lower()]
    page.evaluate(
        """([tgl, mulai, selesai, jenis]) => {
            document.querySelector('#Waktu').value = tgl;
            document.querySelector('#Tmw').value = mulai;
            document.querySelector('#Tsw').value = selesai;
            $('#JenisLogbookKegiatanKampusMerdekaId').val(jenis).trigger('change');
        }""",
        [row["tanggal"].strftime("%d/%m/%Y"), row["jam_mulai"], row["jam_selesai"], jenis],
    )
    # dosen penggerak
    boxes = page.query_selector_all("#main_form input[type=checkbox][name^='ListDosenPembimbing']")
    wanted = row["dosen"]
    for box in boxes:
        label = box.evaluate("e => (e.closest('.form-check, div') || e.parentElement).textContent")
        if wanted == "semua" or any(n.lower() in label.lower() for n in wanted):
            box.check()
    page.check(f"#main_form input[name=IsLuring][value='{TIPE[row['tipe']]}']")
    page.fill("#main_form #Lokasi", row["lokasi"])
    page.fill("#main_form #Keterangan", row["keterangan"])
    page.set_input_files("#main_form #File", str(file_path))


class SesiHabis(Exception):
    pass


# Dijalankan di dalam halaman portal yang sudah login: ambil form Tambah, isi, POST (seperti tombol Simpan),
# lalu ambil ulang tabel log untuk memastikan tanggalnya benar-benar tersimpan.
SUBMIT_JS = """
async (a) => {
  const get = async (u) => {
    const r = await fetch(u, { credentials: 'same-origin' });
    if (r.url.includes('/Account/Login')) throw new Error('SESI_HABIS');
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  };
  const doc = await get(a.tambahUrl);
  const form = doc.querySelector('#main_form');
  if (!form) throw new Error('form Tambah tidak ditemukan');
  const set = { Waktu: a.waktu, Tmw: a.mulai, Tsw: a.selesai, JenisLogbookKegiatanKampusMerdekaId: a.jenis,
                Lokasi: a.lokasi, Keterangan: a.ket };
  const fd = new FormData();
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'submit') continue;
    if (el.type === 'checkbox') {
      const label = (el.closest('.form-check, div') || el.parentElement).textContent.toLowerCase();
      if (a.dosen === null || a.dosen.some((n) => label.includes(n))) fd.append(el.name, el.value);
      continue;
    }
    if (el.type === 'radio') {
      if (el.name === 'IsLuring' && el.value === a.tipe) fd.append(el.name, el.value);
      continue;
    }
    fd.append(el.name, el.name in set ? set[el.name] : el.value);
  }
  const bytes = Uint8Array.from(atob(a.file.b64), (c) => c.charCodeAt(0));
  fd.append('File', new Blob([bytes], { type: a.file.type }), a.file.name);
  const res = await fetch(form.getAttribute('action'), { method: 'POST', body: fd, credentials: 'same-origin',
                                                          headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (res.url.includes('/Account/Login')) throw new Error('SESI_HABIS');
  let msg = null;
  try {
    const j = JSON.parse((await res.text()).replace(/^<textarea>|<\\/textarea>$/g, ''));
    if (!j.status) msg = j.message || 'ditolak server';
  } catch (_) { /* respon HTML: tentukan dari tabel */ }
  const list = await get(a.listUrl);
  return { msg, texts: [...list.querySelectorAll('table tbody tr td:nth-child(2)')].map((e) => e.textContent) };
}
"""
MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def tambah_url(page):
    onclick = page.get_attribute("a:has-text('Tambah')", "onclick") or ""
    m = re.search(r"OpenModal\('([^']+)'", onclick)
    if not m:
        raise RuntimeError("tombol Tambah tidak ditemukan di halaman log")
    return m.group(1)


def submit_fast(page, row, file_path, list_url, add_url):
    """Kirim 1 log tanpa membuka modal. Return (sukses, pesan)."""
    import base64
    dosen = row["dosen"]
    try:
        res = page.evaluate(SUBMIT_JS, {
            "tambahUrl": add_url, "listUrl": list_url,
            "waktu": row["tanggal"].strftime("%d/%m/%Y"), "mulai": row["jam_mulai"], "selesai": row["jam_selesai"],
            "jenis": JENIS[row["jenis_kegiatan"].lower()], "tipe": TIPE[row["tipe"]],
            "lokasi": row["lokasi"], "ket": row["keterangan"],
            "dosen": None if dosen == "semua" else [n.lower() for n in dosen],
            "file": {"b64": base64.b64encode(Path(file_path).read_bytes()).decode(),
                     "type": MIME.get(Path(file_path).suffix.lower(), "application/octet-stream"),
                     "name": Path(file_path).name},
        })
    except Exception as e:
        if "SESI_HABIS" in str(e):
            raise SesiHabis() from None
        raise
    if row["tanggal"] in dates_from_texts(res["texts"]):
        return True, "tersimpan"
    return False, res["msg"] or "tidak muncul di tabel portal setelah disimpan"


def cmd_run(cfg, args):
    from playwright.sync_api import sync_playwright

    rows = read_rows(cfg)
    if args.tanggal:
        only = {parse_date(t) for t in args.tanggal}
        rows = [r for r in rows if r["tanggal"] in only]
    todo = []
    for row in rows:
        if not row["keterangan"]:
            continue
        bukti, problems = check_row(cfg, row)
        if problems:
            print(f"  [skip] {row['tanggal']}: {', '.join(problems)}")
        else:
            todo.append((row, bukti))
    if not todo:
        sys.exit("Tidak ada entri yang siap. Cek dengan: py main.py cek")

    with sync_playwright() as p:
        launch = dict(headless=False, viewport={"width": 1300, "height": 900})
        try:
            ctx = p.chromium.launch_persistent_context(str(PROFILE_DIR), channel="chrome", **launch)
        except Exception:
            ctx = p.chromium.launch_persistent_context(str(PROFILE_DIR), **launch)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", lambda d: d.dismiss())
        wait_for_login(page, cfg["url_log"])

        done = existing_dates(page)
        todo = [(r, b) for r, b in todo if r["tanggal"] not in done]
        if done:
            print(f"{len(done)} tanggal sudah ada di portal, dilewati.")
        if args.limit:
            todo = todo[:args.limit]
        if args.dry_run:
            todo = todo[:max(1, args.limit or 1)]
        print(f"Akan {'MENCOBA (dry-run)' if args.dry_run else 'MENYIMPAN'} {len(todo)} entri.\n")

        add_url = tambah_url(page)
        ok = 0
        for n, (row, bukti) in enumerate(todo, start=1):
            file_path = merge_images(bukti, row["tanggal"]) if isinstance(bukti, list) else bukti
            tag = f"[{n}/{len(todo)}] {row['tanggal'].isoformat()}"
            if args.dry_run:
                try:
                    fill_form(page, row, file_path)
                    input(f"  [dry-run] {tag} sudah diisi di browser. Cek, lalu tekan Enter (tidak disimpan)...")
                except Exception as e:
                    print(f"  [ERROR] {tag}: {e}")
                page.goto(cfg["url_log"])
                continue
            for attempt in (1, 2):
                try:
                    success, msg = submit_fast(page, row, file_path, cfg["url_log"], add_url)
                    print(f"  {'ok   ' if success else 'GAGAL'} {tag}: {msg}")
                    ok += success
                except SesiHabis:
                    if attempt == 1:
                        print("  !! Sesi login terputus (login di browser/perangkat lain?). Login ulang di jendela script.")
                        wait_for_login(page, cfg["url_log"])
                        add_url = tambah_url(page)
                        continue
                    print(f"  GAGAL {tag}: sesi login terputus lagi")
                except Exception as e:
                    print(f"  ERROR {tag}: {e}")
                break
            page.wait_for_timeout(int(cfg.get("jeda_detik", 1) * 1000))

        if not args.dry_run:
            print(f"\nSelesai: {ok}/{len(todo)} tersimpan.")
        ctx.close()


def main():
    ap = argparse.ArgumentParser(description="Auto-isi Log Aktivitas Kampus Merdeka (Student Portal IPB)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_init = sub.add_parser("init", help="buat log.csv + folder bukti dari rentang tanggal di config")
    p_init.add_argument("--force", action="store_true", help="timpa log.csv yang sudah ada")
    p_cek = sub.add_parser("cek", help="cek kesiapan data tanpa buka browser")
    p_cek.add_argument("-v", "--verbose", action="store_true")
    p_run = sub.add_parser("run", help="isi form di portal")
    p_run.add_argument("--dry-run", action="store_true", help="isi form tapi jangan klik Simpan")
    p_run.add_argument("--limit", type=int, help="maksimal jumlah entri yang diproses")
    p_run.add_argument("--tanggal", nargs="+", help="hanya tanggal tertentu, mis. 2026-07-14")
    args = ap.parse_args()
    cfg = load_config()
    {"init": cmd_init, "cek": cmd_cek, "run": cmd_run}[args.cmd](cfg, args)


if __name__ == "__main__":
    main()
