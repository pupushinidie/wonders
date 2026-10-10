"""大厅封面 3 个候选 → art/out/covers/cover-<n>.png（384×192，不透明，不画字）。
- s701：右下角墙上有模型写的乱码字（「KONI」），用周围墙色抹掉。
- s702：上下各有一条纯色深灰带（黑边），裁掉（大厅封面允许 384×17x，和麻将、斗地主一样）；它不能当 ui/cover.png（要 384×192）。
- s703：原样。"""
import pathlib
from collections import Counter
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
SRC = ART / "out/r1/covers"
OUT = ART / "out/covers"
OUT.mkdir(parents=True, exist_ok=True)


def lum(p):
    return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]


a = Image.open(SRC / "cover-s701.png").convert("RGB")
box = (356, 172, 384, 186)
px = a.load()
wall = Counter(px[x, y] for x in range(box[0], box[2]) for y in range(box[1], box[3]) if lum(px[x, y]) < 120).most_common(1)[0][0]
for x in range(box[0], box[2]):
    for y in range(box[1], box[3]):
        if lum(px[x, y]) >= 120:
            px[x, y] = wall
a.save(OUT / "cover-1.png")

b = Image.open(SRC / "cover-s702.png").convert("RGB")
band = (33, 37, 51)
top = next(y for y in range(60) if b.getpixel((200, y)) != band)
bot = next(y for y in range(191, 120, -1) if b.getpixel((200, y)) != band) + 1
b.crop((0, top, 384, bot)).save(OUT / "cover-2.png")   # 上下黑带裁掉，高度变成 384×(bot-top)，只给大厅用
Image.open(SRC / "cover-s703.png").convert("RGB").save(OUT / "cover-3.png")
print("ok", top, wall)
