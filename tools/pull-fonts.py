#!/usr/bin/env python3
# pull-fonts.py — render all of a brand's fonts onto one reference image, attached as a --ref so
# image ads render headlines in the real fonts. Needs Pillow; .woff/.woff2 also need fontTools
# (woff2 also brotli).
#
# Usage (one --font per brand font):
#   python3 tools/pull-fonts.py --out "workspaces/<WS>/Acme/inputs/media/brand/type_sheet.png" \
#     --font "Big Shoulders Display|700|H1 / headline|Point it at the tension" \
#     --font "Poppins|500|Body / UI|Pinpoint recovery, wherever you need relief"
#
# Each --font is "Source|weight|role|sample" (only Source required; weight only for Google families).
# Source: a Google Fonts family name, a font file URL, or a local font path.
# --bg / --fg: background and text hex colors (default 0a0a0a / ffffff).

import argparse, hashlib, os, re, sys, tempfile, urllib.parse, urllib.request
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("pull-fonts needs Pillow. Install it: python3 -m pip install --user pillow "
             "(Ubuntu, Debian: sudo apt install python3-pil)")

LEGACY_UA = "Mozilla/5.0 (Windows NT 5.1)"  # no woff2 -> Google serves TTF, which Pillow reads
UA = "Mozilla/5.0"

def _get(url, ua):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=40).read()

def _stem(s):
    return os.path.splitext(os.path.basename(urllib.parse.urlparse(s).path or s))[0] or s

def _to_ttf(path):
    # .ttf/.otf are usable as-is; .woff/.woff2 need fontTools (woff2 also brotli).
    ext = os.path.splitext(path)[1].lower()
    if ext in (".ttf", ".otf"):
        return path
    if ext in (".woff", ".woff2"):
        try:  # catches both missing fontTools and missing brotli (woff2 decompression)
            from fontTools.ttLib import TTFont
            out = path + ".ttf"; TTFont(path).save(out); return out
        except ImportError:
            raise SystemExit(f"ERROR: {ext} needs fontTools" + (" + brotli" if ext == ".woff2" else "") +
                             " to convert. Install them, or provide a .ttf/.otf, or use the Google family name.")
    raise SystemExit(f"ERROR: unsupported font file type '{ext}'. Use .ttf/.otf/.woff/.woff2.")

def _google_ttf(family, weight):
    fam = urllib.parse.quote(family).replace("%20", "+")
    for spec in (f"{fam}:wght@{weight}", fam):  # fall back to default weight
        try:
            css = _get(f"https://fonts.googleapis.com/css2?family={spec}", LEGACY_UA).decode()
        except Exception:
            continue
        m = re.search(r"src:\s*url\((https://[^)]+\.ttf)\)", css)
        if m:
            p = os.path.join(tempfile.gettempdir(), f"_ts_{hashlib.md5((family + weight).encode()).hexdigest()[:12]}.ttf"); open(p, "wb").write(_get(m.group(1), LEGACY_UA)); return p
    raise SystemExit(f"ERROR: '{family}' is not a Google Fonts family (or not the exact name). "
                     "For a self-hosted or paid font pass a font-file URL or local .ttf/.otf path instead "
                     "(see the pull-fonts skill).")

def resolve_font(source, weight):
    """Return (path_to_usable_font, display_name, note)."""
    if os.path.exists(source):
        return _to_ttf(source), _stem(source), "local file"
    if source.startswith(("http://", "https://")):
        ext = os.path.splitext(urllib.parse.urlparse(source).path)[1].lower() or ".ttf"
        p = os.path.join(tempfile.gettempdir(), f"_ts_{abs(hash(source))}{ext}"); open(p, "wb").write(_get(source, UA))
        return _to_ttf(p), _stem(source), "from url"
    return _google_ttf(source, weight), source, f"weight {weight}"

def hexrgb(s): s = s.lstrip("#"); return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--font", action="append", required=True,
                    help="'Source|weight|role|sample' — Source = Google family, font URL, or local file")
    ap.add_argument("--bg", default="0a0a0a")
    ap.add_argument("--fg", default="ffffff")
    a = ap.parse_args()
    bg, fg = hexrgb(a.bg), hexrgb(a.fg)
    mut = tuple(round(c * 0.55 + b * 0.45) for c, b in zip(fg, bg))

    rows = []  # (text, size, color, ttf) or ("__rule__", ...)
    for spec in a.font:
        source, weight, role, sample = (spec.split("|") + ["", "", ""])[:4]
        source, weight = source.strip(), (weight.strip() or "700")
        ttf, name, note = resolve_font(source, weight)
        sample = sample.strip() or "The quick brown fox jumps over the lazy dog"
        if rows:
            rows.append(("__rule__", 0, mut, None))
        rows.append((f"{role.strip() or 'font'}  ·  {note}", 30, mut, ttf))
        rows.append((name, 52, fg, ttf))
        rows.append((sample, 88, fg, ttf))
        rows.append(("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 38, fg, ttf))
        rows.append(("abcdefghijklmnopqrstuvwxyz 0123456789", 38, fg, ttf))

    W, pad = 1280, 64
    H = pad * 2 + sum((40 if t == "__rule__" else round(sz * 1.34)) for t, sz, _, _ in rows)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    def fit(text, sz, ttf, maxw):  # shrink to fit width; never grow (keeps precomputed H valid)
        s = sz
        while s > 10 and d.textlength(text, font=ImageFont.truetype(ttf, s)) > maxw:
            s -= 2
        return ImageFont.truetype(ttf, s)

    y = pad
    for text, sz, col, ttf in rows:
        if text == "__rule__":
            d.line([(pad, y + 18), (W - pad, y + 18)], fill=col, width=1); y += 40; continue
        d.text((pad, y), text, font=fit(text, sz, ttf, W - 2 * pad), fill=col)
        y += round(sz * 1.34)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    img.save(a.out)
    print("saved", a.out, img.size, "|", len(a.font), "fonts")

main()
