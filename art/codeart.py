"""七大奇迹：代码画的像素素材（不调 PixelLab）。

需要准确、或者几何形状更干净的东西用代码画，颜色全部来自 spec §1 调色板：
  - pips/*      8×8 小点 14 个（卡面成本、手机卡面）
  - icons/*     12 个几何图标（勾、空阶段、交易箭头、链环、组合能力图标）；其余 25 个用 PixelLab
  - ui/arrow-pass  传牌箭头 4 帧
  - fx/*        粒子特效：传牌气流、交锋火星、标记落地、石粉、闪星、金币翻转、烟花（每样 3 个变体当候选）
  - tokens/*    战争标记：PixelLab 出空白底牌，这里盖上 3×5 像素数字（export 时调用 stamp_token）

用法：python art/codeart.py   → art/out/r1/code/ 下出全部候选（变体 v1–v3），并拼一张总览 contact.png
"""
from __future__ import annotations

import math
import pathlib
import random

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "r1" / "code"

T = (0, 0, 0, 0)
INK = (30, 52, 84, 255)
WHITE = (255, 255, 255, 255)
MARBLE = (236, 240, 244, 255)
MARBLE_D = (176, 190, 206, 255)
MARBLE_DD = (122, 140, 158, 255)
SEA = (46, 111, 168, 255)
SEA_L = (94, 155, 192, 255)
SKY = (156, 195, 214, 255)
MOON = (215, 232, 232, 255)
GOLD = (216, 168, 58, 255)
GOLD_L = (255, 210, 122, 255)
COIN = (240, 190, 50, 255)
COIN_D = (168, 132, 32, 255)
FIRE = (242, 160, 61, 255)
RED = (200, 58, 48, 255)
RED_D = (138, 38, 32, 255)
RED_L = (232, 106, 92, 255)
GREEN = (52, 156, 76, 255)
GREEN_L = (92, 192, 112, 255)
GREEN_D = (34, 105, 58, 255)
OLIVE = (107, 122, 58, 255)
OLIVE_L = (157, 166, 90, 255)
PURPLE = (124, 72, 178, 255)
PURPLE_L = (162, 118, 212, 255)
PURPLE_D = (84, 48, 124, 255)
SAND = (232, 217, 176, 255)

RES = {  # 底色、亮、暗
    "W": ((110, 140, 50, 255), (150, 180, 80, 255), (70, 92, 30, 255)),
    "C": ((182, 84, 56, 255), (222, 128, 96, 255), (128, 56, 36, 255)),
    "S": ((150, 156, 164, 255), (204, 210, 216, 255), (104, 110, 120, 255)),
    "O": ((70, 76, 104, 255), (120, 130, 170, 255), (44, 48, 70, 255)),
    "G": ((90, 200, 226, 255), (190, 240, 252, 255), (50, 140, 170, 255)),
    "L": ((176, 128, 216, 255), (220, 190, 244, 255), (124, 84, 168, 255)),
    "P": ((232, 210, 140, 255), (252, 240, 196, 255), (184, 158, 92, 255)),
}


def grid(rows: list[str], colors: dict[str, tuple]) -> Image.Image:
    h, w = len(rows), len(rows[0])
    img = Image.new("RGBA", (w, h), T)
    for y, row in enumerate(rows):
        assert len(row) == w, (rows, y)
        for x, ch in enumerate(row):
            if ch != ".":
                img.putpixel((x, y), colors[ch])
    return img


def outline(img: Image.Image, color=INK) -> Image.Image:
    """给所有不透明像素外面加一圈 1px 描边（四邻域）。"""
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 0 and src[nx, ny][:3] != color[:3]:
                    dst[x, y] = color
                    break
    return out


# ---------------------------------------------------------------- 8×8 小点
SQUARE = [".kkkkkk.", "khhbbbbk", "khbbbbbk", "kbbbbbbk", "kbbbbbbk", "kbbbbbdk", "kbbbbddk", ".kkkkkk."]
ROUND = ["..kkkk..", ".khhbbk.", "khhbbbbk", "khbbbbbk", "kbbbbbbk", "kbbbbbdk", ".kbbddk.", "..kkkk.."]


def pip_res(key: str) -> Image.Image:
    base, hi, dark = RES[key]
    shape = SQUARE if key in "WCSO" else ROUND  # 原料方、制成品圆
    img = grid(shape, {"k": INK, "b": base, "h": hi, "d": dark})
    # 每种加一个小记号，色弱也分得清
    marks = {
        "W": [(3, 3), (4, 3), (3, 4), (4, 4)],          # 年轮：中间一块深色
        "C": [(1, 4), (2, 4), (3, 4), (4, 4), (5, 4), (6, 4)],  # 砖缝：一条横线
        "S": [(5, 2), (4, 3)],                          # 石纹：一道斜裂
        "O": [(3, 3), (5, 5)],                          # 矿：两颗亮点
        "G": [(5, 2), (5, 3)],                          # 玻璃：竖高光
        "L": [(2, 4), (3, 4), (4, 4), (5, 4)],          # 布：一道褶
        "P": [(2, 3), (3, 3), (4, 3), (5, 3), (2, 5), (3, 5), (4, 5)],  # 纸：两条线（不是字）
    }
    mark_color = {"W": dark, "C": hi, "S": dark, "O": hi, "G": WHITE, "L": dark, "P": dark}[key]
    for p in marks[key]:
        img.putpixel(p, mark_color)
    return img


PIPS = {
    "pip-coin": (ROUND, {"k": INK, "b": COIN, "h": GOLD_L, "d": COIN_D}),
    "pip-shield": (["kkkkkkkk", "kbbhbbbk", "kbbhbbbk", "khhhhhhk", "kbbhbbdk", ".kbhbdk.", "..kddk..", "...kk..."],
                   {"k": INK, "b": RED, "h": GOLD_L, "d": RED_D}),
    "pip-vp": (["...kk...", "..kbbk..", ".kbhbbk.", "kbhbbbbk", "kbbbbbdk", ".kbbbdk.", "..kddk..", "...kk..."],
               {"k": INK, "b": OLIVE_L, "h": (200, 210, 140, 255), "d": OLIVE}),
    "pip-compass": (["...kk...", "..kbbk..", "..kbbk..", ".kbkkbk.", ".kbkkbk.", "kbk..kbk", "kbk..kbk", "kk....kk"],
                    {"k": INK, "b": GREEN_L}),
    "pip-gear": (["..kkkk..", ".kbkkbk.", "kbbbbbbk", "kbbkkbbk", "kbbkkbbk", "kbbbbbbk", ".kbkkbk.", "..kkkk.."],
                 {"k": INK, "b": GREEN_L}),
    "pip-tablet": (["..kkkk..", ".kbbbbk.", "kbbhhbbk", "kbbbbbbk", "kbhhhhbk", "kbbbbbbk", "kbbbbbbk", "kkkkkkkk"],
                   {"k": INK, "b": GREEN_L, "h": GREEN_D}),
    "pip-chain": (["kkkk....", "kbbk....", "kbkkkkk.", "kkkbbbk.", "..kbkkbk", "..kkkbbk", "....kbbk", "....kkkk"],
                  {"k": INK, "b": SKY}),
}


def pip(name: str) -> Image.Image:
    if name[4:] in RES:
        return pip_res(name[4:])
    rows, colors = PIPS[name]
    return grid(rows, colors)


# ---------------------------------------------------------------- 16×16 几何图标
def up(img: Image.Image, k: int) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def canvas16() -> Image.Image:
    return Image.new("RGBA", (16, 16), T)


def card_shape(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, band) -> None:
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=INK)
    d.rectangle((x + 1, y + 1, x + w - 2, y + h - 2), fill=MARBLE)
    d.rectangle((x + 1, y + 1, x + w - 2, y + 3), fill=band)


def icon_ready() -> Image.Image:
    return grid([
        "................",
        "............kkk.",
        "...........kggk.",
        "..........kggk..",
        ".........kggk...",
        ".kkk....kggk....",
        "kgghk..kggk.....",
        ".kgghkkggk......",
        "..kgghggk.......",
        "...kgggk........",
        "....kgk.........",
        ".....k..........",
        "................", "................", "................", "................"],
        {"k": INK, "g": GREEN_L, "h": (200, 240, 200, 255)}).transform(
        (16, 16), Image.AFFINE, (1, 0, 0, 0, 1, -2), Image.NEAREST)


def icon_stage_open() -> Image.Image:
    """没建的阶段：灰色空心三角楣（墨蓝描边，白底黑底都看得见）。"""
    img = grid([
        "................",
        ".......kk.......",
        ".....kkddkk.....",
        "...kkd....dkk...",
        ".kkd........dkk.",
        "kkkkkkkkkkkkkkkk",
        "kddddddddddddddk",
        "kkkkkkkkkkkkkkkk",
        ".kdk..kdk..kdk..",
        ".kdk..kdk..kdk..",
        ".kdk..kdk..kdk..",
        ".kdk..kdk..kdk..",
        ".kdk..kdk..kdk..",
        "kkkkkkkkkkkkkkkk",
        "kddddddddddddddk",
        "kkkkkkkkkkkkkkkk"], {"k": INK, "d": MARBLE_D})
    return img


def coin8() -> Image.Image:
    return pip("pip-coin")


def icon_trade_left() -> Image.Image:
    img = grid([
        "................",
        "....k...........",
        "...kbk..........",
        "..kbbkkkkkkkk...",
        ".kbbbbbbbbbbbk..",
        "..kbbkkkkkkkk...",
        "...kbk..........",
        "....k...........",
        "................", "................", "................", "................", "................",
        "................", "................", "................"], {"k": INK, "b": SEA_L})
    img.alpha_composite(coin8(), (8, 8))
    return img


def icon_trade() -> Image.Image:
    img = grid([
        "....k...........",
        "...kbk..........",
        "..kbbkkkkkkkk...",
        ".kbbbbbbbbbbbk..",
        "..kbbkkkkkkkk...",
        "...kbk..........",
        "....k...........",
        "...........k....",
        "..........kbk...",
        "...kkkkkkkkbbk..",
        "..kbbbbbbbbbbbk.",
        "...kkkkkkkkbbk..",
        "..........kbk...",
        "...........k....",
        "................", "................"], {"k": INK, "b": SEA_L})
    img.alpha_composite(coin8(), (0, 7))
    return img


def icon_chain() -> Image.Image:
    return grid([
        "................",
        ".kkkkk..........",
        "kbbbbbk.........",
        "kbkkkbk.........",
        "kbk.kbkkkkk.....",
        "kbk.kbbbbbbk....",
        "kbkkkbkkkkbk....",
        "kbbbbbk..kbk....",
        ".kkkkbk..kbk....",
        "....kbk..kbk....",
        "....kbkkkkbk....",
        "....kbbbbbbk....",
        ".....kkkkkk.....",
        "................", "................", "................"],
        {"k": INK, "b": SKY}).transform((16, 16), Image.AFFINE, (1, 0, -2, 0, 1, -1), Image.NEAREST)


def icon_sci_any() -> Image.Image:
    img = canvas16()
    img.alpha_composite(pip("pip-compass"), (0, 0))
    img.alpha_composite(pip("pip-gear"), (8, 0))
    img.alpha_composite(pip("pip-tablet"), (4, 8))
    return img


def icon_any_raw() -> Image.Image:
    img = canvas16()
    for (k, x, y) in (("W", 0, 0), ("C", 8, 0), ("S", 0, 8), ("O", 8, 8)):
        img.alpha_composite(pip_res(k), (x, y))
    return img


def icon_any_goods() -> Image.Image:
    img = canvas16()
    for (k, x, y) in (("G", 0, 0), ("L", 8, 0), ("P", 4, 8)):
        img.alpha_composite(pip_res(k), (x, y))
    return img


def icon_seventh() -> Image.Image:
    img = canvas16()
    d = ImageDraw.Draw(img)
    card_shape(d, 1, 0, 9, 13, (52, 108, 212, 255))
    card_shape(d, 6, 3, 9, 13, GOLD)
    return img


def icon_discard_build() -> Image.Image:
    img = canvas16()
    d = ImageDraw.Draw(img)
    for i in range(3):  # 弃牌堆
        d.rectangle((1, 12 - i, 14, 15 - i), fill=INK)
        d.rectangle((2, 13 - i, 13, 14 - i), fill=MARBLE_D if i < 2 else MARBLE)
    card_shape(d, 4, 0, 8, 10, GOLD)
    d.line((7, 4, 8, 4), fill=GOLD)
    d.point((6, 5), fill=GOLD)
    d.point((9, 5), fill=GOLD)
    return img


def icon_free_build() -> Image.Image:
    img = canvas16()
    d = ImageDraw.Draw(img)
    card_shape(d, 0, 2, 10, 14, (52, 108, 212, 255))
    star = grid([".....k.....", "....kgk....", "kkkkgggkkkk", ".kggghgggk.", "..kgggggk..", "..kggkggk..", ".kgk...kgk.", ".kk.....kk."],
                {"k": INK, "g": GOLD_L, "h": WHITE})
    img.alpha_composite(star, (5, 0))
    return img


def icon_copy_guild() -> Image.Image:
    img = canvas16()
    d = ImageDraw.Draw(img)
    card_shape(d, 0, 0, 9, 12, PURPLE)
    card_shape(d, 6, 4, 9, 12, PURPLE_L)
    d.line((2, 14, 4, 14), fill=INK)
    d.point((4, 13), fill=INK)
    d.point((4, 15), fill=INK)
    return img


CODE_ICONS = {
    "ready": icon_ready, "stage-open": icon_stage_open, "trade": icon_trade, "trade-left": icon_trade_left,
    "chain": icon_chain, "sci-any": icon_sci_any, "eff-any-raw": icon_any_raw, "eff-any-goods": icon_any_goods,
    "eff-seventh": icon_seventh, "eff-discard-build": icon_discard_build, "eff-free-build": icon_free_build,
    "eff-copy-guild": icon_copy_guild,
}

# ---------------------------------------------------------------- 战争标记数字
DIGITS = {
    "1": ["01", "11", "01", "01", "01"], "3": ["111", "001", "011", "001", "111"],
    "5": ["111", "100", "111", "001", "111"], "+": ["000", "010", "111", "010", "000"],
    "-": ["000", "000", "111", "000", "000"],
}


def stamp(img: Image.Image, s: str, color=WHITE, shadow=INK) -> Image.Image:
    """在 16×16 底牌正中盖上 3×5 数字（带 1px 阴影描边）。"""
    out = img.copy()
    w = sum(len(DIGITS[c][0]) + 1 for c in s) - 1
    x0, y0 = (16 - w) // 2, 5
    layer = Image.new("RGBA", img.size, T)
    x = x0
    for c in s:
        for j, row in enumerate(DIGITS[c]):
            for i, bit in enumerate(row):
                if bit == "1":
                    layer.putpixel((x + i, y0 + j), color)
        x += len(DIGITS[c][0]) + 1
    out.alpha_composite(outline(layer, shadow))
    return out


# ---------------------------------------------------------------- 传牌箭头（4 帧，朝左）
def arrow_frames(variant: int) -> Image.Image:
    strip = Image.new("RGBA", (128, 16), T)
    body = {1: SEA_L, 2: GOLD_L, 3: MARBLE}[variant]
    hi = {1: SKY, 2: WHITE, 3: WHITE}[variant]
    for f, dx in enumerate((0, -1, -2, -1)):
        fr = Image.new("RGBA", (32, 16), T)
        d = ImageDraw.Draw(fr)
        x = 4 + dx
        d.polygon([(x, 8), (x + 8, 1), (x + 8, 5), (x + 24, 5), (x + 24, 11), (x + 8, 11), (x + 8, 15)], fill=body)
        d.line((x + 9, 6, x + 23, 6), fill=hi)
        d.line((x + 2, 8, x + 7, 3), fill=hi)
        # 尾巴后面的速度线：随帧闪动
        for k, yy in enumerate((6, 10)):
            if (f + k) % 2 == 0:
                d.line((x + 26, yy, x + 28 - k, yy), fill=body)
        strip.alpha_composite(outline(fr), (f * 32, 0))
    return strip


# ---------------------------------------------------------------- 粒子特效
def put(img, x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def fx_pass_trail(v: int) -> Image.Image:
    rng = random.Random(v)
    W, H, N = 48, 16, 6
    lines = [(rng.randint(2, 14), rng.uniform(0.6, 1.0), rng.randint(6, 14)) for _ in range(5 + v)]
    cols = [SEA_L, SKY, SEA] if v == 1 else [SKY, MOON, SEA_L] if v == 2 else [GOLD_L, SEA_L, SKY]
    strip = Image.new("RGBA", (W * N, H), T)
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, H), T)
        d = ImageDraw.Draw(fr)
        for i, (y, speed, ln) in enumerate(lines):
            head = 4 + f * 9 * speed  # 气流往左吹：画在帧里，头在左
            x0 = head
            length = max(2, int(ln * (1 - f / (N - 1) * 0.6)))
            d.line((x0, y, x0 + length, y), fill=cols[i % len(cols)])
            d.point((x0, y), fill=WHITE)
            if f >= 3:
                d.point((x0 + length + 2, y), fill=cols[i % len(cols)])
        strip.alpha_composite(fr, (f * W, 0))
    return strip


def star4(d, cx, cy, r, c, core=WHITE):
    d.line((cx - r, cy, cx + r, cy), fill=c)
    d.line((cx, cy - r, cx, cy + r), fill=c)
    d.point((cx, cy), fill=core)


def fx_clash(v: int) -> Image.Image:
    rng = random.Random(10 + v)
    W, N = 32, 6
    strip = Image.new("RGBA", (W * N, W), T)
    rays = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.7, 1.0)) for _ in range(10 + 2 * v)]
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, W), T)
        d = ImageDraw.Draw(fr)
        r = [3, 7, 11, 13, 14][f]
        inner = [0, 2, 6, 9, 12][f]
        for a, k in rays:
            x0, y0 = 16 + math.cos(a) * inner * k, 16 + math.sin(a) * inner * k
            x1, y1 = 16 + math.cos(a) * r * k, 16 + math.sin(a) * r * k
            col = [WHITE, GOLD_L, FIRE, RED, RED_D][f]
            d.line((x0, y0, x1, y1), fill=col)
        if f < 2:
            d.ellipse((16 - 3 + f, 16 - 3 + f, 16 + 3 - f, 16 + 3 - f), fill=GOLD_L)
            star4(d, 16, 16, 5 + 2 * f, WHITE)
        strip.alpha_composite(outline(fr) if f < 3 else fr, (f * W, 0))
    return strip


def fx_token_land(v: int) -> Image.Image:
    W, N = 24, 5
    strip = Image.new("RGBA", (W * N, W), T)
    dust = [MARBLE, SAND, MARBLE_D][v - 1]
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, W), T)
        d = ImageDraw.Draw(fr)
        r = 4 + f * 2
        for k in range(8):
            a = k * math.pi / 4 + (v * 0.3)
            x, y = 12 + math.cos(a) * r, 15 + math.sin(a) * r * 0.45
            s = max(1, 2 - f // 2)
            d.rectangle((x - s // 2, y - s // 2, x + s // 2, y + s // 2), fill=dust)
        if f in (1, 2):
            star4(d, 4 + v, 6, 2, GOLD_L)
            star4(d, 19 - v, 4 + f, 2, GOLD_L)
        strip.alpha_composite(outline(fr) if f < 2 else fr, (f * W, 0))
    return strip


def fx_build_dust(v: int) -> Image.Image:
    rng = random.Random(30 + v)
    W, H, N = 48, 24, 6
    strip = Image.new("RGBA", (W * N, H), T)
    puffs = [(rng.uniform(-1, 1), rng.uniform(0.4, 1.0), rng.randint(2, 4)) for _ in range(9 + v)]
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, H), T)
        d = ImageDraw.Draw(fr)
        t = (f + 1) / (N - 1)
        for dx, dy, s in puffs:
            x = 24 + dx * 20 * t
            y = 21 - dy * 12 * t
            r = max(1, int(s * (1.2 - 0.6 * t)))
            col = MARBLE if t < 0.6 else MARBLE_D
            d.ellipse((x - r, y - r, x + r, y + r), fill=col)
            if r >= 2:
                d.point((x - 1, y - 1), fill=WHITE)
        strip.alpha_composite(outline(fr, MARBLE_DD) if f < 3 else fr, (f * W, 0))
    return strip


def fx_stage_shine(v: int) -> Image.Image:
    rng = random.Random(40 + v)
    W, N = 32, 6
    strip = Image.new("RGBA", (W * N, W), T)
    stars = [(rng.randint(5, 26), rng.randint(5, 26), rng.randint(0, 3)) for _ in range(5 + v)]
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, W), T)
        d = ImageDraw.Draw(fr)
        for x, y, born in stars:
            age = f - born
            if 0 <= age <= 2:
                r = [1, 3, 1][age]
                star4(d, x, y, r, GOLD_L if age != 1 else GOLD, WHITE)
                if r == 3:
                    d.point((x - 1, y - 1), fill=GOLD_L)
                    d.point((x + 1, y + 1), fill=GOLD_L)
        strip.alpha_composite(fr, (f * W, 0))
    return strip


def fx_coin_spin(v: int) -> Image.Image:
    """金币绕竖轴翻转：宽度 14→10→4→10→14 的椭圆，循环。"""
    N = 6
    strip = Image.new("RGBA", (16 * N, 16), T)
    face = [COIN, GOLD, COIN][v - 1]
    for f, w in enumerate((14, 10, 4, 2, 4, 10)):
        fr = Image.new("RGBA", (16, 16), T)
        d = ImageDraw.Draw(fr)
        x0 = 8 - w // 2
        d.ellipse((x0, 1, x0 + w - 1, 14), fill=INK)
        if w > 2:
            d.ellipse((x0 + 1, 2, x0 + w - 2, 13), fill=face if f < 3 else COIN_D)
            if w >= 10:
                d.ellipse((x0 + 3, 4, x0 + w - 4, 11), outline=COIN_D)
                d.line((x0 + 3, 5, x0 + 3, 6), fill=GOLD_L)
        strip.alpha_composite(fr, (f * 16, 0))
    return strip


def fx_fireworks(v: int) -> Image.Image:
    rng = random.Random(50 + v)
    W, N = 64, 8
    palette = [[(230, 70, 110, 255), GOLD, WHITE], [SEA_L, (90, 200, 226, 255), WHITE], [FIRE, RED, GOLD_L]][v - 1]
    strip = Image.new("RGBA", (W * N, W), T)
    sparks = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.75, 1.0)) for _ in range(22)]
    for f in range(N - 1):
        fr = Image.new("RGBA", (W, W), T)
        d = ImageDraw.Draw(fr)
        if f == 0:  # 升空的火种
            d.line((32, 40, 32, 46), fill=palette[1])
            d.point((32, 39), fill=WHITE)
        else:
            t = f / (N - 2)
            r = 6 + 22 * math.sqrt(t)
            for a, k in sparks:
                x, y = 32 + math.cos(a) * r * k, 30 + math.sin(a) * r * k + 6 * t * t
                tx, ty = 32 + math.cos(a) * (r * k - 4), 30 + math.sin(a) * (r * k - 4) + 6 * t * t
                col = palette[2] if f < 3 else palette[0] if f < 5 else palette[1]
                if f < 6:
                    d.line((tx, ty, x, y), fill=palette[0] if f >= 3 else palette[1])
                put(fr, x, y, col)
        strip.alpha_composite(fr, (f * W, 0))
    return strip


FX = {
    "fx/pass-trail": fx_pass_trail, "fx/clash": fx_clash, "fx/token-land": fx_token_land,
    "fx/build-dust": fx_build_dust, "fx/stage-shine": fx_stage_shine, "fx/coin-spin": fx_coin_spin,
    "fx/fireworks": fx_fireworks,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made: list[tuple[str, Image.Image]] = []
    for name in ["pip-W", "pip-C", "pip-S", "pip-O", "pip-G", "pip-L", "pip-P", *PIPS]:
        img = pip(name)
        (OUT / "pips").mkdir(exist_ok=True)
        img.save(OUT / "pips" / f"{name}.png")
        made.append((name, img))
    for name, fn in CODE_ICONS.items():
        img = fn()
        (OUT / "icons").mkdir(exist_ok=True)
        img.save(OUT / "icons" / f"{name}.png")
        made.append((name, img))
    for v in (1, 2, 3):
        img = arrow_frames(v)
        (OUT / "ui").mkdir(exist_ok=True)
        img.save(OUT / "ui" / f"arrow-pass-v{v}.png")
        made.append((f"arrow v{v}", img))
        for key, fn in FX.items():
            img = fn(v)
            (OUT / "fx").mkdir(exist_ok=True)
            img.save(OUT / f"{key}-v{v}.png")
            made.append((f"{key} v{v}", img))
    # 总览：夜、日两种底各一份，放大 3 倍
    rows = []
    for bg in ((22, 28, 40, 255), (250, 250, 248, 255)):
        sheet = Image.new("RGBA", (1500, 2000), bg)
        x = y = 6
        rowh = 0
        for _, img in made:
            im = up(img, 3)
            if x + im.width > 1500:
                x, y, rowh = 6, y + rowh + 6, 0
            sheet.alpha_composite(im, (x, y))
            x += im.width + 6
            rowh = max(rowh, im.height)
        rows.append(sheet.crop((0, 0, 1500, y + rowh + 6)))
    out = Image.new("RGBA", (1500, sum(r.height for r in rows)))
    out.alpha_composite(rows[0], (0, 0))
    out.alpha_composite(rows[1], (0, rows[0].height))
    out.save(OUT / "contact.png")
    print("ok", len(made), OUT / "contact.png")


if __name__ == "__main__":
    main()
