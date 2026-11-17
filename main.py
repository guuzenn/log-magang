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
import re
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).parent
PROFILE_DIR = ROOT / ".browser-profile"   # session login disimpan di sini (jangan di-commit)
IMG_EXT = {".jpg", ".jpeg", ".png"}
OK_EXT = IMG_EXT | {".pdf"}
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


def parse_date(s):
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Format tanggal tidak dikenali: {s!r} (pakai YYYY-MM-DD atau DD/MM/YYYY)")


def read_rows(cfg):
    path = ROOT / cfg.get("file_log", "log.csv")
    if not path.exists():
        sys.exit(f"{path.name} belum ada. Jalankan: py main.py init")
    text = path.read_text(encoding="utf-8-sig")
    delim = ";" if text.splitlines()[0].count(";") > text.splitlines()[0].count(",") else ","
    default = cfg.get("default", {})
    rows = []
    for i, r in enumerate(csv.DictReader(text.splitlines(), delimiter=delim), start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        if not r.get("tanggal"):
            continue
        try:
            tgl = parse_date(r["tanggal"])
        except ValueError as e:
            sys.exit(f"{path.name} baris {i}: {e}")
        get = lambda k: r.get(k) or str(default.get(k, "") or "")
        rows.append({
            "tanggal": tgl,
            "keterangan": r.get("keterangan", ""),
            "jam_mulai": get("jam_mulai"),
            "jam_selesai": get("jam_selesai"),
            "jenis_kegiatan": get("jenis_kegiatan"),
            "tipe": get("tipe").lower(),
            "lokasi": get("lokasi"),
            "dosen": default.get("dosen", "semua"),
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
    if len(files) == 1:
        return files[0], None
    imgs = [p for p in files if p.suffix.lower() in IMG_EXT]
    if len(imgs) != len(files):
        return None, "isi folder campur PDF + file lain; sisakan 1 PDF atau gambar saja"
    return imgs, None  # digabung saat upload


def merge_images(paths, tgl):
    from PIL import Image
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
    if log.exists() and not args.force:
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
    texts = page.eval_on_selector_all(
        "table tbody tr td:nth-child(2)", "els => els.map(e => e.textContent)")
    found = set()
    for t in texts:
        m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", t)
        if m and m.group(2).lower() in BULAN:
            found.add(dt.date(int(m.group(3)), BULAN.index(m.group(2).lower()) + 1, int(m.group(1))))
    return found


def wait_for_login(page, url):
    page.goto(url)
    if "/Account/Login" in page.url or "LogAktivitasKampusMerdeka" not in page.url:
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


def submit(page):
    with page.expect_response(lambda r: r.request.method == "POST" and "/LogAktivitasKampusMerdeka/Tambah" in r.url,
                              timeout=60_000) as resp_info:
        page.click("#main_form input[type=submit]")
    try:
        res = resp_info.value.json()
    except Exception:
        return False, f"respon bukan JSON (HTTP {resp_info.value.status})"
    if res.get("status"):
        page.wait_for_load_state("load")
        return True, res.get("message") or "tersimpan"
    return False, res.get("message") or "gagal tanpa pesan"


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

        ok = 0
        for row, bukti in todo:
            file_path = merge_images(bukti, row["tanggal"]) if isinstance(bukti, list) else bukti
            tag = row["tanggal"].isoformat()
            try:
                fill_form(page, row, file_path)
                if args.dry_run:
                    input(f"  [dry-run] {tag} sudah diisi di browser. Cek, lalu tekan Enter (tidak disimpan)...")
                    page.goto(cfg["url_log"])
                    continue
                success, msg = submit(page)
                print(f"  [{'ok' if success else 'GAGAL'}] {tag}: {msg}")
                ok += success
                if not success:
                    page.goto(cfg["url_log"])
            except Exception as e:
                print(f"  [ERROR] {tag}: {e}")
                page.goto(cfg["url_log"])
            page.wait_for_timeout(int(cfg.get("jeda_detik", 2) * 1000))

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
