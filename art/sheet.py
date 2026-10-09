"""候选总览图（给自查和评审看）：python art/sheet.py <组>

  cards    每种颜色一张：每行一个建筑 × 3 个种子，放大 2 倍，左边写中文名
  wonders  每行一座奇迹：A 面 3 张 + B 面 3 张，原尺寸 1 倍
  scenes   全部场景候选，1 倍
  small    每个小图：64 个候选拼成 8×8，放大 3 倍，下面标序号
  backs / decor / covers
输出到 art/out/r1/sheets/。
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
R1 = ART / "out" / "r1"
SHEETS = R1 / "sheets"
FONT = ImageFont.truetype(str(ART / "out" / "fusion12.ttf"), 12)
BG = (34, 40, 52)
FG = (230, 236, 242)


def up(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def label(d, xy, s):
    d.fontmode = "1"
    d.text(xy, s, font=FONT, fill=FG)


def cards() -> list[pathlib.Path]:
    data = json.loads((ROOT / "data/cards.json").read_text())
    seen: dict[str, dict] = {}
    for c in data:
        seen.setdefault(c["name"].lower().replace(" ", "_"), c)
    outs = []
    for color in ("brown", "gray", "blue", "yellow", "red", "green", "purple"):
        rows = [(s, c) for s, c in seen.items() if c["color"] == color]
        folder = R1 / "cards" / color
        cell_w, cell_h = 112 + 8, 88 + 8
        sheet = Image.new("RGB", (150 + cell_w * 3, 8 + cell_h * len(rows)), BG)
        d = ImageDraw.Draw(sheet)
        for i, (slug, c) in enumerate(rows):
            y = 8 + i * cell_h
            label(d, (6, y + 30), f"{c['zh']} {'I' * c['age']}")
            label(d, (6, y + 46), slug[:18])
            for j, seed in enumerate((301, 302, 303)):
                p = folder / f"{slug}-s{seed}.png"
                if p.exists():
                    sheet.paste(up(Image.open(p).convert("RGB"), 2), (150 + j * cell_w, y))
        out = SHEETS / f"cards-{color}.png"
        sheet.save(out)
        outs.append(out)
    return outs


def wonders() -> list[pathlib.Path]:
    keys = ["giza", "rhodes", "alexandria", "ephesus", "babylon", "olympia", "halicarnassus"]
    folder = R1 / "wonders"
    sheet = Image.new("RGB", (8 + 200 * 3, 8 + (2 * 80 + 24) * len(keys)), BG)
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        y = 8 + i * (2 * 80 + 24)
        label(d, (8, y), k)
        for r, (side, seeds) in enumerate((("a", (101, 102, 103)), ("b", (201, 202, 203)))):
            for j, seed in enumerate(seeds):
                p = folder / f"{k}-{side}-s{seed}.png"
                if p.exists():
                    sheet.paste(Image.open(p).convert("RGB"), (8 + j * 200, y + 16 + r * 80))
    out = SHEETS / "wonders.png"
    up(sheet, 2).save(out)
    return [out]


def flat(folder: pathlib.Path, name: str, k: int = 1, cols: int = 2) -> list[pathlib.Path]:
    files = sorted(p for p in folder.glob("*.png"))
    if not files:
        return []
    ims = [Image.open(p).convert("RGBA") for p in files]
    w = max(i.width for i in ims) * k
    h = max(i.height for i in ims) * k
    sheet = Image.new("RGB", (8 + (w + 8) * cols, 8 + ((len(ims) + cols - 1) // cols) * (h + 22)), BG)
    d = ImageDraw.Draw(sheet)
    for n, (p, im) in enumerate(zip(files, ims)):
        x, y = 8 + (n % cols) * (w + 8), 8 + (n // cols) * (h + 22)
        sheet.paste(up(im, k), (x, y), up(im, k))
        label(d, (x, y + h + 2), p.stem)
    out = SHEETS / f"{name}.png"
    sheet.save(out)
    return [out]


def small() -> list[pathlib.Path]:
    outs = []
    for folder in sorted((R1 / "small").iterdir()):
        if not folder.is_dir():
            continue
        files = sorted(folder.glob("*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]) if p.stem.rsplit("-", 1)[-1].isdigit() else 0)
        ims = [Image.open(p).convert("RGBA") for p in files]
        if not ims:
            continue
        k = 4 if ims[0].width <= 16 else 3
        w, h = ims[0].width * k, ims[0].height * k
        cols = 8
        rows = (len(ims) + cols - 1) // cols
        for bgname, bg in (("night", (22, 28, 40)), ("day", (250, 250, 248))):
            sheet = Image.new("RGB", (8 + cols * (w + 8), 8 + rows * (h + 20)), bg)
            d = ImageDraw.Draw(sheet)
            d.fontmode = "1"
            for n, (p, im) in enumerate(zip(files, ims)):
                x, y = 8 + (n % cols) * (w + 8), 8 + (n // cols) * (h + 20)
                sheet.paste(up(im, k), (x, y), up(im, k))
                idx = p.stem.rsplit("-", 1)[-1] if p.stem.rsplit("-", 1)[-1].isdigit() else "0"
                d.text((x, y + h + 2), idx, font=FONT, fill=(120, 130, 150))
            out = SHEETS / f"small-{folder.name}-{bgname}.png"
            sheet.save(out)
            outs.append(out)
    return outs


if __name__ == "__main__":
    SHEETS.mkdir(parents=True, exist_ok=True)
    group = sys.argv[1]
    fn = {"cards": cards, "wonders": wonders, "small": small,
          "scenes": lambda: flat(R1 / "scenes", "scenes", 1, 2),
          "backs": lambda: flat(R1 / "backs", "backs", 2, 9),
          "decor": lambda: flat(R1 / "decor", "decor", 3, 3),
          "covers": lambda: flat(R1 / "covers", "covers", 1, 3),
          "test": lambda: flat(R1 / "test", "test", 4, 2)}[group]
    for p in fn():
        print(p)
