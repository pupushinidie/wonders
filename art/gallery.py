"""把第 N 轮候选写成不阻塞的拍板 JSON（流水线面板的画廊）。

读 art/picks.json：{ "<spec 路径>": {"options": ["r1/...png", ...], "pick": 0, "note": "为什么推荐这张"}, ... }
（options 是 art/out/ 下的相对路径；pick 是推荐的下标；没写的建筑插画自动用 3 个种子、推荐第 1 个）
放大后的预览图写到 art/out/gallery/（面板直接显示），JSON 写到 ~/projects/pipeline/games/wonders/assets/gallery-decision.json。

用法：python art/gallery.py
"""
from __future__ import annotations

import json
import pathlib

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
CAND = ART / "out"
PREVIEW = ART / "out" / "gallery"
DECISION = pathlib.Path.home() / "projects/pipeline/games/wonders/assets/gallery-decision.json"
MANIFEST = {it["path"]: it for it in json.loads((ART / "manifest.json").read_text())}
CARDS = {}
for c in json.loads((ROOT / "data/cards.json").read_text()):
    CARDS.setdefault(c["name"].lower().replace(" ", "_"), c)
WONDER_ZH = {w["key"]: w["zh"] for w in json.loads((ROOT / "data/wonders.json").read_text())}

GROUP_TITLE = {"scene": "场景背景", "wonders": "奇迹", "cards": "建筑插画", "icons": "图标", "tokens": "战争标记",
               "ui": "界面装饰", "fx": "特效", "pips": "小点"}


def label(path: str) -> str:
    stem = pathlib.Path(path).stem
    if path.startswith("cards/art/"):
        c = CARDS[stem]
        return f"建筑插画 · {c['zh']}（{'I' * c['age']} · {c['color']}）"
    if path.startswith("wonders/"):
        key, side = stem.rsplit("-", 1)
        if side == "emblem":
            return f"奇迹徽记 · {WONDER_ZH[key]}"
        return f"奇迹插图 · {WONDER_ZH[key]} {side.upper()} 面（{'正午' if side == 'a' else '黄昏'}）"
    if path.startswith("scene/"):
        theme, n = stem.split("-")
        return f"场景 · {'夜间' if theme == 'night' else '白天'} {n}（{'柱廊' if n == '1' else '栏杆露台'}构图）"
    if path.startswith("cards/back"):
        return f"卡背 · 时代 {'I' * int(stem[-1])}"
    return f"{GROUP_TITLE.get(path.split('/')[0], '')} · {stem}"


def preview(src: str, path: str, i: int) -> str:
    img = Image.open(CAND / src).convert("RGBA")
    longest = max(img.width, img.height)
    k = max(1, min(8, 384 // longest)) if longest < 384 else 1
    if path.startswith("scene/"):
        k = 2
    big = img.resize((img.width * k, img.height * k), Image.NEAREST)
    if big.mode == "RGBA" and MANIFEST.get(path, {}).get("transparent"):
        bg = Image.new("RGBA", big.size, (34, 40, 52, 255))
        bg.alpha_composite(big)
        big = bg
    out = PREVIEW / path.replace("/", "__").removesuffix(".png") / f"{i}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    big.convert("RGB").save(out)
    return str(out)


def main() -> None:
    picks = json.loads((ART / "picks.json").read_text())
    import sys
    only = sys.argv[1:]  # 只出这些前缀（比如 scene wonders），不写就全部
    for slug in CARDS:  # 建筑插画默认 3 个种子
        path = f"cards/art/{slug}.png"
        if path not in picks:
            folder = f"r1/cards/{CARDS[slug]['color']}"
            opts = [f"{folder}/{slug}-s{s}.png" for s in (301, 302, 303) if (CAND / folder / f"{slug}-s{s}.png").exists()]
            if opts:
                picks[path] = {"options": opts, "pick": 0}
    questions = []
    if only:
        picks = {p: v for p, v in picks.items() if any(p.startswith(o) for o in only)}
    order = sorted(picks, key=lambda p: (list(MANIFEST).index(p) if p in MANIFEST else 9999, p))
    for path in order:
        entry = picks[path]
        options = []
        for i, src in enumerate(entry["options"]):
            opt = {"value": src, "label": f"候选 {i + 1}", "images": [preview(src, path, i)]}
            if i == entry.get("pick", 0):
                opt["recommended"] = True
                opt["description"] = entry.get("note", "美术推荐")
            options.append(opt)
        questions.append({
            "id": path.removesuffix(".png").replace("/", "__"),
            "type": "choice",
            "question": label(path),
            "help": entry.get("help", f"文件 `{path}`，原图 {MANIFEST[path]['w']}×{MANIFEST[path]['h']}，预览已放大。"),
            "options": options,
            "allowOther": True,
            "required": False,
        })
    doc = {
        "id": "gallery",
        "title": "七大奇迹 · 美术画廊（第 1 轮候选）",
        "stage": "art",
        "blocking": False,
        "intro": ("每样素材一题，标「推荐」的是美术评审签字的那张，**不用答也会按推荐上线**。想换哪张随时点；"
                  "都不满意就选「其他」写备注，会重画。"),
        "questions": questions,
    }
    DECISION.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(DECISION, len(questions), "题")


if __name__ == "__main__":
    main()
