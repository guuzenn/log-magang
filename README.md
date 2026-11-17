# Auto Log Aktivitas Kampus Merdeka (Student Portal IPB)

Isi puluhan Log Aktivitas Kampus Merdeka/magang di Student Portal IPB sekaligus. Kamu tidak perlu lagi
input satu per satu. Jam, jenis kegiatan, dosen, tipe, dan lokasi diisi sekali. Setelah itu kamu cukup
paste **tanggal + keterangan** dari spreadsheet dan memilih **folder bukti**.

> Tool tidak resmi dan tidak berafiliasi dengan IPB. Tool ini berjalan di tab yang sudah kamu login-kan,
> tidak pernah meminta atau menyimpan password, dan hanya berkomunikasi dengan `studentportal.ipb.ac.id`.
> Isi log tetap tanggung jawabmu, jadi tulis sesuai kegiatan asli.

Ada dua cara pakai:

| | Userscript (disarankan) | Python CLI |
|---|---|---|
| Install | Ekstensi Tampermonkey | Python + Playwright |
| Input data | Paste dari spreadsheet | File `log.csv` |
| Cocok untuk | Semua orang | Yang nyaman pakai terminal |

---

## Opsi 1: Userscript (paling gampang)

1. Install ekstensi **[Tampermonkey](https://www.tampermonkey.net/)** di Chrome, Edge, atau Firefox.
   Di Chrome/Edge, aktifkan juga **Developer mode** di halaman `chrome://extensions`. Tampermonkey mewajibkan ini.
2. Buka file [`auto-log-ipb.user.js`](auto-log-ipb.user.js), klik **Raw**, lalu klik **Install** di Tampermonkey.
3. Buka Student Portal, lalu menu **Kemahasiswaan → Aktivitas → Log Aktivitas**. Tombol **⚡ Auto Log** muncul di kanan bawah.
4. Di panel yang terbuka:
   1. **Pengaturan default:** jam, jenis kegiatan, tipe, lokasi, dan dosen. Semuanya tersimpan otomatis di browser.
   2. **Paste data:** blok kolom *Tanggal* dan *Keterangan* di Google Sheets/Excel, Ctrl+C, lalu Ctrl+V.
      Format tanggal yang dikenali antara lain `2026-08-11`, `11/08/2026`, dan `11 Agustus 2026`.
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

## Opsi 2: Python CLI

Butuh Python 3.10+ dan Google Chrome.
```bash
pip install -r requirements.txt
```
Kalau tidak punya Chrome, jalankan juga `python -m playwright install chromium`.

1. Copy `config.example.yaml` jadi `config.yaml`, lalu isi URL halaman log, tanggal magang, dan nilai default.
2. Jalankan `python main.py init`. Perintah ini membuat `log.csv` berisi semua hari kerja dan folder `bukti/YYYY-MM-DD/`.
3. Isi kolom `keterangan` di `log.csv`. Kolom lain boleh dikosongkan supaya memakai default.
4. Jalankan `python main.py cek` untuk melihat entri mana yang sudah siap.
5. Jalankan `python main.py run --dry-run`. Browser akan terbuka, lalu kamu login dan melihat form yang terisi tanpa disimpan.
6. Jalankan `python main.py run`. Opsi tambahan: `--limit 5` dan `--tanggal 2026-07-14`.

Catatan: portal hanya mengizinkan satu sesi login aktif. Login di browser lain akan memutus sesi script.

## Privasi
`config.yaml`, `log.csv`, `bukti/`, dan `.browser-profile/` (session login) sudah masuk `.gitignore`.
Pengaturan userscript tersimpan di `localStorage` browser kamu sendiri.
