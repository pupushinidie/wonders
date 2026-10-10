"""第 1 轮剩下的：巴比伦重画、卡背、装饰和封面。等 run_b 退出后才开始（同一时间只开一个出图进程）。"""
import r1
prompt = ("the hanging gardens of Babylon, a tall Mesopotamian ziggurat of tan mud brick with four square stepped terraces, "
          "every terrace edge overflowing with hanging green vines and flowers, date palm trees, stone stairs up the front, "
          "flat desert plain with the Euphrates river in front, not a Mayan pyramid, no jungle")
for side, style, seeds in (("a", r1.STYLE, (111, 112, 113)), ("b", r1.DUSK, (211, 212, 213))):
    for seed in seeds:
        r1.flux(f"babylon-{side}", "wonders", f"{prompt}, wide panoramic landscape, the monument fills most of the height, {style}, {r1.NO}", 192, 72, seed)
# 亚历山大 B 面 s202 上下各有 4px 黑边，补一个种子
r1.flux("alexandria-b", "wonders", f"{r1.WONDER['alexandria']}, wide panoramic landscape, the monument fills most of the height, {r1.DUSK}, {r1.NO}", 192, 72, 204)
for g in ('backs', 'decor'):
    try:
        r1.GROUPS[g]([])
    except Exception as e:
        print(g, '失败', e, flush=True)
print('rest 完成', flush=True)
