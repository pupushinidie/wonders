"""定稿导出：按 art/selection.json 把选中的候选按 spec 的文件名、尺寸、帧数写进 apps/web/public/art/（覆盖占位图）。

selection.json：{ "<public/art 下的路径>": { 来源 }, ... }，来源是下面之一：
  {"src": "r1/cards/blue/temple-s301.png"}             art/out/ 下的候选，尺寸必须和 spec 一致（透明小图可以更小，居中放进画布）
  {"src": ..., "outline": true}                          透明图再补一圈 1px 墨蓝描边
  {"src": ..., "stamp": "+3", "tint": "silver"}          战争标记：底牌（可换色）+ 代码数字
  {"src": ..., "back": 2}                                 卡背：纹样 + 代码画的大理石框 + 罗马数字
  {"code": "pip-W"} / {"code": "ready"}                   codeart.py 画的小点、几何图标
  {"code": "fx/clash", "variant": 2} / {"code": "arrow", "variant": 1}
  {"strip": "r1/anim/brazier", "frames": [0,1,2,3,4,5]}   动画帧目录里的帧，横排成帧条
其余字段：「note」写选它的理由（不参与导出）。

  {"src": ..., "sky": true}                              A 面奇迹：和上边连通的天空统一换成 spec 的海港蓝色阶（评审 P2）
  {"src": ..., "colors": 32}                              量化到 ≤N 色（spec §1：插画 ≤32 色）
  {"src": ..., "focus": 278}                              场景：灯塔横坐标，写进 scene/focus.json

定稿先导出到 art/out/final/（同文件名同尺寸），换图验收开始时再加 --public 覆盖 apps/web/public/art/。
用法：python art/export.py [--public] [路径前缀 ...]
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

from PIL import Image

import codeart

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
OUT = ART / "out" / "final"
PUBLIC = ROOT / "apps/web/public/art"
SEL = json.loads((ART / "selection.json").read_text())
MANIFEST = {it["path"]: it for it in json.loads((ART / "manifest.json").read_text())}
CAND = ART / "out"


def fit(img: Image.Image, w: int, h: int, transparent: bool) -> Image.Image:
    if img.size == (w, h):
        return img
    if transparent and img.width <= w and img.height <= h:
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.alpha_composite(img, ((w - img.width) // 2, (h - img.height) // 2))
        return canvas
    raise ValueError(f"尺寸 {img.size} 和 spec {w}×{h} 不一致")


def trim(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").point(lambda a: 255 if a > 0 else 0).getbbox()
    return img.crop(box) if box else img


def clean_alpha(img: Image.Image) -> Image.Image:
    """半透明像素：≥128 变不透明，其余变全透明（像素图不留毛边）。"""
    a = img.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    img = img.copy()
    img.putalpha(a)
    return img


TINT = {"bronze": None, "silver": (0.85, 0.95, 1.15), "gold": (1.2, 1.05, 0.55)}


def tint(img: Image.Image, name: str) -> Image.Image:
    k = TINT[name]
    if k is None:
        return img
    px = img.load()
    out = img.copy()
    po = out.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a and not (r < 60 and g < 80 and b < 110):  # 描边不动
                lum = (r + g + b) / 3
                po[x, y] = tuple(max(0, min(255, int(lum * c))) for c in k) + (a,)
    return out


def card_back(pattern: Image.Image, age: int) -> Image.Image:
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    img.alpha_composite(pattern.convert("RGBA").resize((58, 90), Image.NEAREST) if pattern.size != (58, 90) else pattern, (3, 3))
    d = codeart.ImageDraw.Draw(img)
    # 框：1px 墨蓝 + 2px 大理石斜面，四角缺 1px
    d.rectangle((0, 0, 63, 95), outline=codeart.INK)
    d.rectangle((1, 1, 62, 94), outline=codeart.WHITE)
    d.rectangle((2, 2, 61, 93), outline=codeart.MARBLE_D)
    d.line((62, 1, 62, 94), fill=codeart.MARBLE_D)
    d.line((1, 94, 62, 94), fill=codeart.MARBLE_D)
    for p in ((0, 0), (63, 0), (0, 95), (63, 95)):
        img.putpixel(p, (0, 0, 0, 0))
    # 罗马数字：竖条 3×9，带描边，放在下方中间的牌子上
    n = age
    w = n * 3 + (n - 1) * 2
    x0, y0 = 32 - w // 2, 78
    d.rectangle((x0 - 4, y0 - 3, x0 + w + 3, y0 + 11), fill=codeart.INK)
    d.rectangle((x0 - 3, y0 - 2, x0 + w + 2, y0 + 10), fill=codeart.MARBLE)
    for i in range(n):
        x = x0 + i * 5
        d.rectangle((x, y0, x + 2, y0 + 8), fill=codeart.INK)
    return img


SKY_RAMP = [(228, 240, 244), (200, 224, 234), (156, 195, 214), (126, 173, 198)]


def unify_sky(img: Image.Image) -> Image.Image:
    """和上边连通、偏蓝青绿的天空像素，按亮度换成 spec 的天色色阶；云（低饱和、很亮）不动。"""
    import colorsys
    from collections import deque
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()

    def skyish(p):
        r, g, b = (c / 255 for c in p)
        hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
        return 0.25 <= hh <= 0.62 and ss > 0.25 and ll > 0.45

    seen = set()
    q = deque((x, 0) for x in range(w) if skyish(px[x, 0]))
    seen.update(q)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and skyish(px[nx, ny]):
                seen.add((nx, ny))
                q.append((nx, ny))
    if not seen:
        return img
    lums = sorted({sum(px[p]) for p in seen})
    for x, y in seen:
        rank = lums.index(sum(px[x, y])) / max(1, len(lums) - 1)
        px[x, y] = SKY_RAMP[min(3, int((1 - rank) * 4))]
    return img


def quantize(img: Image.Image, n: int) -> Image.Image:
    colors = img.convert("RGB").getcolors(1 << 16)
    if colors and len(colors) <= n:
        return img
    return img.convert("RGB").quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")


def build(path: str, spec: dict) -> Image.Image:
    w, h, frames = spec["w"], spec["h"], spec["frames"]
    if "code" in spec:
        code, v = spec["code"], spec.get("variant", 1)
        if code.startswith("pip-"):
            return codeart.pip(code)
        if code in codeart.CODE_ICONS:
            return codeart.CODE_ICONS[code]()
        if code == "arrow":
            return codeart.arrow_frames(v)
        if code in codeart.FX:
            return codeart.FX[code](v)
        raise KeyError(code)
    if "strip" in spec:
        folder = CAND / spec["strip"]
        files = sorted(folder.glob("*.png"))
        picks = [files[i] for i in spec["frames"]]
        strip = Image.new("RGBA", (w * frames, h), (0, 0, 0, 0))
        for i, p in enumerate(picks):
            fr = clean_alpha(Image.open(p).convert("RGBA"))
            strip.alpha_composite(fit(fr, w, h, True), (i * w, 0))
        return strip
    img = Image.open(CAND / spec["src"])
    if "back" in spec:
        return card_back(img, spec["back"])
    if not spec["transparent"]:
        img = fit(img.convert("RGB"), w, h, False)
        if spec.get("sky"):
            img = unify_sky(img)
        if spec.get("colors"):
            img = quantize(img, spec["colors"])
        return img
    img = clean_alpha(img.convert("RGBA"))
    if spec.get("trim", True):
        img = trim(img)
    if "tint" in spec:
        img = tint(img, spec["tint"])
    if spec.get("outline"):
        pad = Image.new("RGBA", (img.width + 2, img.height + 2), (0, 0, 0, 0))
        pad.alpha_composite(img, (1, 1))
        img = trim(codeart.outline(pad))
    img = fit(img, w, h, True)
    if "stamp" in spec:
        img = codeart.stamp(img, spec["stamp"])
    return img


def main(argv: list[str]) -> int:
    global OUT
    if "--public" in argv:
        OUT = PUBLIC
    prefixes = [a for a in argv if not a.startswith("--")]
    n = 0
    focus = {}
    for path, src in SEL.items():
        if prefixes and not any(path.startswith(p) for p in prefixes):
            continue
        if path not in MANIFEST:
            print("✗ 不在清单里：", path)
            return 1
        spec = MANIFEST[path] | src
        img = build(path, spec)
        want = (spec["w"] * spec["frames"], spec["h"])
        if img.size != want:
            print(f"✗ {path} 尺寸 {img.size} ≠ {want}")
            return 1
        if not spec["transparent"]:
            img = img.convert("RGB")
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        img.save(target, optimize=True)
        if "focus" in spec:
            focus[pathlib.Path(path).stem] = spec["focus"]
        n += 1
    if focus:
        fpath = OUT / "scene/focus.json"
        old = json.loads(fpath.read_text()) if fpath.exists() else {}
        fpath.write_text(json.dumps(old | focus, indent=1) + "\n")
    print(f"导出 {n} 个文件 → {OUT}")
    if OUT == PUBLIC:
        return subprocess.call([sys.executable, str(ART / "simple.py"), "--check"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
