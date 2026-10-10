"""动画检查（照宝石商人 finalize.py 的 report / has_glitch_frame 思路，按 manifest 的帧宽切帧）。

对 art/out/final/（或 --public）里每个多帧精灵图：
- 逐帧和上一帧比，变了的像素比例（相邻帧变化）；全程最大变化 < 3% 算「不动」。
- 坏帧：某一帧和前后两帧都差很多（≥2.5 倍中位数且 ≥15%），而前后两帧彼此很像 → 突变又变回。
- 循环的：末帧 → 首帧的变化不能比相邻帧的最大变化大太多（无缝循环）。
- 一次性特效：最后一帧必须是空白（spec §9）。
用法：python art/animcheck.py [--public]
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageChops

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART / "out" / "final"
if "--public" in sys.argv:
    ROOT = ART.parent / "apps/web/public/art"
MANIFEST = [it for it in json.loads((ART / "manifest.json").read_text()) if it["frames"] > 1]


def frames(item):
    strip = Image.open(ROOT / item["path"]).convert("RGBA")
    w, h = item["w"], item["h"]
    return [strip.crop((i * w, 0, (i + 1) * w, h)) for i in range(item["frames"])]


def diff(a, b) -> float:
    d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    hist = d.histogram()
    return hist[255] / (a.width * a.height)


def check(item) -> list[str]:
    fs = frames(item)
    problems = []
    adj = [diff(fs[i - 1], fs[i]) for i in range(1, len(fs))]
    if max(adj) < 0.03:
        problems.append(f"几乎不动（相邻帧最大变化 {max(adj):.1%}）")
    for i in range(1, len(fs) - 1):
        a, b = diff(fs[i - 1], fs[i]), diff(fs[i], fs[i + 1])
        around = diff(fs[i - 1], fs[i + 1])
        med = sorted(adj)[len(adj) // 2] or 0.001
        if min(a, b) >= 0.15 and min(a, b) >= 2.5 * med and around < 0.5 * min(a, b):
            problems.append(f"第 {i} 帧突变又变回（{a:.0%}/{b:.0%}，前后帧互差 {around:.0%}）")
    if item["loop"]:
        wrap = diff(fs[-1], fs[0])
        if wrap > max(adj) * 1.5 + 0.02:
            problems.append(f"循环接缝跳变（末帧→首帧 {wrap:.1%}，相邻帧最大 {max(adj):.1%}）")
    else:
        if fs[-1].getchannel("A").getbbox() is not None:
            problems.append("一次性特效的最后一帧不是空白")
    nonempty = [f for f in fs if f.getchannel("A").getbbox()]
    if len(nonempty) < 2:
        problems.append("有内容的帧少于 2 帧")
    return problems, adj


def main() -> int:
    bad = 0
    for item in MANIFEST:
        problems, adj = check(item)
        tag = "✗" if problems else "✓"
        bad += bool(problems)
        print(f"{tag} {item['path']:24} {item['frames']} 帧 {'循环' if item['loop'] else '一次'}  相邻帧变化 "
              + " ".join(f"{a:.0%}" for a in adj) + ("  " + "；".join(problems) if problems else ""))
    print(f"{len(MANIFEST)} 个动画，{bad} 个有问题")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
