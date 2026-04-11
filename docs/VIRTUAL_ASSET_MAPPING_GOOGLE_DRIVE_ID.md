# Dokumentasi Integrasi Google Drive via Rclone (Virtual Asset Mapping)

## 1. Pendahuluan
Dokumen ini menjelaskan arsitektur **Virtual Asset Mapping** yang diimplementasikan pada AiToEarn untuk mendukung penggunaan Google Drive sebagai sumber media (video/gambar) secara langsung.

Tujuan utama dari arsitektur ini adalah memungkinkan pengguna mengimpor file berukuran besar dari Google Drive ke dalam **Content Manager** dan mempublikasikannya ke sosial media (YouTube, TikTok, Kwai, dll.) **tanpa perlu meng-upload ulang (menduplikasi) data tersebut ke RushFS (S3-compatible storage)**.

## 2. Arsitektur: Sebelumnya vs. Sekarang

### Arsitektur Sebelumnya (Full Upload)
1. Rclone me-mount Google Drive ke `/mnt/social-drive`.
2. Saat user melakukan "Import" di Drive Explorer, backend membaca file dari `/mnt/social-drive`.
3. Backend melakukan **upload stream** fisik file tersebut ke RushFS (S3).
4. S3 mengembalikan URL publik.
5. URL publik S3 disimpan di Content Manager.

**Kelemahan:** Memakan waktu (proses upload internal) dan menduplikasi storage (1GB di Drive + 1GB di RushFS).

### Arsitektur Baru (Virtual Asset Mapping)
1. Rclone me-mount Google Drive ke `/mnt/social-drive`.
2. Saat user melakukan "Import", backend **hanya mendaftarkan path lokalnya** (contoh: `/mnt/social-drive/video.mp4`) ke database Asset.
3. Content Manager menggunakan path virtual tersebut.
4. Saat diputar di browser atau dipublikasikan oleh worker, backend bertindak sebagai **Streaming Proxy** langsung ke rclone mount.

**Kelebihan:** 
- **0% Duplikasi Storage:** File tidak pernah masuk ke RushFS.
- **Import Instan:** Proses import hanya membutuhkan waktu milidetik karena hanya operasi database (metadata).
- **Satu Kesatuan Sistem:** Di mata Content Manager dan sistem publikasi, file Drive dan file RushFS terlihat identik.

## 3. Komponen Utama yang Diubah

### A. `AssetsService.registerLocalAsset` (Backend: `libs/assets`)
Fungsi baru yang bertugas mendaftarkan file lokal ke dalam koleksi MongoDB `Asset` tanpa melakukan pemanggilan `putObject` ke storage provider (S3/AliOSS). Asset ditandai dengan flag `isExternal: true` pada metadatanya.

### B. `DriveExplorerService` (Backend: `apps/aitoearn-ai`)
Fungsi `importSingle` tidak lagi memanggil `uploadFromStream`. Alih-alih mentransfer byte data, ia memanggil `registerLocalAsset`. Ini memastikan metadata diekstrak (seperti mime-type dan ukuran file), tetapi file fisik tetap berada di Google Drive.

### C. Streaming Proxy `/mnt/*` (Backend: `libs/assets/src/http`)
Karena browser web dan worker eksternal tidak bisa membaca path file lokal server (`/mnt/social-drive/...`) secara langsung melalui HTTP, sebuah endpoint proxy dibuat:
- **Route:** `GET /assets/mnt/*`
- **Fitur:** Mendukung **HTTP Range Requests (status 206)**. Ini sangat penting agar pemutaran video di frontend (scrubbing/seeking maju-mundur) dapat berjalan mulus tanpa harus men-download seluruh video.

### D. URL Resolver (`AssetsService.buildUrl`)
Saat sistem meminta URL penuh untuk sebuah Asset (misalnya untuk ditampilkan di UI atau dikirim ke API platform sosial media), `buildUrl` akan mengecek:
- Jika path mengarah ke S3, kembalikan URL public S3/CDN.
- Jika path diawali dengan `/mnt/`, otomatis menyisipkan prefix `/assets` sehingga menjadi URL proxy internal (contoh: `https://api.aitoearn.com/api/assets/mnt/social-drive/video.mp4`).

## 4. Prasyarat & Konfigurasi Infrastruktur
Agar fitur ini berjalan optimal, pastikan hal berikut terpenuhi pada server/container yang menjalankan backend:

1. **Rclone Mount:** Google Drive harus selalu di-mount ke path `/mnt/social-drive`.
2. **VFS Cache Mode:** Sangat direkomendasikan menjalankan perintah rclone mount dengan flag `--vfs-cache-mode full`.
   - *Alasan:* Saat worker melakukan streaming file bergiga-giga ke YouTube/TikTok API, koneksi baca ke Google Drive harus stabil. `vfs-cache-mode full` memungkinkan rclone melakukan *buffering* secara asinkron di disk server (sementara) sehingga mencegah *timeout* atau *broken pipe* saat upload publikasi berlangsung.
3. **Docker Volumes:** Seperti yang sudah ada di `docker-compose.yaml`, pastikan backend container dan playwright worker container memiliki volume binding:
   ```yaml
   volumes:
     - /mnt/social-drive:/mnt/social-drive:ro,rshared
   ```
   (Direktori di-mount secara read-only `ro` untuk keamanan, karena backend tidak perlu memodifikasi isi Google Drive, hanya membacanya).

## 5. Kesimpulan
Pendekatan **Virtual Asset Mapping** memberikan skalabilitas luar biasa untuk manajemen konten video massal. Anda dapat mengelola ratusan terabyte data di Google Drive Enterprise Anda, mengaturnya melalui AiToEarn Content Manager, dan mempublikasikannya ke seluruh platform tanpa membebani tagihan S3 (RushFS) Anda.
