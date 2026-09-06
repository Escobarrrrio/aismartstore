<#
.SYNOPSIS
    Diagnoses why SUPABASE_SERVICE_ROLE_KEY is getting a 401. PowerShell 5.1+.

.DESCRIPTION
    Never prints the key itself -- only its length/shape and Supabase's own
    error response, which is what actually explains a 401.

.EXAMPLE
    .\scripts\Test-ServiceRoleKey.ps1
#>

param([string] $ProjectRef = "okejdzkftwhccplyfluf")

$SupabaseUrl = "https://$ProjectRef.supabase.co"
$key = $env:SUPABASE_SERVICE_ROLE_KEY

Write-Host ""
Write-Host "Checking SUPABASE_SERVICE_ROLE_KEY in THIS session" -ForegroundColor Cyan
Write-Host ("=" * 60)

if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "NOT SET in this PowerShell window." -ForegroundColor Red
    Write-Host "If you set it in a different window/tab, it won't carry over -- "
    Write-Host "`$env:` only applies to the process you set it in."
    exit 1
}

$trimmed = $key.Trim()
$shape =
    if ($trimmed.StartsWith("sb_secret_"))      { "new-style SECRET key (sb_secret_...)" }
    elseif ($trimmed.StartsWith("eyJ"))         { "legacy service_role JWT (eyJ...)" }
    else                                         { "unrecognised format" }

Write-Host "Set: yes ($($key.Length) chars, $($trimmed.Length) after trim)"
Write-Host "Shape: $shape"
if ($key -ne $trimmed) {
    Write-Host "WARNING: has leading/trailing whitespace -- likely cause of the 401." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Testing against $SupabaseUrl/rest/v1/products ..."

# HttpClient, not Invoke-WebRequest: a real key sent via Invoke-WebRequest's
# -Headers hashtable returned a clean 401 with an empty body here, while the
# identical key sent moments later by bulk_attach_images.py's Python requests
# call succeeded (285 products found) -- proving the key was fine and this
# script's request path was not. HttpClient is the modern .NET HTTP stack and
# matches how requests/urllib3 build a request far more closely than the
# legacy WebRequest API Invoke-WebRequest sits on. Kept fully in-process
# (no curl.exe) so the key never appears on any process command line.
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Add("apikey", $trimmed)
$client.DefaultRequestHeaders.Add("Authorization", "Bearer $trimmed")
try {
    $response = $client.GetAsync("$SupabaseUrl/rest/v1/products?select=id&limit=1").GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $status = [int] $response.StatusCode
    if ($response.IsSuccessStatusCode) {
        Write-Host "SUCCESS -- HTTP $status. The key works." -ForegroundColor Green
    } else {
        Write-Host "FAILED -- HTTP $status" -ForegroundColor Red
        Write-Host "Supabase says: $body"
    }
} finally {
    $client.Dispose()
}
