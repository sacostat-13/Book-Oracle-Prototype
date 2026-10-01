import os, io, pathlib, uharfbuzz as hb, cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image

INK = "#16213A"; GOLD = "#C9A15B"; PARCH = "#F5EFE4"
HERE = pathlib.Path(__file__).resolve().parent
OUT = str(HERE.parent / "out")  # docs/brand/out
for d in ("svg", "png", "social"):
    os.makedirs(f"{OUT}/{d}", exist_ok=True)

# ---------- the mark: traced 1:1 from the chosen finalist (1024px app icon) ----------
import json
T = json.load(open(HERE / "traced.json"))
S = 0.0349; TX = 50 - 2048 * S; TY = 50 - 2066 * S   # 4x-trace space -> 100-unit grid
def _p(key, color):
    return "".join(f'<path fill="{color}" transform="translate({x:.2f} {y:.2f})" d="{d}"/>' for d, x, y in T[key])
def mark(fg, accent, sw=None, simple=False):
    base, g = ("bold", "boldgold") if simple else ("all", "gold")
    inner = _p(base, fg) + (_p(g, accent) if accent != fg else "")
    return f'<g transform="translate({TX:.3f} {TY:.3f}) scale({S})">{inner}</g>'

def svg(w, h, body, vb=None):
    vb = vb or f"0 0 {w} {h}"
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vb}">{body}</svg>\n'

def placed(body, x, y, size):  # place a 100-grid mark at x,y with given size
    return f'<g transform="translate({x} {y}) scale({size/100})">{body}</g>'

# ---------- wordmark as outlines ----------
FONT = str(HERE / "InstrumentSerif.ttf")
tt = TTFont(FONT); gs = tt.getGlyphSet(); upm = tt["head"].unitsPerEm
blob = hb.Blob.from_file_path(FONT); face = hb.Face(blob); hfont = hb.Font(face)
def wordmark(text, color, x, baseline, size, tracking=0.0):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hfont, buf, {"kern": True, "liga": True})
    sc = size / upm; pen_x = 0; parts = []
    order = tt.getGlyphOrder()
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        p = SVGPathPen(gs)
        gs[name].draw(TransformPen(p, (sc, 0, 0, -sc, x + (pen_x + pos.x_offset) * sc, baseline)))
        d = p.getCommands()
        if d: parts.append(d)
        pen_x += pos.x_advance + tracking * upm
    width = pen_x * sc
    return f'<path fill="{color}" d="{" ".join(parts)}"/>', width

def wm_width(text, size, tracking=0.0):
    return wordmark(text, "#000", 0, 0, size, tracking)[1]

NAME = "The Books Oracle"

# ---------- SVG masters ----------
files = {}
files["svg/mark-light.svg"] = svg(100, 100, mark(INK, GOLD), "-4 -4 108 108")          # for light backgrounds
files["svg/mark-dark.svg"] = svg(100, 100, mark(PARCH, GOLD), "-4 -4 108 108")         # for dark backgrounds
files["svg/mark-mono-ink.svg"] = svg(100, 100, mark(INK, INK), "-4 -4 108 108")
files["svg/mark-mono-white.svg"] = svg(100, 100, mark("#FFFFFF", "#FFFFFF"), "-4 -4 108 108")
tile = lambda body, sc=0.66, rx=22.5: (f'<rect width="100" height="100" rx="{rx}" fill="{INK}"/>'
                                     + placed(body, 50 - 50*sc, 50 - 50*sc, 100*sc))
files["svg/app-icon.svg"] = svg(100, 100, tile(mark(PARCH, GOLD), sc=0.94, rx=17))
files["svg/app-icon-cream.svg"] = svg(100, 100, tile(mark(PARCH, PARCH), sc=0.94, rx=17))
files["svg/app-icon-light.svg"] = svg(100, 100, f'<rect width="100" height="100" rx="22.5" fill="{PARCH}"/>'
                                      + placed(mark(INK, GOLD), 3, 3, 94))
files["svg/favicon.svg"] = svg(100, 100, tile(mark(PARCH, GOLD, simple=True), sc=1.0, rx=18))

def lockup(fg, bg=None, h=120):
    size = h * 0.5; gap = h * 0.2
    wmw = wm_width(NAME, size)
    w = h + gap + wmw + h*0.08
    body = (f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else "")
    body += placed(mark(fg, GOLD), 0, 0, h)
    path, _ = wordmark(NAME, fg, h + gap, h*0.5 + size*0.33, size)
    return svg(round(w, 1), h, body + path)
files["svg/lockup-horizontal-light.svg"] = lockup(INK)
files["svg/lockup-horizontal-dark.svg"] = lockup(PARCH)

def stacked(fg, w=520):
    msz = 220; size = 62; wmw = wm_width(NAME, size)
    h = msz + 24 + size * 1.0 + 10
    body = placed(mark(fg, GOLD), (w - msz)/2, 0, msz)
    path, _ = wordmark(NAME, fg, (w - wmw)/2, msz + 24 + size*0.72, size)
    return svg(w, round(h), body + path)
files["svg/lockup-stacked-light.svg"] = stacked(INK)
files["svg/lockup-stacked-dark.svg"] = stacked(PARCH)
files["svg/wordmark-ink.svg"] = (lambda p: svg(round(p[1]+4), 70, p[0]))(wordmark(NAME, INK, 2, 52, 66))
files["svg/wordmark-parchment.svg"] = (lambda p: svg(round(p[1]+4), 70, p[0]))(wordmark(NAME, PARCH, 2, 52, 66))

# ---------- social ----------
def og(w, h, dark):
    bg, fg = (INK, PARCH) if dark else (PARCH, INK)
    msz = h * 0.42; size = h * 0.125
    wmw = wm_width(NAME, size)
    total = msz + h*0.06 + size
    top = (h - total) / 2 - h*0.02
    body = f'<rect width="{w}" height="{h}" fill="{bg}"/>' + placed(mark(fg, GOLD), (w - msz)/2, top, msz)
    path, _ = wordmark(NAME, fg, (w - wmw)/2, top + msz + h*0.06 + size*0.75, size)
    url, uw = wordmark("thebooksoracle.com", GOLD, 0, 0, h*0.035, tracking=0.04)
    url, uw = wordmark("thebooksoracle.com", GOLD, (w - uw)/2, h - h*0.08, h*0.035, tracking=0.04)
    return svg(w, h, body + path + url)

def banner(w, h):
    msz = h * 0.5; size = h * 0.18
    wmw = wm_width(NAME, size); gap = h*0.1
    total = msz + gap + wmw; x0 = (w - total) / 2
    body = f'<rect width="{w}" height="{h}" fill="{INK}"/>' + placed(mark(PARCH, GOLD), x0, (h - msz)/2, msz)
    path, _ = wordmark(NAME, PARCH, x0 + msz + gap, h/2 + size*0.33, size)
    return svg(w, h, body + path)

def avatar(n):  # full-bleed square, safe for circular crops
    return svg(n, n, f'<rect width="{n}" height="{n}" fill="{INK}"/>' + placed(mark(PARCH, GOLD), n*0.2, n*0.2, n*0.6))

files["social/og-image-1200x630.svg"] = og(1200, 630, dark=False)
files["social/og-image-dark-1200x630.svg"] = og(1200, 630, dark=True)
files["social/banner-1500x500.svg"] = banner(1500, 500)
files["social/avatar-1080.svg"] = avatar(1080)

for p, c in files.items():
    open(f"{OUT}/{p}", "w").write(c)

# ---------- raster exports ----------
def png(src, dst, w, h=None):
    cairosvg.svg2png(url=f"{OUT}/{src}", write_to=f"{OUT}/{dst}", output_width=w, output_height=h or w)

for n in (16, 32, 48):
    png("svg/favicon.svg", f"png/favicon-{n}.png", n)
Image.open(f"{OUT}/png/favicon-48.png").save(f"{OUT}/png/favicon.ico", sizes=[(16,16),(32,32),(48,48)], append_images=[Image.open(f"{OUT}/png/favicon-16.png"),Image.open(f"{OUT}/png/favicon-32.png")])

# full-bleed square tiles for platforms that apply their own mask
open(f"{OUT}/svg/app-icon-fullbleed.svg", "w").write(svg(100, 100, f'<rect width="100" height="100" fill="{INK}"/>' + placed(mark(PARCH, GOLD), 8, 8, 84)))
open(f"{OUT}/svg/app-icon-maskable.svg", "w").write(svg(100, 100, f'<rect width="100" height="100" fill="{INK}"/>' + placed(mark(PARCH, GOLD), 24, 24, 52)))
png("svg/app-icon-fullbleed.svg", "png/apple-touch-icon.png", 180)
png("svg/app-icon.svg", "png/icon-192.png", 192)
png("svg/app-icon.svg", "png/icon-512.png", 512)
png("svg/app-icon-maskable.svg", "png/icon-maskable-512.png", 512)
png("svg/app-icon-fullbleed.svg", "png/app-store-1024.png", 1024)
png("svg/mark-light.svg", "png/mark-light-1024.png", 1024)
png("svg/mark-dark.svg", "png/mark-dark-1024.png", 1024)

png("social/og-image-1200x630.svg", "social/og-image-1200x630.png", 1200, 630)
png("social/og-image-dark-1200x630.svg", "social/og-image-dark-1200x630.png", 1200, 630)
png("social/banner-1500x500.svg", "social/banner-1500x500.png", 1500, 500)
png("social/avatar-1080.svg", "social/avatar-1080.png", 1080)
print("built", len(os.listdir(f"{OUT}/svg")), "svg")
