"""第 1 轮 A 批：试 3 张建筑（有/无调色板）→ 场景 → 奇迹 → 卡背 → 装饰封面，一个进程跑完，少排几次队。"""
import json, r1
data = json.load(open(r1.ROOT / 'data/cards.json'))
age = {c['name'].lower().replace(' ', '_'): c['age'] for c in data}
for slug in ['lumber_yard', 'temple', 'palace']:
    subject = r1.CARD_SUBJECT[slug]
    prompt = (f"a small pixel art vignette of {subject}, {r1.AGE_LOOK[age[slug]]}, the building is centered and fills most of "
              f"the image, simple sky and distant sea behind, horizon in the lower third, {r1.STYLE}, {r1.NO}")
    for pal in (True, False):
        r1.flux(slug + ('-pal' if pal else '-free'), 'test', prompt, 56, 44, 301, palette=pal)
for g in ('scenes', 'wonders', 'backs', 'decor'):
    try:
        r1.GROUPS[g]([])
    except Exception as e:
        print(g, '失败', e, flush=True)
print('A 批完成', flush=True)
