"""陵墓 A 面手修（第 3 轮）：px-s3101 构图对（高台基 + 柱廊 + 阶梯顶 + 顶上马像），但台基上的点状纹理像乱写的字。
台基改成规整的方石砌缝 + 一圈浮雕带；屋顶改成 5 级更明显的阶梯金字塔。python art/hal_edit.py"""
import pathlib
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent
src = ART / "out/r3/wonders/halicarnassus-a-g100-s2112-px-s3101.png"
out = ART / "out/r3/edit/halicarnassus-a-edit.png"
im = Image.open(src).convert("RGB")
d = ImageDraw.Draw(im)
F, H, G, SKY_A, SKY_I = (237, 242, 247), (190, 196, 208), (129, 139, 150), (161, 210, 228), (180, 221, 237)
X0, X1 = 66, 111            # 台基正面（亮面）x 范围，右侧 112–118 是阴影面
# 台基：清掉点状纹理
d.rectangle((X0, 43, X1, 59), fill=F)
# 浮雕带 y 42–46：底色 H，上下沿 G，里面一排小人形浮雕（亮色竖条 + 头）
d.rectangle((X0, 42, X1, 46), fill=H)
d.line((X0, 42, X1, 42), fill=G); d.line((X0, 47, X1, 47), fill=G)
for x in range(X0 + 2, X1 - 1, 4):
    d.point((x, 43), fill=F); d.line((x, 44, x, 46), fill=F); d.point((x + 1, 45), fill=F)
# 方石砌缝：每 4 行一条横缝，竖缝错开
for i, y in enumerate(range(51, 60, 4)):
    d.line((X0, y, X1, y), fill=H)
    for x in range(X0 + (0 if i % 2 else 4), X1, 8):
        d.line((x, y - 3, x, y - 1), fill=H)
# 屋顶：先把旧屋顶（y 11–19）抹成天空，再画 5 级阶梯
for y in range(11, 20):
    for x in range(60, 125):
        if im.getpixel((x, y)) in (F, H, G):
            im.putpixel((x, y), SKY_A if y < 14 else SKY_I)
cx = 93
steps = [(11, 9), (12, 12), (14, 16), (16, 20), (18, 24)]   # (起始行, 半宽)
for y0, hw in steps:
    rows = (y0,) if y0 == 11 else (y0, y0 + 1)
    for k, y in enumerate(rows):
        d.line((cx - hw, y, cx + hw, y), fill=F if k == 0 else H)
        d.line((cx + hw - 2, y, cx + hw, y), fill=G)
im.save(out)
print(out)
