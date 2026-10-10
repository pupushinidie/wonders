"""A 面（正午）→ B 面（黄昏）：代码调色，保证 A/B 同一构图同一主体（评审第 1 轮要求）。

做法：
- 天空 = 和上边连通、偏蓝青的亮像素 + 云（很亮、低饱和、和天空连通）→ 按 y 映射到橙粉晚霞色阶，云换成暖粉/金。
- 海 = 剩下偏蓝青的像素 → 紫蓝色阶（按亮度）。
- 其余（建筑、地面、植物）→ 暖金受光 + 紫色阴影的色调映射（按亮度插值）。
用法：python art/dusk.py <A 面 png> <输出 png>
"""
from __future__ import annotations

import colorsys
import sys
from collections import deque

from PIL import Image

SKY = [(255, 206, 120), (252, 160, 100), (226, 112, 116), (160, 78, 124), (84, 54, 112)]   # 地平线 → 天顶
CLOUD = [(255, 228, 170), (255, 178, 128), (214, 120, 132), (140, 82, 128)]                 # 亮 → 暗
SEA = [(28, 24, 62), (52, 46, 100), (88, 70, 132), (170, 108, 136), (255, 190, 120)]        # 暗 → 亮（亮处是夕阳倒影）
LAND_DARK, LAND_MID, LAND_LIGHT, LAND_TOP = (36, 22, 56), (150, 80, 92), (250, 184, 112), (255, 238, 182)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ramp(cols, t):
    t = min(1.0, max(0.0, t))
    x = t * (len(cols) - 1)
    i = min(len(cols) - 2, int(x))
    return lerp(cols[i], cols[i + 1], x - i)


def hls(p):
    return colorsys.rgb_to_hls(*(c / 255 for c in p[:3]))


def is_blue(p):
    h, l, s = hls(p)
    return 0.40 <= h <= 0.66 and s > 0.22


def is_cloud(p):
    h, l, s = hls(p)
    return l > 0.80 and (s < 0.55 or 0.4 <= h <= 0.66)


def grade(img: Image.Image, horizon: int | None = None) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    # 天空：先只按「偏蓝青的亮像素」从上边洪水填充；云 = 很亮的连通块，只有整块都在画面上半部、而且贴着天空才算云
    # （第 1 版把白色建筑、浅色石堤也当成云填成了晚霞色：陵墓、罗德岛的石堤）
    sky = set()
    q = deque((x, 0) for x in range(w) if is_blue(px[x, 0]))
    sky.update(q)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in sky:
                p = px[nx, ny]
                if is_blue(p) and hls(p)[1] > 0.55:
                    sky.add((nx, ny))
                    q.append((nx, ny))
    seen = set()
    for y0 in range(h):
        for x0 in range(w):
            if (x0, y0) in seen or (x0, y0) in sky or not is_cloud(px[x0, y0]):
                continue
            comp, q = [], deque([(x0, y0)])
            seen.add((x0, y0))
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and (nx, ny) not in sky and is_cloud(px[nx, ny]):
                        seen.add((nx, ny))
                        q.append((nx, ny))
            touches = any((nx, ny) in sky for x, y in comp for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            if touches and max(y for _, y in comp) < h * 0.55:
                sky.update(comp)
    if horizon is None:
        ys = [y for _, y in sky]
        horizon = max(ys) if ys else h // 2
    out = Image.new("RGB", (w, h))
    o = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            hh, l, s = hls(p)
            if (x, y) in sky:
                t = 1 - y / max(1, horizon)
                if is_cloud(p):
                    o[x, y] = ramp(CLOUD, (1 - l) * 3.2)
                else:
                    o[x, y] = ramp(SKY, t * 0.9 + (0.75 - l) * 0.4)
            elif is_blue(p) and y >= horizon * 0.6:
                o[x, y] = ramp(SEA, l * 1.15)
            else:
                lc = min(1.0, max(0.0, (l - 0.08) / 0.84))
                lc = lc * lc * (3 - 2 * lc)
                if lc < 0.45:
                    c = lerp(LAND_DARK, LAND_MID, lc / 0.45)
                elif lc < 0.85:
                    c = lerp(LAND_MID, LAND_LIGHT, (lc - 0.45) / 0.4)
                else:
                    c = lerp(LAND_LIGHT, LAND_TOP, (lc - 0.85) / 0.15)
                warm = (hh < 0.17 or hh > 0.95) and s > 0.35
                k = 0.65 if warm else 0.3 * s
                o[x, y] = tuple(min(255, round(c[i] * (1 - k) + p[i] * k * (0.8 + 0.3 * l))) for i in range(3))
    return out


if __name__ == "__main__":
    grade(Image.open(sys.argv[1])).save(sys.argv[2])
