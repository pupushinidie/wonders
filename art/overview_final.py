"""定稿总览：art/out/final 的 170 项按类摆一张大图，夜间底和白天底各一份（给他亲眼看）。
用法：python art/overview_final.py [输出目录]（默认 ~/projects/pipeline/games/wonders/assets/）
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ART = pathlib.Path(__file__).resolve().parent
FINAL = ART / "out" / "final"
DEST = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / "projects/pipeline/games/wonders/assets"
MANIFEST = json.loads((ART / "manifest.json").read_text())
FONT = ImageFont.truetype(str(ART / "out" / "fusion12.ttf"), 12) if (ART / "out" / "fusion12.ttf").exists() else None
THEMES = {"night": {"bg": (14, 22, 36), "panel": (27, 41, 53), "ink": (215, 232, 232)},
          "day": {"bg": (244, 241, 234), "panel": (226, 232, 238), "ink": (30, 52, 84)}}
WIDTH = 1600


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def section(title, tiles, theme, cols_w=WIDTH - 32):
    """tiles: [(label, image)]，按行排。"""
    t = THEMES[theme]
    rows, row, x, h = [], [], 0, 0
    for lab, im in tiles:
        w = max(im.width, 40) + 12
        if x + w > cols_w and row:
            rows.append((row, h)); row, x, h = [], 0, 0
        row.append((lab, im)); x += w; h = max(h, im.height + 18)
    if row:
        rows.append((row, h))
    H = 30 + sum(h for _, h in rows) + 8
    S = Image.new("RGB", (WIDTH, H), t["bg"])
    d = ImageDraw.Draw(S)
    d.text((16, 8), title, fill=t["ink"], font=FONT)
    y = 30
    for row, h in rows:
        x = 16
        for lab, im in row:
            S.paste(im, (x, y), im if im.mode == "RGBA" else None)
            if lab:
                d.text((x, y + im.height + 2), lab, fill=t["ink"], font=FONT)
            x += max(im.width, 40) + 12
        y += h
    return S


def load(path):
    return Image.open(FINAL / path).convert("RGBA")


def build(theme):
    parts = []
    scenes = [it["path"] for it in MANIFEST if it["path"].startswith("scene/") and it["theme"] == theme]
    parts.append(section(f"场景（{'夜间' if theme == 'night' else '白天'}，原图 512×288 ×1）",
                         [(pathlib.Path(p).stem, load(p)) for p in scenes], theme))
    wonders = [it["path"] for it in MANIFEST if it["path"].startswith("wonders/") and not it["path"].endswith("emblem.png")]
    parts.append(section("奇迹插图 192×72 ×1（左 A 正午 / 右 B 黄昏）", [(pathlib.Path(p).stem, load(p)) for p in wonders], theme))
    emb = [it["path"] for it in MANIFEST if it["path"].endswith("emblem.png")]
    parts.append(section("奇迹徽记 32×32（×2；外圈 = 座位色）", [(pathlib.Path(p).stem.replace("-emblem", ""), up(load(p), 2)) for p in emb], theme))
    cards = [it["path"] for it in MANIFEST if it["path"].startswith("cards/art/")]
    parts.append(section("建筑插画 56×44（×2，75 张，按 data/cards.json 顺序）", [(pathlib.Path(p).stem[:14], up(load(p), 2)) for p in cards], theme))
    backs = [it["path"] for it in MANIFEST if it["path"].startswith("cards/back")]
    misc = [it for it in MANIFEST if it["path"].startswith(("icons/", "pips/", "tokens/"))]
    parts.append(section("卡背 64×96 ×2", [(pathlib.Path(p).stem, up(load(p), 2)) for p in backs], theme))
    parts.append(section("图标 16×16 / 小点 8×8 / 战争标记 16×16（×3）",
                         [(pathlib.Path(it["path"]).stem[:9], up(load(it["path"]), 3)) for it in misc], theme))
    ui = [it for it in MANIFEST if it["path"].startswith(("ui/", "fx/"))]
    tiles = []
    for it in ui:
        k = 1 if it["w"] >= 160 else 2
        tiles.append((f"{it['path']}  {it['frames']} 帧", up(load(it["path"]), k)))
    parts.append(section("界面装饰和特效（精灵图横排，×2；封面 ×1）", tiles, theme))
    H = sum(p.height for p in parts)
    S = Image.new("RGB", (WIDTH, H), THEMES[theme]["bg"])
    y = 0
    for p in parts:
        S.paste(p, (0, y)); y += p.height
    out = DEST / f"art-final-overview-{theme}.png"
    S.save(out, optimize=True)
    print(out, S.size)


if __name__ == "__main__":
    for th in THEMES:
        build(th)
