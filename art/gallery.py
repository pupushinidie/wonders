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


SAFE = ("sky", "colors", "dusk", "rim", "flip", "stamp", "tint", "back", "focus")


def preview(opt, path: str, i: int, extra: dict, picked: bool) -> str:
    """按导出时的处理（黄昏调色、座位色外圈、镜像、数字……）渲染这个候选，再放大。"""
    import export
    spec = MANIFEST[path] | {k: v for k, v in extra.items() if picked or k in SAFE}
    spec |= {"src": opt} if isinstance(opt, str) else opt
    img = export.build(path, spec).convert("RGBA")
    longest = max(img.width, img.height)
    k = max(1, min(8, 384 // longest)) if longest < 384 else 1
    if path.startswith("scene/"):
        k = 2
    big = img.resize((img.width * k, img.height * k), Image.NEAREST)
    if MANIFEST.get(path, {}).get("transparent"):
        bg = Image.new("RGBA", big.size, (34, 40, 52, 255))
        bg.alpha_composite(big)
        big = bg
    out = PREVIEW / path.replace("/", "__").removesuffix(".png") / f"{i}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    big.convert("RGB").save(out)
    return str(out)


def describe(opt) -> str:
    if isinstance(opt, str):
        return opt
    if "code" in opt:
        return f"代码画 {opt['code']} 第 {opt.get('variant', 1)} 版"
    if "strip" in opt:
        return f"PixelLab 动画 {opt['glob'].split('-*')[0]}"
    return json.dumps(opt, ensure_ascii=False)


def main() -> None:
    picks = json.loads((ART / "picks.json").read_text())
    questions = []
    order = sorted(picks, key=lambda p: (list(MANIFEST).index(p) if p in MANIFEST else 9999, p))
    for path in order:
        entry = picks[path]
        if len(entry["options"]) < 2:
            continue  # 只有一种画法的（代码画的小点和抽象图标）不出题
        options = []
        for i, opt in enumerate(entry["options"]):
            picked = i == entry["pick"]
            o = {"value": describe(opt), "label": ("推荐 · " if picked else "") + f"候选 {i + 1}",
                 "images": [preview(opt, path, i, entry.get("extra", {}), picked)]}
            if picked:
                o["recommended"] = True
                o["description"] = entry.get("note") or "美术挑定"
            options.append(o)
        m = MANIFEST[path]
        size = f"{m['w']}×{m['h']}" + (f"，{m['frames']} 帧横排" if m["frames"] > 1 else "")
        questions.append({
            "id": path.removesuffix(".png").replace("/", "__"),
            "type": "choice",
            "question": label(path),
            "help": f"文件 `{path}`，原图 {size}，预览已放大（透明图垫了深色底）。",
            "options": options,
            "allowOther": True,
            "required": False,
        })
    doc = {
        "id": "gallery",
        "title": "七大奇迹 · 美术画廊（正式美术定稿）",
        "stage": "art",
        "blocking": False,
        "intro": ("每样素材一题，标「推荐」的是美术自查后挑定、已经导出成定稿的那张，**不用答也会按推荐上线**。"
                  "想换哪张随时点；都不满意就选「其他」写备注，会重画。代码画的小点和几个抽象图标（链环、勾、交易箭头等）只有一种画法，不在这里出题。"
                  "定稿总览：~/projects/pipeline/games/wonders/assets/art-final-overview-night.png / -day.png"),
        "questions": questions,
    }
    DECISION.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(DECISION, len(questions), "题")


if __name__ == "__main__":
    main()
