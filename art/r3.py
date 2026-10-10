"""七大奇迹 出图第 3 轮（2026-10-10 接手后）：一个进程，进程内线程池并发（会员下 ≤10，这里用 4）。

  python art/r3.py cards    建筑插画重画：r2.CARD_REDO 的 18 张 + 第 1 批「主体只是一座小房子/神庙」的 12 张，各 3 个种子
  python art/r3.py small    陵墓徽记重画（generate-image-v2，64 个）
  python art/r3.py anim     夜间火盆动画（animate-with-text-v3）
  python art/r3.py wonders  奇迹补画（第 2 轮引导图之外的纯提示词版，见 WONDER3）
已经出过的跳过。同一时间只开这一个出图进程。
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor

import pixellab
import r1
import r2

OUT = r1.ART / "out" / "r3"

CARD_MORE = {
    "lumber_yard": "a lumber yard at the edge of an olive grove: big piles of stacked logs and a long two-man saw on a sawhorse, wood chips on the ground",
    "stone_pit": "a shallow open stone pit dug into the ground with freshly cut white stone blocks inside, a wooden lever and a rope",
    "clay_pool": "a muddy red clay pool beside a small stream, rows of rectangular mud bricks drying in the sun beside it",
    "clay_pit": "a dug red clay pit, a woven basket full of dark blue-grey ore rocks at its edge, a shovel",
    "timber_yard": "a yard with a stack of logs on the left and a pile of grey stone blocks on the right, a small wooden handcart between them",
    "quarry": "a big terraced stone quarry cut in steps into a white cliff, a wooden crane lifting a stone block",
    "loom": "a big wooden weaving loom with blue and white striped cloth on it, bolts of cloth stacked beside it",
    "pawnshop": "a small stone shop front with a big bronze balance scale hanging at the door and two clay jars, a few coins",
    "east_trading_post": "a small roadside trading post hut with crates, sacks and a donkey cart, a dirt road leading away to the right edge",
    "west_trading_post": "a small roadside trading post hut with crates, sacks and a donkey cart, a dirt road leading away to the left edge",
    "circus": "a huge round Roman amphitheater seen from outside, many stacked rows of stone arches in three tiers, oval shape",
    "guard_tower": "a tall narrow mudbrick watchtower with a small wooden lookout platform and railing on top, a ladder, a little pennant",
}


CARD_R4 = {  # 第 3 轮里还看不出主体的，换说法再出（种子 321–323）
    "arsenal": "close-up of a stone armory wall with many round bronze hoplite shields hanging in rows and a wooden rack of tall spears in front, no building exterior",
    "barracks": "a simple wooden army barracks shed, in front of it a wooden rack with tall spears standing upright and three round shields leaning against it, a bronze helmet on a bench",
    "haven": "a marble harbor quay with an ancient Greek wooden merchant galley with one square sail and oars moored at it, stacked amphorae and crates on the quay, a white columned warehouse behind, no steamship, no motor boat, no modern ship",
    "mine": "a wooden mine shaft tower frame with a rope pulley wheel on top over a hole in a rocky mountainside, a mine cart full of dark ore and piles of grey rubble",
}


def cards(names):
    data = json.loads((r1.ROOT / "data/cards.json").read_text())
    info = {}
    for c in data:
        info.setdefault(c["name"].lower().replace(" ", "_"), c)
    jobs = []
    todo = [(slug, subj, (311, 312, 313)) for slug, subj in (r2.CARD_REDO | CARD_MORE).items()]
    todo += [(slug, subj, (321, 322, 323)) for slug, subj in CARD_R4.items()]
    for slug, subject, seeds in todo:
        if names and slug not in names:
            continue
        c = info[slug]
        back = "a plain wall behind, warm interior light" if slug in r2.INDOOR else "simple sky and distant sea behind, horizon in the lower third"
        prompt = (f"a small pixel art vignette showing {subject}, close-up so the subject fills most of the image, "
                  f"{r2.GROUND[c['age']]}, {back}, {r1.STYLE}, {r1.NO}, no modern objects")
        for seed in seeds:
            target = OUT / "cards" / c["color"] / f"{slug}-s{seed}.png"
            if target.exists():
                continue
            jobs.append((slug, c["color"], prompt, seed))
    print("cards jobs", len(jobs), flush=True)

    def run(job):
        slug, color, prompt, seed = job
        try:
            pixellab.generate_image(f"{slug}-s{seed}", {
                "description": prompt, "image_size": {"width": 56, "height": 44}, "no_background": False,
                "detail": "highly detailed", "view": "side", "seed": seed,
            }, OUT / "cards" / color)
            print("card", slug, seed, "ok", flush=True)
        except Exception as e:
            print("card", slug, seed, "失败", e, flush=True)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(run, jobs))


def small(names):
    for name, (prompt, w, h) in {
        "emblem-halicarnassus": ("a round white marble medallion with a thin gold rim, showing a simple bold dark navy silhouette of a tall "
                                 "narrow tower tomb: a wide solid block base, a short row of columns, a stepped pyramid roof rising to a "
                                 "point with a tiny horse statue on top, 32x32 pixel art game emblem, centered, clean, no text, no letters, "
                                 "not a temple front, no triangular pediment", 32, 32),
    }.items():
        folder = OUT / "small" / name
        if folder.exists() and any(folder.glob("*.png")):
            continue
        pixellab.generate_async(name, {"description": prompt, "image_size": {"width": w, "height": h},
                                       "no_background": True, "seed": 502}, folder, endpoint="/generate-image-v2")
        print("small", name, "ok", flush=True)


def anim(names):
    import base64, io
    from PIL import Image
    pick = json.loads((r1.ART / "small_picks.json").read_text())["brazier"][0]
    src = r1.OUT / "small" / "brazier" / (f"brazier-{pick}.png" if pick else "brazier.png")
    img = Image.open(src).convert("RGBA")
    box = img.getchannel("A").getbbox()
    img = img.crop(box)
    canvas = Image.new("RGBA", (16, 24), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((16 - img.width) // 2, 24 - img.height))
    big = canvas.resize((64, 96), Image.NEAREST)
    folder = OUT / "anim" / "brazier"
    folder.mkdir(parents=True, exist_ok=True)
    big.save(folder / "first.png")
    buf = io.BytesIO(); big.save(buf, format="PNG")
    first = {"type": "base64", "base64": base64.b64encode(buf.getvalue()).decode(), "format": "png"}
    for seed, action in ((801, "the orange flames flicker and dance gently, small sparks rise"),
                         (802, "the fire flames sway left and right, embers float up"),
                         (803, "the flames flicker, tongues of fire move up and down")):
        target = f"brazier-s{seed}"
        if (folder / target).exists() or list(folder.glob(f"{target}*")):
            continue
        pixellab.animate(target, {"first_frame": first, "last_frame": first, "action": action, "frame_count": 6,
                                  "seed": seed, "no_background": True}, folder)
        print("anim", target, "ok", flush=True)


COVER = ("an ancient Greek harbor in warm afternoon light seen between two white marble columns at the left and right edges, "
         "a tall white three-tiered lighthouse with a fire on top in the center on a small island, a giant bronze statue of a "
         "Greek warrior with a spear and round shield standing on the harbor breakwater, a white temple with many columns on a "
         "green hill, small pyramids far away on the horizon, wooden ships with white sails on calm turquoise water, olive trees, "
         "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, "
         "no people, no text, no letters, no logo, no signature, no watermark, no black bars")


def covers(names):
    jobs = [s for s in (711, 712, 713, 714) if not (OUT / "covers" / f"cover-s{s}.png").exists()]

    def run(seed):
        pixellab.generate_image(f"cover-s{seed}", {
            "description": COVER, "image_size": {"width": 384, "height": 192}, "detail": "highly detailed", "seed": seed,
        }, OUT / "covers")
        print("cover", seed, "ok", flush=True)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(run, jobs))


def wonders(names):
    """第 2 轮引导重画构图对了但画得平（引导图本身是平涂）。这里拿它们当起点再细化：
    bitforge 带风格参考（已签字、细节足的以弗所 A s103），和 pixflux 中等强度 init 两种。"""
    style = pixellab.b64_image(r1.OUT / "wonders" / "ephesus-a-s103.png")
    starts = {
        "babylon": ["babylon-a-g140-s2113", "babylon-a-g60-s2111"],
        "halicarnassus": ["halicarnassus-a-g100-s2112"],
        "rhodes": ["rhodes-a-g60-s2111"],
    }
    jobs = []
    for key, srcs in starts.items():
        if names and key not in names:
            continue
        for src in srcs:
            init = pixellab.b64_image(r2.OUT / "wonders" / f"{src}.png")
            desc = f"{r2.PROMPT[key]}, {r2.SKY}, wide panoramic landscape, the monument fills most of the height, {r1.STYLE}, {r1.NO}"
            for seed in (3101, 3102):
                jobs.append((f"{src}-bf-s{seed}", "/create-image-bitforge", {
                    "description": desc, "image_size": {"width": 192, "height": 72}, "seed": seed,
                    "style_image": style, "style_strength": 40, "init_image": init, "init_image_strength": 200,
                }))
                jobs.append((f"{src}-px-s{seed}", "/create-image-pixflux", {
                    "description": desc, "image_size": {"width": 192, "height": 72}, "seed": seed, "detail": "highly detailed",
                    "view": "side", "init_image": init, "init_image_strength": 220,
                }))
    jobs = [j for j in jobs if not (OUT / "wonders" / f"{j[0]}.png").exists()]

    def run(job):
        name, endpoint, body = job
        try:
            pixellab.generate_image(name, body, OUT / "wonders", endpoint=endpoint)
            print("wonder", name, "ok", flush=True)
        except Exception as e:
            print("wonder", name, "失败", str(e)[:300], flush=True)

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(run, jobs))


GROUPS = {"cards": cards, "small": small, "anim": anim, "covers": covers, "wonders": wonders}

if __name__ == "__main__":
    for g in (sys.argv[1:] or ["cards"]):
        try:
            GROUPS[g]([])
        except Exception as e:
            print(g, "失败", e, flush=True)
    print("完成", flush=True)
