"""代码画的构图引导图（192×72），给 pixflux 当 init_image，用来拉住模型画不对的构图：
巴比伦（宽矮的拱廊阶梯花园，不是玛雅金字塔）、陵墓（高台基 + 柱廊 + 阶梯顶 + 驷马）、罗德岛（青铜步兵跨港）。
用法：python art/guides.py → art/out/r2/guides/<key>.png"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent / "out" / "r2" / "guides"
W, H = 192, 72


def hexc(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


SKY_T, SKY_B = hexc("8CC0DA"), hexc("D2E8EE")
SEA_D, SEA_M, SEA_L = hexc("2E6FA8"), hexc("5E9BC0"), hexc("9CC3D6")
OL_D, OL_M, OL_L = hexc("3A4230"), hexc("6B7A3A"), hexc("9DA65A")
MAR_L, MAR_M, MAR_S, MAR_D = hexc("FFFFFF"), hexc("ECF0F4"), hexc("B0BECE"), hexc("7A8C9E")
BR_L, BR_M, BR_D, BR_X = hexc("F2CC6A"), hexc("D8A83A"), hexc("B07A44"), hexc("5E3A1C")
MUD_L, MUD_M, MUD_D = hexc("EBDDB4"), hexc("D2B98A"), hexc("A8875A")
GLAZE = hexc("2E5FB0")


def base(horizon=44):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(horizon):
        t = y / horizon
        d.line([(0, y), (W, y)], fill=tuple(round(SKY_T[i] + (SKY_B[i] - SKY_T[i]) * t) for i in range(3)))
    for y in range(horizon, H):
        t = (y - horizon) / (H - horizon)
        c = SEA_L if t < 0.15 else SEA_M if t < 0.55 else SEA_D
        d.line([(0, y), (W, y)], fill=c)
    # 几朵云
    for cx, cy, r in ((24, 10, 6), (34, 8, 7), (150, 12, 6), (162, 9, 8), (174, 12, 5)):
        d.ellipse([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=MAR_L)
    return img, d


def babylon():
    img, d = base(40)
    # 远处平原和蓝釉砖城墙
    d.rectangle([0, 36, W, 46], fill=hexc("C9B98C"))
    d.rectangle([128, 30, 190, 38], fill=GLAZE)
    for x in range(128, 190, 4):
        d.rectangle([x, 28, x + 1, 29], fill=GLAZE)
    d.rectangle([150, 24, 158, 38], fill=hexc("244C90"))
    d.rectangle([0, 40, 40, 46], fill=OL_M)
    # 四层平台
    tiers = [(14, 50, 178, 62), (28, 40, 164, 50), (44, 30, 148, 40), (60, 20, 132, 30)]
    for x0, y0, x1, y1 in tiers:
        d.rectangle([x0, y0, x1, y1], fill=MUD_M)
        d.line([(x0, y0), (x1, y0)], fill=MUD_L)
        d.line([(x0, y0), (x0, y1)], fill=MUD_L)
        d.line([(x1, y0), (x1, y1)], fill=MUD_D)
        # 拱廊：一排圆拱门洞
        for ax in range(x0 + 4, x1 - 4, 8):
            d.rectangle([ax, y0 + 4, ax + 3, y1 - 1], fill=hexc("6A4E32"))
            d.point([(ax, y0 + 4), (ax + 3, y0 + 4)], fill=MUD_M)
        # 上沿垂下的藤蔓和顶上的树丛
        for vx in range(x0, x1, 3):
            ln = 2 + (vx * 7) % 4
            d.line([(vx, y0), (vx, y0 + ln)], fill=OL_M if vx % 2 else OL_L)
        for tx in range(x0 + 3, x1 - 3, 9):
            d.ellipse([tx, y0 - 5, tx + 6, y0 + 1], fill=OL_M)
            d.ellipse([tx + 1, y0 - 5, tx + 4, y0 - 2], fill=OL_L)
    # 顶上一圈树
    for tx in range(64, 128, 7):
        d.ellipse([tx, 12, tx + 7, 21], fill=OL_D)
        d.ellipse([tx + 1, 12, tx + 4, 16], fill=OL_M)
    # 河和水渠
    d.rectangle([0, 63, W, H], fill=SEA_M)
    d.line([(0, 66), (W, 66)], fill=SEA_L)
    d.rectangle([0, 62, W, 62], fill=MUD_D)
    return img


def halicarnassus():
    img, d = base(46)
    # 远处小山和白房子
    d.polygon([(0, 46), (0, 36), (30, 32), (60, 38), (60, 46)], fill=OL_M)
    d.polygon([(132, 46), (150, 34), (192, 30), (192, 46)], fill=OL_M)
    for hx in (6, 16, 26, 40, 140, 152, 166, 178):
        d.rectangle([hx, 40, hx + 6, 45], fill=MAR_M)
        d.rectangle([hx, 39, hx + 6, 39], fill=hexc("B5563A"))
    # 地面台阶
    d.rectangle([52, 60, 140, 64], fill=MAR_S)
    d.rectangle([48, 64, 144, 68], fill=MAR_D)
    cx = 92
    # 高台基
    d.rectangle([cx - 26, 36, cx + 26, 60], fill=MAR_M)
    d.rectangle([cx - 26, 36, cx - 24, 60], fill=MAR_L)
    d.rectangle([cx + 20, 36, cx + 26, 60], fill=MAR_S)
    d.rectangle([cx - 26, 40, cx + 26, 43], fill=MAR_S)   # 浮雕带
    for fx in range(cx - 24, cx + 24, 3):
        d.point((fx, 41), fill=MAR_D)
    # 柱廊
    d.rectangle([cx - 22, 33, cx + 22, 35], fill=MAR_L)
    d.rectangle([cx - 20, 22, cx + 20, 33], fill=MAR_D)
    for col in range(cx - 20, cx + 21, 5):
        d.rectangle([col, 22, col + 2, 33], fill=MAR_L)
    d.rectangle([cx - 22, 20, cx + 22, 22], fill=MAR_M)
    # 阶梯金字塔顶
    for i in range(8):
        hw = 22 - i * 2.5
        y = 19 - i * 1.5
        d.rectangle([cx - hw, y - 1, cx + hw, y], fill=MAR_M if i % 2 else MAR_S)
    # 顶上驷马战车
    d.rectangle([cx - 7, 5, cx + 7, 8], fill=BR_D)
    for hx in (-6, -3, 0, 3):
        d.rectangle([cx + hx, 2, cx + hx + 1, 5], fill=BR_X)
    d.rectangle([cx + 6, 1, cx + 8, 6], fill=BR_X)
    return img


def rhodes():
    img, d = base(46)
    # 两道防波堤，港口入口在中间
    d.polygon([(0, 50), (0, 58), (78, 58), (74, 50)], fill=MAR_S)
    d.polygon([(118, 50), (114, 58), (192, 58), (192, 50)], fill=MAR_S)
    d.rectangle([0, 50, 74, 51], fill=MAR_M)
    d.rectangle([118, 50, 192, 51], fill=MAR_M)
    d.rectangle([66, 44, 78, 50], fill=MAR_M)   # 两个堤头台座
    d.rectangle([114, 44, 126, 50], fill=MAR_M)
    # 跨港巨像（青铜），两腿分开踩在两座台座上
    B, L, X = BR_M, BR_L, BR_X
    d.polygon([(70, 44), (74, 44), (92, 26), (88, 24)], fill=B)    # 左腿
    d.polygon([(118, 44), (122, 44), (100, 24), (96, 26)], fill=hexc("9A6430"))  # 右腿（背光）
    d.rectangle([86, 20, 102, 28], fill=hexc("9A6430"))        # 短裙甲
    d.rectangle([87, 8, 101, 21], fill=B)                      # 胸甲
    d.rectangle([88, 9, 92, 18], fill=L)
    d.ellipse([90, 1, 98, 9], fill=B)                          # 头盔
    d.rectangle([92, 0, 97, 1], fill=hexc("B5563A"))           # 马鬃冠
    d.rectangle([101, 9, 104, 22], fill=B)                     # 右臂垂下握矛
    d.line([(105, 0), (105, 44)], fill=X)                      # 竖直长矛
    d.ellipse([78, 9, 90, 21], fill=BR_D)                      # 圆盾
    d.ellipse([81, 12, 87, 18], fill=BR_M)
    # 两腿之间驶过的帆船
    d.polygon([(86, 52), (106, 52), (102, 56), (90, 56)], fill=hexc("8C582C"))
    d.rectangle([95, 38, 96, 52], fill=X)
    d.polygon([(89, 39), (101, 39), (100, 50), (90, 50)], fill=MAR_L)
    # 右下留海面
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (babylon, halicarnassus, rhodes):
        fn().save(OUT / f"{fn.__name__}.png")
        print(OUT / f"{fn.__name__}.png")
