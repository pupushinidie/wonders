"""第 1 轮 E 批：巴比伦重画（第一批像玛雅丛林金字塔）。"""
import r1
prompt = ("the hanging gardens of Babylon, a tall Mesopotamian ziggurat of tan mud brick with four square stepped terraces, "
          "every terrace edge overflowing with hanging green vines and flowers, date palm trees, stone stairs up the front, "
          "flat desert plain with the Euphrates river in front, not a Mayan pyramid, no jungle")
for side, style, seeds in (("a", r1.STYLE, (111, 112, 113)), ("b", r1.DUSK, (211, 212, 213))):
    for seed in seeds:
        r1.flux(f"babylon-{side}", "wonders", f"{prompt}, wide panoramic landscape, the monument fills most of the height, {style}, {r1.NO}", 192, 72, seed)
print('E 批完成', flush=True)
