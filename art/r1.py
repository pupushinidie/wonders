"""七大奇迹 出图第 1 轮候选（照 art/spec.md）。

分组（python art/r1.py <组> [名字...]；已经出过的跳过）：
  scenes   场景：pixen 512×288。白天两种构图各 3 个种子；夜间版用 /edit-image 从白天候选改出来，保证日夜同构图。
  wonders  奇迹插图：pixflux 192×72，A 正午 / B 黄昏，各 3 个种子。
  cards    建筑插画：pixflux 56×44（v2 上限 42px，放不下），75 张 × 3 个种子，同一套风格词 + 同一张调色板图。
  backs    卡背纹样：pixflux 64×96，3 个时代 × 3 个种子（罗马数字代码画）。
  small    徽记、图标、战争标记底牌：generate-image-v2，一次 64 个候选。
  decor    结算装饰（月桂、横幅）、封面：pixflux / pixen。
  fx       特效首帧：pixflux 透明底；动画在定稿阶段做。

PixelLab 一次只跑一个任务；标准版客户端自动在全站排队。
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image

import pixellab

pixellab.RETRY_DELAY = 3
pixellab.RETRY_ATTEMPTS = 400

ART = pixellab.ART
ROOT = ART.parent
OUT = ART / "out" / "r1"

NO = "no people, no text, no letters, no writing, no numbers, no signs, no border, no frame"
STYLE = ("16-bit pixel art, bright Mediterranean midday sunlight from the upper left, white marble, turquoise and deep blue sea, "
         "olive green, terracotta accents, soft blue-grey shadows, crisp clean pixels")
DUSK = ("16-bit pixel art, warm golden dusk light from the left, orange and pink sunset sky, purple-blue sea, "
        "warm gold highlights on stone, long soft shadows, crisp clean pixels")

# ---------------------------------------------------------------- 调色板图（spec §1）
PALETTE = [
    "FFFFFF", "ECF0F4", "D8DDE0", "B0BECE", "7A8C9E", "4E5E70", "1E3454", "0E1624", "1B2935", "2A404B",
    "2E6FA8", "5E9BC0", "9CC3D6", "D7E8E8", "3E8FB8", "6CC4D8",
    "3A4230", "6B7A3A", "9DA65A", "4E6E2E", "86A84A",
    "B5563A", "8A3E2A", "D98A5E", "F2A03D", "FFD27A", "D8A83A", "F0BE32", "A88420",
    "E8D9B0", "C8B48A", "8C582C", "5E3A1C", "B07A44",
    "8A8C92", "5C5E64", "346CD4", "22489A", "349C4C", "22693A", "E2B834", "C83A30", "8A2620",
    "7C48B2", "54307C", "A276D4", "5AC8E2", "B080D8", "E8D28C", "464C68", "6E8C32",
]


def palette_image() -> dict:
    path = OUT / "palette.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        img = Image.new("RGB", (len(PALETTE) * 4, 4))
        for i, h in enumerate(PALETTE):
            for x in range(4):
                for y in range(4):
                    img.putpixel((i * 4 + x, y), tuple(int(h[k:k + 2], 16) for k in (0, 2, 4)))
        img.save(path)
    return pixellab.b64_image(path)


def flux(name: str, folder: str, prompt: str, w: int, h: int, seed: int, *, transparent=False, palette=False,
         extra: dict | None = None) -> None:
    target = f"{name}-s{seed}"
    out = OUT / folder
    if (out / f"{target}.png").exists():
        return
    body = {
        "description": prompt,
        "image_size": {"width": w, "height": h},
        "no_background": transparent,
        "detail": "highly detailed",
        "view": "side",
        "seed": seed,
    }
    if palette:
        body["color_image"] = palette_image()
    if extra:
        body |= extra
    pixellab.generate_image(target, body, out)
    print(folder, target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


# ---------------------------------------------------------------- 场景
SCENE = {
    "day-1": ("an ancient Greek harbor seen from inside a white marble temple portico, symmetrical composition, "
              "two big fluted columns framing the left and right edges, a tall white stone lighthouse standing exactly in the "
              "center of the image on a small island, calm turquoise bay in the middle, white houses with terracotta roofs on "
              "green hills at the sides, wooden ships with white sails, olive trees and marble floor in the foreground, "
              "clear sky with a few clouds"),
    "day-2": ("an ancient Greek harbor seen from a high marble terrace with a low balustrade, symmetrical composition, "
              "olive trees and cypress trees at the left and right edges, a tall white stone lighthouse at the end of a long "
              "stone pier exactly in the center of the image, wide calm blue sea, white town with terracotta roofs curving "
              "around the bay on both sides, small sailing ships, clear sky"),
}


def scenes(names: list[str]) -> None:
    for key, prompt in SCENE.items():
        if names and key not in names:
            continue
        for seed in (11, 12, 13) if key == "day-1" else (21, 22, 23):
            target = f"scene-{key}-s{seed}"
            out = OUT / "scenes"
            if (out / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": f"{prompt}, white blue and olive green palette, 16-bit pixel art, {NO}, wide view",
                "image_size": {"width": 512, "height": 288},
                "detail": "highly detailed",
                "seed": seed,
            }, out, endpoint="/create-image-pixen")
            print("scenes", target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def scene_nights(sources: list[str]) -> None:
    """白天候选 → 同构图夜景（/edit-image）。"""
    out = OUT / "scenes"
    for src in sources:
        target = src.replace("day", "night")
        if (out / f"{target}.png").exists():
            continue
        pixellab.generate_async(target, {
            "image": pixellab.b64_image(out / f"{src}.png"),
            "description": ("change the scene to night: dark navy sky with stars and a full moon, cool silver moonlight on the "
                            "marble columns and sea, the lighthouse fire glowing warm orange on top, lit bronze fire braziers "
                            "with warm orange flames in the foreground, warm window lights in the town, keep the exact same "
                            "composition, buildings and columns, 16-bit pixel art, no text"),
            "image_size": {"width": 512, "height": 288},
            "seed": 7,
        }, out, endpoint="/edit-image")
        print("scenes", target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


# ---------------------------------------------------------------- 奇迹
WONDER = {
    "giza": "the three great pyramids of Giza in a golden desert, the nearest pyramid largest, a thin line of the Nile with palm trees in the distance",
    "rhodes": ("the Colossus of Rhodes, a giant bronze statue of a standing man holding a long spear upright at his side, "
               "standing on a stone pedestal at the entrance of a harbor, small wooden ships at his feet, stone harbor towers"),
    "alexandria": "the ancient lighthouse of Alexandria, a tall three-tiered white stone tower with a fire burning on top, on a rocky island with waves, ships nearby",
    "ephesus": "the ancient temple of Artemis at Ephesus, a huge wide white marble temple with two rows of tall ionic columns on a stepped platform, olive trees",
    "babylon": "the hanging gardens of Babylon, a tall stepped ziggurat of sandstone terraces overflowing with green plants, palm trees and small waterfalls",
    "olympia": ("the temple of Zeus at Olympia, a large doric temple with a triangular pediment, between the front columns a giant "
                "golden and ivory seated statue is visible in the shadowy interior, cypress trees around"),
    "halicarnassus": ("the mausoleum of Halicarnassus, a tall white marble tomb: a high square podium, a ring of ionic columns, "
                      "a stepped pyramid roof topped by a small four-horse chariot statue, on a hill above a harbor town"),
}


def wonders(names: list[str]) -> None:
    for key, prompt in WONDER.items():
        if names and key not in names:
            continue
        for side, style, seeds in (("a", STYLE, (101, 102, 103)), ("b", DUSK, (201, 202, 203))):
            for seed in seeds:
                flux(f"{key}-{side}", "wonders", f"{prompt}, wide panoramic landscape, the monument fills most of the height, {style}, {NO}",
                     192, 72, seed)


# ---------------------------------------------------------------- 建筑插画
AGE_LOOK = {
    1: "humble rustic village building made of wood, mudbrick and thatch, dirt ground with olive trees",
    2: "solid building of cut grey and white stone with simple columns, paved stone ground",
    3: "grand monumental building of gleaming white marble with gold ornaments, marble platform with steps",
}
CARD_SUBJECT = json.loads((ART / "card_subjects.json").read_text()) if (ART / "card_subjects.json").exists() else {}


def cards(names: list[str], seeds=(301, 302, 303)) -> None:
    data = json.loads((ROOT / "data/cards.json").read_text())
    seen: dict[str, dict] = {}
    for c in data:
        seen.setdefault(c["name"].lower().replace(" ", "_"), c)
    for slug, c in seen.items():
        if names and slug not in names and c["color"] not in names:
            continue
        subject = CARD_SUBJECT[slug]
        prompt = (f"a small pixel art vignette of {subject}, {AGE_LOOK[c['age']]}, the building is centered and fills most of "
                  f"the image, simple sky and distant sea behind, horizon in the lower third, {STYLE}, {NO}")
        for seed in seeds:
            flux(slug, f"cards/{c['color']}", prompt, 56, 44, seed, palette=True)


# ---------------------------------------------------------------- 卡背
BACK = {
    1: "terracotta red",
    2: "deep sea blue",
    3: "royal purple",
}


def backs(names: list[str]) -> None:
    for age, color in BACK.items():
        for seed in (401, 402, 403):
            flux(f"back-age{age}", "backs",
                 (f"the back of a playing card, a {color} background with a symmetrical ornament: a small white marble Greek temple "
                  f"facade in the center surrounded by a thin gold meander border and laurel leaves, flat decorative design, "
                  f"16-bit pixel art, {NO}"), 64, 96, seed)


# ---------------------------------------------------------------- 小图（generate-image-v2，一次 64 个）
ICON = ("a single {} as a tiny 16x16 pixel art game icon, centered, chunky readable shape, 1 pixel dark navy outline, "
        "bright clear colors, no text, no letters, no numbers")
EMBLEM = ("a round white marble medallion with a thin gold rim, showing a simple bold dark navy silhouette of {}, "
          "32x32 pixel art game emblem, centered, clean, no text, no letters")
SMALL: dict[str, tuple[str, int, int]] = {
    # 资源
    "res-W": (ICON.format("pair of crossed brown wooden logs with light end grain"), 16, 16),
    "res-C": (ICON.format("small stack of three red clay bricks"), 16, 16),
    "res-S": (ICON.format("grey-white cut stone block"), 16, 16),
    "res-O": (ICON.format("lump of dark blue-grey iron ore with shiny flecks"), 16, 16),
    "res-G": (ICON.format("turquoise glass bottle"), 16, 16),
    "res-L": (ICON.format("rolled bolt of purple cloth"), 16, 16),
    "res-P": (ICON.format("rolled blank cream papyrus scroll"), 16, 16),
    # 科技
    "sci-compass": (ICON.format("brass drawing compass with two legs"), 16, 16),
    "sci-gear": (ICON.format("bronze cog wheel gear"), 16, 16),
    "sci-tablet": (ICON.format("grey stone tablet with a rounded top, blank"), 16, 16),
    # 常用
    "shield": (ICON.format("red round-topped heater shield with a gold rim"), 16, 16),
    "coin": (ICON.format("shiny round gold coin"), 16, 16),
    "vp": (ICON.format("green laurel wreath"), 16, 16),
    "stage-built": (ICON.format("golden triangular Greek temple pediment"), 16, 16),
    "waiting": (ICON.format("small hourglass with golden sand"), 16, 16),
    # 动作
    "act-build": (ICON.format("mason's hammer"), 16, 16),
    "act-wonder": (ICON.format("white marble Greek temple front with columns"), 16, 16),
    "act-sell": (ICON.format("small stack of gold coins"), 16, 16),
    # 卡色分类
    "cat-brown": (ICON.format("pile of brown logs and red bricks"), 16, 16),
    "cat-gray": (ICON.format("clay amphora with a roll of cloth"), 16, 16),
    "cat-blue": (ICON.format("blue and white Greek temple facade"), 16, 16),
    "cat-green": (ICON.format("open green scroll with a brass compass"), 16, 16),
    "cat-yellow": (ICON.format("yellow leather coin purse"), 16, 16),
    "cat-red": (ICON.format("bronze Greek hoplite helmet with a red crest"), 16, 16),
    "cat-purple": (ICON.format("purple wax seal with a gold ribbon"), 16, 16),
    # 战争标记底牌（数字代码画）
    "token-win": ("a round bronze victory medal token with a green laurel wreath around the rim and a plain blank center, "
                  "16x16 pixel art game token, 1 pixel dark navy outline, no text, no numbers", 16, 16),
    "token-loss": ("a small cracked dark red shield token with a plain blank center, 16x16 pixel art game token, "
                   "1 pixel dark navy outline, no text, no numbers", 16, 16),
    # 奇迹徽记
    "emblem-giza": (EMBLEM.format("three pyramids"), 32, 32),
    "emblem-rhodes": (EMBLEM.format("a giant standing bronze statue holding a spear"), 32, 32),
    "emblem-alexandria": (EMBLEM.format("a tall lighthouse tower with a flame on top"), 32, 32),
    "emblem-ephesus": (EMBLEM.format("a wide Greek temple front with many columns"), 32, 32),
    "emblem-babylon": (EMBLEM.format("a stepped terraced garden tower with green plants"), 32, 32),
    "emblem-olympia": (EMBLEM.format("a seated god on a throne holding a staff"), 32, 32),
    "emblem-halicarnassus": (EMBLEM.format("a tomb with columns and a stepped pyramid roof"), 32, 32),
    # 夜间火盆（动画首帧）
    "brazier": ("a bronze tripod fire brazier with bright orange flames, 16x24 pixel art sprite, side view, "
                "1 pixel dark outline, no text", 16, 24),
}


def small(names: list[str]) -> None:
    for name, (prompt, w, h) in SMALL.items():
        if names and name not in names:
            continue
        folder = OUT / "small" / name
        if folder.exists() and any(folder.glob("*.png")):
            continue
        pixellab.generate_async(name, {
            "description": prompt,
            "image_size": {"width": w, "height": h},
            "no_background": True,
            "seed": 501,
        }, folder, endpoint="/generate-image-v2")
        print("small", name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


# ---------------------------------------------------------------- 装饰、封面
def decor(names: list[str]) -> None:
    for seed in (601, 602, 603):
        flux("laurel", "decor", ("a wide golden-green laurel wreath open at the top, two curved branches of leaves, "
                                 f"pixel art game decoration, 1 pixel dark navy outline, {NO}"), 48, 32, seed, transparent=True)
        flux("ribbon", "decor", ("a long horizontal blank sea-blue cloth banner ribbon with folded tail ends and a thin gold edge, "
                                 f"plain empty center, pixel art game decoration, 1 pixel dark navy outline, {NO}"), 160, 24, seed,
             transparent=True)
    for seed in (701, 702, 703):
        flux("cover", "covers", ("an ancient Greek harbor at golden hour seen between two white marble columns: the tall lighthouse "
                                 "of Alexandria with a fire on top in the center, the Colossus of Rhodes holding a spear at the harbor "
                                 "entrance, a temple with many columns on a hill, distant pyramids on the horizon, wooden ships with "
                                 "white sails, olive trees, cozy 16-bit pixel art game cover illustration, rich warm colors, soft "
                                 "lighting, crisp clean pixels, no people, no text, no letters, no logo"), 384, 192, seed)


GROUPS = {"scenes": scenes, "wonders": wonders, "cards": cards, "backs": backs, "small": small, "decor": decor}

if __name__ == "__main__":
    group, *rest = sys.argv[1:]
    if group == "nights":
        scene_nights(rest)
    else:
        GROUPS[group](rest)
