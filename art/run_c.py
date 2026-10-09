"""第 1 轮 C 批：白天候选改成同构图夜景（/edit-image）。"""
import r1
for src in ['scene-day-2-s21', 'scene-day-1-s13', 'scene-day-2-s23', 'scene-day-1-s11', 'scene-day-1-k43', 'scene-day-2-s22']:
    try:
        r1.scene_nights([src])
    except Exception as e:
        print(src, '失败', e, flush=True)
print('C 批完成', flush=True)
