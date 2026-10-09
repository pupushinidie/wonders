/**
 * 奇迹板：192×72 插图 × n + 代码画的框（A 面海蓝回纹、B 面金色回纹 + B 徽章）+ 名字牌 + 起始资源 + 阶段格（spec §4.2）。
 */
import type { CSSProperties } from "react";
import { wonder as wonderDef, wonderStages, type PlayerState, type WonderKey, type WonderSide } from "@wonders/game";
import { art } from "./art.js";
import { CostPips, EffectIcons, Icon } from "./Card.js";
import { effectText, resCount } from "./text.js";

export function WonderBoard({ wonder, side, stages, n, shine = -1, nameSize = "auto", tutorial, detail = false }: {
  wonder: WonderKey | null;
  side: WonderSide;
  stages: number;
  n: 1 | 2 | 3;
  /** 刚建成的阶段（0 起），亮一下。 */
  shine?: number;
  nameSize?: "auto" | "small";
  tutorial?: string;
  /** 阶段格写出效果的完整说明（弹窗里用）。 */
  detail?: boolean;
}) {
  if (!wonder) {
    return (
      <div className="wd-board empty" style={{ "--n": n } as CSSProperties} data-tutorial={tutorial}>
        <span>还没挑奇迹</span>
      </div>
    );
  }
  const def = wonderDef(wonder);
  const list = wonderStages(wonder, side);
  const showEffects = n >= 2;
  return (
    <div className={`wd-board side-${side}${nameSize === "small" || n === 1 ? " small" : ""}`} style={{ "--n": n } as CSSProperties} data-tutorial={tutorial}>
      <div className="wd-board-pic">
        <img src={art.wonder(wonder, side)} alt={def.zh} width={192 * n} height={72 * n} draggable={false} />
        <span className="wd-board-name">{def.zh}</span>
        <span className="wd-board-start" title={`起始资源：${resCount(def.start)}（邻居能买）`}><Icon name={`res-${def.start}`} s={n === 1 ? 1 : 2} /></span>
        {side === "B" && <span className="wd-board-b">B</span>}
      </div>
      <ol className={detail ? "wd-stages detail" : "wd-stages"} data-tutorial={tutorial ? `${tutorial}-stages` : undefined}>
        {list.map((stage, index) => {
          const built = index < stages;
          const text = `第 ${index + 1} 层：${resCount(stage.cost)} → ${stage.effects.map(effectText).join("，")}${built ? "（已建）" : ""}`;
          return (
            <li key={index} className={[built ? "built" : "", index === stages ? "next" : "", index === shine ? "shine" : ""].join(" ")} title={text}>
              <CostPips cost={stage.cost} n={n === 1 ? 1 : 2} />
              {showEffects && <span className="wd-stage-eff">{stage.effects.map((effect, k) => <EffectIcons key={k} effect={effect} s={1} />)}</span>}
              {built && <img className="wd-stage-check" src={art.icon("stage-built")} alt="已建" width={16} height={16} />}
              {detail && <small>{stage.effects.map(effectText).join("，")}</small>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function PlayerBoard({ player, n, shine, tutorial, detail }: { player: PlayerState; n: 1 | 2 | 3; shine?: number; tutorial?: string; detail?: boolean }) {
  return <WonderBoard wonder={player.wonder} side={player.side} stages={player.stages} n={n} {...(shine !== undefined ? { shine } : {})} {...(tutorial ? { tutorial } : {})} detail={detail ?? false} />;
}
