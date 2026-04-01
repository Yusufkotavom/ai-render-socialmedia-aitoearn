Searched for "start"
Searched for "aitoearn-ai"

Untuk melakukan testing lokal tanpa mem-build Docker, Anda perlu menghentikan container Docker yang terkait agar port-portnya bisa digunakan oleh proses lokal Anda. 

Berikut adalah langkah-langkah detailnya:

### 1. Hentikan Container Docker yang Terkait
Buka PowerShell Terminal, lalu jalankan perintah berikut agar port tidak bentrok:
```bash
cd d:\AiToEarn
docker compose stop aitoearn-ai google-flow-playwright-worker
```

### 2. Jalankan Google Flow Playwright Worker Lokal
Buka terminal baru, masuk ke direktori worker, dan jalankan script-nya menggunakan Node.js langsung:
```bash
cd d:\AiToEarn\project\aitoearn-backend\apps\google-flow-playwright-worker
node src/server.mjs
```
*Worker ini akan berjalan (default-nya di port 4310).*

### 3. Jalankan Service AI (aitoearn-ai) Lokal
Buka terminal baru lagi (karena terminal yang atas sedang menjalankan worker), masuk ke dalam root backend, dan jalankan server AI menggunakan perintah `nx`:
```bash
cd d:\AiToEarn\project\aitoearn-backend
pnpm run ai:serve
```
*Atau jika Anda menggunakan Yarn/NPM, sesuaikan (contoh: `npm run ai:serve`). Ini akan meng-compile perubahan TypeScript secara langsung menggunakan Nx dan me-restart secara otomatis (Hot Reload).*

### 4. Mulai Lakukan Testing
Sekarang semuanya sudah jalan secara lokal di Windows. Buka aplikasi Frontend/Web (yang mungkin masih jalan) lalu coba generate ulang gambar Flow. Log hasil request dan processnya akan terlihat langsung secara *live* di kedua terminal Anda.

### 5. Kembali ke Docker (Jika Sudah Selesai/Stabil)
Jika hasil test sudah bagus dan berhasil, tekan `Ctrl + C` pada kedua terminal lokal Anda untuk mematikannya. Lalu bangun dan nyalakan ulang Dockernya dengan perintah:
```bash
cd d:\AiToEarn
docker compose up -d --build --no-deps aitoearn-ai google-flow-playwright-worker
```