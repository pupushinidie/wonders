"""出图唯一进程（同一时间只开这一个）：先出评审第 1 轮要重画的奇迹，再出剩下的建筑插画、小图、卡背、装饰封面。
A 面先出 3 个种子，B 面用对应的 A 面当 init_image 换黄昏光（A、B 同一构图同一主体）。"""
import json, r1, pixellab

SKY = "pale harbor-blue sky (#9CC3D6) with a few soft white clouds"
REDO = {
    "babylon": ("the hanging gardens of Babylon: a wide and low structure of three or four stepped mud-brick terraces on a flat "
                "river plain, each terrace set back from the one below, every terrace edge is a row of round arched colonnades "
                "with green vines and plants hanging down, trees growing on the terraces, a river and an irrigation canal in front, "
                "a distant city wall of blue glazed bricks, terraced gardens, no jungle, no tropical island, no palm trees, "
                "no Mayan pyramid, no temple on top, no central staircase, no waterfall", 1100),
    "rhodes": ("the Colossus of Rhodes: a giant warm bronze statue (gold-brown bronze, not green, not patina) of a Greek hoplite "
               "warrior wearing a crested Corinthian helmet, holding a tall spear upright close to his body and a round shield, "
               "standing with legs apart astride the harbor entrance, one foot on each stone breakwater, a sailing ship passing "
               "between his legs, the statue fills most of the height, placed center-left, open sea on the lower right, "
               "no torch, no crown, no raised arm, no robe, no island pedestal", 1200),
    "halicarnassus": ("the Mausoleum of Halicarnassus: a tall tower-like white marble tomb, from bottom to top: a tall solid square "
                      "podium taking half of the height with a carved frieze band, a short ring of ionic columns, a stepped pyramid "
                      "roof with many steps rising to a small flat top, a bronze four-horse chariot statue on the very top, "
                      "ancient white houses and a harbor far behind, no minaret, no dome, no church, no mosque, no tower in the "
                      "background, no triangular pediment", 1300),
}


def run_a_b(key, prompt, seed0):
    for i in range(3):
        sa, sb = seed0 + i, seed0 + 100 + i
        r1.flux(f"{key}-a", "wonders", f"{prompt}, {SKY}, wide panoramic landscape, {r1.STYLE}, {r1.NO}", 192, 72, sa)
        dusk_from(key, f"{key}-a-s{sa}", f"{prompt}, {r1.DUSK}", sb)


def dusk_from(key, src, prompt, seed):
    target = f"{key}-b-s{seed}"
    if (r1.OUT / "wonders" / f"{target}.png").exists():
        return
    init = pixellab.b64_image(r1.OUT / "wonders" / f"{src}.png")
    try:
        r1.flux(f"{key}-b", "wonders", f"{prompt}, same composition, wide panoramic landscape, {r1.NO}", 192, 72, seed,
                extra={"init_image": init, "init_image_strength": 450})
    except Exception as e:
        print("init_image 不行，改成直接出：", e, flush=True)
        r1.flux(f"{key}-b", "wonders", f"{prompt}, wide panoramic landscape, {r1.NO}", 192, 72, seed)


for key, (prompt, seed0) in REDO.items():
    run_a_b(key, prompt, seed0)
# 宙斯 B：照 A s103 正面对称构图画黄昏版
oly = ("the temple of Zeus at Olympia seen straight from the front, symmetrical, the central doorway between the two middle "
       "columns opens into an interior lit by warm orange firelight, a huge gold and ivory seated statue of Zeus on a throne "
       "holding a scepter fills most of the doorway height, no face details, orange-pink sunset sky, purple-blue sea, not a three-quarter view")
for i, seed in enumerate((1401, 1402, 1403)):
    dusk_from("olympia", "olympia-a-s103", f"{oly}, {r1.DUSK}", seed)
# 亚历山大 B 补一张
r1.flux("alexandria-b", "wonders", f"{r1.WONDER['alexandria']}, wide panoramic landscape, the monument fills most of the height, {r1.DUSK}, {r1.NO}", 192, 72, 204)
print("奇迹重画完成", flush=True)
# 剩下的建筑插画（不强制调色板）、小图、卡背、装饰封面
_flux = r1.flux
r1.flux = lambda *a, **k: _flux(*a, **{**k, "palette": False})
for color in ("blue", "brown", "gray", "yellow", "red", "green", "purple"):
    try:
        r1.cards([color])
    except Exception as e:
        print("cards", color, "失败", e, flush=True)
r1.flux = _flux
print("建筑插画完成", flush=True)
for g in ("small", "backs", "decor"):
    try:
        r1.GROUPS[g]([])
    except Exception as e:
        print(g, "失败", e, flush=True)
print("全部完成", flush=True)
