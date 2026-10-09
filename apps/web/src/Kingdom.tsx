import { memo, type CSSProperties, type ReactNode } from "react";
import { bounds, domino, key, type Kingdom, type Placement, type PlayerColor, type Pos, type Terrain } from "@wonders/game";
import { art, terrainArt } from "./art.js";

/** 皇冠图标的放大倍数：格子每 32px 放大 1 倍（皇冠是单独的小图，不跟地形原图走）。 */
const crownScale = (cell: number) => Math.max(1, Math.floor(cell / 32));

/** 王国里的一格是骨牌的哪一端（挑变体用，和骨牌在排里时一致）；两端一样时按位置交替。 */
function halfEnd(n: number, t: string, crowns: number, parity: number): number {
  if (n <= 0 || n > 48) return 0;
  const d = domino(n);
  if (d.a.t === d.b.t && d.a.c === d.b.c) return parity & 1;
  return d.a.t === t && d.a.c === crowns ? 0 : 1;
}

/** 一格地形（或城堡）：底图 + 左上角的皇冠。 */
export function Tile({ terrain, crowns, n, end, cell, px, color, className = "", style }: {
  terrain: Terrain | "castle";
  crowns: number;
  /** 来自哪张骨牌（挑变体用）。 */
  n: number;
  end: number;
  cell: number;
  px: 32 | 16;
  color?: PlayerColor;
  className?: string;
  style?: CSSProperties;
}) {
  const src = terrain === "castle" ? art.castle(color ?? "pink", px) : terrainArt(terrain, n, end, px);
  const cs = crownScale(cell);
  return (
    <span className={`kd-tile ${terrain === "castle" ? "castle" : `t-${terrain}`} ${className}`} style={{ width: cell, height: cell, backgroundImage: `url(${src})`, ...style }}>
      {crowns > 0 && (
        <span className="kd-crowns" style={{ gap: cs, left: cs * 2, top: cs * 2 }}>
          {Array.from({ length: crowns }, (_, index) => (
            <i key={index} style={{ width: 9 * cs, height: 8 * cs, backgroundImage: `url(${art.crown})` }} />
          ))}
        </span>
      )}
    </span>
  );
}

/** 一张骨牌（横放，A 端在左）：两格地形，底下有一点厚度。 */
export const DominoView = memo(function DominoView({ n, cell, px, className = "" }: { n: number; cell: number; px: 32 | 16; className?: string }) {
  const d = domino(n);
  return (
    <span className={`kd-domino ${className}`} style={{ "--cell": `${cell}px` } as CSSProperties} aria-label={`${n} 号骨牌`}>
      <Tile terrain={d.a.t} crowns={d.a.c} n={n} end={0} cell={cell} px={px} />
      <Tile terrain={d.b.t} crowns={d.b.c} n={n} end={1} cell={cell} px={px} />
    </span>
  );
});

export interface Window {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/** 能放的范围：已拼好的边框往外两圈，再和「不超出 size × size」的范围取交集。 */
export function playWindow(kingdom: Kingdom, size: number): Window {
  const b = bounds(kingdom);
  return {
    r0: Math.max(b.minR - 2, b.maxR - size + 1),
    r1: Math.min(b.maxR + 2, b.minR + size - 1),
    c0: Math.max(b.minC - 2, b.maxC - size + 1),
    c1: Math.min(b.maxC + 2, b.minC + size - 1),
  };
}

/** 只看已经拼好的部分。 */
export function tightWindow(kingdom: Kingdom): Window {
  const b = bounds(kingdom);
  return { r0: b.minR, r1: b.maxR, c0: b.minC, c1: b.maxC };
}

export interface Ghost {
  readonly placement: Placement;
  readonly n: number;
  /** ok：合法（预览或已选）；bad：放不下；pre：已提前放好。 */
  readonly kind: "ok" | "bad" | "chosen" | "pre";
}

/**
 * 一个王国：box × box 格的框，里面摆 window 范围的格子（居中）。
 * 可以交互时，空格子响应悬停和点击；ghost 是正在摆的骨牌（半透明叠在上面）。
 */
export function KingdomGrid({
  kingdom, color, cell, px, box, window, ghost, anchors, reach, fresh, onHover, onClick, label, children,
}: {
  kingdom: Kingdom;
  color: PlayerColor;
  cell: number;
  px: 32 | 16;
  /** 框的边长（格数）。 */
  box: number;
  window: Window;
  ghost?: Ghost | null;
  /** 当前方向下能当 A 端的格子（亮）。 */
  anchors?: ReadonlySet<string>;
  /** 任何方向的放法用得到的格子（淡）。 */
  reach?: ReadonlySet<string>;
  /** 刚放下的骨牌编号（入场动画）。 */
  fresh?: ReadonlySet<number>;
  onHover?: (pos: Pos | null) => void;
  onClick?: (pos: Pos) => void;
  label: string;
  children?: ReactNode;
}) {
  const rows = window.r1 - window.r0 + 1;
  const cols = window.c1 - window.c0 + 1;
  const left = ((box - cols) * cell) / 2;
  const top = ((box - rows) * cell) / 2;
  const at = (p: Pos) => ({ left: left + (p.c - window.c0) * cell, top: top + (p.r - window.r0) * cell });
  const cells: ReactNode[] = [];
  const interactive = onClick !== undefined;
  for (let r = window.r0; r <= window.r1; r += 1) {
    for (let c = window.c0; c <= window.c1; c += 1) {
      const k = key(r, c);
      const found = kingdom[k];
      const style = { position: "absolute", ...at({ r, c }) } as CSSProperties;
      if (found) {
        cells.push(
          <Tile
            key={k}
            terrain={found.t}
            crowns={found.c}
            n={found.d}
            end={found.d ? halfEnd(found.d, found.t, found.c, r + c) : 0}
            cell={cell}
            px={px}
            color={color}
            className={fresh?.has(found.d) ? "fresh" : ""}
            style={style}
          />,
        );
      } else {
        const can = anchors?.has(k) ?? false;
        const near = !can && (reach?.has(k) ?? false);
        cells.push(
          <span
            key={k}
            className={["kd-empty", can ? "can" : "", near ? "near" : "", interactive ? "live" : ""].join(" ")}
            style={{ ...style, width: cell, height: cell }}
            onPointerEnter={onHover ? () => onHover({ r, c }) : undefined}
            onClick={onClick ? () => onClick({ r, c }) : undefined}
          />,
        );
      }
    }
  }

  let ghostNode: ReactNode = null;
  if (ghost) {
    const d = domino(ghost.n);
    const halves = [
      { p: ghost.placement.a, h: d.a, end: 0 },
      { p: ghost.placement.b, h: d.b, end: 1 },
    ];
    ghostNode = halves.map(({ p, h, end }) => {
      const inside = p.r >= window.r0 && p.r <= window.r1 && p.c >= window.c0 && p.c <= window.c1;
      if (!inside) return null;
      return (
        <Tile
          key={`ghost-${end}`}
          terrain={h.t}
          crowns={h.c}
          n={ghost.n}
          end={end}
          cell={cell}
          px={px}
          className={`kd-ghost ${ghost.kind}`}
          style={{ position: "absolute", ...at(p) }}
        />
      );
    });
  }

  return (
    <div
      className={interactive ? "kd-grid live" : "kd-grid"}
      style={{ width: box * cell, height: box * cell }}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
      aria-label={label}
    >
      <div className="kd-grid-ground" style={{ left, top, width: cols * cell, height: rows * cell }} />
      {cells}
      {ghostNode}
      {children}
    </div>
  );
}
