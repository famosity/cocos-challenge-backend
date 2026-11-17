[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$demoDatabase = 'cocos_orders_demo'
$demoPort = 3001
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousDatabaseUrl = $env:DATABASE_URL
$previousPort = $env:PORT

function Invoke-Postgres {
  param([string]$Database, [string[]]$Options)

  & docker compose exec -T postgres psql -X -U cocos -d $Database -v ON_ERROR_STOP=1 @Options
  if ($LASTEXITCODE -ne 0) {
    throw "Fallo psql en la base $Database. La demo no se inicio."
  }
}

Push-Location -LiteralPath $projectRoot
try {
  if (-not $PrepareOnly) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $demoPort -ErrorAction SilentlyContinue
    if ($listener) {
      throw "El puerto $demoPort esta en uso. Detene la API de demo con Ctrl+C y volve a intentar."
    }
  }

  & docker compose up -d --wait postgres
  if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo iniciar PostgreSQL. Revisa Docker Desktop.'
  }

  $exists = (Invoke-Postgres -Database 'cocos' -Options @(
    '-Atc', "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$demoDatabase');"
  )).Trim()

  if ($Reset -and $exists -eq 't') {
    Write-Host "Reiniciando solo $demoDatabase. Se pierden las ordenes de esa demo."
    Invoke-Postgres -Database 'cocos' -Options @('-c', "DROP DATABASE $demoDatabase;")
    $exists = 'f'
  }

  if ($exists -eq 'f') {
    Invoke-Postgres -Database 'cocos' -Options @('-c', "CREATE DATABASE $demoDatabase;")
    Invoke-Postgres -Database $demoDatabase -Options @(
      '-q', '--single-transaction', '-f', '/docker-entrypoint-initdb.d/01-database.sql'
    )
  }

  $idempotencySql = Join-Path $PSScriptRoot 'order-idempotency.sql'
  Get-Content -LiteralPath $idempotencySql -Raw | & docker compose exec -T postgres psql -X -U cocos -d $demoDatabase -v ON_ERROR_STOP=1 -f -
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo agregar order_idempotency en $demoDatabase."
  }

  Invoke-Postgres -Database $demoDatabase -Options @(
    '-c', 'SELECT current_database() AS base, count(*) AS ordenes FROM public.orders;'
  )

  if ($PrepareOnly) { return }

  $env:DATABASE_URL = "postgresql://cocos:cocos@127.0.0.1:5432/$demoDatabase"
  $env:PORT = "$demoPort"
  Write-Host "Postman baseUrl: http://127.0.0.1:$demoPort"
  Write-Host 'Ctrl+C detiene la API. PostgreSQL sigue corriendo en Docker.'
  & npm.cmd run dev
  if ($LASTEXITCODE -ne 0) {
    throw "npm run dev termino con codigo $LASTEXITCODE."
  }
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:PORT = $previousPort
  Pop-Location
}
