<#
.SYNOPSIS
    Retrieves a working Yoco webhook signing secret and installs it. PowerShell 5.1+.

.DESCRIPTION
    Yoco only returns a webhook's signing secret in the response to the call
    that CREATES it. It is never shown again, and it is not in the dashboard --
    the Checkout API "Test keys" panel holds API keys, which is a different
    credential entirely. That is why pasting from that panel produced a secret
    that loaded fine and then failed every signature check.

    So the only way to obtain a usable secret for an endpoint whose original
    secret is lost is to register the endpoint again and keep what comes back.

    This script lists the webhooks on the account, registers a fresh one for
    the yoco-webhook function, and pipes the returned secret straight into
    Supabase. The secret is never printed, never written to disk in the clear,
    and never enters PowerShell history.

    Your Yoco API key is only used to authenticate these calls and is held in
    memory for the duration.

.EXAMPLE
    .\scripts\Repair-YocoWebhook.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectRef = "okejdzkftwhccplyfluf",
    [string] $YocoApi    = "https://payments.yoco.com/api/webhooks"
)

$ErrorActionPreference = "Stop"
$WebhookUrl = "https://$ProjectRef.supabase.co/functions/v1/yoco-webhook"

function Read-Secret([string] $Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host ""
Write-Host "Repair the Yoco webhook signing secret" -ForegroundColor Cyan
Write-Host ("=" * 64)
Write-Host ""
Write-Host "This needs your Yoco SECRET API KEY (starts 'yoco_test_' or 'yoco_live_')."
Write-Host "That is the key from Checkout API -> Test keys / Live keys."
Write-Host "It is NOT the webhook signing secret -- that is what we are here to get."
Write-Host ""

$apiKey = (Read-Secret "Paste your Yoco secret API key").Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) { Write-Host "Nothing entered. Aborted."; exit 1 }

if ($apiKey -notmatch '^(yoco|sk)_(test|live)_') {
    Write-Host ""
    Write-Host "WARNING: that does not look like a Yoco API key (expected yoco_test_/yoco_live_)." -ForegroundColor Yellow
    $go = Read-Host "Continue anyway? [y/N]"
    if ($go.Trim().ToLower() -notin @("y","yes")) { Write-Host "Aborted."; exit 1 }
}

$mode = if ($apiKey -match '_live_') { "LIVE" } else { "TEST" }
Write-Host ""
Write-Host "Key mode: $mode" -ForegroundColor $(if ($mode -eq "LIVE") { "Yellow" } else { "Green" })

$headers = @{ Authorization = "Bearer $apiKey"; "Content-Type" = "application/json" }

# --- 1. What is already registered? -----------------------------------
Write-Host ""
Write-Host "Existing webhooks on this account:"
try {
    $existing = Invoke-RestMethod -Uri $YocoApi -Method GET -Headers $headers
} catch {
    Write-Host "Failed to list webhooks: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $r = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $r.ReadToEnd()
    }
    exit 1
}

$subs = @($existing.subscriptions)
if ($subs.Count -eq 0) {
    Write-Host "  (none)"
} else {
    foreach ($s in $subs) {
        $marker = if ($s.url -eq $WebhookUrl) { "  <-- ours" } else { "" }
        Write-Host ("  {0,-34} {1,-5} {2}{3}" -f $s.name, $s.mode, $s.url, $marker)
    }
}

Write-Host ""
Write-Host "Registering a fresh webhook for:" -ForegroundColor Cyan
Write-Host "  $WebhookUrl"
Write-Host ""
Write-Host "A new registration is the only way to obtain a usable secret -- Yoco"
Write-Host "returns it once, at creation, and never again. Any existing duplicate"
Write-Host "for this same URL can be removed afterwards from the list above."
Write-Host ""
$confirm = Read-Host "Register now? [y/N]"
if ($confirm.Trim().ToLower() -notin @("y","yes")) { Write-Host "Aborted - nothing changed."; exit 1 }

# --- 2. Register, and capture the secret ------------------------------
$body = @{ name = "aismartstore-$(Get-Date -Format yyyyMMdd-HHmm)"; url = $WebhookUrl } | ConvertTo-Json
try {
    $created = Invoke-RestMethod -Uri $YocoApi -Method POST -Headers $headers -Body $body
} catch {
    Write-Host "Registration failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $r = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $r.ReadToEnd()
    }
    exit 1
}

# Yoco returns the signing secret on the created object. Field name is read
# defensively: if their shape changes, say so plainly rather than silently
# installing an empty secret, which would look identical to a wrong one.
$secret = $created.secret
if ([string]::IsNullOrWhiteSpace($secret)) { $secret = $created.signingSecret }
if ([string]::IsNullOrWhiteSpace($secret)) { $secret = $created.webhookSecret }

if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Host ""
    Write-Host "Registered, but no secret field was found in the response." -ForegroundColor Red
    Write-Host "Fields returned: $(($created | Get-Member -MemberType NoteProperty).Name -join ', ')"
    Write-Host "Nothing was installed. Send the field list above and it can be handled."
    exit 1
}

Write-Host ""
Write-Host "Webhook registered. Secret received ($($secret.Length) chars, starts '$($secret.Substring(0,[Math]::Min(6,$secret.Length)))...')." -ForegroundColor Green
if (-not $secret.StartsWith("whsec_")) {
    Write-Host "Note: expected a 'whsec_' prefix. Installing it anyway, then verify." -ForegroundColor Yellow
}

# --- 3. Install into Supabase, without the value touching disk or history ---
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yoco-" + [Guid]::NewGuid().ToString("N") + ".env")
try {
    New-Item -ItemType File -Path $tmp | Out-Null
    $acl = Get-Acl $tmp
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        "$env:USERDOMAIN\$env:USERNAME", "FullControl", "Allow")))
    Set-Acl -Path $tmp -AclObject $acl

    "YOCO_WEBHOOK_SECRET=$secret" | Out-File -FilePath $tmp -Encoding ascii -NoNewline

    Write-Host "Installing into Supabase..."
    $out = & supabase secrets set --env-file $tmp --project-ref $ProjectRef 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to set secret." -ForegroundColor Red
        Write-Host ($out | Select-Object -First 3)
        exit 1
    }
    Write-Host "YOCO_WEBHOOK_SECRET installed." -ForegroundColor Green
} finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    $secret = $null; $apiKey = $null
}

Write-Host ""
Write-Host "Redeploying the function so it picks up the new secret..."
& supabase functions deploy yoco-webhook --project-ref $ProjectRef | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed - run it manually:" -ForegroundColor Yellow
    Write-Host "  supabase functions deploy yoco-webhook --project-ref $ProjectRef"
} else {
    Write-Host "Deployed." -ForegroundColor Green
}

Write-Host ""
Write-Host ("=" * 64)
Write-Host "Now make a test purchase. The webhook will either verify (order goes"
Write-Host "to 'paid', confirmation email sends) or land in automation_events as"
Write-Host "signature_failed, which is visible in Admin -> Yoco Health."
Write-Host ""
Write-Host "Tidy-up: the older webhook for this same URL, if any, can be deleted"
Write-Host "so events are not delivered twice."
