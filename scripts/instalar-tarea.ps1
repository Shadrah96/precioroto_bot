# Registra una tarea programada de Windows que revisa precios cada 30 minutos.
#
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarea.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarea.ps1 -Minutos 15
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarea.ps1 -Desinstalar
#
# Ventaja sobre GitHub Actions: sale por tu IP de casa, asi que Amazon,
# PcComponentes y Carrefour te dejan entrar. Requiere el PC encendido.

param(
  [int]$Minutos = 30,
  [string]$Nombre = 'Chollos - buscar errores de precio',
  [switch]$Desinstalar
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$cmd = Join-Path $PSScriptRoot 'scan.cmd'

if ($Desinstalar) {
  Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
  Write-Host "Tarea '$Nombre' eliminada."
  return
}

if (-not (Test-Path $cmd)) { throw "No encuentro $cmd" }
if (-not (Test-Path (Join-Path $raiz '.env'))) {
  Write-Warning 'No hay .env: los avisos no llegaran a Telegram. Copia .env.example a .env y rellenalo.'
}

$accion = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $raiz

# Dos disparadores:
#  1) al iniciar sesion, con 2 min de margen para que la red este levantada.
#     Asi hay un scan nada mas encender el PC, sin esperar al siguiente ciclo.
#  2) el ciclo periodico mientras el equipo siga encendido.
#     Hay que acotarlo a TU usuario: un -AtLogOn sin -User vale para cualquiera
#     que inicie sesion, y eso exige permisos de administrador.
$alEncender = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$alEncender.Delay = 'PT2M'

$periodico = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutos)

# StartWhenAvailable recupera las ejecuciones que se perdieron con el PC apagado.
$ajustes = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 25)

# Reemplazar una tarea existente con -Force da "Acceso denegado" sin privilegios
# de administrador, asi que la borramos primero y la creamos de cero.
$existente = Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue
if ($existente) {
  Write-Host "Ya existia una tarea con ese nombre; la reemplazo."
  Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
}

Register-ScheduledTask -TaskName $Nombre -Action $accion -Trigger @($alEncender, $periodico) `
  -Settings $ajustes -Description 'Revisa precios y avisa por Telegram de errores de precio.' | Out-Null

Write-Host "Listo. '$Nombre' se ejecutara al iniciar sesion (+2 min) y luego cada $Minutos minutos."
Write-Host "Log: $(Join-Path $raiz 'scan.log')"
Write-Host "Para verla:  Get-ScheduledTask -TaskName '$Nombre'"
Write-Host "Para probarla ya:  Start-ScheduledTask -TaskName '$Nombre'"
