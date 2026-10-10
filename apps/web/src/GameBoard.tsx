/**
 * 七大奇迹的牌桌。座位圆环：我在下方，左邻画在屏幕左边、右邻画在右边，其他人在上排（从左到右 = 左邻的左邻 … 右邻的右邻）。
 * 桌面：顶栏 │ 其他玩家 │ 左邻 │ 中栏（我的奇迹板、状态、城池）│ 右邻 │ 手牌 + 出牌面板。手机：竖着排，出牌面板从底部弹出。
 * 尺寸见 layout.ts；所有像素图整数倍显示。动画只看 game.version 变没变。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  card,
  CARD_COLORS,
  playOptions,
  scoreBreakdown,
  wonder as wonderDef,
  wonderStages,
  type CardId,
  type GameCommand,
  type GameEvent,
  type LobbyRoomSnapshot,
  type PaymentOption,
  type PlayAction,
} from "@wonders/game";
import { ActionPanel, commandFor, whyText } from "./ActionPanel.js";
import { art, loadSceneFocus, sceneIndex, sceneScale } from "./art.js";
import { buildStatus, CardFace, CardItem, type CardStatus } from "./Card.js";
import { ChooseWonderDialog, City, DiscardDialog, PlayerDialog, Production } from "./Dialogs.js";
import { FinalDialog } from "./FinalDialog.js";
import { MilitaryBanner, PassArrow, PassFly, Sprite, useTransient } from "./Fx.js";
import GameRules from "./GameRules.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorial/tutorialGame.js";
import { boardH, useLayout } from "./layout.js";
import { ColorCounts, LastPlay, MobileNeighbor, NeighborPanel, OtherCard, OtherTag, ScienceCounts, StatLine, type SeatInfo } from "./Players.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { describeEvent, ROMAN, seatVar } from "./text.js";
import type { Theme } from "./theme.js";
import { PlayerBoard } from "./Wonder.js";

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
  /** 自己在 room.members 里的 id（默认 socket.id；新手教程里传固定值）。 */
  readonly selfMemberId?: string;
  /**
   * online：真实对局（默认）；只有自己和人机时有「提示」，还会出「第一次遇到」小贴士。
   * tutorial：新手教程的剧本进行中（咕噜嘎在讲，不出提示和小贴士）；practice：教程后的练习局（随时能看提示）。
   */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
}

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

const COLOR_ORDER = new Map(CARD_COLORS.map((color, index) => [color, index]));
const byColor = (a: CardId, b: CardId) => COLOR_ORDER.get(card(a).color)! - COLOR_ORDER.get(card(b).color)! || card(a).zh.localeCompare(card(b).zh, "zh");

type Military = Extract<GameEvent, { type: "MilitaryResolved" }>;

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave, selfMemberId, mode = "online", finalActions }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === (selfMemberId ?? socket.id));
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const n = game.players.length;
  const meIndex = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[meIndex]!;
  const leftIndex = (meIndex + 1) % n;
  const rightIndex = (meIndex - 1 + n) % n;
  const otherIndexes = Array.from({ length: Math.max(0, n - 3) }, (_, k) => (meIndex + 2 + k) % n);
  const layout = useLayout(n);
  const finished = game.phase === "finished";
  const autoPlaying = member?.auto === true;
  const secondsLeft = useCountdown(room);
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  const seats: SeatInfo[] = useMemo(
    () => game.players.map((player) => ({
      player,
      member: room.members.find((candidate) => candidate.playerId === player.id),
      score: player.wonder ? scoreBreakdown(game, player.id).total : 0,
      you: player.id === selfId,
      last: game.lastReveal.find((play) => play.player === player.id),
    })),
    [game, room.members, selfId],
  );
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  // ---------- 出牌 ----------
  const canAct = !spectating && !autoPlaying && ((game.phase === "play" && !me.submitted) || (game.phase === "seventh" && game.pending?.player === me.id));
  const hand = useMemo(() => [...me.hand].sort(byColor), [me.hand]);
  const options = useMemo(() => (canAct ? playOptions(game, me.id) : []), [canAct, game, me.id]);
  const statuses = useMemo(() => new Map<CardId, CardStatus>(options.map((entry) => [entry.card, buildStatus(entry.build, entry.card)])), [options]);
  const [selected, setSelected] = useState<CardId | null>(null);
  const [choice, setChoice] = useState({ build: 0, wonder: 0 });
  const handKey = hand.join(",");
  useEffect(() => setSelected(null), [handKey, game.phase, me.submitted]);
  useEffect(() => setChoice({ build: 0, wonder: 0 }), [selected, game.version]);
  const select = (id: CardId | null) => {
    if (!canAct && id) return;
    setSelected(id === selected ? null : id);
  };
  const playSelected = (action: PlayAction) => {
    if (!selected || busy) return;
    const entry = options.find((candidate) => candidate.card === selected);
    if (!entry) return;
    let option: PaymentOption | undefined;
    if (action !== "discard") {
      const info = action === "build" ? entry.build : entry.wonder;
      if (info.options.length === 0) { pushToast(`${action === "build" ? "建不了" : "建不了奇迹"}：${/^钱不够/.test(info.reason ?? "") ? "钱不够，" : ""}${whyText(info)}`, 4000); return; }
      option = info.options[Math.min(action === "build" ? choice.build : choice.wonder, info.options.length - 1)];
    }
    onCommand(commandFor(selected, action, option));
    setSelected(null);
  };

  // ---------- 弹窗 ----------
  const [openSeat, setOpenSeat] = useState<string | null>(null);
  const [wondersOpen, setWondersOpen] = useState(game.phase === "wonders");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [finalHidden, setFinalHidden] = useState(false);
  const discardMine = game.phase === "discardBuild" && game.pending?.player === me.id && !spectating;
  useEffect(() => setWondersOpen(game.phase === "wonders"), [game.phase]);
  useEffect(() => setDiscardOpen(discardMine && !autoPlaying), [discardMine, autoPlaying]);
  useEffect(() => { if (!finished) setFinalHidden(false); }, [finished]);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);

  // ---------- 「提示」（练习局，或者只有自己和人机的房间）和「第一次遇到」小贴士 ----------
  const botsOnly = room.members.every((candidate) => candidate.id === member?.id || candidate.bot === true);
  const chooseMine = !spectating && game.phase === "wonders" && game.players[game.chooseOrder[game.chooser] ?? -1]?.id === selfId;
  const canHint = !spectating && !autoPlaying && (canAct || discardMine || chooseMine) && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint | null } | null>(null);
  // 提示建议出一张手牌时，顺手把那张选中、用法那一行的付款方案切到提示说的那种；玩家改选别的牌，提示就收起
  const shownHint = hint && hint.version === game.version && canHint && (!hint.hint?.card || !canAct || selected === hint.hint.card) ? hint.hint : null;
  const toggleHint = () => {
    if (hint && hint.version === game.version && shownHint) {
      setHint(null);
      return;
    }
    const next = hintFor(game, myId);
    setHint({ version: game.version, hint: next });
    if (next?.card && canAct) setSelected(next.card);
  };
  useEffect(() => {
    if (!canHint) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "h") toggleHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canHint, game.version]);
  const hintAnchor = shownHint ? (shownHint.card && shownHint.action ? `act-${shownHint.action}` : shownHint.anchor === "undo" ? "undo" : null) : null;
  // 用法那一行默认是最便宜的付款方案；提示用的是别的（比如奥林匹亚免费建造、向另一边买）就切过去
  useEffect(() => {
    const command = shownHint?.command;
    if (!command || command.type !== "PLAY" || command.action === "discard" || selected !== command.card) return;
    const entry = options.find((candidate) => candidate.card === command.card);
    const list = (command.action === "build" ? entry?.build : entry?.wonder)?.options ?? [];
    const index = list.findIndex((option) => (command.olympia ? option.kind === "olympia" : command.trade ? option.kind !== "olympia" && option.left === command.trade.left && option.right === command.trade.right : option.isDefault));
    if (index > 0) setChoice((old) => ({ ...old, [command.action]: index }));
  }, [selected, shownHint]);
  // 挑弃牌、自选奇迹的弹窗会盖住出牌面板上的「提示」：弹窗开着时另放一个浮在上面的
  const modalHint = canHint && ((discardOpen && discardMine) || (wondersOpen && chooseMine));
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, mode === "online" && !spectating);

  // ---------- 键盘：1–7 选牌，B / W / D 出牌，U 撤回，Esc 取消 ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") { setSelected(null); setMenu(false); return; }
      if (/^[1-7]$/.test(event.key) && canAct) {
        const id = hand[Number(event.key) - 1];
        if (id) select(id);
      } else if (selected && canAct && /^[bwd]$/i.test(event.key)) {
        playSelected(({ b: "build", w: "wonder", d: "discard" } as const)[event.key.toLowerCase() as "b" | "w" | "d"]);
      } else if (/^u$/i.test(event.key) && game.phase === "play" && me.submitted && !spectating && !busy) {
        onCommand({ type: "UNDO" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 页面在后台时，轮到自己出牌就在标题上提醒
  const needMe = canAct || discardMine || (game.phase === "wonders" && game.players[game.chooseOrder[game.chooser] ?? -1]?.id === selfId);
  useEffect(() => {
    const base = "七大奇迹 · 在线对战";
    const update = () => { document.title = needMe && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [needMe]);

  // ---------- 动作记录 + 过场（只看 version 变没变） ----------
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const [fresh, pushFresh] = useTransient<CardId[]>();
  const [shine, pushShine] = useTransient<{ player: string; stage: number }>();
  const [passes, pushPass] = useTransient<{ direction: "left" | "right"; age: 1 | 2 | 3 }>();
  const [military, pushMilitary] = useTransient<Military>();
  const [toasts, pushToast] = useTransient<string>();
  const [passCount, setPassCount] = useState(0);
  const lastVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === lastVersion.current) return;
    lastVersion.current = game.version;
    const lines = game.events.flatMap((event, index) => describeEvent(event, nameOf).map((text, k) => ({ key: `${game.version}-${index}-${k}`, text })));
    if (lines.length > 0) setLog((previous) => [...lines.reverse(), ...previous].slice(0, 120));
    const built: CardId[] = [];
    for (const event of game.events) {
      const plays = event.type === "Revealed" ? event.plays : event.type === "SeventhPlayed" ? [event.play] : [];
      for (const play of plays) {
        if (play.action === "build" && play.card) built.push(play.card);
        if (play.action === "wonder" && play.stage) pushShine({ player: play.player, stage: play.stage - 1 }, 1200);
      }
      if (event.type === "BuiltFromDiscard" && event.card) built.push(event.card);
      if (event.type === "HandsPassed") {
        pushPass({ direction: event.direction, age: game.age }, 900);
        setPassCount((count) => count + 1);
      }
      if (event.type === "MilitaryResolved") pushMilitary(event, 4200);
      if (event.type === "TurnTimedOut" && event.player === selfId) pushToast("你超时了，人机替你出了这一步", 5000);
    }
    if (built.length > 0) pushFresh(built, 2600);
  }, [game.version]);
  const freshSet = useMemo(() => new Set(fresh.flatMap((item) => item.value)), [fresh]);
  const shineOf = (playerId: string) => shine.find((item) => item.value.player === playerId)?.value.stage;
  const shineProp = (playerId: string) => {
    const stage = shineOf(playerId);
    return stage === undefined ? {} : { shine: stage };
  };
  const lastPass = passes[passes.length - 1];
  const lastMilitary = military[military.length - 1]?.value;

  // 房主开关「观战看手牌」：牌桌顶栏常驻提示，开关时记一条
  const seeAll = room.access.allowSpectators && room.access.spectatorsSeeAll;
  const lastSeeAll = useRef(seeAll);
  useEffect(() => {
    if (lastSeeAll.current === seeAll) return;
    lastSeeAll.current = seeAll;
    setLog((previous) => [{ key: `seeall-${Date.now()}`, text: seeAll ? "房主打开了「观战看手牌」：观战的人能看到所有人的手牌" : "房主关掉了「观战看手牌」" }, ...previous].slice(0, 120));
  }, [seeAll]);

  // ---------- 记录 / 聊天 ----------
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [seenChat, setSeenChat] = useState(room.chat.length);
  const unread = drawer && tab === "chat" ? 0 : Math.max(0, room.chat.length - seenChat);
  useEffect(() => { if (drawer && tab === "chat") setSeenChat(room.chat.length); }, [drawer, tab, room.chat.length]);

  const sceneN = sceneIndex(room.code || "WONDER");
  const scale = sceneScale(layout.width, layout.height);
  const [focus, setFocus] = useState<Record<string, number>>({});
  useEffect(() => { void loadSceneFocus().then(setFocus); }, []);
  const focusX = focus[`${theme}-${sceneN}`];
  const tableStyle = {
    "--scene": `url(${art.scene(theme, sceneN)})`,
    "--scene-size": `${512 * scale}px ${288 * scale}px`,
    "--pad": `${layout.pad}px`,
    "--gap": `${layout.gap}px`,
    "--nb-w": `${layout.nbW}px`,
    "--others-h": `${layout.othersH}px`,
    "--hand-h": `${layout.handRowH}px`,
    "--strip-h": `${layout.stripH}px`,
    "--strip-font": `${layout.stripFont}px`,
    "--act-w": `${layout.actW}px`,
    ...(layout.mobile && focusX !== undefined ? { "--scene-x": `${Math.round(layout.width / 2 - focusX * scale)}px` } : {}),
  } as CSSProperties;

  const submittedCount = game.players.filter((player) => player.submitted).length;
  const passName = game.direction === "left" ? `左邻 ${nameOf(game.players[leftIndex]!.id)}` : `右邻 ${nameOf(game.players[rightIndex]!.id)}`;
  const toast = toasts[toasts.length - 1]?.value;
  const feedback = (error || shownNotice || toast) ? (
    <p className={error ? "wd-feedback error" : "wd-feedback"} role={error ? "alert" : "status"}>{error || toast || shownNotice}</p>
  ) : null;

  const actionPanel = (
    <ActionPanel
      game={game}
      me={me}
      meIndex={meIndex}
      options={options}
      selected={selected}
      onSelect={setSelected}
      onCommand={onCommand}
      busy={busy}
      autoPlaying={autoPlaying}
      onAuto={onAuto}
      spectating={spectating}
      spectateBar={<SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
      nameOf={nameOf}
      feedback={feedback}
      mobile={layout.mobile}
      iconS={layout.mobile || !layout.actInHand ? 1 : 2}
      onOpenDiscard={() => setDiscardOpen(true)}
      onOpenWonders={() => setWondersOpen(true)}
      onOpenFinal={() => setFinalHidden(false)}
      passName={passName}
      choice={choice}
      onChoice={setChoice}
      className={layout.mobile && selected ? "sheet" : ""}
      hintButton={canHint ? (
        <button className={shownHint ? "quiet-button wd-hint-btn on" : "quiet-button wd-hint-btn"} type="button" data-tutorial="hint" onClick={toggleHint}>
          提示{layout.mobile ? "" : "（H）"}
        </button>
      ) : null}
    />
  );

  // ---------- 顶栏 ----------
  const compactBar = layout.mobile || layout.width < 1280;
  const menuItems = (
    <>
      {themeToggle}
      <GameRules />
      <GameRoomMenu room={room} />
      {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
      {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
    </>
  );
  const topbar = (
    <header className="wd-topbar">
      {brand}
      <div className="wd-turn">
        {game.phase === "wonders" ? (
          <span className="wd-age" data-tutorial="age-round">自选奇迹</span>
        ) : finished ? (
          <span className="wd-age">游戏结束</span>
        ) : (
          <span className="wd-age" data-tutorial="age-round" title={`时代 ${ROMAN[game.age]} · 第 ${game.round}/6 轮`}>
            {layout.mobile ? `${ROMAN[game.age]}·${game.round}/6` : <>时代 {ROMAN[game.age]}<small>·</small>{game.round}/6 轮</>}
          </span>
        )}
        {game.phase !== "wonders" && !finished && (
          <span className="wd-pass" data-tutorial="pass-arrow" title={`这个时代打完把剩下的手牌传给${game.direction === "left" ? "左邻" : "右邻"}`}>
            <PassArrow direction={game.direction} s={layout.mobile ? 1 : 2} />
            {!layout.mobile && <small>传{game.direction === "left" ? "左" : "右"}</small>}
          </span>
        )}
        {game.phase === "play" && (
          <span className="wd-sent-count" data-tutorial="submitted-count" title="这一轮已经出牌的人数">
            {!layout.mobile && <small>已出</small>}<b>{submittedCount}/{n}</b>
          </span>
        )}
        {secondsLeft !== null && !finished && <b className={secondsLeft <= 10 ? "wd-timer low" : "wd-timer"} data-tutorial="timer">{secondsLeft}s</b>}
        {seeAll && !spectating && !layout.mobile && <span className="wd-seeall" title="房主打开了「观战看手牌」：观战的人能看到所有人的手牌和交了没亮的牌">观战能看到手牌</span>}
      </div>
      <div className="wd-topbar-right">
        <button className="quiet-button wd-drawer-toggle" type="button" data-tutorial="log-toggle" aria-expanded={drawer} onClick={() => { setDrawer(!drawer); setMenu(false); }}>
          {layout.mobile ? "记录" : "记录·聊天"}{unread > 0 ? <em>{unread}</em> : null}
        </button>
        {compactBar ? (
          <span className="wd-menu">
            <button className="quiet-button" type="button" data-tutorial="menu" aria-expanded={menu} onClick={() => { setMenu(!menu); setDrawer(false); }}>菜单</button>
            {menu && <div className="wd-menu-pop" role="menu">{menuItems}</div>}
          </span>
        ) : menuItems}
        {connection}
      </div>
    </header>
  );

  const drawerPanel = drawer && (
    <aside className="wd-panel wd-drawer" aria-label="记录和聊天">
      <div className="wd-tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>动作记录</button>
        <button type="button" role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          聊天{unread > 0 && <em>{unread}</em>}
        </button>
        <button type="button" className="quiet-button" onClick={() => setDrawer(false)}>关闭</button>
      </div>
      {tab === "log" ? (
        log.length === 0 ? <p className="wd-muted">还没有动作。每轮亮牌后这里记下每个人做了什么。</p> : <ul className="wd-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
      ) : <div className="wd-chat">{chat}</div>}
    </aside>
  );

  const seatOpen = openSeat ? seats.find((seat) => seat.player.id === openSeat) : undefined;
  const dialogs = (
    <>
      {seatOpen && <PlayerDialog seat={seatOpen} game={game} onClose={() => setOpenSeat(null)} />}
      {wondersOpen && game.phase === "wonders" && (
        <ChooseWonderDialog game={game} me={selfId} members={room.members} nameOf={nameOf} onCommand={onCommand} onClose={() => setWondersOpen(false)} busy={busy} />
      )}
      {discardOpen && discardMine && <DiscardDialog game={game} me={me.id} onCommand={onCommand} onClose={() => setDiscardOpen(false)} busy={busy} />}
      {finished && !finalHidden && game.finalResult && (
        <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} nameOf={nameOf} onRematch={onRematch} onLeave={onLeave} onHide={() => setFinalHidden(true)} {...(finalActions ? { actions: finalActions } : {})} />
      )}
      {lastMilitary && <MilitaryBanner event={lastMilitary} meId={me.id} leftName={nameOf(game.players[leftIndex]!.id)} rightName={nameOf(game.players[rightIndex]!.id)} />}
      {shownHint && (
        <Coach
          bubble
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: hintAnchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {modalHint && (
        <button className={shownHint ? "quiet-button wd-hint-btn wd-hint-float on" : "quiet-button wd-hint-btn wd-hint-float"} type="button" data-tutorial="hint-float" onClick={toggleHint}>提示</button>
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </>
  );

  const passTo = (side: "left" | "right") => game.direction === side;
  const left = seats[leftIndex]!;
  const right = seats[rightIndex]!;
  const mine = seats[meIndex]!;

  // ---------- 手牌 ----------
  const hiddenHand = hand.length === 0 && me.handCount > 0;
  const handCards = hiddenHand ? (
    layout.mobile
      ? <p className="wd-hand-empty">{nameOf(me.id)} 手里 {me.handCount} 张（观战看不到牌面）</p>
      : Array.from({ length: me.handCount }, (_, index) => (
        <img key={index} className="wd-back" src={art.back(game.age)} alt="" width={64 * layout.handN} height={96 * layout.handN} title="观战看不到手牌" />
      ))
  ) : hand.length === 0 ? (
    <p className="wd-hand-empty">{finished ? "游戏结束" : game.phase === "wonders" ? "挑完奇迹就发牌" : "手里没有牌了，等这一步结算"}</p>
  ) : hand.map((id, index) => {
    const status = statuses.get(id);
    const sent = me.submitted && me.play?.card === id;
    const click = canAct ? { onClick: () => select(id) } : {};
    return layout.mobile ? (
      <CardItem key={id} id={id} {...(status ? { status } : {})} selected={selected === id} submitted={sent} {...click} tutorial={`hand-card-${index}`} />
    ) : (
      <CardFace key={id} id={id} n={layout.handN} {...(status ? { status } : {})} selected={selected === id} submitted={sent} {...click} tutorial={`hand-card-${index}`} {...(canAct ? { index } : {})} />
    );
  });
  const enterFrom = lastPass ? (lastPass.value.direction === "left" ? "right" : "left") : game.direction === "left" ? "right" : "left";
  const handBox = (
    <div className={`wd-hand ${passCount > 0 ? `enter-${enterFrom}` : ""}`} key={`hand-${passCount}`} data-tutorial="hand" style={{ "--n": layout.handN, "--card-gap": `${layout.cardGap}px` } as CSSProperties}>
      {handCards}
    </div>
  );

  if (layout.mobile) {
    return (
      <div className="wd-screen mobile">
        {topbar}
        <div className="wd-mtable" style={tableStyle}>
          {seeAll && !spectating && <p className="wd-seeall">房主开了「观战看手牌」：观战的人能看到你的手牌</p>}
          {otherIndexes.length > 0 && (
            <div className="wd-mothers" data-tutorial="others">
              {otherIndexes.map((index) => <OtherTag key={index} seat={seats[index]!} game={game} onOpen={() => setOpenSeat(game.players[index]!.id)} />)}
            </div>
          )}
          <div className="wd-mnbs">
            <span data-tutorial="neighbor-left"><MobileNeighbor seat={left} me={me} side="left" game={game} passTo={passTo("left")} onOpen={() => setOpenSeat(left.player.id)} /></span>
            <span data-tutorial="neighbor-right"><MobileNeighbor seat={right} me={me} side="right" game={game} passTo={passTo("right")} onOpen={() => setOpenSeat(right.player.id)} /></span>
          </div>
          <button type="button" className="wd-panel wd-mme wd-seat" style={seatVar(me.wonder) as CSSProperties} onClick={() => setOpenSeat(me.id)} data-tutorial="my-board">
            <PlayerBoard player={me} n={1} {...shineProp(me.id)} />
            <span className="wd-mme-side">
              {me.wonder && <span className="wd-mme-name">{wonderDef(me.wonder).zh} · {me.side} 面 · {me.stages}/{wonderStages(me.wonder, me.side).length} 层</span>}
              <StatLine seat={mine} items={["coin", "shield", "vp"]} tutorial="my-stats" />
              <span data-tutorial="my-city"><ColorCounts player={me} big /></span>
            </span>
          </button>
          {actionPanel}
          {handBox}
        </div>
        {drawerPanel}
        {menu && <div className="wd-menu-backdrop" onClick={() => setMenu(false)} />}
        {dialogs}
      </div>
    );
  }

  const myBoard = (
    <div className="wd-panel wd-mine wd-seat" style={seatVar(me.wonder) as CSSProperties} data-tutorial="my-board">
      {theme === "night" && <Sprite name="brazier" s={2} className="wd-brazier l" />}
      <button type="button" className="wd-open" onClick={() => setOpenSeat(me.id)} aria-label="看自己的完整城池" />
      <PlayerBoard player={me} n={layout.myWonderN} {...shineProp(me.id)} tutorial="my-wonder" />
      <StatLine seat={mine} tutorial="my-stats" />
      {theme === "night" && <Sprite name="brazier" s={2} className="wd-brazier r" />}
    </div>
  );
  const myInfo = (
    <section className="wd-panel wd-myinfo" data-tutorial="my-info">
      <div className="wd-pd-line"><em>{spectating ? "产出" : "你的产出"}</em><Production player={me} /></div>
      <div className="wd-pd-line"><em>科技</em><ScienceCounts player={me} /></div>
      <div className="wd-pd-line"><em>军事标记</em>
        <span className="wd-tokens">
          {me.tokens.length === 0 ? <span className="wd-muted">还没有</span> : me.tokens.map((token, index) => <img key={index} src={art.token(token.value)} alt={String(token.value)} width={32} height={32} />)}
        </span>
      </div>
      <LastPlay last={mine.last} label={spectating ? "上轮" : "你上轮"} />
      <p className="wd-muted">弃牌堆 {game.discardCount} 张 · 手牌 {me.handCount} 张</p>
    </section>
  );
  // 城池每列能放几条卡名：中栏高 − 奇迹板 − 金币那一行 − 列标题
  const topH = layout.actInHand ? boardH(layout.myWonderN) + 48 : 236;
  const capacity = Math.max(2, Math.floor((layout.middleH - topH - layout.gap - 22 - 14 - 2) / (layout.stripH + 2)));

  return (
    <div className={`wd-screen ${layout.actInHand ? "act-hand" : "act-center"} ${n === 3 ? "three" : ""}`} style={{ "--top-h": `${layout.topH}px` } as CSSProperties}>
      {topbar}
      <div className={["wd-table", layout.nbW >= 400 ? "nb-wide" : "", layout.middleH < 420 ? "compact" : ""].join(" ")} style={tableStyle}>
        {otherIndexes.length > 0 && (
          <div className="wd-others" data-tutorial="others">
            {otherIndexes.map((index) => <OtherCard key={index} seat={seats[index]!} game={game} emblemN={layout.emblemN} onOpen={() => setOpenSeat(game.players[index]!.id)} />)}
          </div>
        )}
        <NeighborPanel seat={left} me={me} side="left" game={game} wonderN={layout.nbWonderN} passTo={passTo("left")} onOpen={() => setOpenSeat(left.player.id)} {...shineProp(left.player.id)} tutorial="neighbor-left" />
        <div className="wd-center">
          <div className="wd-center-top">
            {myBoard}
            {layout.actInHand ? myInfo : actionPanel}
          </div>
          <City player={me} capacity={capacity} fresh={freshSet} tutorial="my-city" />
        </div>
        <NeighborPanel seat={right} me={me} side="right" game={game} wonderN={layout.nbWonderN} passTo={passTo("right")} onOpen={() => setOpenSeat(right.player.id)} {...shineProp(right.player.id)} tutorial="neighbor-right" />
        <div className="wd-handrow">
          {handBox}
          {layout.actInHand && actionPanel}
          {lastPass && <PassFly key={`pass-${lastPass.id}`} direction={lastPass.value.direction} age={lastPass.value.age} n={layout.handN} />}
        </div>
        {drawerPanel}
      </div>
      {menu && <div className="wd-menu-backdrop" onClick={() => setMenu(false)} />}
      {dialogs}
    </div>
  );
}

export default GameBoard;
