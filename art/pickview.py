"""小图挑选结果放大看：每个图标 3 个候选 ×4（深底、浅底各一份）。python art/pickview.py <picks.json> <候选根目录> <输出>"""
import json, pathlib, sys
from PIL import Image, ImageDraw
picks = json.loads(pathlib.Path(sys.argv[1]).read_text()); root = pathlib.Path(sys.argv[2])
sc = 4; cw = 32 * sc + 8; rows = list(picks.items())
cols = 4
S = Image.new("RGB", (cols * (cw * 6 + 10), ((len(rows) + cols - 1) // cols) * (32 * sc + 24)), (40, 40, 48)); d = ImageDraw.Draw(S)
for k, (name, idxs) in enumerate(rows):
    x0, y0 = (k % cols) * (cw * 6 + 10), (k // cols) * (32 * sc + 24)
    d.text((x0 + 2, y0 + 2), name, fill=(255, 255, 255))
    for j, i in enumerate(idxs):
        im = Image.open(root / name / (f"{name}-{i}.png" if i else f"{name}.png")).convert("RGBA")
        big = im.resize((im.width * sc, im.height * sc), Image.NEAREST)
        for t, bg in enumerate(((30, 52, 84), (236, 240, 244))):
            cell = Image.new("RGBA", (32 * sc, 32 * sc), bg + (255,))
            cell.alpha_composite(big, ((cell.width - big.width) // 2, (cell.height - big.height) // 2))
            S.paste(cell.convert("RGB"), (x0 + (j * 2 + t) * cw, y0 + 16))
        d.text((x0 + j * 2 * cw + 2, y0 + 16), str(i), fill=(255, 220, 0))
S.save(sys.argv[3]); print(S.size)
