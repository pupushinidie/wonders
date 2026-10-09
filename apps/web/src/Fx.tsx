/**
 * 特效和过场：横排帧条播放、临时效果（计时器表只在卸载时清空，不会被下一次更新打断）、传牌、军事结算横幅、传牌箭头。
 * 入场只用位移（transform），不给图片做透明度入场。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Age, GameEvent, Side } from "@wonders/game";
import { ARROW, art, FX, type FxName } from "./art.js";

/** 播一段帧条：s = 倍数；loop 不给就按 manifest。 */
export function Sprite({ name, s, className = "", delay = 0, loop, loopDelay = 0, style }: {
  name: FxName;
  s: number;
  className?: string;
  delay?: number;
  loop?: boolean;
  loopDelay?: number;
  style?: CSSProperties;
}) {
  const fx = FX[name];
  const looping = loop ?? (fx.loop || loopDelay > 0);
  const vars = {
    "--f": fx.frames,
    "--dur": `${fx.frames * fx.ms + loopDelay}ms`,
    "--delay": `${delay}ms`,
    "--iter": looping ? "infinite" : "1",
    width: fx.w * s,
    height: fx.h * s,
    backgroundImage: `url(${art.fx(name)})`,
    ...style,
  } as CSSProperties;
  return <span className={`wd-sprite ${className}`} style={vars} aria-hidden="true" />;
}

/** 传牌方向箭头（原图朝左，往右传时镜像）。 */
export function PassArrow({ direction, s }: { direction: Side; s: number }) {
  const vars = {
    "--f": ARROW.frames,
    "--dur": `${ARROW.frames * ARROW.ms}ms`,
    "--delay": "0ms",
    "--iter": "infinite",
    width: ARROW.w * s,
    height: ARROW.h * s,
    backgroundImage: `url(${art.arrow})`,
  } as CSSProperties;
  return <span className={direction === "right" ? "wd-sprite wd-arrow flip" : "wd-sprite wd-arrow"} style={vars} aria-hidden="true" />;
}

let seq = 0;
/** 临时效果：push(value, ms) 显示一阵后自己消失。计时器只在卸载时清，状态更新不会把它们取消。 */
export function useTransient<T>(): [readonly { id: number; value: T }[], (value: T, ms: number) => void] {
  const [items, setItems] = useState<{ id: number; value: T }[]>([]);
  const timers = useRef(new Map<number, number>());
  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);
  const push = useCallback((value: T, ms: number) => {
    seq += 1;
    const id = seq;
    setItems((list) => [...list, { id, value }]);
    const timer = window.setTimeout(() => {
      setItems((list) => list.filter((item) => item.id !== id));
      timers.current.delete(id);
    }, ms);
    timers.current.set(id, timer);
  }, []);
  return [items, push];
}

/** 传牌：一叠卡背往传牌方向滑出去，后面拖一道海风。 */
export function PassFly({ direction, age, n }: { direction: Side; age: Age; n: number }) {
  const dx = direction === "left" ? -1 : 1;
  return (
    <div className={`wd-passfly ${direction}`} style={{ "--dx": `${dx * 46}vw`, "--n": n } as CSSProperties} aria-hidden="true">
      {[0, 1, 2].map((k) => (
        <img key={k} src={art.back(age)} alt="" width={64 * n} height={96 * n} style={{ "--k": k } as CSSProperties} />
      ))}
      <Sprite name="pass-trail" s={2} className="trail" />
    </div>
  );
}

type Military = Extract<GameEvent, { type: "MilitaryResolved" }>;

/** 时代结束的军事横幅：我和左右邻居各比一次，拿到的标记飞进来。 */
export function MilitaryBanner({ event, meId, leftName, rightName }: { event: Military; meId: string; leftName: string; rightName: string }) {
  const mine = event.results.find((result) => result.player === meId);
  const all = event.results;
  const shields = (offset: number) => {
    if (!mine) return 0;
    const index = all.indexOf(mine);
    return all[(index + offset + all.length) % all.length]!.shields;
  };
  const line = (side: Side) => {
    if (!mine) return null;
    const value = side === "left" ? mine.left : mine.right;
    const theirs = side === "left" ? shields(1) : shields(-1);
    return (
      <div className={`wd-mil-line ${side}`}>
        <span>{side === "left" ? `左邻 ${leftName}` : `右邻 ${rightName}`}</span>
        <b>{mine.shields} : {theirs}</b>
        {value !== 0 ? <img className="wd-mil-token" src={art.token(value)} alt={String(value)} width={48} height={48} /> : <em>平，不拿</em>}
        {value !== 0 && <Sprite name="token-land" s={2} className="land" delay={500} />}
      </div>
    );
  };
  return (
    <div className="wd-mil" role="status" aria-live="polite" data-tutorial="military">
      <h3>时代 {"I".repeat(event.age)} 结束 · 军事</h3>
      {mine ? (
        <>
          {line("left")}
          <Sprite name="clash" s={3} className="clash" />
          {line("right")}
        </>
      ) : (
        <p>大家和左右邻居比了盾牌。</p>
      )}
    </div>
  );
}
