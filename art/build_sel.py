"""正式美术定稿表（2026-10-10 接手后自查自选）：一处写清每项选哪张、备选有哪些、为什么。

生成两份文件：
- art/picks.json      画廊用：{spec 路径: {options: [art/out 下的候选], pick: 推荐下标, note: 理由, extra: 导出时的处理}}
- art/selection.json  导出用：{spec 路径: {src/code/strip..., 处理参数, note}}（export.py 读）
用法：python art/build_sel.py && python art/export.py
"""
from __future__ import annotations

import json
import pathlib

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
ROOT = ART.parent
MANIFEST = {it["path"]: it for it in json.loads((ART / "manifest.json").read_text())}
CARDS = {}
for c in json.loads((ROOT / "data/cards.json").read_text()):
    CARDS.setdefault(c["name"].lower().replace(" ", "_"), c)

SEAT = {"giza": "#E69F00", "rhodes": "#D55E00", "alexandria": "#56B4E9", "ephesus": "#F0E442",
        "babylon": "#009E73", "olympia": "#CC79A7", "halicarnassus": "#0072B2"}

picks: dict[str, dict] = {}


def put(path: str, options: list, pick: int = 0, note: str = "", **extra) -> None:
    assert path in MANIFEST, path
    for o in options:
        if isinstance(o, str):
            assert (OUT / o).exists(), o
    picks[path] = {"options": options, "pick": pick, "note": note, "extra": extra}


# ---------------------------------------------------------------- 场景（评审第 1 轮签字，focus = 实测灯塔横坐标）
SCENES = {
    "night-1": (["r1/scenes/scene-night-1-s33.png", "r1/scenes/scene-night-1-s32.png", "r1/scenes/scene-night-1-s31.png"], 278,
                "月亮在右上、两只火盆在下角，中间安静，压暗后面板清楚"),
    "night-2": (["r1/scenes/scene-night-2-s42.png", "r1/scenes/scene-night-2-s41.png", "r1/scenes/scene-night-2-s43.png"], 319,
                "长堤通向灯塔、左右对称，和白天 2 同一视角"),
    "day-1": (["r1/scenes/scene-day-1-s13.png", "r1/scenes/scene-day-1-s11.png", "r1/scenes/scene-day-1-k43.png"], 265,
              "柱廊框住海港，灯塔最靠近正中，手机也露得出来"),
    "day-2": (["r1/scenes/scene-day-2-s21.png", "r1/scenes/scene-day-2-s22.png", "r1/scenes/scene-day-2-s23.png"], 328,
              "栏杆露台 + 长堤灯塔，构图对称，中间平静"),
}
for k, (opts, focus, note) in SCENES.items():
    put(f"scene/{k}.png", opts, 0, note, focus=focus)

# ---------------------------------------------------------------- 奇迹（A 正午；B 黄昏。重画的三座 B 面由 dusk.py 从 A 面调色）
W = "r1/wonders/"
put("wonders/giza-a.png", [W + "giza-a-s101.png", W + "giza-a-s103.png", W + "giza-a-s102.png"], 0,
    "三座都在，近大远小，×1 最清楚", sky=True, colors=32)
put("wonders/giza-b.png", [W + "giza-b-s201.png", W + "giza-a-s101.png", W + "giza-b-s203.png"], 0,
    "主体占七成高，黄昏紫影金光，和 A 面一眼分开", colors=32)
put("wonders/alexandria-a.png", [W + "alexandria-a-s101.png", W + "alexandria-a-s102.png"], 0,
    "分层塔身、顶上有火、岛和古帆船（s103 有现代汽船，不列）", sky=True, colors=32)
put("wonders/alexandria-b.png", [W + "alexandria-b-s201.png", W + "alexandria-b-s204.png", W + "alexandria-b-s203.png"], 0,
    "顶上有火、古帆船、黄昏", colors=32)
put("wonders/ephesus-a.png", [W + "ephesus-a-s103.png", W + "ephesus-a-s101.png", W + "ephesus-a-s102.png"], 0,
    "神庙占约 75% 高，双排柱看得出来", sky=True, colors=32)
put("wonders/ephesus-b.png", [W + "ephesus-b-s202.png", W + "ephesus-b-s201.png", W + "ephesus-b-s203.png"], 0,
    "宽神庙、黄昏，和 A 面分得开", colors=32)
put("wonders/olympia-a.png", [W + "olympia-a-s103.png", W + "olympia-b-s1401.png", W + "olympia-a-s101.png"], 0,
    "神殿正面，柱间金色坐像 ×1 也认得出", sky=True, colors=32)
put("wonders/olympia-b.png", [W + "olympia-a-s103.png", W + "olympia-b-s1401.png", W + "olympia-b-s1403.png"], 0,
    "照 A 面同一张正面构图代码调成黄昏（评审要求：正面对称 + 大坐像，和以弗所 B 拉开）", dusk=True, colors=32)

# 重画的三座：候选和推荐在 WONDER_REDO 里填（看完第 3 轮再定）
WONDER_REDO: dict[str, tuple[list[str], int, str]] = json.loads((ART / "wonder_redo.json").read_text()) \
    if (ART / "wonder_redo.json").exists() else {}
for key, (opts, pick, note) in WONDER_REDO.items():
    put(f"wonders/{key}-a.png", opts, pick, note, colors=32)  # 重画时提示词里已写浅海港蓝天，不再统一天色
    put(f"wonders/{key}-b.png", opts, pick, "同一张 A 面代码调成黄昏（A/B 同一尊像、同一构图）", dusk=True, colors=32)

# ---------------------------------------------------------------- 徽记（v2 64 选 1，外圈换成座位色）
SMALL = json.loads((ART / "small_picks.json").read_text())


def small(name: str, rnd: str = "r1") -> list[str]:
    return [f"{rnd}/small/{name}/" + (f"{name}-{i}.png" if i else f"{name}.png") for i in SMALL[name]]


SMALL["emblem-halicarnassus-r3"] = [17, 1, 9]
for key, col in SEAT.items():
    if key == "halicarnassus":
        opts = [f"r3/small/emblem-halicarnassus/emblem-halicarnassus-{i}.png" for i in (17, 1, 9)] + small("emblem-halicarnassus")[:1]
        note = "第 3 轮重画：高台基 + 阶梯顶 + 顶上马，和以弗所的神庙正面分得开（第 1 批全是神庙正面）"
    else:
        opts = small(f"emblem-{key}")
        note = "剪影 32px 下清楚，外圈换成座位色"
    put(f"wonders/{key}-emblem.png", opts, 0, note, rim=col)

# ---------------------------------------------------------------- 图标（v2 64 选 1；抽象的用代码画）
V2_ICONS = ["res-W", "res-C", "res-S", "res-O", "res-G", "res-L", "res-P", "sci-compass", "sci-gear", "sci-tablet",
            "shield", "coin", "vp", "stage-built", "act-build", "act-wonder", "act-sell", "waiting",
            "cat-brown", "cat-gray", "cat-blue", "cat-green", "cat-yellow", "cat-red", "cat-purple"]
for name in V2_ICONS:
    put(f"icons/{name}.png", small(name), 0, "64 个里挑的：16px 下形状清楚，深浅底都看得清")
for name in ["sci-any", "chain", "stage-open", "trade", "trade-left", "eff-any-raw", "eff-any-goods", "eff-free-build",
             "eff-discard-build", "eff-seventh", "eff-copy-guild", "ready"]:
    put(f"icons/{name}.png", [{"code": name}], 0, "抽象符号，用代码画（和资源图标同一套描边、斜面），比模型出的准")

# ---------------------------------------------------------------- 小点（代码画终稿，spec §6）
for path in MANIFEST:
    if path.startswith("pips/"):
        put(path, [{"code": pathlib.Path(path).stem}], 0, "代码画（spec §6），和卡面同倍数")

# ---------------------------------------------------------------- 战争标记（底牌 v2，数字代码画）
tw = small("token-win")
for n, tint in ((1, "bronze"), (3, "silver"), (5, "gold")):
    put(f"tokens/war-win{n}.png", tw, 0, f"月桂底牌 + 代码画「+{n}」，{ {'bronze': '铜', 'silver': '银', 'gold': '金'}[tint] }色区分时代",
        stamp=f"+{n}", tint=tint)
put("tokens/war-loss.png", small("token-loss"), 0, "裂开的暗红盾 + 代码画「-1」", stamp="-1")

# ---------------------------------------------------------------- 卡背（纹样 PixelLab，框和罗马数字代码画；同一种子成套）
for age in (1, 2, 3):
    opts = [f"r1/backs/back-age{age}-s{s}.png" for s in (402, 403, 401)]
    put(f"cards/back-age{age}.png", opts, 0, "s402 三张成套：月桂环里的神庙纹样 + 细金边，罗马数字代码画", back=age)

# ---------------------------------------------------------------- 界面装饰
put("ui/arrow-pass.png", [{"code": "arrow", "variant": 2}, {"code": "arrow", "variant": 1}, {"code": "arrow", "variant": 3}], 0,
    "金色箭头在深浅顶栏上都最醒目，4 帧往左挪动循环")
put("ui/laurel.png", ["r1/decor/laurel-s601.png", "r1/decor/laurel-s603.png", "r1/decor/laurel-s602.png"], 0, "金绿月桂，结算第一名两侧")
put("ui/ribbon.png", ["r1/decor/ribbon-s602.png", "r1/decor/ribbon-s601.png", "r1/decor/ribbon-s603.png"], 0,
    "卷轴两端的海蓝横幅，中间平静好叠字")
put("ui/cover.png", ["r3/covers/cover-s711.png", "r1/covers/cover-s702.png", "r3/covers/cover-s712.png"], 0,
    "柱廊望海港：灯塔、持矛持盾的青铜巨像、神庙、帆船都在，没有字和人；s702 上下有黑带要裁，尺寸就不够 192 高了")

# ---------------------------------------------------------------- 特效（代码画 3 版选 1；火盆是 PixelLab 动画）
FX = {"pass-trail": (2, "浅蓝气流线带白头，传牌时最清楚"), "clash": (2, "金白火星炸开再变红散去"),
      "token-land": (2, "沙色尘土 + 小星"), "build-dust": (3, "石粉团扬起再散开"),
      "stage-shine": (2, "几颗小星依次闪（不整片发光）"), "coin-spin": (1, "金币翻转一圈"),
      "fireworks": (1, "金、粉两色烟花，界面错开播")}
for name, (v, note) in FX.items():
    order = [v] + [i for i in (1, 2, 3) if i != v]
    put(f"fx/{name}.png", [{"code": f"fx/{name}", "variant": i} for i in order], 0, note)
put("fx/brazier.png", [{"strip": "r3/anim/brazier", "glob": "brazier-s801-*.png", "use": [0, 1, 2, 3, 4, 5], "down": 4},
                       {"strip": "r3/anim/brazier", "glob": "brazier-s803-*.png", "use": [0, 1, 2, 3, 4, 5], "down": 4},
                       {"strip": "r3/anim/brazier", "glob": "brazier-s802-*.png", "use": [0, 1, 2, 3, 4, 5], "down": 4}], 0,
    "PixelLab 动画：火苗起伏 + 火星上飘，首末帧同一张静态图，无缝循环")

# ---------------------------------------------------------------- 建筑插画（75 张）：(轮次, 种子, 理由)；备选 = 第 1 轮 3 张 + 第 3 轮 3–6 张
CARD_PICK: dict[str, tuple[str, int, str]] = json.loads((ART / "card_picks.json").read_text())
for slug, c in CARDS.items():
    rnd, seed, note = CARD_PICK[slug]
    extra = {}
    if slug == "guard_tower":  # 顶上小旗原来是红白红三道，像国旗，涂成纯红三角旗
        extra = {"repaint": [[x, 1, "#963946"] for x in (18, 19, 20)]}
    if slug == "west_trading_post" and rnd == "flip":  # 西贸易站 = 东贸易站左右镜像（spec：构图镜像，道路伸向左边）
        rnd, extra = "r3", {"flip": True}
        slug_src = "east_trading_post"
    else:
        slug_src = slug
    cands = []
    for r in ("r3", "r1"):
        folder = OUT / r / "cards" / c["color"]
        cands += [f"{r}/cards/{c['color']}/{p.name}" for p in sorted(folder.glob(f"{slug_src}-s*.png"))]
    chosen = f"{rnd}/cards/{c['color']}/{slug_src}-s{seed}.png"
    assert chosen in cands, chosen
    cands.remove(chosen)
    put(f"cards/art/{slug}.png", [chosen] + cands, 0, note, **extra)

missing = [p for p in MANIFEST if p not in picks]
assert not missing, missing

sel = {}
for path, e in picks.items():
    o = e["options"][e["pick"]]
    entry = {"src": o} if isinstance(o, str) else dict(o)
    entry |= e["extra"]
    entry["note"] = e["note"]
    sel[path] = entry
(ART / "picks.json").write_text(json.dumps(picks, ensure_ascii=False, indent=1) + "\n")
(ART / "selection.json").write_text(json.dumps(sel, ensure_ascii=False, indent=1) + "\n")
print(len(sel), "项定稿写进 selection.json / picks.json")
