#!/usr/bin/env pwsh
# Test berbagai kombinasi model, rasio, dan jumlah image
# Run: .\src\test-combinations.ps1

$BASE = "http://localhost:4310"
$PROMPT = "a beautiful landscape photo"

function Submit-Task($model, $n, $ratio) {
    $body = @{ profileId = "legacy-default"; prompt = $PROMPT; model = $model }
    if ($n) { $body.n = $n }
    if ($ratio) { $body.aspectRatio = $ratio }
    $json = $body | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "$BASE/v1/image/generate" -Method POST -Body $json -ContentType "application/json"
    return ($r.Content | ConvertFrom-Json).taskId
}

function Wait-Task($taskId, $timeoutSec = 120) {
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        Start-Sleep -Seconds 5
        $elapsed += 5
        $r = Invoke-WebRequest -Uri "$BASE/v1/tasks/$taskId" -Method GET
        $j = $r.Content | ConvertFrom-Json
        if ($j.status -ne "processing" -and $j.status -ne "queued") {
            return $j
        }
        Write-Host "  [$elapsed s] status=$($j.status)..."
    }
    return $null
}

$tests = @(
    @{ model = "google-flow-browser-image-nano-banana-2";   n = 1; ratio = ""    ; label = "Nano Banana 2, 1x, default ratio" },
    @{ model = "google-flow-browser-image-nano-banana-pro"; n = 1; ratio = "16:9"; label = "Nano Banana Pro, 1x, 16:9" },
    @{ model = "google-flow-browser-image-nano-banana-pro"; n = 2; ratio = "1:1" ; label = "Nano Banana Pro, 2x, 1:1" },
    @{ model = "google-flow-browser-image-nano-banana-pro"; n = 4; ratio = "4:3" ; label = "Nano Banana Pro, 4x, 4:3" },
    @{ model = "google-flow-browser-image-imagen-4";        n = 1; ratio = "9:16"; label = "Imagen 4, 1x, 9:16" },
    @{ model = "google-flow-browser-image-imagen-4";        n = 2; ratio = "3:4" ; label = "Imagen 4, 2x, 3:4" },
    @{ model = "google-flow-browser-image-nano-banana-2";   n = 4; ratio = "16:9"; label = "Nano Banana 2, 4x, 16:9" }
)

$results = @()
$pass = 0
$fail = 0

foreach ($t in $tests) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TEST: $($t.label)" -ForegroundColor Cyan
    Write-Host "  model=$($t.model) n=$($t.n) ratio=$($t.ratio)"

    try {
        $taskId = Submit-Task $t.model $t.n $t.ratio
        Write-Host "  taskId=$taskId"

        $result = Wait-Task $taskId 120

        if ($null -eq $result) {
            Write-Host "  ❌ TIMEOUT!" -ForegroundColor Red
            $fail++
            $results += [PSCustomObject]@{ Label = $t.label; Status = "TIMEOUT"; URLs = "" }
        }
        elseif ($result.status -eq "succeeded") {
            $urls = $result.outputUrl.urls -join " | "
            $cnt = $result.outputUrl.urls.Count
            Write-Host "  ✅ SUCCEEDED — $cnt image(s)" -ForegroundColor Green
            Write-Host "     $urls"
            $pass++
            $results += [PSCustomObject]@{ Label = $t.label; Status = "OK ($cnt imgs)"; URLs = $urls }
        }
        else {
            Write-Host "  ❌ FAILED — status=$($result.status) error=$($result.error)" -ForegroundColor Red
            $fail++
            $results += [PSCustomObject]@{ Label = $t.label; Status = "FAIL: $($result.status)"; URLs = "" }
        }
    }
    catch {
        Write-Host "  ❌ EXCEPTION: $_" -ForegroundColor Red
        $fail++
        $results += [PSCustomObject]@{ Label = $t.label; Status = "ERROR: $_"; URLs = "" }
    }

    # Cool-down antara test
    Start-Sleep -Seconds 3
}

Write-Host "`n========================================"
Write-Host "SUMMARY: $pass/$($tests.Count) passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
Write-Host "========================================"
$results | Format-Table -AutoSize
