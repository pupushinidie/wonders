"""把 public/art 里的图按 spec §2 的尺寸摆成一张假牌桌（1440×790 和 390×664，夜/日），亲眼看真实显示大小下清不清楚。
卡框、卡名、成本按 spec §3.1 用代码画（界面会用 CSS 画同样的东西），字用 Fusion Pixel 12px ×2 = 24px。
输出 art/out/mock/table-<尺寸>-<主题>.png。用法：python art/mock_table.py
"""
from __future__ import annotations

import json
import pathlib

from PIL import Image, ImageDraw

import simple_draw as sd

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
import sys
PUB = ROOT / "apps/web/public/art"
OUT = ART / "out" / "mock"
if "--final" in sys.argv:  # 用定稿 art/out/final 摆：python art/mock_table.py --final → art/out/mock-final/
    PUB = ART / "out" / "final"
    OUT = ART / "out" / "mock-final"
CARDS = {c["name"].lower().replace(" ", "_"): c for c in json.loads((ROOT / "data/cards.json").read_text())}
WONDERS = {w["key"]: w for w in json.loads((ROOT / "data/wonders.json").read_text())}


def img(path: str, k: int = 1) -> Image.Image:
    return sd.up(Image.open(PUB / path).convert("RGBA"), k)


def txt(s: str, k: int = 2, color=sd.WHITE, outline=sd.INK) -> Image.Image:
    return sd.text_layer(s, color, k, outline)


def card_face(slug: str, k: int) -> Image.Image:
    c = CARDS[slug]
    base, light, dark = sd.CARD[c["color"]]
    face = Image.new("RGBA", (64, 96), sd.T)
    d = ImageDraw.Draw(face)
    d.rectangle((0, 0, 63, 95), fill=sd.INK)
    d.rectangle((1, 1, 62, 94), fill=sd.P["marble"])
    d.line((1, 1, 62, 1), fill=sd.WHITE)
    d.line((1, 1, 1, 94), fill=sd.WHITE)
    d.line((62, 1, 62, 94), fill=sd.P["marble_d"])
    d.line((1, 94, 62, 94), fill=sd.P["marble_d"])
    d.rectangle((3, 3, 60, 14), fill=base)
    d.line((3, 3, 60, 3), fill=light)
    d.line((3, 14, 60, 14), fill=dark)
    d.line((3, 15, 60, 15), fill=sd.INK)
    x = 5
    cost = c["cost"]
    if c["coin"]:
        face.alpha_composite(Image.open(PUB / "pips/pip-coin.png").convert("RGBA"), (x, 5))
        x += 9
    step = 7 if len(cost) > 5 else 9
    for r in cost:
        face.alpha_composite(Image.open(PUB / f"pips/pip-{r}.png").convert("RGBA"), (x, 5))
        x += step
    d.rectangle((3, 16, 60, 60), fill=sd.INK)
    face.alpha_composite(Image.open(PUB / f"cards/art/{slug}.png").convert("RGBA"), (4, 16))
    d.rectangle((3, 61, 60, 92), fill=sd.WHITE)
    for p in ((0, 0), (63, 0), (0, 95), (63, 95)):
        face.putpixel(p, sd.T)
    face = sd.up(face, k)
    name = c["zh"].replace("行会", "") if len(c["zh"]) > 4 else c["zh"]
    t = sd.text_layer(name, sd.INK, k, None)
    face.alpha_composite(t, ((face.width - t.width) // 2, 64 * k))
    return face


def strip(slug: str, w: int) -> Image.Image:
    c = CARDS[slug]
    base = sd.CARD[c["color"]][0]
    s = Image.new("RGBA", (w, 24), sd.INK)
    d = ImageDraw.Draw(s)
    d.rectangle((1, 1, w - 2, 22), fill=sd.WHITE)
    d.rectangle((1, 1, 14, 22), fill=base)
    t = sd.text_layer(c["zh"], sd.INK, 1, None)
    s.alpha_composite(t, (19, 5))
    return s


def board(key: str, k: int, built: int) -> Image.Image:
    art = img(f"wonders/{key}-a.png", k)
    stages = WONDERS[key]["sides"]["A"]
    h = art.height + 20 * k + 4
    b = Image.new("RGBA", (art.width + 4, h), sd.INK)
    b.alpha_composite(art, (2, 2))
    d = ImageDraw.Draw(b)
    sw = (art.width - 2 * (len(stages) - 1)) // len(stages)
    for i, st in enumerate(stages):
        x0 = 2 + i * (sw + 2)
        fill = sd.mix(sd.P["marble"], sd.P["gold"], 0.45) if i < built else sd.WHITE
        d.rectangle((x0, art.height + 4, x0 + sw - 1, h - 3), fill=fill)
        x = x0 + 3
        for r in st["cost"]:
            b.alpha_composite(img(f"pips/pip-{r}.png", k), (x, art.height + 8))
            x += 8 * k
        eff = st["effects"][0]
        label = f"{eff['n']}分" if eff["type"] == "vp" else {"coins": "+9金", "shields": "+2盾"}.get(eff["type"], "能力")
        t = sd.text_layer(label, sd.INK, 1 if k == 1 else 2, None)
        b.alpha_composite(t, (x0 + sw - t.width - 4, art.height + 4 + (20 * k - t.height) // 2))
    b.alpha_composite(img(f"wonders/{key}-emblem.png", 1), (6, 6))
    return b


def panel(w: int, h: int, night: bool) -> Image.Image:
    p = Image.new("RGBA", (w, h), (14, 22, 36, 200) if night else (255, 255, 255, 200))
    ImageDraw.Draw(p).rectangle((0, 0, w - 1, h - 1), outline=sd.INK)
    return p


HAND = ["temple", "sawmill", "glassworks", "laboratory", "caravansery", "archery_range", "bazar"]
CITY = {"brown": ["lumber_yard", "clay_pool", "ore_vein", "timber_yard"], "gray": ["loom"], "blue": ["altar", "baths"],
        "yellow": ["tavern"], "red": ["stockade", "barracks"], "green": ["scriptorium"], "purple": []}


def desktop(theme: str) -> Image.Image:
    night = theme == "night"
    W, H = 1440, 790
    canvas = Image.new("RGBA", (W, H))
    sc = img(f"scene/{theme}-1.png", 3)
    canvas.alpha_composite(sc.crop(((sc.width - W) // 2, (sc.height - H) // 2, (sc.width + W) // 2, (sc.height + H) // 2)))
    canvas.alpha_composite(panel(W, 40, night), (0, 0))
    canvas.alpha_composite(txt("时代 II · 第 3 轮"), (12, 8))
    arrow = img("ui/arrow-pass.png", 2).crop((0, 0, 64, 32)).transpose(Image.FLIP_LEFT_RIGHT)
    canvas.alpha_composite(arrow, (W - 260, 4))
    canvas.alpha_composite(txt("传给右邻"), (W - 190, 8))
    # 其他 4 位
    for i, key in enumerate(("babylon", "ephesus", "giza", "olympia")):
        x = 262 + i * 232
        canvas.alpha_composite(panel(220, 64, night), (x, 48))
        canvas.alpha_composite(img(f"wonders/{key}-emblem.png", 1), (x + 8, 56))
        canvas.alpha_composite(txt(f"玩家{i + 3}", 1), (x + 46, 56))
        canvas.alpha_composite(img("icons/coin.png", 1), (x + 46, 78))
        canvas.alpha_composite(txt("4", 1), (x + 64, 78))
        canvas.alpha_composite(img("icons/shield.png", 1), (x + 84, 78))
        canvas.alpha_composite(txt("2", 1), (x + 102, 78))
        for j in range(3):
            canvas.alpha_composite(img("icons/stage-built.png" if j < 1 else "icons/stage-open.png", 1), (x + 124 + j * 18, 78))
    # 左右邻居
    for side, key, x in (("左邻", "rhodes", 12), ("右邻", "alexandria", W - 228)):
        canvas.alpha_composite(panel(216, 300, night), (x, 120))
        canvas.alpha_composite(board(key, 1, 1), (x + 10, 128))
        canvas.alpha_composite(txt(side), (x + 10, 228))
        canvas.alpha_composite(img("icons/coin.png", 2), (x + 70, 228))
        canvas.alpha_composite(txt("5"), (x + 104, 228))
        canvas.alpha_composite(img("icons/shield.png", 2), (x + 130, 228))
        canvas.alpha_composite(txt("3"), (x + 164, 228))
        for j, t in enumerate(("war-win1", "war-loss", "war-win3")):
            canvas.alpha_composite(img(f"tokens/{t}.png", 2), (x + 10 + j * 36, 268))
        for j, r in enumerate("WCSOG"):
            canvas.alpha_composite(img(f"icons/res-{r}.png", 2), (x + 10 + j * 38, 312))
        for j, col in enumerate(("brown", "gray", "blue", "yellow", "red", "green", "purple")):
            canvas.alpha_composite(img(f"icons/cat-{col}.png", 1), (x + 10 + j * 28, 360))
            canvas.alpha_composite(txt(str(j % 3), 1), (x + 12 + j * 28, 380))
    # 自己：奇迹 ×2 + 城池
    canvas.alpha_composite(board("halicarnassus", 2, 2), (W // 2 - 194, 120))
    for i, (col, names) in enumerate(CITY.items()):
        for j, n in enumerate(names):
            canvas.alpha_composite(strip(n, 128), (240 + i * 136, 320 + j * 26))
    # 手牌
    for i, slug in enumerate(HAND):
        face = card_face(slug, 2)
        y = 578 - (12 if i == 0 else 0)
        canvas.alpha_composite(face, (W // 2 - 472 + i * 136, y))
    return canvas


def mobile(theme: str) -> Image.Image:
    night = theme == "night"
    W, H = 390, 664
    canvas = Image.new("RGBA", (W, H))
    sc = img(f"scene/{theme}-1.png", 3)
    canvas.alpha_composite(sc.crop(((sc.width - W) // 2, 0, (sc.width + W) // 2, H)))
    canvas.alpha_composite(panel(W, 36, night), (0, 0))
    canvas.alpha_composite(txt("时代 II · 3"), (8, 6))
    canvas.alpha_composite(img("ui/arrow-pass.png", 1).crop((0, 0, 32, 16)), (W - 44, 10))
    for i, key in enumerate(("babylon", "ephesus", "giza", "olympia")):
        canvas.alpha_composite(img(f"wonders/{key}-emblem.png", 1), (16 + i * 92, 44))
        canvas.alpha_composite(txt("4", 1), (52 + i * 92, 52))
    for j, key in enumerate(("rhodes", "alexandria")):
        x = 16 + j * 183
        canvas.alpha_composite(panel(175, 92, night), (x, 84))
        canvas.alpha_composite(img(f"wonders/{key}-emblem.png", 1), (x + 6, 90))
        canvas.alpha_composite(txt("左邻" if j == 0 else "右邻", 1), (x + 44, 92))
        canvas.alpha_composite(img("icons/coin.png", 1), (x + 6, 130))
        canvas.alpha_composite(txt("5", 1), (x + 24, 130))
        canvas.alpha_composite(img("icons/shield.png", 1), (x + 44, 130))
        canvas.alpha_composite(txt("3", 1), (x + 62, 130))
        for k, r in enumerate("WCSO"):
            canvas.alpha_composite(img(f"pips/pip-{r}.png", 2), (x + 6 + k * 20, 154))
    canvas.alpha_composite(board("halicarnassus", 1, 2), (16, 186))
    for i, slug in enumerate(HAND):
        face = card_face(slug, 1)
        canvas.alpha_composite(face, (58 + (i % 4) * 70, 300 + (i // 4) * 102))
    return canvas


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for theme in ("night", "day"):
        desktop(theme).convert("RGB").save(OUT / f"table-1440-{theme}.png")
        mobile(theme).convert("RGB").save(OUT / f"table-390-{theme}.png")
    print(OUT)
