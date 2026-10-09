"""七大奇迹：美术占位图（不调 PixelLab）。

按 art/spec.md 的清单，把每一项按正式的文件名、尺寸、帧数画成占位图，放进 apps/web/public/art/。
界面、教程、功能验收都用这些文件排版和跑通；出图阶段定稿后用同名正式图覆盖。

- 占位图一律在 PNG 里写一个文本块 guluga=placeholder，`--check` 靠它数出还剩几张占位图。
- 建筑插画、奇迹名单从 data/cards.json、data/wonders.json 读（文件名 = 英文名小写、空格换成下划线）。
- 同时写出 art/manifest.json（每个文件的尺寸、帧数、每帧毫秒、透明与否、主题），界面可以照抄常量。

用法：
  python art/placeholders.py            # 生成全部占位图 + manifest.json（已是正式图的文件不覆盖）
  python art/placeholders.py --force    # 连正式图也覆盖成占位图（慎用）
  python art/placeholders.py --check    # 核对 public/art：每项都在、尺寸帧数对、没有清单外的文件；列出剩下的占位图
  python art/placeholders.py --check --final   # 同上，且还有占位图就算失败（换图验收用）
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps/web/public/art"
FONT_WOFF2 = ROOT / "apps/web/src/assets/pixel/fusion-pixel-12px-zh_hans.woff2"
FONT_CACHE = ROOT / "art/out/fusion12.ttf"
MARK = "placeholder"

# ---------------------------------------------------------------- 调色板（和 spec.md「风格」一节一致）
INK = (30, 52, 84)            # #1E3454 描边、墨字
MARBLE = (236, 240, 244)      # #ECF0F4
MARBLE_LIGHT = (255, 255, 255)
MARBLE_DARK = (176, 190, 206)  # #B0BECE
SEA = (46, 111, 168)          # #2E6FA8
SKY = (156, 195, 214)         # #9CC3D6
NIGHT = (14, 22, 36)          # #0E1624
NIGHT2 = (27, 41, 53)         # #1B2935
MOON = (215, 232, 232)        # #D7E8E8
OLIVE = (107, 122, 58)        # #6B7A3A
TERRACOTTA = (181, 86, 58)    # #B5563A
FIRE = (242, 160, 61)         # #F2A03D
GOLD = (216, 168, 58)         # #D8A83A
COIN = (240, 190, 50)         # #F0BE32

CARD = {  # 七种卡色：主色
    "brown": (140, 88, 44),    # #8C582C
    "gray": (138, 140, 146),   # #8A8C92
    "blue": (52, 108, 212),    # #346CD4
    "green": (52, 156, 76),    # #349C4C
    "yellow": (226, 184, 52),  # #E2B834
    "red": (200, 58, 48),      # #C83A30
    "purple": (124, 72, 178),  # #7C48B2
}
RES = {  # 引擎字母 → (中文, 颜色)
    "W": ("木", (110, 140, 50)),   # #6E8C32
    "C": ("砖", (182, 84, 56)),    # #B65438
    "S": ("石", (150, 156, 164)),  # #969CA4
    "O": ("矿", (70, 76, 104)),    # #464C68
    "G": ("玻", (90, 200, 226)),   # #5AC8E2
    "L": ("布", (176, 128, 216)),  # #B080D8
    "P": ("纸", (232, 210, 140)),  # #E8D28C
}
AGE_BACK = {1: TERRACOTTA, 2: SEA, 3: (122, 78, 158)}  # 时代 I 陶土、II 海蓝、III 紫（#7A4E9E）


# ---------------------------------------------------------------- 清单
def slug(name: str) -> str:
    return name.lower().replace(" ", "_")


def load_cards() -> list[dict]:
    cards = json.loads((ROOT / "data/cards.json").read_text())
    seen: dict[str, dict] = {}
    for c in cards:
        seen.setdefault(c["name"], {"slug": slug(c["name"]), "zh": c["zh"], "color": c["color"], "age": c["age"]})
    out = list(seen.values())
    assert len(out) == 75, f"卡名应该是 75 个，读到 {len(out)} 个"
    return out


def load_wonders() -> list[dict]:
    ws = json.loads((ROOT / "data/wonders.json").read_text())
    assert len(ws) == 7
    return [{"key": w["key"], "zh": w["zh"]} for w in ws]


def item(path, w, h, *, frames=1, ms=None, loop=False, transparent=True, theme="both", draw, **extra):
    return dict(path=path, w=w, h=h, frames=frames, ms=ms, loop=loop, transparent=transparent, theme=theme,
                draw=draw, **extra)


ICONS = [  # (文件名, 占位字, 底色)
    *[(f"res-{k}", v[0], v[1]) for k, v in RES.items()],
    ("sci-compass", "规", CARD["green"]), ("sci-gear", "齿", CARD["green"]), ("sci-tablet", "板", CARD["green"]),
    ("sci-any", "任", CARD["green"]),
    ("shield", "盾", CARD["red"]), ("coin", "金", COIN), ("vp", "分", OLIVE),
    ("chain", "链", SEA),
    ("stage-built", "成", GOLD), ("stage-open", "空", MARBLE_DARK),
    ("act-build", "建", SEA), ("act-wonder", "奇", GOLD), ("act-sell", "卖", COIN),
    ("trade", "买", COIN), ("trade-left", "左", COIN),
    ("eff-any-raw", "原", CARD["brown"]), ("eff-any-goods", "品", CARD["gray"]),
    ("eff-free-build", "免", GOLD), ("eff-discard-build", "弃", GOLD), ("eff-seventh", "七", GOLD),
    ("eff-copy-guild", "抄", CARD["purple"]),
    ("ready", "好", (64, 160, 80)), ("waiting", "等", MARBLE_DARK),
    *[(f"cat-{c}", ch, CARD[c]) for c, ch in
      (("brown", "原"), ("gray", "制"), ("blue", "文"), ("green", "科"), ("yellow", "商"), ("red", "军"),
       ("purple", "会"))],
]
PIPS = [  # 8×8 小点（代码画），(文件名, 颜色)
    *[(f"pip-{k}", v[1]) for k, v in RES.items()],
    ("pip-coin", COIN), ("pip-shield", CARD["red"]), ("pip-vp", OLIVE),
    ("pip-compass", CARD["green"]), ("pip-gear", CARD["green"]), ("pip-tablet", CARD["green"]),
    ("pip-chain", SEA),
]
TOKENS = [("war-win1", "+1", True), ("war-win3", "+3", True), ("war-win5", "+5", True), ("war-loss", "-1", False)]
FX = [  # (文件名, 每帧宽, 高, 帧数, 每帧毫秒, 循环, 主题, 颜色)
    ("fx/pass-trail", 48, 16, 6, 60, False, "both", SKY),
    ("fx/clash", 32, 32, 6, 70, False, "both", FIRE),
    ("fx/token-land", 24, 24, 5, 60, False, "both", GOLD),
    ("fx/build-dust", 48, 24, 6, 70, False, "both", MARBLE_DARK),
    ("fx/stage-shine", 32, 32, 6, 80, False, "both", GOLD),
    ("fx/coin-spin", 16, 16, 6, 70, True, "both", COIN),
    ("fx/fireworks", 64, 64, 8, 90, False, "both", (230, 90, 120)),
    ("fx/brazier", 16, 24, 6, 120, True, "night", FIRE),
]


def build_items() -> list[dict]:
    items: list[dict] = []
    for theme in ("night", "day"):
        for n in (1, 2):
            items.append(item(f"scene/{theme}-{n}.png", 512, 288, transparent=False, theme=theme, draw="scene", n=n))
    for c in load_cards():
        items.append(item(f"cards/art/{c['slug']}.png", 56, 44, transparent=False, draw="card_art", **c))
    for age in (1, 2, 3):
        items.append(item(f"cards/back-age{age}.png", 64, 96, draw="card_back", age=age))
    for w in load_wonders():
        for side in ("a", "b"):
            items.append(item(f"wonders/{w['key']}-{side}.png", 192, 72, transparent=False, draw="wonder", side=side, **w))
        items.append(item(f"wonders/{w['key']}-emblem.png", 32, 32, draw="emblem", **w))
    for name, ch, color in ICONS:
        items.append(item(f"icons/{name}.png", 16, 16, draw="icon", ch=ch, color=color))
    for name, color in PIPS:
        items.append(item(f"pips/{name}.png", 8, 8, draw="pip", color=color))
    for name, text, win in TOKENS:
        items.append(item(f"tokens/{name}.png", 16, 16, draw="token", text=text, win=win))
    items.append(item("ui/arrow-pass.png", 32, 16, frames=4, ms=150, loop=True, draw="arrow"))
    items.append(item("ui/laurel.png", 48, 32, draw="laurel"))
    items.append(item("ui/ribbon.png", 160, 24, draw="ribbon"))
    items.append(item("ui/cover.png", 384, 192, transparent=False, draw="cover"))
    for path, w, h, frames, ms, loop, theme, color in FX:
        items.append(item(f"{path}.png", w, h, frames=frames, ms=ms, loop=loop, theme=theme, draw="fx", color=color))
    return items


# ---------------------------------------------------------------- 画法
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


def text(img: Image.Image, cx: int, cy: int, s: str, fill, shadow=None) -> None:
    """以 (cx, cy) 为中心写 12px 像素字，关掉抗锯齿。"""
    d = ImageDraw.Draw(img)
    d.fontmode = "1"
    box = font().getbbox(s)
    w = box[2] - box[0]
    x, y = cx - w // 2 - box[0], cy - 6 - 1
    if shadow is not None:
        d.text((x + 1, y + 1), s, font=font(), fill=shadow)
    d.text((x, y), s, font=font(), fill=fill)


DIGITS = {  # 3×5 像素数字
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "3": ["111", "001", "111", "001", "111"], "5": ["111", "100", "111", "001", "111"],
    "+": ["000", "010", "111", "010", "000"], "-": ["000", "000", "111", "000", "000"],
    "I": ["1", "1", "1", "1", "1"],
}


def tiny(img: Image.Image, x: int, y: int, s: str, fill, scale: int = 1) -> int:
    d = ImageDraw.Draw(img)
    for ch in s:
        rows = DIGITS[ch]
        for j, row in enumerate(rows):
            for i, bit in enumerate(row):
                if bit == "1":
                    d.rectangle((x + i * scale, y + j * scale, x + (i + 1) * scale - 1, y + (j + 1) * scale - 1), fill=fill)
        x += (len(rows[0]) + 1) * scale
    return x


def tiny_width(s: str, scale: int = 1) -> int:
    return sum((len(DIGITS[c][0]) + 1) * scale for c in s) - scale


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3])


def hatch(img: Image.Image, color, step=6) -> None:
    """占位图标记：45° 斜线。"""
    d = ImageDraw.Draw(img)
    w, h = img.size
    for k in range(-h, w, step):
        d.line((k, h, k + h, 0), fill=color)


def bordered(img: Image.Image, fill, outline=INK, cut=True) -> None:
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rectangle((0, 0, w - 1, h - 1), fill=outline)
    d.rectangle((1, 1, w - 2, h - 2), fill=fill)
    if cut:
        for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            d.point(p, fill=(0, 0, 0, 0))


def draw_scene(it) -> Image.Image:
    night = it["theme"] == "night"
    img = Image.new("RGBA", (512, 288), NIGHT if night else SKY)
    d = ImageDraw.Draw(img)
    sea = NIGHT2 if night else SEA
    d.rectangle((0, 150, 511, 287), fill=sea)
    for y in range(156, 288, 10):
        d.line((0, y, 511, y), fill=shade(sea, 1.15))
    d.rectangle((0, 250, 511, 287), fill=shade(MARBLE, 0.35 if night else 0.92))  # 柱廊地面
    col = shade(MARBLE, 0.45 if night else 1.0)
    for x in ((24, 70), (442, 488)) if it["n"] == 1 else ((60, 100), (412, 452)):
        d.rectangle((x[0], 0, x[1], 260), fill=col, outline=INK)
    # 灯塔（焦点放在中间那一竖条里，手机只看得到中间）
    d.rectangle((248, 96, 264, 152), fill=shade(MARBLE, 0.6 if night else 0.95), outline=INK)
    d.rectangle((246, 88, 266, 96), fill=FIRE if night else TERRACOTTA)
    if night:
        d.ellipse((400, 30, 424, 54), fill=MOON)
    label = f"{'夜间' if night else '白天'}场景 {it['n']} · 占位"
    box_w = 140
    d.rectangle((256 - box_w // 2, 186, 256 + box_w // 2, 206), fill=INK)
    text(img, 256, 196, label, MARBLE_LIGHT)
    return img


def draw_card_art(it) -> Image.Image:
    base = CARD[it["color"]]
    img = Image.new("RGBA", (56, 44), base)
    hatch(img, shade(base, 1.18))
    zh = it["zh"][:4]
    text(img, 28, 26, zh, MARBLE_LIGHT, shadow=INK)
    tiny(img, 2, 2, "I" * it["age"], MARBLE_LIGHT)
    return img


def draw_card_back(it) -> Image.Image:
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    bordered(img, MARBLE)
    c = AGE_BACK[it["age"]]
    sub = Image.new("RGBA", (58, 90), c)
    hatch(sub, shade(c, 1.15), step=8)
    img.paste(sub, (3, 3))
    s = "I" * it["age"]
    w = tiny_width(s, 4)
    tiny(img, 32 - w // 2, 30, s, MARBLE_LIGHT, 4)
    text(img, 32, 72, "卡背", MARBLE_LIGHT, shadow=INK)
    return img


def draw_wonder(it) -> Image.Image:
    a = it["side"] == "a"
    sky, sea = (SKY, SEA) if a else ((232, 160, 106), (58, 74, 110))
    img = Image.new("RGBA", (192, 72), sky)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 48, 191, 71), fill=sea)
    hatch(img, shade(sky, 1.06), step=8)
    d.rectangle((0, 48, 191, 71), fill=sea)
    d.polygon([(80, 48), (96, 20), (112, 48)], fill=shade(MARBLE, 0.9), outline=INK)  # 主体剪影
    label = f"{it['zh']} {'A' if a else 'B'}"
    w = font().getbbox(label)[2] + 8
    d.rectangle((96 - w // 2, 52, 96 + w // 2, 67), fill=INK)
    text(img, 96, 60, label, MARBLE_LIGHT)
    return img


def draw_emblem(it) -> Image.Image:
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, 31, 31), fill=INK)
    d.ellipse((1, 1, 30, 30), fill=MARBLE)
    d.ellipse((3, 3, 28, 28), outline=GOLD)
    text(img, 16, 16, it["zh"][0], INK)
    return img


def draw_icon(it) -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    bordered(img, it["color"])
    light = sum(it["color"]) > 520
    text(img, 8, 8, it["ch"], INK if light else MARBLE_LIGHT)
    return img


def draw_pip(it) -> Image.Image:
    img = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    bordered(img, it["color"])
    ImageDraw.Draw(img).point((2, 2), fill=MARBLE_LIGHT)
    return img


def draw_token(it) -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if it["win"]:
        d.ellipse((0, 0, 15, 15), fill=INK)
        d.ellipse((1, 1, 14, 14), fill=(196, 160, 60))
    else:
        d.polygon([(1, 1), (14, 1), (14, 9), (8, 15), (1, 9)], fill=INK)
        d.polygon([(2, 2), (13, 2), (13, 9), (8, 13), (2, 9)], fill=(110, 40, 40))
    s = it["text"]
    tiny(img, 8 - tiny_width(s) // 2, 5, s, MARBLE_LIGHT)
    return img


def draw_arrow(it) -> Image.Image:
    strip = Image.new("RGBA", (32 * 4, 16), (0, 0, 0, 0))
    for f in range(4):
        fr = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
        d = ImageDraw.Draw(fr)
        x = 2 + (3 - f)  # 箭头朝左，一帧往左挪 1px
        pts = [(x, 8), (x + 9, 1), (x + 9, 5), (x + 27, 5), (x + 27, 11), (x + 9, 11), (x + 9, 15)]
        d.polygon(pts, fill=SEA, outline=INK)
        strip.paste(fr, (f * 32, 0))
    return strip


def draw_laurel(it) -> Image.Image:
    img = Image.new("RGBA", (48, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.arc((2, 0, 46, 44), 120, 240, fill=OLIVE, width=4)
    d.arc((2, 0, 46, 44), 300, 60, fill=OLIVE, width=4)
    text(img, 24, 14, "冠", GOLD, shadow=INK)
    return img


def draw_ribbon(it) -> Image.Image:
    img = Image.new("RGBA", (160, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(0, 4), (12, 4), (8, 12), (12, 20), (0, 20)], fill=shade(SEA, 0.7), outline=INK)
    d.polygon([(159, 4), (147, 4), (151, 12), (147, 20), (159, 20)], fill=shade(SEA, 0.7), outline=INK)
    d.rectangle((10, 1, 149, 22), fill=SEA, outline=INK)
    text(img, 80, 12, "结算横幅 · 占位", MARBLE_LIGHT)
    return img


def draw_cover(it) -> Image.Image:
    img = Image.new("RGBA", (384, 192), SKY)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 110, 383, 191), fill=SEA)
    d.rectangle((24, 0, 60, 191), fill=MARBLE, outline=INK)
    d.rectangle((324, 0, 360, 191), fill=MARBLE, outline=INK)
    d.rectangle((186, 60, 198, 112), fill=MARBLE, outline=INK)
    d.rectangle((140, 140, 244, 160), fill=INK)
    text(img, 192, 150, "封面 · 占位", MARBLE_LIGHT)
    return img


def draw_fx(it) -> Image.Image:
    w, h, n = it["w"], it["h"], it["frames"]
    strip = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    last_blank = not it["loop"]
    for f in range(n):
        if last_blank and f == n - 1:
            continue  # 一次性特效最后一帧留空收尾
        fr = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(fr)
        k = (f + 1) / n
        bw, bh = max(2, int(w * (0.3 + 0.6 * k))), max(2, int(h * (0.3 + 0.6 * k)))
        x0 = (w - bw) // 2 + (f % 2)
        y0 = (h - bh) // 2
        d.rectangle((x0, y0, x0 + bw - 1, y0 + bh - 1), fill=it["color"] + (255,), outline=INK)
        strip.paste(fr, (f * w, 0))
    return strip


DRAW = {name[5:]: fn for name, fn in globals().items() if name.startswith("draw_")}


# ---------------------------------------------------------------- 主流程
def is_placeholder(path: pathlib.Path) -> bool:
    try:
        with Image.open(path) as im:
            return im.info.get("guluga") == MARK
    except OSError:
        return False


def save(it: dict, force: bool) -> str:
    path = OUT / it["path"]
    if path.exists() and not force and not is_placeholder(path):
        return "kept"
    img = DRAW[it["draw"]](it)
    if not it["transparent"]:
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        bg.alpha_composite(img)
        img = bg.convert("RGB")
    assert img.size == (it["w"] * it["frames"], it["h"]), (it["path"], img.size)
    info = PngInfo()
    info.add_text("guluga", MARK)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, pnginfo=info, optimize=True)
    return "written"


def manifest(items: list[dict]) -> list[dict]:
    keys = ("path", "w", "h", "frames", "ms", "loop", "transparent", "theme")
    return [{k: it[k] for k in keys} for it in items]


def check(items: list[dict], final: bool) -> int:
    bad, holders = [], []
    listed = {it["path"] for it in items}
    for it in items:
        path = OUT / it["path"]
        if not path.exists():
            bad.append(f"缺文件 {it['path']}")
            continue
        with Image.open(path) as im:
            want = (it["w"] * it["frames"], it["h"])
            if im.size != want:
                bad.append(f"尺寸不对 {it['path']}：{im.size}，应为 {want}")
            has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
            if it["transparent"] and not has_alpha:
                bad.append(f"应为透明图 {it['path']}（mode {im.mode}）")
            if im.info.get("guluga") == MARK:
                holders.append(it["path"])
    extra = sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*.png") if str(p.relative_to(OUT)) not in listed)
    for p in extra:
        bad.append(f"清单外的文件 {p}")
    print(f"清单 {len(items)} 项；问题 {len(bad)} 个；占位图 {len(holders)} 张；正式图 {len(items) - len(holders)} 张")
    for b in bad:
        print("  ✗", b)
    if holders and final:
        for h in holders:
            print("  · 仍是占位图", h)
    return 1 if bad or (final and holders) else 0


def main(argv: list[str]) -> int:
    items = build_items()
    if "--check" in argv:
        return check(items, "--final" in argv)
    force = "--force" in argv
    counts = {"written": 0, "kept": 0}
    for it in items:
        counts[save(it, force)] += 1
    (ROOT / "art/manifest.json").write_text(json.dumps(manifest(items), ensure_ascii=False, indent=1) + "\n")
    print(f"写了 {counts['written']} 张占位图，保留 {counts['kept']} 张正式图；共 {len(items)} 项 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
