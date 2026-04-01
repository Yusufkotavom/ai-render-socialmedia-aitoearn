@echo off
echo Menghentikan container Docker yang akan dijalankan lokal...
cd /d D:\AiToEarn
docker compose stop aitoearn-ai google-flow-playwright-worker

echo Memulai Server Playwright Worker Lokal...
start "Playwright Worker" powershell -NoExit -Command "cd D:\AiToEarn\project\aitoearn-backend\apps\google-flow-playwright-worker; node src\server.mjs"

echo Memulai Server AI (aitoearn-ai) Lokal dengan Nx...
start "AI Backend Server" powershell -NoExit -Command "cd D:\AiToEarn\project\aitoearn-backend; pnpm run ai:serve"

echo Semua server lokal berhasil dijalankan di background (lihat taskbar).
pause
