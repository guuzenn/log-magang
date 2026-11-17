# Logmager

**Biar magang nggak bikin mager ngisi logbook.**

Isi puluhan Log Aktivitas Kampus Merdeka/magang di Student Portal IPB sekaligus dari spreadsheet. Kamu tidak perlu lagi
input satu per satu. Jam, jenis kegiatan, dosen, tipe, dan lokasi diisi sekali. Setelah itu kamu cukup
paste **tanggal + kegiatan** dari spreadsheet dan memilih **folder bukti**.

https://github.com/user-attachments/assets/489b420d-be52-410d-804c-8ee54ea06e03

> Tool tidak resmi dan tidak berafiliasi dengan IPB. Tool ini berjalan di tab yang sudah kamu login-kan,
> tidak pernah meminta atau menyimpan password, dan hanya berkomunikasi dengan `studentportal.ipb.ac.id`.
> Isi log tetap tanggung jawabmu, jadi tulis sesuai kegiatan asli.

Ada tiga cara pakai:

| | Opsi 1: Extension Chrome | Opsi 2: Userscript | Opsi 3: Python CLI |
|---|---|---|---|
| Status | Segera di Chrome Web Store | **Disarankan saat ini** | Tersedia |
| Install | Satu klik dari Chrome Web Store | Ekstensi Tampermonkey | Python + Playwright |
| Browser | Chrome, Edge | Chrome, Edge, Firefox | Chrome (dibuka otomatis) |
| Input data | Paste dari spreadsheet | Paste dari spreadsheet | File `.xlsx` atau `log.csv` |
| Cocok untuk | Semua orang | Semua orang, termasuk pengguna Firefox | Yang nyaman pakai terminal |

Opsi 1 dan 2 memakai panel yang sama persis, jadi pilih salah satu saja.

---

## Opsi 1: Extension Chrome

Sedang direview di Chrome Web Store. Setelah terbit, cukup klik **Add to Chrome**, tanpa perlu Tampermonkey.
Sambil menunggu, pakai [Opsi 2](#opsi-2-userscript-tampermonkey).

<details>
<summary>Tidak mau menunggu? Pasang manual dari file ZIP</summary>

1. Unduh `logmager-extension-<versi>.zip` dari [rilis terbaru](https://github.com/guuzenn/logmager/releases/latest), lalu klik kanan → **Extract All**.
2. Buka `chrome://extensions`, lalu nyalakan **Developer mode** di kanan atas.
3. Klik **Load unpacked**, lalu pilih folder hasil extract (yang berisi `manifest.json`).

Cara ini tidak ter-update otomatis. Ulangi langkah di atas setiap ada rilis baru, atau pindah ke versi Chrome Web Store setelah terbit.
</details>

Setelah terpasang, lanjut ke [Cara pakai panel](#cara-pakai-panel).

## Opsi 2: Userscript (Tampermonkey)

1. Install ekstensi **[Tampermonkey](https://www.tampermonkey.net/)** di Chrome, Edge, atau Firefox.
   Di Chrome/Edge, ada satu langkah tambahan supaya script bisa jalan:
   - Buka `chrome://extensions`, cari **Tampermonkey**, lalu klik **Details**.
   - Nyalakan **Allow User Scripts**.
   - Kalau opsi itu tidak muncul (versi Chrome lama), nyalakan **Developer mode** di kanan atas halaman `chrome://extensions`.
2. Klik **[Install Logmager](https://github.com/guuzenn/logmager/releases/latest/download/auto-log-ipb.user.js)**, lalu klik **Install** di Tampermonkey.
   Script akan otomatis ter-update setiap kali ada rilis baru.

Jangan pasang userscript dan extension bersamaan. Kalau terlanjur, panelnya tetap hanya muncul satu.

## Cara pakai panel

Berlaku untuk Opsi 1 dan 2.

1. Buka Student Portal, lalu menu **Kemahasiswaan → Aktivitas → Log Aktivitas**. Tombol **⚡ Logmager** muncul di kanan bawah.
2. Di panel yang terbuka:
   0. **Persiapan (sekali di awal):** isi tanggal mulai, tanggal selesai, dan hari kerja. Logmager menyiapkan:
      - Folder `bukti/` dengan subfolder untuk setiap hari kerja (`bukti/2026-07-13/` dan seterusnya).
      - `template-log-magang.xlsx` dengan kolom *Tanggal* (bertipe tanggal) dan *Kegiatan*. Tanggalnya sudah terisi, tinggal tulis kegiatan tiap hari di Excel atau Google Sheets.

      Ada dua cara:
      - **📁 Buat folder persiapan** (Chrome/Edge): pilih sebuah **subfolder**, lalu klik **Allow** saat browser minta izin.
        Chrome tidak mengizinkan memilih folder Documents, Desktop, atau Downloads itu sendiri ("berisi file sistem"),
        jadi buat dulu folder baru di dalamnya lewat tombol **New folder** di jendela pilih folder, misalnya `Documents\Magang`.
        Semuanya langsung dibuat di `persiapan-log-magang-<tanggal mulai>/`. Aman diklik ulang: foto bukti dan template yang sudah diisi tidak ditimpa.
        Kalau tetap gagal, Logmager otomatis menawarkan unduh .zip.
      - **Unduh sebagai .zip** (semua browser, termasuk Firefox): klik kanan file ZIP, pilih **Extract All**, lalu taruh hasilnya di mana saja.
        Pastikan benar-benar di-extract. Folder di dalam ZIP yang belum di-extract tidak bisa dipilih di langkah 3.
   1. **Pengaturan default:** jam, jenis kegiatan, tipe, lokasi, dan dosen. Semuanya tersimpan otomatis di browser.
   2. **Paste data:** blok kolom *Tanggal* dan *Kegiatan* di Excel/Google Sheets, Ctrl+C, lalu Ctrl+V.
      Format tanggal yang dikenali antara lain `2026-08-11`, `11/08/2026`, `11 Agustus 2026`, dan format US `8/11/2026`
      (terdeteksi otomatis kalau ada tanggal seperti `8/19/2026`). Baris yang tanggalnya tidak terbaca ditandai **Error**, tidak dilewati diam-diam.
   3. **Pilih bukti:** pilih folder `bukti/` yang berisi subfolder per tanggal, atau file yang namanya diawali tanggal.
   4. **🔍 Cek data**, lalu **🚀 Kirim**.

### Struktur folder bukti
```
bukti/
├── 2026-08-11/
│   ├── standup.jpg
│   └── commit.png        <- beberapa foto otomatis digabung jadi 1 gambar
├── 2026-08-12/
│   └── laporan.pdf       <- 1 PDF dipakai apa adanya
└── 2026-08-13.jpg        <- atau cukup file bernama tanggal
```

Tanggal yang sudah ada di portal otomatis dilewati, jadi aman dipakai berkali-kali sambil mencicil.

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

Catatan: portal hanya mengizinkan satu sesi login aktif. Login di browser lain akan memutus sesi script.

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
