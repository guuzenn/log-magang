# Kebijakan Privasi Logmager

*Berlaku untuk extension Chrome dan userscript Logmager. Terakhir diperbarui: 17 November 2026.*

Logmager adalah tool tidak resmi untuk mengisi Log Aktivitas Kampus Merdeka di Student Portal IPB.
Tool ini tidak berafiliasi dengan IPB.

## Ringkasnya
- Logmager **tidak punya server** dan tidak mengirim data ke pihak mana pun selain `studentportal.ipb.ac.id`.
- Logmager **tidak meminta, membaca, atau menyimpan password**. Ia bekerja di tab Student Portal yang sudah kamu login-kan sendiri.
- Tidak ada analytics, iklan, pelacakan, atau penjualan data.

## Data yang diproses
| Data | Disimpan di mana | Untuk apa |
|---|---|---|
| Pengaturan default (jam, jenis kegiatan, tipe, lokasi, dosen, tanggal magang, hari kerja) dan data kegiatan yang kamu paste | `localStorage` browser kamu, hanya untuk situs Student Portal | Supaya tidak perlu diisi ulang |
| File bukti (foto/PDF) yang kamu pilih | Tidak disimpan. Dibaca di browser saat kamu menekan **Kirim** | Diunggah sebagai bukti ke Student Portal, sama seperti upload manual |
| Isi tabel log di Student Portal | Tidak disimpan | Mengecek tanggal yang sudah terisi supaya tidak dobel |

Semua data dikirim **hanya** ke `studentportal.ipb.ac.id`, lewat formulir yang sama dengan yang kamu isi secara manual.

## Fitur "Buat folder persiapan"
Kalau kamu memakai tombol ini, browser meminta izin menulis ke folder yang **kamu pilih sendiri**. Logmager hanya membuat
folder `persiapan-log-magang-<tanggal>/` berisi subfolder bukti per tanggal dan file template spreadsheet. Tidak ada file lain yang dibaca atau diubah.

## Menghapus data
Hapus data situs `studentportal.ipb.ac.id` di pengaturan browser, atau uninstall Logmager.

## Kode terbuka
Seluruh kode bisa dicek di [github.com/guuzenn/logmager](https://github.com/guuzenn/logmager).
Pertanyaan atau laporan masalah: [GitHub Issues](https://github.com/guuzenn/logmager/issues).
