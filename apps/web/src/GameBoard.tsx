import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DIRS,
  domino,
  key,
  legalPlacements,
  pendingSlot,
  pickRow,
  selectableSlots,
  TERRAIN_NAMES,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Placement,
  type Player,
  type Pos,
  type ScoreBreakdown,
  type Slot,
} from "@wonders/game";
import { art, coverSize, PLAYER_HEX } from "./art.js";
import GameRules from "./GameRules.js";
import { DominoView, KingdomGrid, playWindow, tightWindow, type Ghost } from "./Kingdom.js";
import { useLayout, type Layout } from "./layout.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
}

const placementKey = (p: Placement) => `${p.a.r},${p.a.c}|${p.b.r},${p.b.c}`;
const plus = (p: Pos, d: Pos): Pos => ({ r: p.r + d.r, c: p.c + d.c });
const minus = (p: Pos, d: Pos): Pos => ({ r: p.r - d.r, c: p.c - d.c });

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "Picked":
      return `${name(event.player)} 挑了 ${event.n} 号${event.auto ? "（只剩这张）" : ""}`;
    case "Placed": {
      const gained = event.scoreAfter - event.scoreBefore;
      return `${name(event.player)} 把 ${event.n} 号放进王国${event.pre ? "（提前放好的）" : ""}${gained > 0 ? `，+${gained} 分` : ""}`;
    }
    case "Discarded":
      return `${name(event.player)} 的 ${event.n} 号哪里都放不下，弃掉了`;
    case "LeftoverRemoved":
      return `没人挑的 ${event.n} 号弃掉了`;
    case "RoundStarted":
      return event.last ? `第 ${event.round} 轮：最后一轮，只放不挑` : `第 ${event.round} 轮：翻开 ${event.revealed.join("、")} 号`;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，自动替他走了一步`;
    case "GameEnded":
      return "游戏结束";
    default:
      return null;
  }
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  // 观战的人没有座位：按 watchId 那位玩家的座位摆（me 就是他），但什么都不能点，也不叫「你」。
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const meIndex = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[meIndex]!;
  const size = game.config.size;
  const box = size + 2;
  const finished = game.phase === "finished";
  const actor = finished ? undefined : game.players[game.currentPlayer];
  const myTurn = !spectating && !finished && game.currentPlayer === meIndex;
  const secondsLeft = useCountdown(room);
  const opponents = game.players.filter((player) => player.id !== myId);
  const [mainRef, layout, mainBox] = useLayout(size, opponents.length);
  const px = layout.art;
  const autoPlaying = member?.auto === true;
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  // 「对局已开始」这类提示只留到第一步动作
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  // 页面在后台时，轮到自己就在标题上提醒
  useEffect(() => {
    const base = "多米诺王国 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // ---------- 动作记录 ----------
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const loggedVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === loggedVersion.current) return;
    loggedVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    setLog((previous) => [...lines.reverse(), ...previous].slice(0, 60));
  }, [game.version]);
  const fresh = useMemo(
    () => new Set(game.events.flatMap((event) => (event.type === "Placed" ? [event.n] : []))),
    [game.version],
  );

  // ---------- 放骨牌 ----------
  const pendingIndex = spectating || finished ? -1 : pendingSlot(game, meIndex);
  const pending: Slot | null = pendingIndex >= 0 ? game.current[pendingIndex]! : null;
  const placingN = pending?.n ?? null;
  const placingNow = myTurn && game.step === "place" && pendingIndex === game.active;
  const myPre = pending?.pre && pending.pre !== "hidden" ? pending.pre : null;
  const legal = useMemo(
    () => (placingN === null ? [] : legalPlacements(me.kingdom, domino(placingN), size)),
    [placingN, me.kingdom, size],
  );
  const legalKeys = useMemo(() => new Set(legal.map(placementKey)), [legal]);
  const canPlace = placingN !== null && legal.length > 0 && !autoPlaying;
  const [rot, setRot] = useState(0);
  const [hover, setHover] = useState<Pos | null>(null);
  const [chosen, setChosen] = useState<Placement | null>(null);
  const placingKey = `${game.round}:${pendingIndex}:${placingN}`;
  useEffect(() => {
    setChosen(null);
    setHover(null);
  }, [placingKey]);
  const inRot = (p: Placement, r: number) => p.b.r - p.a.r === DIRS[r]!.r && p.b.c - p.a.c === DIRS[r]!.c;
  // 当前方向一个能放的位置都没有时，自动转到有位置的方向
  useEffect(() => {
    if (legal.length === 0 || legal.some((p) => inRot(p, rot))) return;
    const next = [1, 2, 3].map((i) => (rot + i) % 4).find((r) => legal.some((p) => inRot(p, r)));
    if (next !== undefined) setRot(next);
  }, [legal, rot]);
  // 亮格：当前方向下骨牌 A 端能放的格子（亮）；任何方向能用到的格子（淡），点了会自动找方向
  const anchors = useMemo(() => {
    if (!canPlace || chosen) return new Set<string>();
    return new Set(legal.filter((p) => inRot(p, rot)).map((p) => key(p.a.r, p.a.c)));
  }, [canPlace, chosen, legal, rot]);
  const reach = useMemo(() => {
    if (!canPlace || chosen) return new Set<string>();
    return new Set(legal.flatMap((p) => [key(p.a.r, p.a.c), key(p.b.r, p.b.c)]));
  }, [canPlace, chosen, legal]);

  const tryAt = (p: Pos, start: number): { placement: Placement; rot: number } | null => {
    for (let i = 0; i < 4; i += 1) {
      const r = (start + i) % 4;
      const asA = { a: p, b: plus(p, DIRS[r]!) };
      if (legalKeys.has(placementKey(asA))) return { placement: asA, rot: r };
    }
    for (let i = 0; i < 4; i += 1) {
      const r = (start + i) % 4;
      const asB = { a: minus(p, DIRS[r]!), b: p };
      if (legalKeys.has(placementKey(asB))) return { placement: asB, rot: r };
    }
    return null;
  };
  const clickCell = (p: Pos) => {
    if (!canPlace || busy) return;
    const found = tryAt(p, rot);
    if (found) {
      setRot(found.rot);
      setChosen(found.placement);
    }
  };
  const rotate = () => {
    if (!canPlace) return;
    if (chosen) {
      // 绕 A 端转到下一个能放的方向
      for (let i = 1; i <= 4; i += 1) {
        const r = (rot + i) % 4;
        const next = { a: chosen.a, b: plus(chosen.a, DIRS[r]!) };
        if (legalKeys.has(placementKey(next))) {
          setRot(r);
          setChosen(next);
          return;
        }
      }
      return;
    }
    setRot((rot + 1) % 4);
  };
  const confirmPlace = () => {
    if (!chosen || busy) return;
    onCommand({ type: "PLACE", a: chosen.a, b: chosen.b });
    setChosen(null);
  };

  let ghost: Ghost | null = null;
  if (placingN !== null) {
    if (chosen) ghost = { placement: chosen, n: placingN, kind: "chosen" };
    else if (hover && canPlace && !me.kingdom[key(hover.r, hover.c)]) {
      const candidate = { a: hover, b: plus(hover, DIRS[rot]!) };
      ghost = { placement: candidate, n: placingN, kind: legalKeys.has(placementKey(candidate)) ? "ok" : "bad" };
    } else if (myPre) ghost = { placement: myPre, n: placingN, kind: "pre" };
  }

  // ---------- 挑骨牌 ----------
  const pickable = myTurn && game.step === "pick" && !autoPlaying ? selectableSlots(game) : [];
  const [pickSel, setPickSel] = useState<number | null>(null);
  useEffect(() => setPickSel(null), [game.version]);
  const clickSlot = (index: number) => {
    if (!pickable.includes(index) || busy) return;
    if (pickSel === index) onCommand({ type: "PICK", slot: index });
    else setPickSel(index);
  };

  // 键盘：R / 空格 旋转，回车确认，Esc 取消，1–4 挑骨牌
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((event.key === "r" || event.key === "R" || event.key === " ") && canPlace) {
        event.preventDefault();
        rotate();
      } else if (event.key === "Enter") {
        if (chosen) confirmPlace();
        else if (pickSel !== null) clickSlot(pickSel);
      } else if (event.key === "Escape") {
        setChosen(null);
        setPickSel(null);
      } else if (/^[1-4]$/.test(event.key) && pickable.length > 0) {
        clickSlot(Number(event.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 提示 ----------
  let headline = "";
  let detail = "";
  if (finished) headline = "游戏结束";
  else if (autoPlaying) {
    headline = "托管中";
    detail = "人机正在替你走，点「取消托管」拿回来。";
  } else if (myTurn && game.step === "pick") {
    headline = game.phase === "picking" ? "开局：挑一张骨牌" : "挑下一轮的骨牌";
    detail = "编号越小，下一轮越早行动。点一下选中，再点一下（或按回车）确定。";
  } else if (placingNow) {
    headline = "轮到你：把骨牌放进王国";
    detail = chosen ? "看好了就点「确认放下」；点别处可以换位置。" : "点亮着的格子放下（R 键旋转）；至少一格要挨着城堡或同种地形。";
  } else if (pending && !finished && game.phase === "playing") {
    headline = myPre ? "已经提前放好了" : `等 ${actor ? nameOf(actor.id) : ""} ${game.step === "pick" ? "挑骨牌" : "放骨牌"}`;
    detail = myPre ? "轮到你时自动生效；想改就重新点格子。" : legal.length > 0 ? "不用等：现在就可以先把你的骨牌放好，轮到你时自动生效。" : "你这张哪里都放不下，轮到你时会自动弃掉。";
  } else if (actor) {
    headline = `等 ${nameOf(actor.id)} ${game.step === "pick" ? "挑骨牌" : "放骨牌"}`;
    detail = game.next.length === 0 && game.phase === "playing" ? "最后一轮：只放不挑。" : "";
  }
  if (spectating && !finished && actor) {
    headline = `${actor.name} ${game.step === "pick" ? "挑骨牌" : "放骨牌"}中`;
    detail = "";
  }

  // 顶栏中间写完整提示：手机上（没有状态栏），或者王国上下摆、又没有侧栏时（宽屏才放得下）
  const fullPrompt = layout.mobile || (!layout.mineBeside && !layout.side && mainBox.width >= 1280);
  const sideTabs = useSideTabs(room);
  const [drawer, setDrawer] = useState(false);
  const scene = theme === "day" ? art.sceneDay : art.sceneNight;
  const showTimer = secondsLeft !== null && !finished;

  const controls = !spectating && !finished && (
    <div className="kd-controls">
      {canPlace && (
        <>
          <button className="quiet-button" type="button" onClick={rotate} title="旋转（R）">⟳ 旋转</button>
          <button className="primary-button kd-confirm" type="button" disabled={!chosen || busy} onClick={confirmPlace}>
            {placingNow ? "确认放下" : "提前放好"}
          </button>
          {chosen && <button className="quiet-button" type="button" onClick={() => setChosen(null)}>重选</button>}
          {!chosen && myPre && <button className="quiet-button" type="button" disabled={busy} onClick={() => onCommand({ type: "CANCEL_PRE" })}>取消预放</button>}
        </>
      )}
      {pickable.length > 0 && (
        <button className="primary-button kd-confirm" type="button" disabled={pickSel === null || busy} onClick={() => pickSel !== null && clickSlot(pickSel)}>
          {pickSel === null ? "先点一张骨牌" : `就挑 ${pickRow(game)[pickSel]?.n} 号`}
        </button>
      )}
      {autoPlaying && <button className="primary-button" type="button" onClick={() => onAuto(false)}>取消托管</button>}
      {!canPlace && pickable.length === 0 && !autoPlaying && <span className="kd-controls-note">{placingN !== null && legal.length === 0 ? "这张放不下，轮到你时自动弃掉" : "没有要做的事，等别人"}</span>}
    </div>
  );

  const mine = (
    <section className={["kd-mine", layout.mineBeside ? "beside" : "", myTurn ? "active" : ""].join(" ")} style={{ "--seat": PLAYER_HEX[me.color] } as CSSProperties}>
      <PlayerHead player={me} you={!spectating} member={memberOf(me.id)} game={game} big />
      {layout.mobile && (error || shownNotice) && <p className={error ? "kd-feedback error kd-mobile-note" : "kd-feedback kd-mobile-note"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
      {layout.mineBeside && !layout.mobile && (
        <div className="kd-mine-info">
          <strong>{headline}</strong>
          {detail && <p>{detail}</p>}
          {(error || shownNotice) && <p className={error ? "kd-feedback error" : "kd-feedback"}>{error || shownNotice}</p>}
        </div>
      )}
      <KingdomGrid
        kingdom={me.kingdom}
        color={me.color}
        cell={layout.c}
        px={px}
        box={box}
        window={playWindow(me.kingdom, size)}
        ghost={ghost}
        anchors={anchors}
        reach={reach}
        fresh={fresh}
        {...(canPlace ? { onHover: setHover, onClick: clickCell } : {})}
        label={`${me.name} 的王国`}
      />
      {controls}
    </section>
  );

  const rows = (
    <section className={layout.rowsSide ? "kd-rows side" : "kd-rows"} style={{ "--rc": `${layout.rc}px` } as CSSProperties}>
      <RowColumn
        title={game.phase === "picking" ? "开局 · 先挑一张" : "本轮 · 放进王国"}
        meta={game.phase === "picking" ? "" : `${game.round}/${game.totalRounds} 轮`}
        slots={game.current}
        game={game}
        kind="current"
        layout={layout}
        pickable={game.phase === "picking" ? pickable : []}
        pickSel={game.phase === "picking" ? pickSel : null}
        onSlot={clickSlot}
        selfIndex={spectating ? -1 : meIndex}
      />
      <RowColumn
        title={game.phase === "picking" ? "下一排 · 开局后翻开" : game.next.length === 0 ? "最后一轮 · 不再挑" : "下一轮 · 挑一张"}
        meta={`牌堆 ${game.deckCount ?? 0}`}
        slots={game.next}
        game={game}
        kind="next"
        layout={layout}
        pickable={game.phase === "playing" ? pickable : []}
        pickSel={game.phase === "playing" ? pickSel : null}
        onSlot={clickSlot}
        selfIndex={spectating ? -1 : meIndex}
      />
    </section>
  );

  const opps = opponents.length > 0 && (
    <section className={layout.twoCols ? "kd-opps across" : "kd-opps"}>
      {opponents.map((player) => (
        <div
          key={player.id}
          className={["kd-opp", actor?.id === player.id ? "active" : ""].join(" ")}
          style={{ "--seat": PLAYER_HEX[player.color], width: layout.mobile ? undefined : Math.max(size * layout.oc + 24, 184) } as CSSProperties}
        >
          <PlayerHead player={player} you={player.id === selfId} member={memberOf(player.id)} game={game} />
          <KingdomGrid
            kingdom={player.kingdom}
            color={player.color}
            cell={layout.oc}
            px={px}
            box={size}
            window={tightWindow(player.kingdom)}
            fresh={fresh}
            label={`${player.name} 的王国`}
          >
            {player.discarded.length > 0 && <small className="kd-discard-badge" title={`弃掉：${player.discarded.join("、")} 号`}>弃 {player.discarded.length}</small>}
          </KingdomGrid>
        </div>
      ))}
    </section>
  );

  const status = (
    <section className="kd-panel kd-status">
      <h2>{headline}</h2>
      {detail && <p>{detail}</p>}
      {(error || shownNotice) && <p className={error ? "kd-feedback error" : "kd-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
      {!spectating && !finished && !autoPlaying && (
        <button className="quiet-button kd-auto-toggle" type="button" onClick={() => onAuto(true)}>托管</button>
      )}
    </section>
  );

  const side = (
    <aside className="kd-side">
      {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
      {status}
      <section className="kd-panel kd-scores">
        {[...game.players].sort((a, b) => b.score - a.score).map((player) => (
          <div key={player.id} className={player.id === myId ? "mine" : ""}>
            <i style={{ background: PLAYER_HEX[player.color] }} />
            <span>{nameOf(player.id)}</span>
            <b>{player.score}</b>
          </div>
        ))}
      </section>
      <section className="kd-panel kd-tabs">
        <div className="kd-tab-bar" role="tablist">
          <button type="button" role="tab" aria-selected={sideTabs.tab === "log"} className={sideTabs.tab === "log" ? "active" : ""} onClick={() => sideTabs.setTab("log")}>动作记录</button>
          <button type="button" role="tab" aria-selected={sideTabs.tab === "chat"} className={sideTabs.tab === "chat" ? "active" : ""} onClick={() => sideTabs.setTab("chat")}>
            聊天{sideTabs.unread > 0 && <em>{sideTabs.unread}</em>}
          </button>
        </div>
        {sideTabs.tab === "log" ? (
          log.length === 0 ? <p className="kd-muted">还没有动作。</p> : <ul className="kd-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
        ) : <div className="kd-chat">{chat}</div>}
      </section>
    </aside>
  );

  return (
    <div className={["kd-screen", layout.mobile ? "mobile" : "", layout.side ? "with-side" : ""].join(" ")}>
      <header className="kd-topbar">
        {brand}
        <div className="kd-turn">
          {!finished && actor && (
            <span className={myTurn ? "kd-turn-who mine" : "kd-turn-who"}>
              <i style={{ background: PLAYER_HEX[actor.color] }} />
              {/* 手机上没有单独的状态栏：顶栏第二行直接写现在该做什么 */}
              {fullPrompt ? headline : myTurn ? "轮到你" : `轮到 ${actor.name}`}
            </span>
          )}
          {showTimer && <b className={secondsLeft! <= 10 ? "kd-timer low" : "kd-timer"}>{secondsLeft}s</b>}
          {finished && <span className="kd-turn-who">游戏结束</span>}
        </div>
        <div className="kd-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!layout.side && (
            <button className="quiet-button kd-drawer-toggle" type="button" aria-expanded={drawer} onClick={() => { setDrawer(!drawer); sideTabs.markRead(); }}>
              记录 / 聊天{sideTabs.unread > 0 ? ` · ${sideTabs.unread}` : ""}
            </button>
          )}
          {connection}
        </div>
      </header>

      <div className="kd-main" ref={mainRef}>
        <div
          className="kd-table"
          style={{ "--scene": `url(${scene})`, "--scene-size": coverSize(mainBox.width, mainBox.height) } as CSSProperties}
        >
          {layout.mobile ? (
            <>
              {rows}
              {mine}
              {opps}
            </>
          ) : (
            <>
              {mine}
              <div className={layout.twoCols ? "kd-right two" : "kd-right"}>
                {rows}
                {opps}
              </div>
            </>
          )}
        </div>
        {(layout.side || drawer || layout.mobile) && side}
      </div>

      {finished && <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} nameOf={nameOf} onRematch={onRematch} onLeave={onLeave} />}
    </div>
  );
}

/** 侧栏的「动作记录 / 聊天」切换和未读数。 */
function useSideTabs(room: LobbyRoomSnapshot) {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [seen, setSeen] = useState(room.chat.length);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  useEffect(() => {
    if (tab === "chat") setSeen(room.chat.length);
  }, [tab, room.chat.length]);
  return {
    tab,
    setTab: (next: "log" | "chat") => {
      setTab(next);
      if (next === "chat") setSeen(room.chat.length);
    },
    unread,
    markRead: () => undefined,
  };
}

/** 玩家名牌：颜色、名字、标签、分数。 */
function PlayerHead({ player, you, member, game, big = false }: { player: Player; you: boolean; member: LobbyMember | undefined; game: GameState; big?: boolean }) {
  const offline = !member?.connected;
  const active = game.phase !== "finished" && game.players[game.currentPlayer]?.id === player.id;
  return (
    <div className={["kd-head", big ? "big" : "", active ? "active" : ""].join(" ")}>
      <img className="kd-head-king" src={art.king(player.color)} alt="" />
      <strong title={player.name}>{player.name}</strong>
      {you && <small className="kd-you">你</small>}
      {member?.bot && <small className="kd-bot">人机</small>}
      {!member?.bot && (member?.auto || offline) && <small className="kd-auto">托管</small>}
      {offline && !member?.bot && <small className="kd-offline">离线</small>}
      {big && player.discarded.length > 0 && <small className="kd-discard" title={`弃掉：${player.discarded.join("、")} 号`}>弃 {player.discarded.length}</small>}
      <b className="kd-score">{player.score}</b>
    </div>
  );
}

/** 一排骨牌（竖着排 4 张）：编号、骨牌、站在上面的国王、状态。 */
function RowColumn({ title, meta, slots, game, kind, layout, pickable, pickSel, onSlot, selfIndex }: {
  title: string;
  meta: string;
  slots: Slot[];
  game: GameState;
  kind: "current" | "next";
  layout: Layout;
  pickable: number[];
  pickSel: number | null;
  onSlot: (index: number) => void;
  selfIndex: number;
}) {
  const kingPx = Math.max(32, Math.floor(layout.rc / 32) * 32);
  return (
    <div className={`kd-row ${kind}${slots.length === 0 ? " empty" : ""}`}>
      <h3 title={kind === "next" ? `牌堆还剩 ${game.deckCount ?? 0} 张${(game.setAsideCount ?? 0) > 0 ? `，本局移出 ${game.setAsideCount} 张不用` : ""}${game.removed.length > 0 ? `，没人挑弃掉 ${game.removed.length} 张` : ""}` : undefined}>
        <span>{title}</span>{meta && <em>{meta}</em>}
      </h3>
      {slots.length === 0 && <p className="kd-row-empty">{kind === "next" && game.phase === "playing" ? "牌堆已经用完" : "—"}</p>}
      <ol>
        {slots.map((slot, index) => {
          const owner = slot.king ? game.players[slot.king.player] : undefined;
          // 当前排：国王挑完下一张就走了；开局选牌时国王一直站着
          const kingHere = owner && (kind === "next" || game.phase === "picking" || index >= game.active);
          const activeHere = game.phase === "playing" && kind === "current" && index === game.active;
          const canPick = pickable.includes(index);
          const state =
            kind !== "current" || game.phase !== "playing" ? "" :
            slot.resolved ? (owner?.discarded.includes(slot.n) ? "弃掉" : "已放") :
            activeHere ? "" :
            slot.pre ? (slot.king?.player === selfIndex ? "已预放" : "已放好") : "";
          return (
            <li
              key={slot.n}
              className={[
                "kd-slot",
                slot.resolved ? "done" : "",
                activeHere ? "active" : "",
                canPick ? "pickable" : "",
                pickSel === index ? "selected" : "",
                pickable.length > 0 && !canPick ? "taken" : "",
              ].join(" ")}
              onClick={canPick ? () => onSlot(index) : undefined}
              style={owner ? ({ "--seat": PLAYER_HEX[owner.color] } as CSSProperties) : undefined}
            >
              <span className="kd-num">{slot.n}</span>
              <span className="kd-domino-wrap">
                <DominoView n={slot.n} cell={layout.rc} px={layout.art} />
                {state && <span className="kd-slot-state">{state}</span>}
              </span>
              <span className="kd-king-spot" style={{ width: kingPx, height: kingPx }}>
                {kingHere && <img className="kd-king" src={art.king(owner.color)} alt={owner.name} title={owner.name} style={{ width: kingPx, height: kingPx }} />}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- 终局 ----------

function regionLine(score: ScoreBreakdown): string {
  const parts = score.regions
    .filter((region) => region.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((region) => `${TERRAIN_NAMES[region.t]} ${region.cells.length}×${region.crowns}`);
  return parts.length > 0 ? parts.join(" · ") : "没有带皇冠的区域";
}

function FinalDialog({ game, room, myId, spectating, nameOf, onRematch, onLeave }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  nameOf: (id: string) => string;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const scores = [...result.scores].sort((a, b) => b.total - a.total || b.largest - a.largest || b.crowns - a.crowns);
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return <button className="primary-button kd-show-final" type="button" onClick={() => setHidden(false)}>看结算</button>;
  }
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel kd-final" role="dialog" aria-modal="true" aria-labelledby="kd-final-title">
        <h2 id="kd-final-title">{result.winners.includes(myId) ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : "游戏结束"}</h2>
        <ol className="kd-standings">
          {scores.map((score, index) => {
            const player = game.players.find((candidate) => candidate.id === score.player)!;
            const winner = result.winners.includes(score.player);
            const tie = scores.some((other) => other !== score && other.total === score.total);
            return (
              <li key={score.player} className={winner ? "winner" : ""} style={{ "--seat": PLAYER_HEX[player.color] } as CSSProperties}>
                <span className="kd-rank">{winner ? "★" : index + 1}</span>
                <span className="kd-standing-name">
                  <strong>{nameOf(score.player)}</strong>
                  <small>{regionLine(score)}</small>
                  {(score.middle > 0 || score.harmony > 0 || game.config.middleKingdom || game.config.harmony) && (
                    <small>
                      {game.config.middleKingdom ? `中央王国 ${score.middle > 0 ? "+10" : "没拿到"}` : ""}
                      {game.config.middleKingdom && game.config.harmony ? " · " : ""}
                      {game.config.harmony ? `和谐 ${score.harmony > 0 ? "+5" : "没拿到"}` : ""}
                    </small>
                  )}
                  {tie && <small>同分比较：最大一片 {score.largest} 格 · 皇冠 {score.crowns} 个</small>}
                </span>
                <b className="kd-final-score">{score.total}</b>
              </li>
            );
          })}
        </ol>
        {spectating ? (
          <div className="kd-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看王国</button>
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            </div>
          </div>
        ) : room.rematch && (
          <div className="kd-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看王国</button>
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
