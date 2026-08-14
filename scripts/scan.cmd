@echo off
REM Un scan desde la carpeta del proyecto. Lo lanza la tarea programada de Windows.
REM
REM Si el repo tiene un remoto configurado, sincroniza con GitHub antes y despues:
REM asi este runner y el de GitHub Actions comparten lista e historico. Cada uno
REM escribe solo los ficheros de SUS tiendas, de modo que nunca hay conflictos.

setlocal
cd /d "%~dp0.."
set "LOG=%~dp0..\scan.log"
set "SYNC="

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :scan
git remote get-url origin >nul 2>&1
if errorlevel 1 goto :scan
set "SYNC=1"

echo. >> "%LOG%"
echo === %date% %time% — sincronizando >> "%LOG%"
git pull --rebase --autostash >> "%LOG%" 2>&1

:scan
node --env-file-if-exists=.env src/cli.ts scan >> "%LOG%" 2>&1
set "CODE=%errorlevel%"

if not defined SYNC goto :end
git add data >> "%LOG%" 2>&1
git diff --staged --quiet
if errorlevel 1 (
  git commit -m "precios (local)" >> "%LOG%" 2>&1
  git push >> "%LOG%" 2>&1
)

:end
exit /b %CODE%
