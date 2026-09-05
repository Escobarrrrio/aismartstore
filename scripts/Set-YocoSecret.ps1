<#
.SYNOPSIS
    Sets the Yoco webhook signing secret on the Supabase project. PowerShell 5.1+.

.DESCRIPTION
    The Supabase dashboard login sits on an email account that is currently
    unreachable, but the Supabase CLI on this machine is still authenticated,
    so the CLI is the way in.

    The value is typed hidden, is never written to the screen, never reaches
    PowerShell history, and is handed to the CLI through a temp env-file that
    is deleted afterwards.

    NOTE: this is the WEBHOOK SIGNING SECRET (usually 'whsec_...'), which
    verifies that callbacks really came from Yoco. It is NOT the API key
    ('sk_test_...' / 'sk_live_...') that creates checkouts -- that one lives in
    the store_settings table and is set from Admin -> Settings.

.EXAMPLE
    .\scripts\Set-YocoSecret.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectRef = "okejdzkftwhccplyfluf",
    [string] $SecretName = "YOCO_WEBHOOK_SECRET"
)

$ErrorActionPreference = "Stop"

function Get-FormatDescription {
    # Describes the SHAPE of the secret without ever revealing the value.
    param([string] $Value)

    if ($Value.StartsWith("whsec_")) {
        $body = $Value.Substring(6)
        $prefix = "has the whsec_ prefix"
    } else {
        $body = $Value
        $prefix = "no whsec_ prefix"
    }

    $looksB64 = ($body -match '^[A-Za-z0-9+/]+={0,2}$') -and ($body.Length % 4 -eq 0)
    if ($looksB64) {
        try {
            [void][Convert]::FromBase64String($body)
            $decodes = "decodes as base64 (standard Svix format)"
        } catch {
            $decodes = "looks like base64 but will not decode"
        }
    } else {
        $decodes = "not base64 - will be used as a raw string key"
    }

    return "$($Value.Length) characters, $prefix, $decodes"
}

Write-Host ""
Write-Host "Setting $SecretName on Supabase project $ProjectRef"
Write-Host ("=" * 64)
Write-Host ""
Write-Host "Where to find this value:"
Write-Host "  Yoco dashboard -> Developers / Webhooks -> your webhook entry."
Write-Host "  It is the SIGNING SECRET (usually starts 'whsec_')."
Write-Host "  It is NOT your API key ('sk_test_...' / 'sk_live_...')."
Write-Host ""
Write-Host "Input is hidden. Nothing is echoed to the screen." -ForegroundColor Cyan
Write-Host ""

$secure = Read-Host -Prompt "Paste $SecretName" -AsSecureString

# Convert only in memory, and free the unmanaged buffer immediately after.
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $secret = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Host ""
    Write-Host "Nothing entered. Aborted - no change made." -ForegroundColor Yellow
    exit 1
}
$secret = $secret.Trim()

if ($secret.StartsWith("sk_test_") -or $secret.StartsWith("sk_live_")) {
    Write-Host ""
    Write-Host "That is your Yoco API key, not the webhook signing secret." -ForegroundColor Red
    Write-Host "They are different values and go in different places. Aborted."
    Write-Host "The API key belongs in store_settings.yoco_secret_key (Admin -> Settings)."
    exit 1
}

Write-Host ""
Write-Host "Format check: $(Get-FormatDescription -Value $secret)"

# Yoco delivers webhooks through Svix (confirmed from the Svix-Webhooks
# user-agent on real deliveries), and Svix signing secrets are always
# "whsec_" + base64. A value in any other shape will load without error and
# then fail every signature check -- which reads as "payments silently not
# recording" rather than as a wrong secret. Warn loudly before that happens.
if (-not $secret.StartsWith("whsec_")) {
    Write-Host ""
    Write-Host "WARNING: this does not start with 'whsec_'." -ForegroundColor Yellow
    Write-Host "Yoco signs webhooks via Svix, whose secrets always look like" -ForegroundColor Yellow
    Write-Host "  whsec_XXXXXXXXXXXXXXXXXXXXXXXXXXXX" -ForegroundColor Yellow
    Write-Host "A value in another shape will be accepted here but will fail every" -ForegroundColor Yellow
    Write-Host "signature check, so real payments will never be marked paid." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Find it in: Yoco dashboard -> Webhooks -> your endpoint -> signing secret." -ForegroundColor Yellow
}

Write-Host ""
$confirm = Read-Host -Prompt "Set this secret now? [y/N]"
if ($confirm.Trim().ToLower() -notin @("y", "yes")) {
    Write-Host "Aborted - no change made." -ForegroundColor Yellow
    exit 1
}

# An env-file keeps the value out of the command line, so it cannot be read
# from PowerShell history or a process listing.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yoco-" + [Guid]::NewGuid().ToString("N") + ".env")
try {
    New-Item -ItemType File -Path $tmp | Out-Null

    # Lock to the current user before the secret goes in.
    $acl = Get-Acl $tmp
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "$env:USERDOMAIN\$env:USERNAME", "FullControl", "Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -Path $tmp -AclObject $acl

    "$SecretName=$secret" | Out-File -FilePath $tmp -Encoding ascii -NoNewline

    Write-Host ""
    Write-Host "Setting secret via Supabase CLI..."
    $out = & supabase secrets set --env-file $tmp --project-ref $ProjectRef 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to set secret." -ForegroundColor Red
        Write-Host ($out | Select-Object -First 3)
        exit 1
    }
    Write-Host "$SecretName set successfully." -ForegroundColor Green
} finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    $secret = $null
}

Write-Host ""
Write-Host "Next: redeploy the function so it picks up the new secret."
Write-Host "  supabase functions deploy yoco-webhook --project-ref $ProjectRef"
Write-Host ""
Write-Host "Then confirm:"
Write-Host "  .\scripts\Verify-YocoWebhook.ps1"
