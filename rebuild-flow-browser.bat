@echo off
echo.
echo [AiToEarn] Rebuilding google-flow containers after session fix...
echo.

cd /d d:\AiToEarn

echo [1/3] Stopping affected containers...
docker compose stop google-flow-remote-browser google-flow-playwright-worker

echo [2/3] Rebuilding images...
docker compose build google-flow-remote-browser google-flow-playwright-worker

echo [3/3] Starting containers...
docker compose up -d google-flow-remote-browser google-flow-playwright-worker

echo.
echo Done! Check logs with:
echo   docker compose logs -f google-flow-remote-browser google-flow-playwright-worker
echo.
