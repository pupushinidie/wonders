"""第 1 轮 B 批：75 张建筑插画 × 3 个种子（pixflux 56×44），然后小图（v2）。参数 nopal = 不用调色板。"""
import sys, r1
pal = 'nopal' not in sys.argv
if not pal:
    _flux = r1.flux
    r1.flux = lambda *a, **k: _flux(*a, **{**k, 'palette': False})
for color in ('blue', 'brown', 'gray', 'yellow', 'red', 'green', 'purple'):
    try:
        r1.cards([color])
    except Exception as e:
        print('cards', color, '失败', e, flush=True)
if 'nosmall' not in sys.argv:
    try:
        r1.small([])
    except Exception as e:
        print('small 失败', e, flush=True)
print('B 批完成', flush=True)
