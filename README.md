# Auto Log Aktivitas Kampus Merdeka (Student Portal IPB)

Isi log harian magang/MBKM di Student Portal IPB dari satu file CSV, tanpa input satu per satu.
Jam, dosen, tipe, dan lokasi diisi otomatis dari config. Kamu cukup menulis **keterangan per hari**
dan menaruh **bukti** di folder per tanggal.

> Tool tidak resmi dan tidak berafiliasi dengan IPB. Kamu login sendiri di jendela browser;
> script tidak pernah meminta atau menyimpan password. Isi log tetap tanggung jawabmu, jadi tulis sesuai kegiatan asli.

## Instalasi
Butuh Python 3.10+ dan Google Chrome.
```bash
pip install -r requirements.txt
```
Kalau tidak punya Chrome: `python -m playwright install chromium`.

## Pemakaian
1. **Config:** copy `config.example.yaml` jadi `config.yaml`, lalu isi URL halaman log, tanggal magang, dan nilai default.
2. **Generate template:**
   ```bash
   python main.py init
   ```
   Perintah ini membuat `log.csv` berisi semua hari kerja dan folder `bukti/YYYY-MM-DD/` untuk tiap hari.
3. **Isi `log.csv`** (bisa dibuka di Excel / Google Sheets). Kolom `keterangan` wajib diisi.
   Kolom `jam_mulai`, `jam_selesai`, `tipe`, `lokasi`, dan `jenis_kegiatan` boleh dikosongkan supaya memakai default.
   Baris dengan keterangan kosong (libur/izin) otomatis dilewati.
4. **Taruh bukti** di `bukti/2026-07-14/` dan seterusnya. Format yang diterima: 1 file PDF/JPG/PNG,
   atau beberapa gambar yang otomatis digabung jadi 1 PDF.
5. **Cek data:**
   ```bash
   python main.py cek
   ```
6. **Coba dulu (tidak disimpan):**
   ```bash
   python main.py run --dry-run
   ```
   Browser akan terbuka. Login, lalu lihat form yang terisi.
7. **Jalankan:**
   ```bash
   python main.py run
   ```
   Opsi tambahan: `--limit 5` untuk memproses 5 entri saja, `--tanggal 2026-07-14 2026-07-15` untuk tanggal tertentu.

Tanggal yang sudah ada di portal otomatis dilewati, jadi aman dijalankan berkali-kali sambil mencicil.

## Privasi
`config.yaml`, `log.csv`, `bukti/`, dan `.browser-profile/` (session login) sudah masuk `.gitignore`.
Jangan upload file-file itu ke mana pun.
