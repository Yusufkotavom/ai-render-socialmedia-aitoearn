# Internal Cheat Sheet: RushFS + Cloudflare Tunnel

## Tujuan
Panduan cepat untuk menghubungkan upload asset AiToEarn ke RushFS (S3-compatible) di balik Cloudflare Tunnel.

## Prinsip Penting
- Gunakan endpoint API S3, bukan URL console.
- `publicEndpoint` dipakai untuk generate presigned URL (dipakai browser untuk `PUT`).
- `cdnEndpoint` dipakai untuk URL file final yang disimpan/ditampilkan di aplikasi.
- `endpoint` internal tetap diarahkan ke service Docker (`rustfs.local:9000`).

## Template ENV (Wajib untuk AI + SERVER)
Masukkan ke file `.env`:

```env
RUSTFS_ACCESS_KEY=replace-me
RUSTFS_SECRET_KEY=replace-me
RUSTFS_BUCKET=aitoearn

AI_ASSETS_CONFIG={"provider":"s3","region":"auto","bucketName":"aitoearn","endpoint":"http://rustfs.local:9000","publicEndpoint":"https://storage.piiblog.net","cdnEndpoint":"https://storage.piiblog.net/aitoearn","accessKeyId":"replace-me","secretAccessKey":"replace-me","forcePathStyle":true}
SERVER_ASSETS_CONFIG={"provider":"s3","region":"auto","bucketName":"aitoearn","endpoint":"http://rustfs.local:9000","publicEndpoint":"https://storage.piiblog.net","cdnEndpoint":"https://storage.piiblog.net/aitoearn","accessKeyId":"replace-me","secretAccessKey":"replace-me","forcePathStyle":true}
```

## Pola Endpoint Benar vs Salah
- Benar (API S3): `https://storage.piiblog.net` atau `https://storage.piiblog.net/aitoearn/...`
- Salah (untuk upload API): `https://storage.piiblog.net/rustfs/console/browser/...`

## Contoh Cloudflared Tunnel (Konsep)
Pastikan hostname storage diarahkan ke origin yang expose API S3 RushFS.

```yaml
ingress:
  - hostname: storage.piiblog.net
    service: http://127.0.0.1:9000
  - service: http_status:404
```

Catatan:
- Jika Anda menambahkan path rewrite (`/rustfs`), presigned URL bisa mismatch dan upload gagal.
- Untuk endpoint upload, paling aman tanpa path prefix.

## CORS Minimum untuk Browser Upload
Harus mendukung:
- Methods: `GET, PUT, HEAD, OPTIONS` (tambahkan `POST, DELETE` bila perlu)
- Headers: `content-type, authorization, x-amz-*` (atau wildcard `*`)
- Origin: domain web app Anda (contoh `https://api.piiblog.net`, `http://localhost:3000`)

## Langkah Apply Konfigurasi
1. Update `.env`.
2. Restart service:

```bash
docker compose -f docker-compose.yaml up -d aitoearn-ai aitoearn-server
```

3. Verifikasi health:

```bash
docker compose -f docker-compose.yaml ps
```

## Verifikasi Upload Cepat
1. Trigger upload dari frontend.
2. Cek log backend:

```bash
docker logs --since=10m aitoearn-server | tail -n 200
```

Ekspektasi:
- `POST /api/assets/uploadSign` -> `200`
- Lalu browser `PUT` ke `uploadUrl` -> `200`
- Lalu `POST /api/assets/:id/confirm` -> `200`

## Troubleshooting Cepat
### Kasus: `POST /api/assets/uploadSign` 200, tapi upload tetap gagal
Kemungkinan masalah ada di `PUT` ke storage (bukan di backend API app).

### Kasus: `NoSuchBucket` saat `PUT`
- `bucketName` salah, bucket belum dibuat, atau path prefix tunnel salah.
- Cek endpoint, biasanya harus root domain storage tanpa prefix tambahan.

### Kasus: CORS error di browser console
- Preflight `OPTIONS` tidak mengizinkan origin/method/header.
- Perbaiki CORS di layer yang melayani `storage.piiblog.net`.

### Kasus: Signature mismatch / access denied
- `publicEndpoint` tidak sama dengan domain yang diakses browser.
- `accessKeyId/secretAccessKey` tidak sinkron dengan RushFS server.

## Keamanan
- Jangan pakai kredensial default `rustfsadmin/rustfsadmin` di production.
- Rotasi key dan sinkronkan ke:
  - `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`
  - `AI_ASSETS_CONFIG.accessKeyId/secretAccessKey`
  - `SERVER_ASSETS_CONFIG.accessKeyId/secretAccessKey`
