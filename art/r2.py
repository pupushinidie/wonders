"""七大奇迹 出图第 2 轮（评审第 1 轮之后）。同一时间只开这一个出图进程。

  python art/r2.py wonders   巴比伦/陵墓/罗德岛 A 面：用 guides.py 的构图引导图当 init_image（第 1 批纯提示词还是画成
                             玛雅金字塔、普通神庙、海岛底座）。B 面不再出图，用 dusk.py 从选中的 A 面代码调成黄昏
                             （run_all 里 init_image_strength 450 的 B 面和 A 面几乎一样，没用）。
  python art/r2.py anim      动画（animate-with-text-v3）。
已经出过的跳过。
"""
from __future__ import annotations

import sys

import pixellab
import r1

OUT = r1.ART / "out" / "r2"
GUIDE = OUT / "guides"
SKY = "pale harbor-blue sky with a few soft white clouds"

PROMPT = {
    "babylon": ("the hanging gardens of Babylon, a wide and low palace of four stacked mud-brick terraces on a flat river plain, "
                "each terrace set back from the one below, every terrace wall is a row of round arched openings, green vines and "
                "plants hanging down over every terrace edge, trees growing on top of every terrace, a calm river in front, "
                "a distant city wall of blue glazed bricks on the right, sand yellow mud brick, terraced gardens, "
                "no jungle, no tropical island, no palm trees, no Mayan pyramid, no temple on top, no central staircase, no waterfall"),
    "halicarnassus": ("the Mausoleum of Halicarnassus, a tall tower-like white marble tomb in the center: a tall solid square "
                      "podium with a carved frieze band, a ring of slender ionic columns above it, a stepped pyramid roof with "
                      "many steps rising to a small flat top, a small bronze four-horse chariot statue on the very top, "
                      "distant small ancient white houses with terracotta roofs on green hills, calm harbor water, "
                      "no minaret, no dome, no church, no mosque, no triangular pediment"),
    "rhodes": ("the Colossus of Rhodes, a giant warm bronze statue of a Greek hoplite warrior with a crested Corinthian helmet, "
               "a round bronze shield and a tall spear held upright, standing with legs wide apart astride the harbor entrance, "
               "one foot on each stone breakwater, a small sailing ship passing between his legs, gold-brown bronze, "
               "not green, no patina, no torch, no crown, no raised arm, no robe"),
}


def wonders(names):
    for key, prompt in PROMPT.items():
        if names and key not in names:
            continue
        init = pixellab.b64_image(GUIDE / f"{key}.png")
        for seed, strength in ((2111, 60), (2112, 100), (2113, 140)):
            target = f"{key}-a-g{strength}-s{seed}"
            if (OUT / "wonders" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": f"{prompt}, {SKY}, wide panoramic landscape, the monument fills most of the height, {r1.STYLE}, {r1.NO}",
                "image_size": {"width": 192, "height": 72},
                "detail": "highly detailed",
                "view": "side",
                "seed": seed,
                "init_image": init,
                "init_image_strength": strength,
            }, OUT / "wonders")
            print("wonders", target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


# ---------------------------------------------------------------- 建筑插画重画（第 1 批「建筑居中」把主体画成了千篇一律的小房子/神庙）
GROUND = {1: "rustic village setting, dirt ground with olive trees, simple wood and mudbrick",
          2: "paved stone ground, cut grey and white stone",
          3: "white marble ground with gold accents"}
CARD_REDO = {
    "ore_vein": "a mine tunnel entrance in a rocky hillside braced with wooden beams, dark blue-grey ore rocks piled in front, a pickaxe",
    "tree_farm": "rows of young saplings in a tree nursery field, a small stack of mud bricks in the corner",
    "excavation": "an open excavated earth slope dig site, grey stone blocks on the left and a pile of red clay on the right, a shovel and a basket",
    "mine": "a wooden mine shaft headframe on a rocky mountain, piles of grey stone rubble and dark ore at its foot",
    "press": "a wooden papyrus press frame with stacked sheets, blank rolled papyrus scrolls drying on a rack beside it, blank, no writing",
    "altar": "an open-air ancient Greek stone altar block on a hilltop with a thin wisp of smoke rising, two small columns, olive trees, no building, no church, no cross",
    "theater": "a small ancient Greek semicircular open-air theater with curved stone seat steps built into a hillside, seen from above, round stage at the bottom",
    "lighthouse": "a small short ancient stone lighthouse, a single round stone storey with an open fire basket burning on top, on a rocky sea cape, no stripes, no glass lantern, not a modern lighthouse",
    "barracks": "an ancient Greek wooden army barracks hut with a rack of tall spears and round shields leaning at the door, helmets on a bench",
    "training_ground": "an open sandy training yard with wooden practice posts, straw dummies and round wooden targets, a low fence",
    "stables": "an open wooden horse stable with a brown horse's head looking out of the stall, hay bales piled in front",
    "fortifications": "a massive ancient Greek fortress: two tall square stone towers with crenellations joined by a thick crenellated wall with a gate, no church, no bell tower, no dome",
    "arsenal": "the open front of an armory storehouse showing racks of many round bronze shields and tall spears lined up in rows",
    "siege_workshop": "a large wooden torsion catapult and a wooden battering ram on wheels in a sandy workshop yard with timber, no cannon, no gunpowder",
    "workshop": "a carpenter's wooden workbench with a small wooden gear machine, saws and hammers hanging on the wall",
    "scriptorium": "inside a small room with shelves full of rolled scrolls and clay tablets, a writing desk, blank, no writing",
    "laboratory": "an alchemist laboratory table with a copper still, bubbling copper pots and glass flasks",
    "lodge": "a quiet lodge room with a star chart painted on the wall, candles burning on a table with scrolls, blank, no writing",
}
INDOOR = {"press", "workshop", "scriptorium", "laboratory", "lodge"}


def cards(names):
    import json
    data = json.loads((r1.ROOT / "data/cards.json").read_text())
    info = {}
    for c in data:
        info.setdefault(c["name"].lower().replace(" ", "_"), c)
    for slug, subject in CARD_REDO.items():
        if names and slug not in names:
            continue
        c = info[slug]
        back = "a plain wall behind, warm interior light" if slug in INDOOR else "simple sky and distant sea behind, horizon in the lower third"
        prompt = (f"a small pixel art vignette showing {subject}, close-up so the subject fills most of the image, "
                  f"{GROUND[c['age']]}, {back}, {r1.STYLE}, {r1.NO}, no modern objects")
        for seed in (311, 312, 313):
            r1.flux(slug, f"../r2/cards/{c['color']}", prompt, 56, 44, seed)


# ---------------------------------------------------------------- 小图重画：陵墓徽记（第 1 批全是神庙正面，和以弗所分不开）
def small(names):
    jobs = {
        "emblem-halicarnassus": ("a round white marble medallion with a thin gold rim, showing a simple bold dark navy silhouette of a tall "
                                 "narrow tower tomb: a wide solid block base, a short row of columns, a stepped pyramid roof rising to a "
                                 "point with a tiny horse statue on top, 32x32 pixel art game emblem, centered, clean, no text, no letters, "
                                 "not a temple front, no triangular pediment", 32, 32),
    }
    for name, (prompt, w, h) in jobs.items():
        if names and name not in names:
            continue
        folder = OUT / "small" / name
        if folder.exists() and any(folder.glob("*.png")):
            continue
        pixellab.generate_async(name, {"description": prompt, "image_size": {"width": w, "height": h},
                                       "no_background": True, "seed": 502}, folder, endpoint="/generate-image-v2")
        print("small", name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


# ---------------------------------------------------------------- 动画：夜间火盆（首帧 = 选中的火盆 ×2，出完缩回 16×24）
def anim(names):
    import base64, io
    from PIL import Image
    jobs = {
        "brazier": ("small_picks", "the orange flames flicker and dance gently, small sparks rise", 7, (801, 802, 803)),
    }
    for name, (_, action, frames, seeds) in jobs.items():
        if names and name not in names:
            continue
        import json as _j
        pick = _j.loads((r1.ART / "small_picks.json").read_text())[name][0]
        src = r1.OUT / "small" / name / (f"{name}-{pick}.png" if pick else f"{name}.png")
        img = Image.open(src).convert("RGBA")
        canvas = Image.new("RGBA", (16, 24), (0, 0, 0, 0))
        canvas.alpha_composite(img, ((16 - img.width) // 2, 24 - img.height))
        big = canvas.resize((32, 48), Image.NEAREST)
        buf = io.BytesIO(); big.save(buf, format="PNG")
        first = {"type": "base64", "base64": base64.b64encode(buf.getvalue()).decode(), "format": "png"}
        (OUT / "anim" / name).mkdir(parents=True, exist_ok=True)
        big.save(OUT / "anim" / name / "first.png")
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "anim" / name / f"{target}-00.png").exists():
                continue
            pixellab.animate(target, {"first_frame": first, "last_frame": first, "action": action, "frame_count": frames,
                                      "seed": seed, "no_background": True}, OUT / "anim" / name)
            print("anim", target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


GROUPS = {"wonders": wonders, "cards": cards, "small": small, "anim": anim}

if __name__ == "__main__":
    for g in (sys.argv[1:] or ["wonders"]):
        try:
            GROUPS[g]([])
        except Exception as e:  # 一组失败不挡下一组
            print(g, "失败", e, flush=True)
    print("完成", flush=True)
