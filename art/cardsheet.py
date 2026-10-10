"""每种卡色一张总览：每行 3 张卡 × 3 个候选（×2），给自查和评审用。python art/cardsheet.py [r1|r2] → art/out/review2/cards-<色>.png"""
import json, pathlib, sys
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent
rnd = sys.argv[1] if len(sys.argv) > 1 else "r1"
data = json.loads((ART.parent / "data/cards.json").read_text())
seen = {}
for c in data:
    seen.setdefault(c["name"].lower().replace(" ", "_"), c)
out = ART / "out" / "review2"; out.mkdir(parents=True, exist_ok=True)
for color in ("brown", "gray", "blue", "yellow", "red", "green", "purple"):
    slugs = [s for s, c in seen.items() if c["color"] == color]
    cols = 3
    cw, ch = 3 * 116 + 10, 88 + 16
    rows = (len(slugs) + cols - 1) // cols
    S = Image.new("RGB", (cw * cols, ch * rows), (50, 50, 60)); d = ImageDraw.Draw(S)
    for k, slug in enumerate(slugs):
        x0, y0 = (k % cols) * cw + 4, (k // cols) * ch + 14
        d.text((x0, y0 - 13), slug, fill=(255, 255, 255))
        files = sorted((ART / "out" / rnd / "cards" / color).glob(f"{slug}-s*.png"))
        for i, f in enumerate(files[:3]):
            im = Image.open(f).convert("RGB").resize((112, 88), Image.NEAREST)
            S.paste(im, (x0 + i * 116, y0))
            d.text((x0 + i * 116 + 2, y0 + 76), f.stem.split("-s")[-1], fill=(255, 255, 0))
    S.save(out / f"cards-{color}.png"); print(color, len(slugs), S.size)
