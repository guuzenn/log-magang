<img src="extension/icons/logo.svg" width="88" alt="Logo Logmager">

# Logmager

**Biar magang nggak bikin mager ngisi logbook.**

Isi puluhan Log Aktivitas Kampus Merdeka/magang di Student Portal IPB sekaligus dari spreadsheet. Kamu tidak perlu lagi
input satu per satu. Jam, jenis kegiatan, dosen, tipe, dan lokasi diisi sekali. Setelah itu kamu cukup
paste **tanggal + kegiatan** dari spreadsheet dan memilih **folder bukti**.

https://github.com/user-attachments/assets/40432ff5-5cde-4f5c-9bbf-081febb8192a

**[➜ Pasang dari Chrome Web Store](https://chromewebstore.google.com/detail/gjhmgccpfhjdnomfgmpolaokeohbolgm)** · gratis · Chrome & Edge

> Tool tidak resmi dan tidak berafiliasi dengan IPB. Tool ini berjalan di tab yang sudah kamu login-kan,
> tidak pernah meminta atau menyimpan password, dan hanya berkomunikasi dengan `studentportal.ipb.ac.id`.
> Isi log tetap tanggung jawabmu, jadi tulis sesuai kegiatan asli.

Ada tiga cara pakai:

| | Opsi 1: Extension Chrome | Opsi 2: Userscript | Opsi 3: Python CLI |
|---|---|---|---|
| Status | **Disarankan** | Tersedia | Tersedia |
| Install | Satu klik dari Chrome Web Store | Ekstensi Tampermonkey | Python + Playwright |
| Browser | Chrome, Edge | Chrome, Edge, Firefox | Chrome (dibuka otomatis) |
| Input data | Paste dari spreadsheet | Paste dari spreadsheet | File `.xlsx` atau `log.csv` |
| Cocok untuk | Semua orang | Pengguna Firefox | Yang nyaman pakai terminal |

Opsi 1 dan 2 memakai panel yang sama persis, jadi pilih salah satu saja.

---

## Opsi 1: Extension Chrome

### **[➜ Pasang Logmager dari Chrome Web Store](https://chromewebstore.google.com/detail/gjhmgccpfhjdnomfgmpolaokeohbolgm)**

Klik **Add to Chrome**, lalu **Add extension**. Selesai, tanpa Tampermonkey dan tanpa pengaturan tambahan.
Extension ter-update otomatis setiap ada versi baru. Bisa juga dipasang di **Edge** dari halaman yang sama
(klik **Allow extensions from other stores** kalau Edge memintanya).

Sudah pernah pasang userscript (Opsi 2)? Matikan atau hapus dulu di Tampermonkey supaya tidak dobel.
Pengaturanmu tetap ada, karena keduanya membaca data yang sama di browser.

<details>
<summary>Pasang manual dari file ZIP (tanpa Chrome Web Store)</summary>

1. Unduh `logmager-extension-<versi>.zip` dari [rilis terbaru](https://github.com/guuzenn/logmager/releases/latest), lalu klik kanan → **Extract All**.
2. Buka `chrome://extensions`, lalu nyalakan **Developer mode** di kanan atas.
3. Klik **Load unpacked**, lalu pilih folder hasil extract (yang berisi `manifest.json`).

Cara ini tidak ter-update otomatis. Ulangi langkah di atas setiap ada rilis baru.
</details>

Setelah terpasang, lanjut ke [Cara pakai panel](#cara-pakai-panel).

## Opsi 2: Userscript (Tampermonkey)

Pilih ini kalau kamu pakai **Firefox**, atau tidak bisa memasang dari Chrome Web Store.

1. Install ekstensi **[Tampermonkey](https://www.tampermonkey.net/)** di Chrome, Edge, atau Firefox.
   Di Chrome/Edge, ada satu langkah tambahan supaya script bisa jalan:
   - Buka `chrome://extensions`, cari **Tampermonkey**, lalu klik **Details**.
   - Nyalakan **Allow User Scripts**.
   - Kalau opsi itu tidak muncul (versi Chrome lama), nyalakan **Developer mode** di kanan atas halaman `chrome://extensions`.
2. Klik **[Install Logmager](https://github.com/guuzenn/logmager/releases/latest/download/auto-log-ipb.user.js)**, lalu klik **Install** di Tampermonkey.
   Script akan otomatis ter-update setiap kali ada rilis baru.

Jangan pasang userscript dan extension bersamaan. Kalau terlanjur, panelnya tetap hanya muncul satu.

## Cara pakai panel

Berlaku untuk Opsi 1 dan 2. Buka Student Portal → **Kemahasiswaan → Aktivitas → Log Aktivitas**, lalu klik tombol **Logmager** di kanan bawah.

**Sekali di awal magang**
1. **Persiapan:** isi tanggal mulai, selesai, dan hari kerja, lalu klik **Buat folder persiapan**.
   Pilih folder baru, misalnya `Documents\Magang` (Documents/Desktop/Downloads langsung tidak bisa dipilih Chrome).
   Hasilnya `persiapan-log-magang-<tanggal>/` berisi `template-log-magang.xlsx` dan `bukti/<tanggal>/`.
   Di Firefox, atau kalau gagal: pakai **Unduh .zip** lalu **Extract All**.
2. **Pengaturan:** jam, jenis kegiatan, tipe, lokasi, dan dosen. Tersimpan otomatis.

**Tiap minggu**
1. Isi kolom **Kegiatan** di `template-log-magang.xlsx`, lalu **Save**. Taruh foto di `bukti/<tanggal>/`.
2. Di panel, klik **Pilih folder persiapan** dan pilih folder tadi. Kalau browser bertanya "Upload … files?", klik **Upload**:
   file hanya dibaca di browser, tidak dikirim ke mana-mana. Excel + bukti dibaca, lalu langsung dicek.
   Opsional (Chrome/Edge): klik **Ingat folder ini** sekali, minggu depan cukup **Pakai folder terakhir**.
3. Klik **Kirim**.

Tanggal yang sudah ada di portal otomatis dilewati, jadi aman dipakai berkali-kali sambil mencicil.

<details>
<summary>Detail: format tanggal, bukti, dan cara lain</summary>

- **Cara lain (Google Sheets / spreadsheet sendiri):** buka **Pakai cara lain** di panel, paste kolom *Tanggal* + *Kegiatan*,
  lalu pilih folder `bukti/`. File `.csv` di folder persiapan juga bisa dibaca.
- **Format tanggal:** `2026-08-11`, `11/08/2026`, `11 Agustus 2026`, kolom bertipe tanggal di Excel, dan format US `8/11/2026`
  (terdeteksi otomatis kalau ada tanggal seperti `8/19/2026`). Tanggal yang tidak terbaca ditandai **Error**.
- **Bukti:** JPG/PNG (beberapa foto otomatis digabung jadi 1 gambar) atau 1 PDF per tanggal. Foto iPhone (HEIC) kadang tidak bisa
  dibuka Chrome; ubah ke JPG atau setel iPhone ke *Settings → Camera → Formats → Most Compatible*.

```
persiapan-log-magang-2026-08-03/
├── template-log-magang.xlsx
└── bukti/
    ├── 2026-08-11/
    │   ├── standup.jpg
    │   └── commit.png      <- beberapa foto digabung jadi 1 gambar
    ├── 2026-08-12/
    │   └── laporan.pdf     <- 1 PDF dipakai apa adanya
    └── 2026-08-13.jpg      <- atau cukup file bernama tanggal
```
</details>

---

## Opsi 3: Python CLI

Butuh Python 3.10+ dan Google Chrome.
```bash
pip install -r requirements.txt
```
Kalau tidak punya Chrome, jalankan juga `python -m playwright install chromium`.

> **Windows:** kalau `python` atau `pip` tidak dikenali, pakai `py`, misalnya `py -m pip install -r requirements.txt`
> dan `py main.py init`.

1. Copy `config.example.yaml` jadi `config.yaml`, lalu isi URL halaman log, tanggal magang, dan nilai default.
2. Jalankan `python main.py init`. Perintah ini membuat `log.csv` berisi semua hari kerja dan folder `bukti/YYYY-MM-DD/`.
3. Isi kolom `keterangan` di `log.csv`. Kolom lain boleh dikosongkan supaya memakai default.
   **Sudah punya spreadsheet?** Lewati `log.csv`: isi `file_log: Logbook.xlsx` dan `sheet: NamaSheet` di `config.yaml`.
   Script otomatis mencari kolom *Tanggal* dan *Kegiatan/Keterangan/Aktivitas*.
   Format tanggal yang dikenali antara lain `2026-08-11`, `11/08/2026`, dan `Senin, 11 Agustus 2026`, termasuk template dari paket persiapan dan format US `8/19/2026` (terdeteksi otomatis).
4. Jalankan `python main.py cek` untuk melihat entri mana yang sudah siap.
5. Jalankan `python main.py run --dry-run`. Browser akan terbuka, lalu kamu login dan melihat form yang terisi tanpa disimpan.
6. Jalankan `python main.py run`. Opsi tambahan: `--limit 5` dan `--tanggal 2026-07-14`.

Catatan:
- Foto iPhone (HEIC) didukung dan otomatis dikonversi (butuh `pillow-heif`, sudah ada di `requirements.txt`).
- Tanggal yang muncul dua kali di data ditolak supaya tidak terkirim dobel.
- Portal hanya mengizinkan satu sesi login aktif. Login di browser lain akan memutus sesi script.

## Privasi
`config.yaml`, `log.csv`, `bukti/`, dan `.browser-profile/` (session login) sudah masuk `.gitignore`.
Pengaturan extension/userscript tersimpan di `localStorage` browser kamu sendiri. Detailnya ada di [PRIVACY.md](PRIVACY.md).

## Untuk developer: build extension
Extension dibangun dari userscript yang sama (Manifest V3), jadi cukup ubah `auto-log-ipb.user.js`.
```bash
node tools/build-extension.mjs
```
Hasilnya `dist/extension/` (untuk **Load unpacked**) dan `dist/logmager-extension-<versi>.zip` (untuk Chrome Web Store dan lampiran rilis).
Versinya otomatis mengikuti `@version` di userscript.
