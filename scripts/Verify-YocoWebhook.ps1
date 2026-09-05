<#
.SYNOPSIS
    Checks whether the Yoco webhook endpoint is healthy. Windows PowerShell 5.1+.

.DESCRIPTION
    Sends deliberately INVALID webhooks and reads how the endpoint refuses them.

    Read the result this way round -- a refusal is the GOOD outcome here:

      401  HEALTHY. The secret loaded, the signature was computed, and the
           forgery was refused. This is what you want to see.
      503  The secret is set but unusable. Real payments will not be recorded.
      500  The old crashing build is still deployed.
      200  EMERGENCY. An unsigned "you have been paid" was ACCEPTED, which
           means anyone could mark orders paid. Take the endpoint down.

    No valid signature is ever produced, so this cannot mark anything paid.
    Safe to run as often as you like.

.EXAMPLE
    .\scripts\Verify-YocoWebhook.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectRef = "okejdzkftwhccplyfluf"
)

$ErrorActionPreference = "Stop"

$Url = "https://$ProjectRef.supabase.co/functions/v1/yoco-webhook"
$Anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4"

$Body = '{"id":"evt_verify","type":"payment.succeeded","payload":{"amount":1,"metadata":{"orderId":"00000000-0000-0000-0000-000000000000"}}}'

function Invoke-Probe {
    param([string] $Label, [hashtable] $ExtraHeaders)

    $headers = @{ apikey = $Anon }
    foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] }

    try {
        $res = Invoke-WebRequest -Uri $Url -Method POST -Headers $headers `
            -ContentType "application/json" -Body $Body -UseBasicParsing
        $status = [int] $res.StatusCode
        $text = $res.Content
    } catch {
        # Windows PowerShell throws on any non-2xx, so the real status lives on
        # the exception's response, not on a return value.
        if ($_.Exception.Response) {
            $status = [int] $_.Exception.Response.StatusCode.value__
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $text = $reader.ReadToEnd()
            $reader.Close()
        } else {
            $status = 0
            $text = $_.Exception.Message
        }
    }

    if ($text.Length -gt 110) { $text = $text.Substring(0, 110) }
    "  {0,-30} -> {1}  {2}" -f $Label, $status, $text | Write-Host
    return $status
}

Write-Host ""
Write-Host "Probing $Url"
Write-Host ("=" * 64)

# Must be UTC. `Get-Date -UFormat %s` is local-time based, so at UTC+2 the
# timestamp lands outside the endpoint's 5-minute window and the probe is
# rejected for staleness before the signature is ever compared -- which would
# make a broken signature check look like a working one.
$ts = [string] ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())

[void] (Invoke-Probe -Label "no signature headers" -ExtraHeaders @{})

$status = Invoke-Probe -Label "signed with a wrong key" -ExtraHeaders @{
    "webhook-id"        = "msg_verify"
    "webhook-timestamp" = $ts
    "webhook-signature" = "v1,YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY="
}

Write-Host ""
Write-Host ("=" * 64)

switch ($status) {
    401 {
        Write-Host "HEALTHY - forged webhooks are refused." -ForegroundColor Green
        Write-Host ""
        Write-Host "401 here is the PASS. These were fake webhooks and the endpoint"
        Write-Host "threw them out, which is exactly what protects your stock."
        Write-Host ""
        Write-Host "Still unproven: whether the stored secret matches the one Yoco"
        Write-Host "signs with. A wrong-but-readable secret looks identical from out"
        Write-Host "here. To settle it, send a test webhook from the Yoco dashboard:"
        Write-Host "  200 back = secret correct, payments will record."
        Write-Host "  401 back = wrong value, run .\scripts\Set-YocoSecret.ps1"
        exit 0
    }
    503 {
        Write-Host "MISCONFIGURED - the secret is set but unusable." -ForegroundColor Yellow
        Write-Host "Real payments will NOT mark orders paid."
        Write-Host "Fix: .\scripts\Set-YocoSecret.ps1"
        exit 1
    }
    500 {
        Write-Host "OLD BUILD STILL DEPLOYED." -ForegroundColor Yellow
        Write-Host "Fix: supabase functions deploy yoco-webhook --project-ref $ProjectRef"
        exit 1
    }
    200 {
        Write-Host "EMERGENCY - an UNSIGNED payment webhook was ACCEPTED." -ForegroundColor Red
        Write-Host "Anyone could mark orders paid. Disable the endpoint now."
        exit 2
    }
    default {
        Write-Host "UNEXPECTED status $status - check the Supabase function logs." -ForegroundColor Yellow
        exit 1
    }
}
