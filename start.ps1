param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv/Scripts/python.exe')) {
    $taskBundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (Test-Path -LiteralPath $taskBundledPython) {
        & $taskBundledPython -m venv .venv
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
        py -3.12 -m venv .venv
    } else {
        throw 'Установите Python 3.12 с официального сайта python.org. См. README.md.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Нужен Python 3.12. См. README.md.' }
}
if (-not $SkipInstall) {
    & '.venv/Scripts/python.exe' -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости Python' }
}
if (-not (Test-Path 'frontend/dist/index.html')) {
    $taskNode = Get-Command node -ErrorAction SilentlyContinue
    $taskBundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if ((-not $taskNode -or [version]((& $taskNode.Source --version).TrimStart('v')) -lt [version]'22.12.0') -and (Test-Path -LiteralPath $taskBundled)) {
        $env:PATH = (Split-Path $taskBundled) + ';' + $env:PATH
    }
    $taskVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or [version]($taskVersion.TrimStart('v')) -lt [version]'22.12.0') { throw 'Нужен Node.js 22.12+ или 24 для сборки интерфейса.' }
    Push-Location frontend
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Ошибка npm ci' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки интерфейса' }
    } finally { Pop-Location }
}
Write-Host 'Приложение: http://127.0.0.1:8000  Остановка: Ctrl+C'
& '.venv/Scripts/python.exe' -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
