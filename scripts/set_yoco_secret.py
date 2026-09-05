#!/usr/bin/env python3
"""
Set the Yoco webhook secret on the Supabase project, safely.

Why this exists rather than "just paste it into the dashboard":

  - The Supabase dashboard login sits on an email account that is currently
    unreachable, but the Supabase CLI on this machine is still authenticated.
    So the CLI is the way in.
  - Typing the secret as a CLI argument puts it in shell history. This asks for
    it with hidden input and hands it to the CLI through a temp env-file that is
    deleted afterwards, so it lands in neither history nor the repo.

The secret is never printed, never logged, and never leaves this machine.

Usage:
    python scripts/set_yoco_secret.py
"""

from __future__ import annotations

import base64
import getpass
import os
import re
import subprocess
import sys
import tempfile

PROJECT_REF = "okejdzkftwhccplyfluf"
SECRET_NAME = "YOCO_WEBHOOK_SECRET"
WEBHOOK_URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/yoco-webhook"


def describe_format(secret: str) -> str:
    """Explain the shape WITHOUT revealing the value."""
    body = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    prefix = "has the whsec_ prefix" if secret.startswith("whsec_") else "no whsec_ prefix"

    looks_b64 = bool(re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", body)) and len(body) % 4 == 0
    if looks_b64:
        try:
            base64.b64decode(body, validate=True)
            decodes = "decodes as base64 (standard Svix format)"
        except Exception:
            decodes = "looks like base64 but will not decode"
    else:
        decodes = "not base64 -- will be used as a raw string key"

    return f"{len(secret)} characters, {prefix}, {decodes}"


def main() -> int:
    print(f"\nSetting {SECRET_NAME} on Supabase project {PROJECT_REF}")
    print("=" * 62)
    print("\nWhere to find this value:")
    print("  Yoco dashboard -> Developers / Webhooks -> your webhook entry.")
    print("  It is the SIGNING SECRET for the webhook (usually starts 'whsec_').")
    print("  It is NOT your API/secret key (the one starting 'sk_test_'/'sk_live_').")
    print("\nThe value is hidden as you type/paste. Nothing is echoed.\n")

    secret = getpass.getpass(f"Paste {SECRET_NAME} (input hidden): ").strip()
    if not secret:
        print("\nNothing entered. Aborted -- no change made.")
        return 1

    print(f"\nFormat check: {describe_format(secret)}")
    if secret.startswith(("sk_test_", "sk_live_")):
        print(
            "\nThat looks like your Yoco API key, not the webhook signing secret.\n"
            "They are different values and go in different places. Aborted."
        )
        return 1

    if input("\nSet this secret now? [y/N] ").strip().lower() not in {"y", "yes"}:
        print("Aborted -- no change made.")
        return 1

    # An env-file keeps the value out of argv (and therefore out of shell
    # history and any process listing). Written 0600, deleted in `finally`.
    fd, path = tempfile.mkstemp(prefix="yoco-", suffix=".env")
    try:
        os.chmod(path, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(f"{SECRET_NAME}={secret}\n")

        result = subprocess.run(
            ["supabase", "secrets", "set", "--env-file", path, "--project-ref", PROJECT_REF],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            # stderr could echo the value back; show only the first line.
            print(f"\nFailed to set secret: {result.stderr.strip().splitlines()[:1]}")
            return 1
        print(f"\n{SECRET_NAME} set successfully.")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    print("\nNext step -- the function must be redeployed to pick it up:")
    print("    supabase functions deploy yoco-webhook --project-ref " + PROJECT_REF)
    print("\nThen verify with:")
    print("    python scripts/verify_yoco_webhook.py")
    print(f"\n(That probes {WEBHOOK_URL} with a deliberately invalid signature.")
    print(" A healthy endpoint answers 401 'Invalid signature'.")
    print(" A 503 'Webhook misconfigured' means the secret is still unusable.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
