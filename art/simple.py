"""七大奇迹：简洁版美术（不调 PixelLab，全部代码画，能直接上线）。

按 art/spec.md 的清单，把每一项按正式的文件名、尺寸、帧数画成简洁版，放进 apps/web/public/art/，
原图另存一份到 art/simple/ 备查。正式美术定稿后同名覆盖 public/art，界面不用改代码。

- 简洁版在 PNG 里写文本块 guluga=lean；正式美术没有这个标记。`--check` 靠它分清两种图。
- 画法在 simple_draw.py（场景、建筑插画、奇迹、徽记、图标、卡背、标记、装饰）和 codeart.py（小点、几何图标、箭头、粒子特效）。
- 建筑插画、奇迹名单从 data/cards.json、data/wonders.json 读（文件名 = 英文名小写、空格换成下划线）。
- 同时写出 art/manifest.json（每个文件的尺寸、帧数、每帧毫秒、透明与否、主题），界面可以照抄常量。

用法：
  python art/simple.py                  # 生成全部简洁版 + manifest.json（public/art 里已是正式美术的不覆盖）
  python art/simple.py --force          # 连正式美术也覆盖回简洁版（慎用）
  python art/simple.py --check          # 核对 public/art：每项都在、尺寸帧数对、没有清单外的文件、没有老占位图
  python art/simple.py --check --final  # 同上，且还有简洁版就算失败（换图验收用）
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
MARK = "lean"

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


# ---------------------------------------------------------------- 画法（简洁版，见 simple_draw.py）
import codeart  # noqa: E402
import simple_draw as sd  # noqa: E402

_cards = {c["name"].lower().replace(" ", "_"): c for c in json.loads((ROOT / "data/cards.json").read_text())}


def draw(it: dict) -> Image.Image:
    kind, path = it["draw"], it["path"]
    name = pathlib.Path(path).stem
    if kind == "scene":
        return sd.scene(it["theme"], it["n"])
    if kind == "card_art":
        return sd.card_art(_cards[it["slug"]] | {"slug": it["slug"]})
    if kind == "card_back":
        return sd.card_back(it["age"])
    if kind == "wonder":
        return sd.wonder_art(it["key"], it["side"])
    if kind == "emblem":
        return sd.emblem(it["key"])
    if kind == "icon":
        return sd.icon(name)
    if kind == "pip":
        return codeart.pip(name)
    if kind == "token":
        return sd.token(name)
    if kind == "arrow":
        return codeart.arrow_frames(1)
    if kind == "laurel":
        return sd.laurel()
    if kind == "ribbon":
        return sd.ribbon()
    if kind == "cover":
        return sd.cover()
    if kind == "fx":
        if name == "brazier":
            return sd.brazier_frames()
        return codeart.FX[f"fx/{name}"](1)
    raise KeyError(kind)


# ---------------------------------------------------------------- 主流程
SIMPLE_DIR = ROOT / "art/simple"  # 简洁版原图备查（正式美术覆盖 public/art 之后还留着）


def mark_of(path: pathlib.Path) -> str:
    """PNG 文本块 guluga：lean = 简洁版，placeholder = 老占位图，没有 = 正式美术。"""
    try:
        with Image.open(path) as im:
            return im.info.get("guluga") or "final"
    except OSError:
        return "missing"


def render(it: dict) -> Image.Image:
    img = draw(it)
    if not it["transparent"]:
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        bg.alpha_composite(img.convert("RGBA"))
        img = bg.convert("RGB")
    else:
        img = img.convert("RGBA")
    assert img.size == (it["w"] * it["frames"], it["h"]), (it["path"], img.size)
    return img


def save(it: dict, force: bool) -> str:
    img = render(it)
    info = PngInfo()
    info.add_text("guluga", MARK)
    keep = SIMPLE_DIR / it["path"]
    keep.parent.mkdir(parents=True, exist_ok=True)
    img.save(keep, pnginfo=info, optimize=True)
    path = OUT / it["path"]
    if path.exists() and not force and mark_of(path) == "final":
        return "kept"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, pnginfo=info, optimize=True)
    return "written"


def manifest(items: list[dict]) -> list[dict]:
    keys = ("path", "w", "h", "frames", "ms", "loop", "transparent", "theme")
    return [{k: it[k] for k in keys} for it in items]


def check(items: list[dict], final: bool) -> int:
    bad: list[str] = []
    kinds: dict[str, list[str]] = {"lean": [], "placeholder": [], "final": []}
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
        kinds.setdefault(mark_of(path), []).append(it["path"])
    extra = sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*.png") if str(p.relative_to(OUT)) not in listed)
    for p in extra:
        bad.append(f"清单外的文件 {p}")
    for p in kinds["placeholder"]:
        bad.append(f"还是老占位图 {p}")
    print(f"清单 {len(items)} 项；问题 {len(bad)} 个；简洁版 {len(kinds['lean'])} 张；正式美术 {len(kinds['final'])} 张")
    for b in bad:
        print("  ✗", b)
    if final:
        for h in kinds["lean"]:
            print("  · 仍是简洁版", h)
    return 1 if bad or (final and kinds["lean"]) else 0


def main(argv: list[str]) -> int:
    items = build_items()
    if "--check" in argv:
        return check(items, "--final" in argv)
    force = "--force" in argv
    counts = {"written": 0, "kept": 0}
    for it in items:
        counts[save(it, force)] += 1
    (ROOT / "art/manifest.json").write_text(json.dumps(manifest(items), ensure_ascii=False, indent=1) + "\n")
    print(f"写了 {counts['written']} 张简洁版，保留 {counts['kept']} 张正式美术；共 {len(items)} 项 → {OUT}（原图另存 art/simple/）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
