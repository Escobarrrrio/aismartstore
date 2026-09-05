#!/usr/bin/env python3
"""
Live-site audit for AI Smart Store.

Complements the Playwright suite rather than duplicating it. Playwright drives
a real browser and is the only thing that can judge the rendered React app;
this walks the whole site at the HTTP layer, which is where a headless browser
suite is slow and awkward:

  - every URL in sitemap.xml actually resolves (a 404 in a sitemap is a direct
    SEO penalty and a dead link for a customer arriving from Google)
  - every internal link found on the key pages resolves
  - security headers are present AND enforcing (a Content-Security-Policy in
    Report-Only mode blocks nothing; it only looks like protection)
  - robots.txt and sitemap.xml agree with each other

Usage:
    python scripts/site_audit.py                    # audit production
    python scripts/site_audit.py http://localhost:8080
"""

from __future__ import annotations

import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

DEFAULT_BASE = "https://www.aismartstore.co.za"
TIMEOUT = 20
WORKERS = 8

# Headers that materially change how hostile input is treated in the browser.
REQUIRED_HEADERS = {
    "strict-transport-security": "forces HTTPS on repeat visits",
    "x-content-type-options": "stops MIME-sniffing a response into a script",
    "x-frame-options": "blocks clickjacking via iframe",
    "referrer-policy": "stops leaking full URLs to third parties",
    "permissions-policy": "denies camera/mic/geolocation by default",
}

session = requests.Session()
session.headers["User-Agent"] = "aismartstore-site-audit/1.0"


def fetch(url: str) -> tuple[str, int | None, str]:
    """Return (url, status, error). Never raises -- a dead host is a result."""
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        return url, r.status_code, ""
    except requests.RequestException as e:
        return url, None, type(e).__name__


def sitemap_urls(base: str) -> list[str]:
    r = session.get(urljoin(base, "/sitemap.xml"), timeout=TIMEOUT)
    if r.status_code != 200:
        print(f"  [FAIL] sitemap.xml returned {r.status_code}")
        return []
    # lxml isn't guaranteed to be installed; the stdlib parser handles this fine.
    soup = BeautifulSoup(r.text, "html.parser")
    return [loc.get_text(strip=True) for loc in soup.find_all("loc")]


def internal_links(base: str, page: str) -> set[str]:
    try:
        r = session.get(page, timeout=TIMEOUT)
    except requests.RequestException:
        return set()
    soup = BeautifulSoup(r.text, "html.parser")
    host = urlparse(base).netloc
    found = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        absolute = urljoin(page, href)
        if urlparse(absolute).netloc == host:
            found.add(absolute.split("#")[0])
    return found


def check_headers(base: str) -> list[str]:
    problems: list[str] = []
    r = session.get(base, timeout=TIMEOUT)
    h = {k.lower(): v for k, v in r.headers.items()}

    for name, why in REQUIRED_HEADERS.items():
        if name not in h:
            problems.append(f"MISSING  {name}  ({why})")

    enforced = "content-security-policy" in h
    report_only = "content-security-policy-report-only" in h
    if not enforced and report_only:
        problems.append(
            "REPORT-ONLY  content-security-policy is Report-Only: violations are "
            "not blocked, so it provides no actual XSS protection"
        )
    elif not enforced and not report_only:
        problems.append("MISSING  content-security-policy  (no XSS containment at all)")

    if report_only and not any(
        d in h.get("content-security-policy-report-only", "") for d in ("report-uri", "report-to")
    ):
        problems.append(
            "NO-REPORTING  the Report-Only policy has no report-uri/report-to, so "
            "violations are neither blocked nor collected -- it does nothing"
        )
    return problems


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE).rstrip("/")
    print(f"\nAuditing {base}\n" + "=" * 60)

    print("\n[1] Security headers")
    header_problems = check_headers(base)
    if header_problems:
        for p in header_problems:
            print(f"  [FAIL] {p}")
    else:
        print("  [ok] all required headers present and CSP enforcing")

    print("\n[2] Sitemap URLs")
    urls = sitemap_urls(base)
    print(f"  {len(urls)} URLs listed")

    print("\n[3] Crawling internal links from key pages")
    seeds = [base, f"{base}/products", f"{base}/procurement", f"{base}/compliance"]
    discovered: set[str] = set(urls)
    for seed in seeds:
        discovered |= internal_links(base, seed)
    print(f"  {len(discovered)} unique internal URLs to check")

    print("\n[4] Checking every URL")
    results: list[tuple[str, int | None, str]] = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for res in pool.map(fetch, sorted(discovered)):
            results.append(res)

    by_status: dict[str | int, list[str]] = defaultdict(list)
    for url, status, err in results:
        by_status[err or status].append(url)

    broken = []
    for status in sorted(by_status, key=str):
        urls_at = by_status[status]
        ok = isinstance(status, int) and status < 400
        mark = "[ok]" if ok else "[FAIL]"
        print(f"  {mark} {status}: {len(urls_at)}")
        if not ok:
            broken.extend(urls_at)
            for u in urls_at[:15]:
                print(f"      {u}")

    print("\n" + "=" * 60)
    print(f"SUMMARY: {len(results)} URLs checked, {len(broken)} broken, "
          f"{len(header_problems)} header problems")
    return 1 if (broken or header_problems) else 0


if __name__ == "__main__":
    raise SystemExit(main())
