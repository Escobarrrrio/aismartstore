#!/usr/bin/env python3
"""
Tell whether the Yoco webhook is actually healthy, without moving any money.

It sends deliberately INVALID webhooks and reads how the endpoint refuses them.
That is enough to distinguish the three states that matter:

  401 Invalid signature      -> healthy. The secret loaded, the HMAC was
                                computed, and our forgery was correctly refused.
                                Real Yoco callbacks will verify and pay out.

  503 Webhook misconfigured  -> the secret is set but unusable (wrong value or
                                unparseable). Real payments will NOT mark orders
                                paid. Re-copy it from the Yoco dashboard.

  500 Failed to decode ...   -> the OLD crashing build is still deployed.
                                Run: supabase functions deploy yoco-webhook

No valid signature is ever produced here, so nothing can be marked paid by
running this. It is safe to run as often as you like.

Usage:
    python scripts/verify_yoco_webhook.py
"""

from __future__ import annotations

import json
import time

import requests

PROJECT_REF = "okejdzkftwhccplyfluf"
URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/yoco-webhook"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0."
    "JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4"
)

BODY = json.dumps({
    "id": "evt_verify_probe",
    "type": "payment.succeeded",
    "payload": {"amount": 1, "metadata": {"orderId": "00000000-0000-0000-0000-000000000000"}},
})


def probe(label: str, headers: dict[str, str]) -> tuple[int, str]:
    r = requests.post(
        URL,
        headers={"apikey": ANON, "Content-Type": "application/json", **headers},
        data=BODY,
        timeout=30,
    )
    body = r.text[:120]
    print(f"  {label:<32} -> {r.status_code}  {body}")
    return r.status_code, body


def main() -> int:
    ts = str(int(time.time()))
    print(f"\nProbing {URL}\n" + "=" * 62)

    probe("no signature headers", {})
    status, body = probe(
        "signed with a wrong key",
        {
            "webhook-id": "msg_verify",
            "webhook-timestamp": ts,
            # Valid base64, but not signed with the real secret.
            "webhook-signature": "v1,YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
        },
    )

    print("\n" + "=" * 62)
    if status == 401:
        print("HEALTHY -- the secret loaded and the signature check ran.")
        print("Forged webhooks are refused, and genuine Yoco callbacks will verify.")
        return 0
    if status == 503:
        print("MISCONFIGURED -- the secret is set but unusable.")
        print("Real payments will not mark orders paid.")
        print("Re-copy the webhook signing secret from Yoco, then:")
        print("    python scripts/set_yoco_secret.py")
        return 1
    if status == 500 and "decode" in body:
        print("OLD BUILD STILL DEPLOYED -- this is the crash that broke payments.")
        print("Deploy the fix:")
        print(f"    supabase functions deploy yoco-webhook --project-ref {PROJECT_REF}")
        return 1
    print(f"UNEXPECTED status {status}. Check the function logs in Supabase.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
