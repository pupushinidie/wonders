"""小图 64 候选总览：每个图标 8×8 格（×2，底色一半深一半浅），每张总览放 6 个图标。
python art/smallsheet.py <候选根目录> <输出前缀> [名字...]"""
import pathlib, sys, re
from PIL import Image, ImageDraw
root, prefix = pathlib.Path(sys.argv[1]), sys.argv[2]
names = sys.argv[3:] or sorted(p.name for p in root.iterdir() if p.is_dir())
def idx(p):
    m = re.search(r"-(\d+)$", p.stem); return int(m.group(1)) if m else 0
sc = 2
for g in range(0, len(names), 6):
    group = names[g:g + 6]
    tiles = []
    for n in group:
        files = sorted((root / n).glob("*.png"), key=idx)
        ims = [Image.open(f).convert("RGBA") for f in files]
        tw = max(i.width for i in ims) * sc + 4; th = max(i.height for i in ims) * sc + 10
        T = Image.new("RGB", (tw * 8, th * 8 + 14), (40, 40, 48)); d = ImageDraw.Draw(T)
        d.text((2, 1), n, fill=(255, 255, 255))
        for k, (f, im) in enumerate(zip(files, ims)):
            x, y = (k % 8) * tw, (k // 8) * th + 14
            bg = (236, 240, 244) if (k // 8) % 2 else (30, 52, 84)
            cell = Image.new("RGBA", (tw - 4, th - 10), bg + (255,))
            big = im.resize((im.width * sc, im.height * sc), Image.NEAREST)
            cell.alpha_composite(big, ((cell.width - big.width) // 2, (cell.height - big.height) // 2))
            T.paste(cell.convert("RGB"), (x + 2, y))
            d.text((x + 2, y + th - 10), str(idx(f)), fill=(255, 220, 0))
        tiles.append(T)
    W = max(t.width for t in tiles); H = max(t.height for t in tiles)
    S = Image.new("RGB", (W * 3, H * ((len(tiles) + 2) // 3)), (20, 20, 20))
    for k, t in enumerate(tiles):
        S.paste(t, ((k % 3) * W, (k // 3) * H))
    out = f"{prefix}-{g // 6}.png"; S.save(out); print(out, S.size, group)
