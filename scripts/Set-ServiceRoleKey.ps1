<#
.SYNOPSIS
    Fetches the Supabase secret (service-role) key via the CLI's JSON output
    and sets it directly into this session -- no manual copy/paste.

.DESCRIPTION
    This project is on Supabase's newer key system: there is no legacy
    "eyJ..." service_role JWT at all, only a "secret" key prefixed
    "sb_secret_...". `supabase projects api-keys --reveal` prints a table
    meant for a human to read, and hand-copying a 200+ character value out of
    a terminal (line wrapping, column boundaries, a selected label) is exactly
    how that value gets silently corrupted -- which is what produced the
    401 last time.

    This script asks the CLI for JSON instead, picks the entry whose type is
    "secret" programmatically, and writes it straight into
    $env:SUPABASE_SERVICE_ROLE_KEY in THIS PowerShell session. The value is
    never printed, and this script doesn't touch any file.

    Session-only, matching how $env: has worked throughout: closing this
    window clears it. Re-run this script in each new window before running
    bulk_attach_images.py.

.EXAMPLE
    .\scripts\Set-ServiceRoleKey.ps1
#>

param([string] $ProjectRef = "okejdzkftwhccplyfluf")

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Fetching the secret key for project $ProjectRef ..." -ForegroundColor Cyan

$json = & supabase projects api-keys --project-ref $ProjectRef --reveal --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "CLI call failed:" -ForegroundColor Red
    Write-Host $json
    exit 1
}

try {
    $keys = $json | ConvertFrom-Json
} catch {
    Write-Host "Could not parse CLI output as JSON." -ForegroundColor Red
    exit 1
}

$secretEntry = $keys | Where-Object { $_.type -eq "secret" } | Select-Object -First 1
if (-not $secretEntry) {
    Write-Host "No 'secret' key found on this project." -ForegroundColor Red
    Write-Host "Types present: $(($keys | Select-Object -ExpandProperty type) -join ', ')"
    exit 1
}

$key = $secretEntry.api_key
if ([string]::IsNullOrWhiteSpace($key) -or -not $key.StartsWith("sb_secret_")) {
    Write-Host "Got a value but it doesn't look like a secret key (expected 'sb_secret_' prefix)." -ForegroundColor Red
    exit 1
}

$env:SUPABASE_SERVICE_ROLE_KEY = $key.Trim()
Write-Host "Set for this session. $($key.Length) characters, prefix '$($secretEntry.prefix)'." -ForegroundColor Green
$key = $null

Write-Host ""
Write-Host "Verifying it actually works..."
& "$PSScriptRoot\Test-ServiceRoleKey.ps1" -ProjectRef $ProjectRef
