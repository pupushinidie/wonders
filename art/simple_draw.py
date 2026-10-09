"""七大奇迹简洁版的画法（被 art/simple.py 调用）。全部用代码画，不用 PixelLab、不用外部图片。

风格约定（spec §1 白石海港）：
- 硬边像素，透明小图外圈 1px 墨蓝 #1E3454 描边；形状用「遮罩 + 自动斜面」画：左上一圈亮、右下一圈暗。
- 字只用 Fusion Pixel 12px（原图 12px，界面 ×2 显示就是 24px），白字 + 1px 墨蓝描边。
- 颜色只从 spec 调色板里取。
"""
from __future__ import annotations

import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFont

import codeart as ca

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
FONT_WOFF2 = ROOT / "apps/web/src/assets/pixel/fusion-pixel-12px-zh_hans.woff2"
FONT_CACHE = ART / "out" / "fusion12.ttf"

T = (0, 0, 0, 0)
INK = ca.INK
WHITE = ca.WHITE


def rgb(h: str, a: int = 255) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


# ---------------------------------------------------------------- 调色板（spec §1）
P = {
    "marble_l": rgb("FFFFFF"), "marble": rgb("ECF0F4"), "marble_m": rgb("D8DDE0"), "marble_d": rgb("B0BECE"),
    "marble_dd": rgb("7A8C9E"), "ink": rgb("1E3454"),
    "sea": rgb("2E6FA8"), "sea_m": rgb("5E9BC0"), "sky": rgb("9CC3D6"), "sky_l": rgb("C8E0EA"),
    "night": rgb("0E1624"), "night_sea": rgb("1B2935"), "night_fog": rgb("2A404B"), "moon": rgb("D7E8E8"),
    "olive_d": rgb("3A4230"), "olive": rgb("6B7A3A"), "olive_l": rgb("9DA65A"),
    "terracotta": rgb("B5563A"), "fire": rgb("F2A03D"), "fire_l": rgb("FFD27A"), "gold": rgb("D8A83A"),
    "coin": rgb("F0BE32"), "coin_d": rgb("A88420"), "sand": rgb("E8D9B0"), "sand_d": rgb("C8B48A"),
    "dusk_sky": rgb("E8A06A"), "dusk_sky2": rgb("C87A86"), "dusk_sea": rgb("3A4A6E"),
}
CARD = {  # 主色、亮、暗（spec 七种卡色）
    "brown": (rgb("8C582C"), rgb("B07A44"), rgb("5E3A1C")),
    "gray": (rgb("8A8C92"), rgb("B4B6BC"), rgb("5C5E64")),
    "blue": (rgb("346CD4"), rgb("5E92EE"), rgb("22489A")),
    "green": (rgb("349C4C"), rgb("5CC070"), rgb("22693A")),
    "yellow": (rgb("E2B834"), rgb("F4D66A"), rgb("A88420")),
    "red": (rgb("C83A30"), rgb("E86A5C"), rgb("8A2620")),
    "purple": (rgb("7C48B2"), rgb("A276D4"), rgb("54307C")),
}
# 座位色 = 奇迹色（Okabe-Ito 色盲安全色组，7 色两两分得开）
SEAT = {
    "giza": rgb("E69F00"), "rhodes": rgb("D55E00"), "alexandria": rgb("56B4E9"), "ephesus": rgb("F0E442"),
    "babylon": rgb("009E73"), "olympia": rgb("CC79A7"), "halicarnassus": rgb("0072B2"),
}
AGE_BACK = {1: (rgb("B5563A"), rgb("D98A5E"), rgb("8A3E2A")), 2: (rgb("2E6FA8"), rgb("5E9BC0"), rgb("22489A")),
            3: (rgb("7A4E9E"), rgb("A276D4"), rgb("54307C"))}


def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (255,)


# ---------------------------------------------------------------- 字
_font = None


def font() -> ImageFont.FreeTypeFont:
    global _font
    if _font is None:
        if not FONT_CACHE.exists():
            from fontTools.ttLib import TTFont
            FONT_CACHE.parent.mkdir(parents=True, exist_ok=True)
            f = TTFont(str(FONT_WOFF2))
            f.flavor = None
            f.save(str(FONT_CACHE))
        _font = ImageFont.truetype(str(FONT_CACHE), 12)
    return _font


def text_layer(s: str, color=WHITE, scale: int = 1, outline_color=INK) -> Image.Image:
    """12px 像素字（scale=2 就是 24px 原图像素），1px 描边，裁到内容大小。"""
    box = font().getbbox(s)
    w, h = box[2] - box[0] + 2, 14
    img = Image.new("RGBA", (w, h), T)
    d = ImageDraw.Draw(img)
    d.fontmode = "1"
    d.text((1 - box[0], 0), s, font=font(), fill=color)
    bbox = img.getbbox()
    img = img.crop(bbox) if bbox else img
    if scale > 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    pad = Image.new("RGBA", (img.width + 2, img.height + 2), T)
    pad.alpha_composite(img, (1, 1))
    return ca.outline(pad, outline_color) if outline_color else pad


# ---------------------------------------------------------------- 遮罩 + 自动斜面
def shaded(mask: Image.Image, base, light, dark, outline=INK) -> Image.Image:
    m = mask.load()
    w, h = mask.size
    inside = lambda x, y: 0 <= x < w and 0 <= y < h and m[x, y] > 0  # noqa: E731
    img = Image.new("RGBA", (w, h), T)
    px = img.load()
    edge = set()
    for y in range(h):
        for x in range(w):
            if inside(x, y) and not all(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                edge.add((x, y))
    for y in range(h):
        for x in range(w):
            if not inside(x, y):
                continue
            if (x, y) in edge:
                px[x, y] = outline if outline else base
            elif (x - 1, y) in edge or (x, y - 1) in edge:
                px[x, y] = light
            elif (x + 1, y) in edge or (x, y + 1) in edge:
                px[x, y] = dark
            else:
                px[x, y] = base
    return img


def mask(size, *shapes) -> Image.Image:
    """shapes: ("rect", box) / ("ellipse", box) / ("poly", pts) / ("line", pts, width) / ("cut-*", ...) 挖掉。"""
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for s in shapes:
        kind, *args = s
        fill = 0 if kind.startswith("cut-") else 255
        kind = kind.removeprefix("cut-")
        if kind == "rect":
            d.rectangle(args[0], fill=fill)
        elif kind == "ellipse":
            d.ellipse(args[0], fill=fill)
        elif kind == "poly":
            d.polygon(args[0], fill=fill)
        elif kind == "line":
            d.line(args[0], fill=fill, width=args[1])
    return m


def part(size, colors, *shapes, outline=INK) -> Image.Image:
    return shaded(mask(size, *shapes), *colors, outline=outline)


def stack(size, *layers) -> Image.Image:
    img = Image.new("RGBA", size, T)
    for layer, xy in layers:
        img.alpha_composite(layer, xy)
    return img


def dots(img: Image.Image, pts, color) -> Image.Image:
    for p in pts:
        img.putpixel(p, color)
    return img


def up(img: Image.Image, k: int) -> Image.Image:
    return img if k == 1 else img.resize((img.width * k, img.height * k), Image.NEAREST)


S16 = (16, 16)
TAN = (rgb("D6AA6E"), rgb("F0D296"), rgb("A0703C"))
BRICK = (rgb("B65438"), rgb("DE8060"), rgb("803824"))
STONE = (rgb("C4CAD0"), rgb("E8ECF0"), rgb("8C949E"))
ORE = (rgb("464C68"), rgb("6E78A0"), rgb("2C3046"))
GLASS = (rgb("5AC8E2"), rgb("BEF0FC"), rgb("3290AA"))
CLOTH = (rgb("B080D8"), rgb("DCBEF4"), rgb("7C54A8"))
PAPER = (rgb("E8D28C"), rgb("FCF0C4"), rgb("B89E5C"))
SCI = (rgb("5CC070"), rgb("A8E4B4"), rgb("2E8444"))
REDS = (rgb("C83A30"), rgb("E86A5C"), rgb("8A2620"))
GOLDS = (rgb("F0BE32"), rgb("FFE08A"), rgb("A88420"))
GOLD2 = (rgb("D8A83A"), rgb("FFD27A"), rgb("9C7424"))
MARBLES = (rgb("ECF0F4"), rgb("FFFFFF"), rgb("B0BECE"))
GREENS = (rgb("6B7A3A"), rgb("9DA65A"), rgb("3A4230"))
LEAF = (rgb("86A84A"), rgb("B4CC70"), rgb("4E6E2E"))
BRONZE = (rgb("C8823C"), rgb("F0B470"), rgb("8A5424"))


BARK = (rgb("8C582C"), rgb("B07A44"), rgb("5E3A1C"))


def log(y):
    body = part(S16, BARK, ("rect", (1, y, 13, y + 5)))
    end = part(S16, TAN, ("ellipse", (10, y, 15, y + 5)))
    img = stack(S16, (body, (0, 0)), (end, (0, 0)))
    return dots(img, [(12, y + 2), (13, y + 3), (12, y + 3)], TAN[2])


def icon_res_W():
    leaf = part(S16, LEAF, ("poly", [(2, 0), (6, 0), (6, 3), (3, 4)]))
    return stack(S16, (log(9), (0, 0)), (log(4), (0, 0)), (leaf, (0, 0)))


def brick(x0, y0):
    p = part(S16, BRICK, ("rect", (x0, y0, x0 + 7, y0 + 4)))
    return p


def icon_res_C():
    return stack(S16, (brick(0, 10), (0, 0)), (brick(8, 10), (0, 0)), (brick(4, 6), (0, 0)), (brick(2, 2), (0, 0)))


def icon_res_S():
    img = part(S16, STONE, ("poly", [(3, 4), (6, 2), (11, 2), (14, 5), (15, 10), (13, 13), (4, 14), (1, 11), (1, 7)]))
    return dots(img, [(7, 5), (8, 6), (8, 7), (9, 8), (9, 9), (8, 10)], STONE[2])


def icon_res_O():
    img = part(S16, ORE, ("poly", [(2, 6), (5, 3), (9, 2), (13, 4), (14, 9), (11, 13), (6, 14), (2, 11)]))
    dots(img, [(6, 6), (10, 9), (7, 11), (11, 6)], rgb("BEF0FC"))
    return dots(img, [(5, 6), (9, 9)], rgb("6E78A0"))


def icon_res_G():
    body = part(S16, GLASS, ("ellipse", (3, 6, 12, 15)), ("rect", (6, 3, 9, 7)))
    cork = part(S16, TAN, ("rect", (5, 0, 10, 3)))
    img = stack(S16, (body, (0, 0)), (cork, (0, 0)))
    return dots(img, [(5, 9), (5, 10), (6, 8)], WHITE)


def icon_res_L():
    body = part(S16, CLOTH, ("rect", (1, 4, 12, 12)))
    end = part(S16, (CLOTH[1], WHITE, CLOTH[0]), ("ellipse", (9, 4, 15, 12)))
    img = stack(S16, (body, (0, 0)), (end, (0, 0)))
    dots(img, [(4, 6), (4, 7), (4, 8), (4, 9), (4, 10), (7, 6), (7, 7), (7, 8), (7, 9), (7, 10)], CLOTH[2])
    return dots(img, [(12, 8), (12, 7), (13, 8)], CLOTH[2])


def icon_res_P():
    sheet = part(S16, PAPER, ("rect", (3, 3, 12, 13)))
    top = part(S16, (PAPER[2], PAPER[0], rgb("8C7440")), ("rect", (1, 1, 14, 4)))
    bot = part(S16, (PAPER[2], PAPER[0], rgb("8C7440")), ("rect", (1, 12, 14, 15)))
    return stack(S16, (sheet, (0, 0)), (top, (0, 0)), (bot, (0, 0)))


def icon_sci_compass():
    legs = part(S16, SCI, ("line", [(7, 4), (3, 14)], 3), ("line", [(8, 4), (12, 14)], 3), ("ellipse", (5, 0, 10, 5)))
    return dots(legs, [(7, 2), (8, 2), (7, 3), (8, 3)], SCI[2])


def icon_sci_gear():
    shapes = [("ellipse", (2, 2, 13, 13))]
    for x, y in ((6, 0), (6, 12)):
        shapes.append(("rect", (x, y, x + 3, y + 3)))
    for x, y in ((0, 6), (12, 6)):
        shapes.append(("rect", (x, y, x + 3, y + 3)))
    for pts in ([(2, 4), (4, 2), (5, 3), (3, 5)], [(13, 4), (11, 2), (10, 3), (12, 5)],
                [(2, 11), (4, 13), (5, 12), (3, 10)], [(13, 11), (11, 13), (10, 12), (12, 10)]):
        shapes.append(("poly", pts))
    shapes.append(("cut-rect", (7, 7, 8, 8)))
    return part(S16, SCI, *shapes)


def icon_sci_tablet():
    img = part(S16, SCI, ("ellipse", (3, 0, 12, 9)), ("rect", (3, 4, 12, 15)))
    for y in (6, 9, 12):
        for x in range(5, 11):
            img.putpixel((x, y), SCI[2])
    return img


def icon_shield():
    img = part(S16, REDS, ("poly", [(1, 1), (14, 1), (14, 8), (8, 15), (7, 15), (1, 8)]))
    for y in range(3, 12):
        img.putpixel((7, y), GOLDS[1])
        img.putpixel((8, y), GOLDS[0])
    for x in range(4, 12):
        img.putpixel((x, 5), GOLDS[1])
    return img


def icon_coin():
    img = part(S16, GOLDS, ("ellipse", (1, 1, 14, 14)))
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 11, 11), outline=GOLDS[2])
    return dots(img, [(6, 6), (6, 7), (7, 6)], GOLDS[1])


def icon_vp():
    img = part(S16, LEAF, ("ellipse", (0, 1, 15, 16)), ("cut-ellipse", (4, 5, 11, 12)), ("cut-rect", (6, 0, 9, 6)))
    for x, y in ((2, 8), (3, 5), (5, 3), (13, 8), (12, 5), (10, 3), (3, 11), (12, 11), (6, 13), (9, 13)):
        img.putpixel((x, y), LEAF[2])
    return img


def facade(colors, col_colors=None):
    ped = part(S16, colors, ("poly", [(0, 6), (7, 1), (8, 1), (15, 6)]))
    beam = part(S16, colors, ("rect", (0, 6, 15, 8)))
    base = part(S16, colors, ("rect", (0, 13, 15, 15)))
    cols = [part(S16, col_colors or colors, ("rect", (x, 8, x + 2, 13))) for x in (1, 6, 11)]
    return stack(S16, *[(c, (0, 0)) for c in cols], (ped, (0, 0)), (beam, (0, 0)), (base, (0, 0)))


def icon_stage_built():
    return facade(GOLD2)


def icon_waiting():
    glass = part(S16, (rgb("C8E0EA"), WHITE, rgb("9CC3D6")),
                 ("poly", [(3, 2), (12, 2), (8, 8), (7, 8)]), ("poly", [(7, 8), (8, 8), (12, 13), (3, 13)]))
    d = ImageDraw.Draw(glass)
    d.polygon([(5, 11), (10, 11), (11, 12), (4, 12)], fill=GOLDS[0])
    d.line((7, 9, 8, 9), fill=GOLDS[0])
    d.line((5, 4, 10, 4), fill=GOLDS[0])
    top = part(S16, TAN, ("rect", (2, 0, 13, 2)))
    bot = part(S16, TAN, ("rect", (2, 13, 13, 15)))
    return stack(S16, (glass, (0, 0)), (top, (0, 0)), (bot, (0, 0)))


def icon_act_build():
    handle = part(S16, TAN, ("rect", (7, 6, 9, 15)))
    head = part(S16, STONE, ("rect", (2, 1, 13, 6)))
    return stack(S16, (handle, (0, 0)), (head, (0, 0)))


def icon_act_wonder():
    img = facade(MARBLES)
    arrow = part(S16, GOLD2, ("poly", [(12, 0), (15, 3), (13, 3), (13, 6), (11, 6), (11, 3), (9, 3)]))
    return stack(S16, (img, (0, 1)), (arrow, (0, 0)))


def icon_act_sell():
    layers = [(part(S16, GOLDS, ("ellipse", (1, y, 14, y + 5))), (0, 0)) for y in (10, 6, 2)]
    return stack(S16, *layers)


def icon_cat_brown():
    b = part(S16, BRICK, ("rect", (0, 9, 9, 14)))
    l1 = part(S16, TAN, ("ellipse", (8, 6, 15, 13)))
    l2 = part(S16, TAN, ("ellipse", (4, 1, 11, 8)))
    return stack(S16, (b, (0, 0)), (l1, (0, 0)), (l2, (0, 0)))


def icon_cat_gray():
    g = CARD["gray"]
    body = part(S16, (g[1], WHITE, g[0]), ("ellipse", (3, 4, 12, 15)), ("rect", (6, 1, 9, 5)))
    handles = part(S16, (g[1], WHITE, g[0]), ("rect", (2, 3, 4, 8)), ("rect", (11, 3, 13, 8)))
    lip = part(S16, (g[1], WHITE, g[0]), ("rect", (5, 0, 10, 2)))
    img = stack(S16, (handles, (0, 0)), (body, (0, 0)), (lip, (0, 0)))
    for x in range(5, 11):
        img.putpixel((x, 10), CARD["gray"][2])
    return img


def icon_cat_blue():
    b = CARD["blue"]
    return facade((b[1], WHITE, b[0]), MARBLES)


def icon_cat_green():
    g = CARD["green"]
    glass = part(S16, (rgb("C8E0EA"), WHITE, rgb("9CC3D6")), ("rect", (6, 0, 9, 6)), ("ellipse", (2, 5, 13, 15)))
    d = ImageDraw.Draw(glass)
    d.chord((3, 6, 12, 14), 10, 170, fill=g[1])
    d.line((4, 11, 11, 11), fill=WHITE)
    return glass


def icon_cat_yellow():
    y = CARD["yellow"]
    bag = part(S16, y, ("ellipse", (1, 5, 14, 15)), ("poly", [(4, 1), (11, 1), (9, 5), (6, 5)]))
    tie = part(S16, REDS, ("rect", (4, 4, 11, 6)))
    img = stack(S16, (bag, (0, 0)), (tie, (0, 0)))
    return dots(img, [(6, 10), (7, 9), (8, 9), (9, 10), (8, 11), (7, 11)], y[2])


def icon_cat_red():
    crest = part(S16, REDS, ("rect", (5, 0, 10, 3)), ("ellipse", (2, 0, 13, 5)))
    dome = part(S16, BRONZE, ("ellipse", (2, 3, 13, 14)), ("rect", (2, 8, 5, 15)), ("rect", (10, 8, 13, 15)),
                ("cut-rect", (6, 10, 9, 15)))
    img = stack(S16, (crest, (0, 0)), (dome, (0, 0)))
    return dots(img, [(5, 8), (6, 8), (9, 8), (10, 8)], INK)


def icon_cat_purple():
    p = CARD["purple"]
    tails = part(S16, GOLD2, ("poly", [(4, 9), (7, 9), (5, 15), (2, 15)]), ("poly", [(8, 9), (11, 9), (13, 15), (10, 15)]))
    seal = part(S16, p, ("ellipse", (1, 0, 14, 12)))
    d = ImageDraw.Draw(seal)
    d.ellipse((4, 3, 11, 9), outline=p[2])
    return stack(S16, (tails, (0, 0)), (seal, (0, 0)))


ICONS = {
    "res-W": icon_res_W, "res-C": icon_res_C, "res-S": icon_res_S, "res-O": icon_res_O, "res-G": icon_res_G,
    "res-L": icon_res_L, "res-P": icon_res_P, "sci-compass": icon_sci_compass, "sci-gear": icon_sci_gear,
    "sci-tablet": icon_sci_tablet, "shield": icon_shield, "coin": icon_coin, "vp": icon_vp,
    "stage-built": icon_stage_built, "waiting": icon_waiting, "act-build": icon_act_build,
    "act-wonder": icon_act_wonder, "act-sell": icon_act_sell, "cat-brown": icon_cat_brown, "cat-gray": icon_cat_gray,
    "cat-blue": icon_cat_blue, "cat-green": icon_cat_green, "cat-yellow": icon_cat_yellow, "cat-red": icon_cat_red,
    "cat-purple": icon_cat_purple,
}


def icon(name: str) -> Image.Image:
    if name in ICONS:
        return ICONS[name]()
    return ca.CODE_ICONS[name]()


# ---------------------------------------------------------------- 战争标记
def token(name: str) -> Image.Image:
    if name == "war-loss":
        base = part(S16, (rgb("6E2828"), rgb("A04040"), rgb("461818")),
                    ("poly", [(1, 0), (14, 0), (14, 8), (8, 15), (7, 15), (1, 8)]))
        dots(base, [(10, 1), (9, 2), (10, 3), (9, 4)], rgb("461818"))  # 裂纹
        return ca.stamp(base, "-1")
    k = {"war-win1": BRONZE, "war-win3": (rgb("B4BCC8"), WHITE, rgb("788494")), "war-win5": GOLDS}[name]
    disc = part(S16, k, ("ellipse", (0, 0, 15, 15)))
    d = ImageDraw.Draw(disc)
    d.ellipse((2, 2, 13, 13), outline=LEAF[0])  # 月桂环
    for p in ((2, 7), (13, 7), (4, 3), (11, 3), (4, 12), (11, 12)):
        disc.putpixel(p, LEAF[1])
    return ca.stamp(disc, "+" + name[-1])


# ---------------------------------------------------------------- 建筑插画 56×44
SIL = {  # 每张卡背景里的建筑剪影类型
    "lumber_yard": "logs", "stone_pit": "quarry", "clay_pool": "kiln", "ore_vein": "mine", "tree_farm": "trees",
    "excavation": "quarry", "clay_pit": "kiln", "timber_yard": "logs", "forest_cave": "mine", "mine": "mine",
    "sawmill": "logs", "quarry": "quarry", "brickyard": "kiln", "foundry": "kiln",
    "loom": "workshop", "glassworks": "kiln", "press": "workshop",
    "pawnshop": "house", "baths": "temple", "altar": "altar", "theater": "theater", "aqueduct": "aqueduct",
    "temple": "temple", "statue": "statue", "courthouse": "temple", "pantheon": "dome", "gardens": "trees",
    "town_hall": "hall", "palace": "dome", "senate": "theater",
    "tavern": "house", "east_trading_post": "stall", "west_trading_post": "stall", "marketplace": "stall",
    "forum": "hall", "caravansery": "house", "vineyard": "trees", "bazar": "stall", "haven": "ship",
    "lighthouse": "tower", "chamber_of_commerce": "hall", "arena": "theater",
    "stockade": "palisade", "barracks": "house", "guard_tower": "tower", "walls": "wall",
    "training_ground": "palisade", "stables": "house", "archery_range": "palisade", "fortifications": "wall",
    "circus": "theater", "arsenal": "hall", "siege_workshop": "workshop",
    "apothecary": "house", "workshop": "workshop", "scriptorium": "house", "dispensary": "house",
    "laboratory": "dome", "library": "hall", "school": "temple", "lodge": "house", "observatory": "tower",
    "university": "hall", "academy": "temple", "study": "house",
}


def silhouette(kind: str, d: ImageDraw.ImageDraw, c) -> None:
    """56×44 背景里的低对比剪影，地面线 y=34。"""
    g = 34
    if kind == "temple":
        d.polygon([(8, 14), (28, 5), (48, 14)], fill=c)
        d.rectangle((8, 14, 48, 16), fill=c)
        for x in range(10, 47, 7):
            d.rectangle((x, 17, x + 3, g), fill=c)
        d.rectangle((6, g - 2, 50, g), fill=c)
    elif kind == "dome":
        d.ellipse((16, 4, 40, 26), fill=c)
        d.rectangle((10, 15, 46, g), fill=c)
    elif kind == "hall":
        d.rectangle((4, 10, 52, 13), fill=c)
        for x in range(5, 52, 6):
            d.rectangle((x, 14, x + 2, g), fill=c)
        d.rectangle((4, 6, 52, 9), fill=c)
    elif kind == "house":
        d.polygon([(10, 16), (28, 6), (46, 16)], fill=c)
        d.rectangle((13, 16, 43, g), fill=c)
    elif kind == "tower":
        d.rectangle((22, 6, 34, g), fill=c)
        d.rectangle((20, 3, 36, 8), fill=c)
        d.polygon([(18, g), (22, 20), (34, 20), (38, g)], fill=c)
    elif kind == "wall":
        d.rectangle((2, 14, 54, g), fill=c)
        for x in range(2, 54, 8):
            d.rectangle((x, 10, x + 4, 14), fill=c)
        d.rectangle((20, 6, 36, g), fill=c)
    elif kind == "palisade":
        for x in range(4, 54, 5):
            d.polygon([(x, 14), (x + 2, 9), (x + 4, 14), (x + 4, g), (x, g)], fill=c)
    elif kind == "theater":
        d.chord((4, 8, 52, 56), 180, 360, fill=c)
    elif kind == "aqueduct":
        d.rectangle((0, 10, 55, 14), fill=c)
        for x in range(0, 56, 14):
            d.rectangle((x, 14, x + 3, g), fill=c)
    elif kind == "statue":
        d.rectangle((22, 22, 34, g), fill=c)
        d.ellipse((25, 3, 31, 9), fill=c)
        d.polygon([(23, 22), (25, 10), (31, 10), (33, 22)], fill=c)
    elif kind == "altar":
        d.polygon([(4, g), (20, 18), (36, 18), (52, g)], fill=c)
        d.rectangle((22, 12, 34, 18), fill=c)
    elif kind == "stall":
        for x0 in (4, 30):
            d.polygon([(x0, 18), (x0 + 11, 10), (x0 + 22, 18)], fill=c)
            d.rectangle((x0 + 2, 18, x0 + 20, g), fill=c)
    elif kind == "ship":
        d.polygon([(8, 26), (48, 26), (42, g), (14, g)], fill=c)
        d.rectangle((27, 6, 29, 26), fill=c)
        d.polygon([(30, 8), (44, 22), (30, 22)], fill=c)
    elif kind == "logs":
        for x, y in ((8, 24), (20, 24), (32, 24), (14, 14), (26, 14), (20, 4)):
            d.ellipse((x, y, x + 12, y + 10), fill=c)
    elif kind == "quarry":
        for i, y in enumerate((10, 18, 26)):
            d.rectangle((4 + i * 6, y, 52 - i * 6, g), fill=c)
    elif kind == "mine":
        d.polygon([(0, g), (18, 6), (38, 10), (55, g)], fill=c)
    elif kind == "kiln":
        for x in (8, 30):
            d.ellipse((x, 12, x + 18, 40), fill=c)
        d.rectangle((14, 2, 17, 12), fill=c)
    elif kind == "trees":
        for x in (6, 22, 38):
            d.ellipse((x, 8, x + 12, 26), fill=c)
            d.rectangle((x + 5, 26, x + 7, g), fill=c)
    elif kind == "workshop":
        d.polygon([(6, 18), (28, 6), (50, 18)], fill=c)
        d.rectangle((8, 18, 48, g), fill=c)
        d.rectangle((38, 4, 42, 12), fill=c)


GUILD_SIL = "guildhall"


def card_bg(color: str, sil: str) -> Image.Image:
    base, light, dark = CARD[color]
    img = Image.new("RGBA", (56, 44), mix(base, P["marble_l"], 0.18))
    d = ImageDraw.Draw(img)
    # 天空两道浅色横条（像素风的渐变），地面一条深色
    d.rectangle((0, 0, 55, 5), fill=mix(base, P["marble_l"], 0.30))
    d.rectangle((0, 6, 55, 11), fill=mix(base, P["marble_l"], 0.24))
    d.rectangle((0, 35, 55, 43), fill=mix(base, dark, 0.45))
    d.line((0, 34, 55, 34), fill=dark)
    # 地面一排回纹
    for x in range(1, 56, 6):
        d.line((x, 38, x + 3, 38), fill=mix(base, dark, 0.75))
        d.line((x + 3, 38, x + 3, 40), fill=mix(base, dark, 0.75))
    if sil == GUILD_SIL:
        silhouette("hall", d, mix(base, light, 0.55))
        for x in (6, 22, 38):  # 紫色帷幔
            d.polygon([(x, 6), (x + 12, 6), (x + 6, 13)], fill=mix(base, dark, 0.6))
    else:
        silhouette(sil, d, mix(base, light, 0.55))
    return img


def centered(canvas: Image.Image, parts: list[Image.Image], gap: int = 2, y: int | None = None) -> None:
    w = sum(p.width for p in parts) + gap * (len(parts) - 1)
    h = max(p.height for p in parts)
    x = (canvas.width - w) // 2
    y0 = (canvas.height - h) // 2 - 3 if y is None else y
    for p in parts:
        canvas.alpha_composite(p, (x, y0 + (h - p.height) // 2))
        x += p.width + gap


RES_ORDER = "WCSOGLP"


def plate(img: Image.Image, x0: int, y0: int, x1: int, y1: int) -> None:
    """浅色大理石小牌（圆角），把小图标托起来。"""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y0, x1, y1), radius=3, fill=P["marble"], outline=INK)
    d.line((x0 + 2, y1 - 1, x1 - 2, y1 - 1), fill=P["marble_d"])


def card_art(card: dict) -> Image.Image:
    """card：data/cards.json 里的一条（effect、color、slug）。"""
    slug, color, eff = card["slug"], card["color"], card["effect"]
    img = card_bg(color, GUILD_SIL if color == "purple" else SIL.get(slug, "house"))
    t = eff["type"]
    big = lambda name: up(icon(name), 2)  # noqa: E731
    if t == "produce":
        res = eff["res"]
        if len(res) == 1:
            centered(img, [big(f"res-{res}")])
        else:
            centered(img, [big(f"res-{res[0]}"), text_layer(f"×{len(res)}")])
    elif t == "produceChoice":
        opts = eff["options"]
        if len(opts) == 2:
            plate(img, 6, 8, 49, 29)
            centered(img, [icon(f"res-{opts[0]}"), text_layer("/"), icon(f"res-{opts[1]}")], gap=2, y=11)
        elif len(opts) == 3:  # 一排三个 + 「任选」
            centered(img, [icon(f"res-{k}") for k in opts], gap=3, y=5)
            centered(img, [text_layer("任选")], y=23)
        else:  # 四种：左边 2×2，右边「任选」
            for i, k in enumerate(opts):  # 一排四个，描边互相压 3px
                img.alpha_composite(icon(f"res-{k}"), (1 + i * 13, 5))
            centered(img, [text_layer("任选")], y=23)
    elif t == "vp":
        centered(img, [big("vp"), text_layer(str(eff["n"]), scale=2)])
    elif t == "shields":
        n = eff["n"]
        if n == 1:
            centered(img, [big("shield")])
        else:
            centered(img, [big("shield"), text_layer(f"×{n}")])
    elif t == "science":
        sym = eff["symbol"]
        centered(img, [big("sci-any" if sym == "any" else f"sci-{sym}")])
    elif t == "coins":
        centered(img, [big("coin"), text_layer(str(eff["n"]), scale=2)])
    elif t == "tradeDiscount":
        frm = eff["from"]
        arrow = icon("trade" if len(frm) == 2 else "trade-left")
        if frm == ["right"]:
            arrow = arrow.transpose(Image.FLIP_LEFT_RIGHT)
        centered(img, [up(arrow, 2)], y=1)
        centered(img, [ca.pip_res(k) for k in eff["res"]], gap=1, y=34)
    elif t == "perCount":
        what = eff["what"]
        heads = [icon("stage-built") if w == "stage" else token("war-loss") if w == "defeat" else icon(f"cat-{w}")
                 for w in what]
        gains = []
        if eff.get("coinsNow"):
            gains.append(icon("coin"))
        if eff.get("vpEnd"):
            gains.append(icon("vp"))
        if len(heads) == 1:  # 左边大图标（数什么），右边竖着摆拿什么（金币 / 分）
            head = up(heads[0], 2)
            col = Image.new("RGBA", (16, 16 * len(gains) + 2 * (len(gains) - 1)), T)
            for i, g in enumerate(gains):
                col.alpha_composite(g, (0, i * 18))
            centered(img, [head, col], gap=3, y=1)
        else:  # 船主行会：三种卡一排，下面「→ 分」
            centered(img, heads, gap=2, y=2)
            centered(img, [text_layer("→")] + gains, gap=1, y=19)
        scope = eff["scope"]
        if "left" in scope or "right" in scope:  # 两邻：底部左右箭头
            arrow = ca.icon_trade_left().crop((0, 0, 16, 8))
            img.alpha_composite(arrow, (2, 35))
            img.alpha_composite(arrow.transpose(Image.FLIP_LEFT_RIGHT), (38, 35))
    return img


# ---------------------------------------------------------------- 奇迹插图 192×72
def sky(img: Image.Image, side: str) -> None:
    d = ImageDraw.Draw(img)
    if side == "a":
        bands = [P["sky_l"], mix(P["sky_l"], P["sky"], 0.5), P["sky"]]
        sea, sea2 = P["sea"], P["sea_m"]
    else:
        bands = [P["dusk_sky2"], mix(P["dusk_sky2"], P["dusk_sky"], 0.5), P["dusk_sky"]]
        sea, sea2 = P["dusk_sea"], mix(P["dusk_sea"], P["dusk_sky"], 0.35)
    for i, c in enumerate(bands):
        d.rectangle((0, i * 16, 191, i * 16 + 15), fill=c)
    d.rectangle((0, 48, 191, 71), fill=sea)
    rnd = random.Random(3)
    for _ in range(40):
        x, y = rnd.randint(0, 186), rnd.randint(50, 70)
        d.line((x, y, x + rnd.randint(2, 5), y), fill=sea2)
    if side == "b":
        d.ellipse((150, 30, 170, 50), fill=P["fire_l"])
        d.rectangle((0, 48, 191, 48), fill=P["fire_l"])


def wonder_parts(key: str, side: str):
    """返回 (遮罩列表 [(颜色组, 形状...)], 细节函数)。地平线 y=48，地面 y≥54。"""
    W, H = 192, 72
    stone = MARBLES if side == "a" else (rgb("F0D8C0"), rgb("FFF0DC"), rgb("B49480"))
    sand = (P["sand"], rgb("F8ECC8"), P["sand_d"]) if side == "a" else (rgb("E8B88C"), rgb("FFD8A8"), rgb("B08060"))
    layers = []
    if key == "giza":
        layers.append((sand, [("rect", (0, 56, 191, 71))]))
        for x0, w, h in ((118, 56, 30), (20, 64, 34), (62, 90, 50)):
            layers.append((sand, [("poly", [(x0, 58), (x0 + w // 2, 58 - h), (x0 + w, 58)])]))
    elif key == "rhodes":
        layers.append((stone, [("rect", (40, 50, 72, 62)), ("rect", (120, 50, 152, 62))]))
        layers.append((BRONZE, [("poly", [(56, 50), (82, 30), (90, 30), (70, 50)]),
                                ("poly", [(136, 50), (110, 30), (102, 30), (122, 50)]),
                                ("rect", (84, 14, 108, 36)), ("ellipse", (88, 2, 104, 16)),
                                ("rect", (110, 4, 113, 50)), ("rect", (106, 16, 112, 22))]))
    elif key == "alexandria":
        layers.append((STONE, [("ellipse", (40, 50, 152, 72))]))
        layers.append((stone, [("rect", (74, 36, 118, 56)), ("rect", (82, 18, 110, 38)), ("rect", (88, 6, 104, 20))]))
    elif key == "ephesus":
        layers.append((stone, [("rect", (20, 52, 172, 58)), ("rect", (26, 48, 166, 52)), ("poly", [(30, 22), (96, 6), (162, 22)]),
                               ("rect", (30, 22, 162, 27))]))
        for x in range(34, 160, 12):
            layers.append((stone, [("rect", (x, 27, x + 6, 48))]))
    elif key == "babylon":
        sand2 = (rgb("D8A86A"), rgb("F0CC90"), rgb("A07040")) if side == "a" else (rgb("C88860"), rgb("E8AC80"), rgb("905838"))
        for i, (x0, x1, y) in enumerate(((20, 172, 50), (40, 152, 38), (58, 134, 26), (76, 116, 14))):
            layers.append((sand2, [("rect", (x0, y, x1, y + 12 if i else 58))]))
    elif key == "olympia":
        layers.append((stone, [("rect", (24, 52, 168, 58)), ("poly", [(28, 20), (96, 4), (164, 20)]), ("rect", (28, 20, 164, 25))]))
        for x in (32, 50, 132, 150):
            layers.append((stone, [("rect", (x, 25, x + 9, 52))]))
        layers.append((GOLDS, [("rect", (82, 36, 110, 52)), ("rect", (86, 24, 106, 38)), ("ellipse", (90, 14, 102, 26))]))
    elif key == "halicarnassus":
        layers.append((stone, [("rect", (50, 36, 142, 58)), ("rect", (46, 56, 146, 60))]))
        for x in range(54, 140, 10):
            layers.append((stone, [("rect", (x, 26, x + 5, 36))]))
        layers.append((stone, [("rect", (52, 22, 140, 26))]))
        for i, y in enumerate((18, 14, 10, 6)):
            layers.append((stone, [("rect", (60 + i * 8, y, 132 - i * 8, y + 4))]))
        layers.append((BRONZE, [("rect", (88, 0, 104, 6))]))
    return layers


def wonder_art(key: str, side: str) -> Image.Image:
    img = Image.new("RGBA", (192, 72), T)
    sky(img, side)
    d = ImageDraw.Draw(img)
    # 远处橄榄色山丘（左右两侧），奇迹放中间
    hill = P["olive"] if side == "a" else rgb("6E5A6A")
    d.polygon([(0, 48), (0, 38), (20, 34), (36, 40), (44, 48)], fill=hill)
    d.polygon([(191, 48), (191, 36), (172, 32), (154, 42), (148, 48)], fill=hill)
    for colors, shapes in wonder_parts(key, side):
        img.alpha_composite(part((192, 72), colors, *shapes))
    if key == "alexandria":  # 塔顶火光
        img.alpha_composite(part((192, 72), (P["fire"], P["fire_l"], rgb("C86A28")), ("poly", [(90, 6), (96, 0), (102, 6)])))
    if key == "babylon":  # 每层垂下的绿植
        for x0, x1, y in ((20, 172, 50), (40, 152, 38), (58, 134, 26), (76, 116, 14)):
            for x in range(x0 + 2, x1 - 1, 3):
                d.line((x, y + 1, x, y + 1 + (x % 4) + 1), fill=LEAF[0])
                d.point((x, y), fill=LEAF[1])
    if key == "giza":  # 金字塔阴面
        for x0, w, h in ((118, 56, 30), (20, 64, 34), (62, 90, 50)):
            cx = x0 + w // 2
            for y in range(58 - h + 2, 58):
                half = int((y - (58 - h)) * (w / 2) / h)
                d.line((cx + 1, y, cx + half - 2, y), fill=(P["sand_d"] if side == "a" else rgb("B08060")))
    return img.convert("RGB")


# ---------------------------------------------------------------- 徽记 32×32
def emblem(key: str) -> Image.Image:
    seat = SEAT[key]
    ring = part((32, 32), (seat, mix(seat, WHITE, 0.45), mix(seat, INK, 0.35)), ("ellipse", (0, 0, 31, 31)))
    face = part((32, 32), MARBLES, ("ellipse", (4, 4, 27, 27)))
    img = stack((32, 32), (ring, (0, 0)), (face, (0, 0)))
    sil = Image.new("L", (32, 32), 0)
    d = ImageDraw.Draw(sil)
    if key == "giza":
        d.polygon([(7, 22), (15, 10), (23, 22)], fill=255)
        d.polygon([(17, 22), (21, 15), (26, 22)], fill=255)
    elif key == "rhodes":
        d.ellipse((14, 6, 18, 10), fill=255)
        d.rectangle((13, 10, 18, 17), fill=255)
        d.polygon([(13, 17), (10, 25), (12, 25), (15, 18), (16, 18), (19, 25), (21, 25), (18, 17)], fill=255)
        d.rectangle((20, 6, 20, 25), fill=255)
    elif key == "alexandria":
        d.rectangle((11, 18, 20, 24), fill=255)
        d.rectangle((12, 12, 19, 18), fill=255)
        d.rectangle((14, 7, 17, 12), fill=255)
    elif key == "ephesus":
        d.polygon([(7, 12), (15, 7), (24, 12)], fill=255)
        for x in (8, 12, 16, 20, 23):
            d.rectangle((x, 13, x + 1, 21), fill=255)
        d.rectangle((7, 22, 24, 24), fill=255)
    elif key == "babylon":
        for i, y in enumerate((20, 15, 10)):
            d.rectangle((7 + i * 3, y, 24 - i * 3, y + 4), fill=255)
    elif key == "olympia":
        d.ellipse((13, 6, 18, 11), fill=255)
        d.rectangle((11, 11, 20, 18), fill=255)
        d.rectangle((9, 18, 22, 24), fill=255)
        d.rectangle((22, 7, 22, 24), fill=255)
    elif key == "halicarnassus":
        d.rectangle((9, 17, 22, 24), fill=255)
        for x in (10, 13, 16, 19):
            d.rectangle((x, 13, x + 1, 17), fill=255)
        d.polygon([(9, 13), (15, 7), (16, 7), (22, 13)], fill=255)
    px = img.load()
    for y in range(32):
        for x in range(32):
            if sil.getpixel((x, y)):
                px[x, y] = INK
    if key == "alexandria":
        px[15, 6] = P["fire"]
        px[16, 6] = P["fire"]
    return img


# ---------------------------------------------------------------- 卡背 64×96
def card_back(age: int) -> Image.Image:
    base, light, dark = AGE_BACK[age]
    img = Image.new("RGBA", (64, 96), T)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 63, 95), fill=INK)
    d.rectangle((1, 1, 62, 94), fill=P["marble_l"])
    d.rectangle((2, 2, 61, 93), fill=P["marble_d"])
    d.rectangle((2, 2, 60, 92), fill=P["marble"])
    d.rectangle((3, 3, 60, 92), fill=INK)
    d.rectangle((4, 4, 59, 91), fill=base)
    # 回纹边
    for x in range(6, 58, 6):
        for y in (6, 88):
            d.line((x, y, x + 3, y), fill=light)
            d.line((x + 3, y, x + 3, y + 2), fill=light)
    # 斜格底纹
    for k in range(-96, 64, 8):
        d.line((k, 96, k + 96, 0), fill=mix(base, dark, 0.35))
    d.rectangle((4, 4, 59, 10), fill=base)
    d.rectangle((4, 85, 59, 91), fill=base)
    for x in range(6, 58, 6):
        for y in (6, 88):
            d.line((x, y, x + 3, y), fill=light)
            d.line((x + 3, y, x + 3, y + 2), fill=light)
    # 中间一座神庙正面
    temple = up(facade(MARBLES), 2)
    img.alpha_composite(temple, (16, 26))
    # 罗马数字牌
    w = age * 3 + (age - 1) * 2
    x0, y0 = 32 - w // 2, 66
    d.rectangle((x0 - 4, y0 - 3, x0 + w + 3, y0 + 11), fill=INK)
    d.rectangle((x0 - 3, y0 - 2, x0 + w + 2, y0 + 10), fill=P["marble"])
    for i in range(age):
        d.rectangle((x0 + i * 5, y0, x0 + i * 5 + 2, y0 + 8), fill=INK)
    for p in ((0, 0), (63, 0), (0, 95), (63, 95)):
        img.putpixel(p, T)
    return img


# ---------------------------------------------------------------- 场景 512×288
def column(d: ImageDraw.ImageDraw, x0: int, top: int, bottom: int, light, mid, dark) -> None:
    w = 40
    d.rectangle((x0 - 4, top, x0 + w + 4, top + 10), fill=light)  # 柱头
    d.rectangle((x0 - 4, top + 10, x0 + w + 4, top + 12), fill=dark)
    d.rectangle((x0, top + 12, x0 + w, bottom), fill=mid)
    for i, x in enumerate(range(x0 + 3, x0 + w - 2, 6)):
        d.line((x, top + 14, x, bottom - 2), fill=light if i < 2 else dark)
    d.rectangle((x0 - 6, bottom, x0 + w + 6, bottom + 8), fill=light)
    d.line((x0 - 6, bottom + 8, x0 + w + 6, bottom + 8), fill=dark)


def scene(theme: str, n: int) -> Image.Image:
    night = theme == "night"
    img = Image.new("RGBA", (512, 288), T)
    d = ImageDraw.Draw(img)
    if night:
        skyc = [P["night"], mix(P["night"], P["night_sea"], 0.5), P["night_sea"], P["night_fog"]]
        seac, sea2 = P["night_sea"], P["night_fog"]
        hills, town = rgb("16222E"), rgb("223444")
        mar = (rgb("6C7C8C"), rgb("4A5A6A"), rgb("2E3C4A"))
        floor = (rgb("3A4858"), rgb("2E3C4A"))
    else:
        skyc = [P["sky_l"], mix(P["sky_l"], P["sky"], 0.5), P["sky"], mix(P["sky"], P["marble_l"], 0.3)]
        seac, sea2 = P["sea"], P["sea_m"]
        hills, town = P["olive"], rgb("E4E2DA")
        mar = (P["marble_l"], P["marble"], P["marble_d"])
        floor = (P["marble"], P["marble_m"])
    # 天空：四道横带（像素渐变）+ 带间棋盘点过渡
    hz = 150
    for i, c in enumerate(skyc):
        y0, y1 = i * hz // 4, (i + 1) * hz // 4
        d.rectangle((0, y0, 511, y1), fill=c)
        if i:
            for x in range(0, 512, 2):
                d.point((x + (y0 % 2), y0), fill=skyc[i - 1])
    rnd = random.Random(7 + n)
    if night:
        for _ in range(70):
            x, y = rnd.randint(0, 511), rnd.randint(0, 110)
            d.point((x, y), fill=P["moon"] if rnd.random() < 0.3 else rgb("8CA0B4"))
        d.ellipse((360 if n == 1 else 120, 28, 384 if n == 1 else 144, 52), fill=P["moon"])
    else:
        for cx, cy in ((120, 40), (380, 26), (300, 60)):
            for k in range(3):
                d.ellipse((cx + k * 12 - 14, cy - 6 + (k % 2) * 3, cx + k * 12 + 10, cy + 8), fill=P["marble_l"])
    # 远山和两岸白城
    d.polygon([(0, hz), (0, 118), (60, 104), (130, 120), (170, hz)], fill=hills)
    d.polygon([(511, hz), (511, 112), (440, 100), (380, 122), (342, hz)], fill=hills)
    for x in list(range(20, 150, 14)) + list(range(372, 500, 14)):
        h = rnd.randint(6, 12)
        d.rectangle((x, hz - h - 4, x + 10, hz - 4), fill=town)
        d.rectangle((x, hz - h - 6, x + 10, hz - h - 4), fill=P["terracotta"] if not night else rgb("4A3A3A"))
        if night and rnd.random() < 0.5:
            d.point((x + 4, hz - h + 1), fill=P["fire_l"])
    # 海
    d.rectangle((0, hz, 511, 250), fill=seac)
    for _ in range(140):
        x, y = rnd.randint(0, 505), rnd.randint(hz + 3, 246)
        d.line((x, y, x + rnd.randint(3, 8), y), fill=sea2)
    if night:  # 月光倒影
        mx = 372 if n == 1 else 132
        glint = mix(P["night_fog"], P["moon"], 0.45)
        for y in range(hz + 6, 246, 7):
            w = rnd.randint(2, 6) + (y - hz) // 25
            off = rnd.randint(-3, 3)
            d.line((mx - w + off, y, mx + w + off, y), fill=glint)
    # 正中的灯塔（手机只露中间这一竖条）
    cx = 256
    d.ellipse((cx - 30, hz - 2, cx + 30, hz + 10), fill=hills)
    lt = (rgb("ECF0F4"), rgb("B0BECE")) if not night else (rgb("8C9CAC"), rgb("5A6A7A"))
    d.rectangle((cx - 10, hz - 34, cx + 10, hz + 2), fill=lt[0])
    d.rectangle((cx + 3, hz - 34, cx + 10, hz + 2), fill=lt[1])
    d.rectangle((cx - 7, hz - 56, cx + 7, hz - 34), fill=lt[0])
    d.rectangle((cx + 2, hz - 56, cx + 7, hz - 34), fill=lt[1])
    d.rectangle((cx - 5, hz - 66, cx + 5, hz - 56), fill=P["fire"] if night else P["terracotta"])
    if night:
        d.point((cx, hz - 68), fill=P["fire_l"])
        d.polygon([(cx + 6, hz - 63), (cx + 70, hz - 76), (cx + 70, hz - 54)], fill=mix(P["night_fog"], P["fire_l"], 0.18))
    # 前景：大理石地面 + 两侧柱子（构图 1）或栏杆和柏树（构图 2）
    d.rectangle((0, 250, 511, 287), fill=floor[0])
    for x in range(0, 512, 32):
        d.line((x, 250, x - 20, 287), fill=floor[1])
    d.line((0, 250, 511, 250), fill=mar[2])
    d.line((0, 268, 511, 268), fill=floor[1])
    if n == 1:
        column(d, 20, 0, 242, *mar)
        column(d, 452, 0, 242, *mar)
        d.rectangle((0, 0, 511, 8), fill=mar[1])
        d.line((0, 8, 511, 8), fill=mar[2])
    else:
        d.rectangle((0, 226, 511, 232), fill=mar[0])
        for x in range(6, 512, 16):
            d.rectangle((x, 232, x + 7, 248), fill=mar[1])
            d.line((x + 5, 233, x + 5, 247), fill=mar[2])
        d.rectangle((0, 246, 511, 250), fill=mar[0])
        cyp = rgb("2E4A26") if not night else rgb("16261A")
        for x in (24, 470):
            d.ellipse((x, 70, x + 22, 240), fill=cyp)
    if night:  # 两个火盆
        for x in ((90, 410) if n == 1 else (60, 440)):
            d.polygon([(x - 10, 236), (x + 10, 236), (x + 6, 244), (x - 6, 244)], fill=rgb("8A5424"))
            d.line((x - 6, 244, x - 9, 250), fill=rgb("8A5424"))
            d.line((x + 6, 244, x + 9, 250), fill=rgb("8A5424"))
            d.polygon([(x - 8, 236), (x - 3, 224), (x, 230), (x + 3, 220), (x + 8, 236)], fill=P["fire"])
            d.polygon([(x - 4, 236), (x, 228), (x + 4, 236)], fill=P["fire_l"])
    return img.convert("RGB")


# ---------------------------------------------------------------- 装饰
def laurel() -> Image.Image:
    """月桂冠：左右两枝从底部往上弯，顶上开口。"""
    img = Image.new("RGBA", (48, 32), T)
    stem = Image.new("RGBA", (48, 32), T)
    ds = ImageDraw.Draw(stem)
    pts = []
    for i in range(8):
        a = math.radians(255 - i * 18)
        pts.append((24 + math.cos(a) * 19, 15 - math.sin(a) * 14))
    for side in (1, -1):
        line = [(x if side == 1 else 47 - x, y) for x, y in pts]
        ds.line(line, fill=LEAF[2], width=2)
        for i, (x, y) in enumerate(line[1:], 1):
            ox = -3 if side == 1 else 3
            for dx, dy in ((ox, -1), (-ox // 3, -3)):
                cx, cy = int(x + dx * 0.6), int(y + dy * 0.6)
                leaf = part((48, 32), LEAF, ("ellipse", (cx - 3, cy - 2, cx + 3, cy + 2)))
                img.alpha_composite(leaf)
    img.alpha_composite(stem)
    berry = part((48, 32), REDS, ("ellipse", (21, 26, 26, 31)))
    img.alpha_composite(berry)
    return img


def ribbon() -> Image.Image:
    img = Image.new("RGBA", (160, 24), T)
    blue = (P["sea"], P["sea_m"], rgb("22489A"))
    tails = part((160, 24), (rgb("22489A"), P["sea"], rgb("16325E")),
                 ("poly", [(0, 6), (16, 6), (16, 22), (0, 22), (6, 14)]), ("poly", [(159, 6), (143, 6), (143, 22), (159, 22), (153, 14)]))
    body = part((160, 24), blue, ("rect", (10, 1, 149, 19)))
    img = stack((160, 24), (tails, (0, 0)), (body, (0, 0)))
    d = ImageDraw.Draw(img)
    d.line((13, 4, 146, 4), fill=P["gold"])
    d.line((13, 16, 146, 16), fill=P["gold"])
    return img


def cover() -> Image.Image:
    sc = scene("day", 1).convert("RGBA")
    img = sc.crop((64, 48, 448, 240)).copy()  # 384×192
    d = ImageDraw.Draw(img)
    # 地平线上远远立着几座奇迹的剪影
    d.polygon([(30, 102), (52, 80), (74, 102)], fill=P["sand_d"])
    d.polygon([(60, 102), (76, 88), (92, 102)], fill=P["sand"])
    for i, (x0, x1, y) in enumerate(((290, 350, 94), (298, 342, 86), (306, 334, 78))):
        d.rectangle((x0, y, x1, y + 8), fill=rgb("D8A86A"))
        for x in range(x0 + 2, x1, 3):
            d.point((x, y + 8), fill=LEAF[0])
    for x, y, k in ((70, 150, 1), (290, 136, -1)):  # 两艘帆船
        d.polygon([(x - 14, y), (x + 14, y), (x + 9, y + 7), (x - 9, y + 7)], fill=rgb("8A5424"))
        d.line((x, y - 22, x, y), fill=INK)
        d.polygon([(x + k, y - 20), (x + k, y - 3), (x + k * 14, y - 4)], fill=P["marble_l"])
    return img.convert("RGB")


def brazier_frames() -> Image.Image:
    strip = Image.new("RGBA", (16 * 6, 24), T)
    bowl = part((16, 24), BRONZE, ("poly", [(1, 13), (14, 13), (11, 18), (4, 18)]))
    legs = part((16, 24), BRONZE, ("line", [(5, 18), (2, 23)], 2), ("line", [(10, 18), (13, 23)], 2), ("rect", (7, 18, 8, 23)))
    flames = [
        [(3, 13), (5, 6), (7, 9), (8, 2), (10, 8), (12, 5), (12, 13)],
        [(3, 13), (4, 7), (7, 8), (9, 3), (10, 7), (13, 6), (12, 13)],
        [(3, 13), (5, 5), (7, 10), (8, 3), (11, 9), (12, 6), (12, 13)],
        [(3, 13), (4, 6), (6, 9), (7, 1), (10, 8), (12, 4), (12, 13)],
        [(3, 13), (5, 7), (7, 8), (9, 2), (10, 9), (13, 5), (12, 13)],
        [(3, 13), (4, 5), (7, 9), (8, 3), (10, 7), (12, 6), (12, 13)],
    ]
    for f, pts in enumerate(flames):
        fr = Image.new("RGBA", (16, 24), T)
        fl = part((16, 24), (P["fire"], P["fire_l"], rgb("C86A28")), ("poly", pts))
        core = part((16, 24), (P["fire_l"], WHITE, P["fire"]), ("poly", [(5, 13), (7, 9 - f % 2), (9, 8 + f % 3), (10, 13)]), outline=None)
        fr = stack((16, 24), (legs, (0, 0)), (fl, (0, 0)), (core, (0, 0)), (bowl, (0, 0)))
        strip.alpha_composite(fr, (f * 16, 0))
    return strip
