#!/usr/bin/env python3
"""
Attach the local ProductImages stash to products, by SKU, in bulk.

Why this exists
---------------
frontosa-sync used to discard any item Frontosa had no photo for, so those
products had no row -- and a photo cannot be attached to a row that does not
exist. That is why 726 folders of product photography matched almost nothing.
The sync now stores them unlisted, which makes this script possible: every
folder finally has something to attach to.

What it does
------------
Walks ProductImages/{Brand}/{StockCode}/, derives the SKU, and for each
product that is missing a photo: resizes the images, uploads them to the
public `product-images` bucket, writes the URLs onto the product, and takes
it live.

It is a reconciliation tool first and an uploader second. The default is a
DRY RUN that changes nothing and tells you exactly what would happen --
matched and needing photos, matched but already fine, and unmatched. Run it,
read the report, then run it again with --apply.

Safety properties, deliberately
-------------------------------
* Dry run unless --apply is passed.
* Never overwrites a product that already has images (--force to override).
* Only activates a product whose price clears min_sellable_price. Attaching a
  photo is not a reason to put a R5 item on the shelf when store policy says
  otherwise.
* is_active is set explicitly, because products_enforce_blocklist only ever
  sets it false -- it will never turn a product on for you. Uploading images
  without saying is_active=true leaves the product hidden and makes the run
  look like it did nothing.
* Idempotent: re-running skips products already done.
* Writes a CSV of every decision, so nothing is silently dropped.

Usage
-----
    # 1. Get the key (it is never stored by this script):
    #    supabase projects api-keys --project-ref okejdzkftwhccplyfluf --reveal
    set SUPABASE_SERVICE_ROLE_KEY=...        (PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="...")

    python scripts/bulk_attach_images.py              # dry run, changes nothing
    python scripts/bulk_attach_images.py --apply      # do it
    python scripts/bulk_attach_images.py --apply --limit 5   # try a few first
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import uuid
from pathlib import Path

import requests

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "okejdzkftwhccplyfluf")
SUPABASE_URL = os.environ.get("SUPABASE_URL", f"https://{PROJECT_REF}.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

REPO = Path(__file__).resolve().parent.parent
STASH = REPO / "ProductImages"
BUCKET = "product-images"

# Same treatment the existing resize_for_upload.py used and that produced the
# three ASUS listings already live: long edge 1500, JPEG q85, alpha flattened
# onto white so a transparent PNG does not render as a black box.
MAX_EDGE = 1500
JPEG_QUALITY = 85
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

# A folder can hold a dozen shots of one item; the product page shows a
# handful. Matches MAX_IMAGES in PhotosModule.
MAX_IMAGES_PER_PRODUCT = 8

# PostgREST puts the filter in the query string, so `in.(...)` has to be
# chunked or the URL exceeds what the server will accept.
SKU_LOOKUP_CHUNK = 100


def die(msg: str) -> None:
    sys.exit(f"ERROR: {msg}")


def headers() -> dict:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }


def find_folders() -> list[tuple[str, str, Path]]:
    """Return (brand, stock_code, path) for every ProductImages/{Brand}/{Code}/."""
    out = []
    if not STASH.is_dir():
        die(f"{STASH} not found")
    for brand_dir in sorted(p for p in STASH.iterdir() if p.is_dir()):
        for code_dir in sorted(p for p in brand_dir.iterdir() if p.is_dir()):
            if code_dir.name.lower() == "processed":
                continue
            imgs = [
                f for f in sorted(code_dir.iterdir())
                if f.is_file() and f.suffix.lower() in IMAGE_EXTS
            ]
            if imgs:
                out.append((brand_dir.name, code_dir.name, code_dir))
    return out


def lookup_products(skus: list[str]) -> dict[str, dict]:
    """Fetch products for the given SKUs. Chunked; keyed by sku."""
    found: dict[str, dict] = {}
    for i in range(0, len(skus), SKU_LOOKUP_CHUNK):
        chunk = skus[i:i + SKU_LOOKUP_CHUNK]
        # Quote each value: stock codes contain '+' and ',' which would
        # otherwise be read as PostgREST syntax rather than as data.
        quoted = ",".join('"' + s.replace('"', '\\"') + '"' for s in chunk)
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/products",
            params={"sku": f"in.({quoted})", "select": "id,sku,name,images,is_active,price"},
            headers=headers(), timeout=60,
        )
        r.raise_for_status()
        for row in r.json():
            found[row["sku"]] = row
    return found


def min_sellable_price() -> float:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/store_settings",
        params={"key": "eq.min_sellable_price", "select": "value"},
        headers=headers(), timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    try:
        return float(rows[0]["value"]) if rows else 0.0
    except (ValueError, KeyError, IndexError):
        return 0.0


def process_image(path: Path) -> bytes | None:
    """Resize/flatten one image to upload-ready JPEG bytes."""
    try:
        with Image.open(path) as img:
            if img.mode in ("RGBA", "LA", "P"):
                if img.mode == "P":
                    img = img.convert("RGBA")
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
                img = bg
            else:
                img = img.convert("RGB")

            w, h = img.size
            longest = max(w, h)
            if longest > MAX_EDGE:
                scale = MAX_EDGE / longest
                img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
            return buf.getvalue()
    except Exception as e:  # a corrupt file must not stop the run
        print(f"    ! could not process {path.name}: {e}")
        return None


def upload(data: bytes) -> str | None:
    name = f"{uuid.uuid4()}.jpg"
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{name}",
        headers={**headers(), "Content-Type": "image/jpeg"},
        data=data, timeout=120,
    )
    if not r.ok:
        print(f"    ! upload failed {r.status_code}: {r.text[:120]}")
        return None
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{name}"


def patch_product(sku: str, urls: list[str], activate: bool) -> bool:
    # is_active is sent explicitly: products_enforce_blocklist only ever sets
    # it false. Sending images alone leaves the product hidden.
    body: dict = {"images": urls}
    if activate:
        body["is_active"] = True
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/products",
        params={"sku": f"eq.{sku}"},
        headers={**headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=body, timeout=60,
    )
    if not r.ok:
        print(f"    ! patch failed {r.status_code}: {r.text[:160]}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually upload and patch (default: dry run)")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N matched folders")
    ap.add_argument("--force", action="store_true", help="also replace images on products that already have them")
    ap.add_argument("--report", default="image_attach_report.csv")
    args = ap.parse_args()

    if not SERVICE_KEY:
        die("SUPABASE_SERVICE_ROLE_KEY is not set.\n"
            f"  Get it with:  supabase projects api-keys --project-ref {PROJECT_REF} --reveal\n"
            '  Then:  $env:SUPABASE_SERVICE_ROLE_KEY="<key>"')

    folders = find_folders()
    print(f"\nProductImages: {len(folders)} folders with images\n" + "=" * 66)

    # Derive candidate SKUs. Frontosa rows carry the FR- prefix; try the raw
    # code too, in case a product was created by another route.
    candidates: dict[str, list[str]] = {}
    for _brand, code, _p in folders:
        candidates[code] = [f"FR-{code}", code]

    all_skus = sorted({s for v in candidates.values() for s in v})
    print(f"Looking up {len(all_skus)} candidate SKUs...")
    products = lookup_products(all_skus)
    floor = min_sellable_price()
    print(f"Found {len(products)} matching products. min_sellable_price = R{floor:g}\n")

    todo, already, unmatched = [], [], []
    for brand, code, path in folders:
        product = next((products[s] for s in candidates[code] if s in products), None)
        if product is None:
            unmatched.append((brand, code))
        elif product.get("images") and not args.force:
            already.append((brand, code, product))
        else:
            todo.append((brand, code, path, product))

    print(f"  needs photos : {len(todo)}")
    print(f"  already fine : {len(already)}")
    print(f"  no product   : {len(unmatched)}")

    if unmatched:
        print("\n  Unmatched examples (no product row for these codes):")
        for brand, code in unmatched[:8]:
            print(f"    {brand}/{code}")
        if len(unmatched) > 8:
            print(f"    ... and {len(unmatched) - 8} more")

    if args.limit:
        todo = todo[:args.limit]

    rows = []
    for brand, code, _p, prod in already:
        rows.append({"brand": brand, "code": code, "sku": prod["sku"], "action": "skipped-has-images",
                     "images": len(prod.get("images") or []), "activated": "", "error": ""})
    for brand, code in unmatched:
        rows.append({"brand": brand, "code": code, "sku": "", "action": "no-product-row",
                     "images": 0, "activated": "", "error": ""})

    if not args.apply:
        print(f"\n{'=' * 66}\nDRY RUN -- nothing was changed.")
        print(f"{len(todo)} products would receive photos and go live.")
        print("Re-run with --apply to do it.")
    else:
        print(f"\n{'=' * 66}\nApplying to {len(todo)} products...\n")
        done = failed = activated = 0
        for n, (brand, code, path, prod) in enumerate(todo, 1):
            sku = prod["sku"]
            print(f"[{n}/{len(todo)}] {sku}  ({brand}/{code})")
            files = [f for f in sorted(path.iterdir())
                     if f.is_file() and f.suffix.lower() in IMAGE_EXTS][:MAX_IMAGES_PER_PRODUCT]
            urls = []
            for f in files:
                data = process_image(f)
                if data is None:
                    continue
                url = upload(data)
                if url:
                    urls.append(url)

            if not urls:
                failed += 1
                rows.append({"brand": brand, "code": code, "sku": sku, "action": "failed",
                             "images": 0, "activated": "no", "error": "no images uploaded"})
                continue

            # Policy, not preference: a photo does not override the store's
            # minimum sellable price.
            price = float(prod.get("price") or 0)
            activate = price >= floor
            ok = patch_product(sku, urls, activate)
            if ok:
                done += 1
                if activate:
                    activated += 1
                print(f"    {len(urls)} images  ->  {'LIVE' if activate else f'attached (below R{floor:g}, left hidden)'}")
            else:
                failed += 1
            rows.append({"brand": brand, "code": code, "sku": sku,
                         "action": "attached" if ok else "failed",
                         "images": len(urls), "activated": "yes" if (ok and activate) else "no",
                         "error": "" if ok else "patch failed"})

        print(f"\n{'=' * 66}")
        print(f"attached: {done}   went live: {activated}   failed: {failed}")

    report = REPO / args.report
    with open(report, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["brand", "code", "sku", "action", "images", "activated", "error"])
        w.writeheader()
        w.writerows(rows)
    print(f"\nReport: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
