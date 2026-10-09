/**
 * 预览页（提交进仓库，界面负责维护；教程、验收可以往 SCENES 里加场景，别删别人的）。
 * 不连服务器：规则引擎直接在浏览器里跑，渲染真正的 GameBoard。打开 /preview.html?s=<场景>，不带 s 列出全部场景。
 *
 * 参数：
 *   s=<场景>        场景名（见下面 SCENES）
 *   viewer=p2       从哪个座位看（默认场景里写的，通常 p1）
 *   anim=1          先渲染上一步、再换成这一步，播一遍这一步的过场（亮牌、传牌、军事横幅）
 *   seeall=1        房主打开了「观战看手牌」（看牌桌顶栏的提示）
 *   click=a|b       渲染后依次点这些 CSS 选择器（用 | 分隔），比如 click=.wd-hand .wd-card:nth-child(2)
 * 牌桌上的操作（出牌、撤回、挑奇迹……）直接在本地 apply，可以接着点。
 */
import { StrictMode, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  apply,
  buildScene,
  finalScores,
  playTo,
  previewRoom,
  scene,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PreviewRoomOptions,
} from "@wonders/game";
import GameBoard from "./GameBoard.js";
import { applyMove, createShowcaseGame, createTutorialGame, TUTORIAL_STEPS } from "./tutorial/script.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import "./styles.css";
import "./app-pixel.css";
import "./wd.css";
import "./theme-day.css";

applyTheme(readTheme());

interface Scene {
  readonly note: string;
  readonly game: () => GameState;
  readonly room?: PreviewRoomOptions;
}

/** 7 人局、城池满：终局版（fullCities 打完）。 */
function finishedFull(side: "A" | "B"): GameState {
  const game = scene("fullCities", { side });
  for (const player of game.players) {
    player.hand = [];
    player.handCount = 0;
  }
  game.phase = "finished";
  game.finalResult = finalScores(game);
  game.events = [{ type: "GameEnded", result: game.finalResult }];
  return game;
}

/** 自选奇迹：找到现在轮到谁，用他的视角。 */
function chooserId(game: GameState): string {
  return game.players[game.chooseOrder[game.chooser] ?? 0]!.id;
}

const SCENES: Record<string, Scene> = {
  start3: { note: "开局 3 人（没有其他玩家一排）", game: () => scene("start", { players: 3 }), room: { turnRemainingMs: 58000 } },
  start4: { note: "开局 4 人", game: () => scene("start", { players: 4 }), room: { turnRemainingMs: 58000 } },
  start5: { note: "开局 5 人", game: () => scene("start", { players: 5 }), room: { turnRemainingMs: 58000 } },
  start7: { note: "开局 7 人（最多人数）", game: () => scene("start", { players: 7 }), room: { turnRemainingMs: 58000 } },
  mid7: { note: "7 人局 Age II 第 3 轮（往右传），轮到我", game: () => scene("midgame", { players: 7, age: 2, round: 3 }), room: { turnRemainingMs: 41000, bots: ["p3", "p5"] } },
  mid7a3: { note: "7 人局 Age III 第 4 轮", game: () => scene("midgame", { players: 7, age: 3, round: 4 }), room: { turnRemainingMs: 33000 } },
  full7: { note: "7 人局 Age III 第 6 轮，城池满（A 面）", game: () => scene("fullCities", { side: "A" }), room: { turnRemainingMs: 52000 } },
  full7b: { note: "7 人局 Age III 第 6 轮，城池满（B 面）", game: () => scene("fullCities", { side: "B" }), room: { turnRemainingMs: 52000 } },
  allActions: { note: "出牌前：能自建、免费链、要向两边买、建不了但能垫奇迹、同名建过", game: () => scene("allActions"), room: { turnRemainingMs: 45000 } },
  submitted: { note: "我交了牌（可撤回），还有两人没交", game: () => scene("submitted"), room: { turnRemainingMs: 30000 } },
  others: { note: "轮到别人：从已交牌的 p2 看，等其他人", game: () => scene("submitted"), room: { viewer: "p2", turnRemainingMs: 30000 } },
  lastRound: { note: "第 6 轮：打一张，另一张作废", game: () => scene("lastRound"), room: { turnRemainingMs: 20000 } },
  chain: { note: "Age II：图书馆可以免费链", game: () => scene("chain"), room: { turnRemainingMs: 50000 } },
  tradeBoth: { note: "要向两边买（法庭）", game: () => scene("tradeBoth"), room: { turnRemainingMs: 50000 } },
  tradeDiscount: { note: "要向两边买，有西贸易站 + 市场折扣", game: () => scene("tradeBoth", { discount: true }), room: { turnRemainingMs: 50000 } },
  wonderStageB4: { note: "金字塔 B 已建 3 层、要建第 4 层（4 层奇迹板）", game: () => scene("wonderStage", { wonder: "giza", side: "B", stage: 4 }), room: { turnRemainingMs: 50000 } },
  ephesusB: { note: "以弗所 B 建满 3 层（看自己奇迹板的阶段格）", game: () => scene("wonderStage", { wonder: "ephesus", side: "B", stage: 3 }), room: { turnRemainingMs: 50000 } },
  wonderStage: { note: "能建奇迹下一层", game: () => scene("wonderStage", { wonder: "giza", side: "B", stage: 2 }), room: { turnRemainingMs: 50000 } },
  seventh: { note: "巴比伦 B 打第 7 张（我）", game: () => scene("babylonSeventh"), room: { turnRemainingMs: 18000 } },
  seventhOther: { note: "别人在打第 7 张", game: () => scene("babylonSeventh"), room: { viewer: "p2" } },
  halicarnassus: { note: "哈利卡纳苏斯挑弃牌（我）", game: () => scene("halicarnassus"), room: { turnRemainingMs: 18000 } },
  halicarnassusOther: { note: "别人在挑弃牌", game: () => scene("halicarnassus"), room: { viewer: "p2" } },
  olympiaFree: { note: "奥林匹亚 A 的免费建造", game: () => scene("olympiaFree"), room: { turnRemainingMs: 50000 } },
  military: { note: "Age I 刚结束：军事横幅（加 anim=1 播过场）", game: () => scene("militaryDone"), room: { turnRemainingMs: 58000 } },
  military7: { note: "7 人局 Age I 刚结束", game: () => scene("militaryDone", { players: 7 }), room: { turnRemainingMs: 58000 } },
  chooseWonders: { note: "自选奇迹：轮到我挑", game: () => scene("chooseWonders"), room: {} },
  chooseWait: { note: "自选奇迹：等别人挑", game: () => scene("chooseWonders"), room: { viewer: "__other__" } },
  final: { note: "终局（4 人，七项都有分）", game: () => scene("final"), room: {} },
  finalTie: { note: "终局并列第一", game: () => scene("finalTie"), room: {} },
  final7: { note: "终局 7 人、城池满", game: () => finishedFull("A"), room: {} },
  final7b: { note: "终局 7 人、B 面", game: () => finishedFull("B"), room: { viewer: "p5" } },
  offline: { note: "对手离线（人机代打）", game: () => scene("midgame", { players: 5, age: 1, round: 2 }), room: { offline: ["p3"], turnRemainingMs: 44000 } },
  auto: { note: "我托管中", game: () => scene("midgame", { players: 5, age: 2, round: 2 }), room: { auto: ["p1"], turnRemainingMs: 44000 } },
  bots: { note: "有人机的桌子", game: () => scene("midgame", { players: 6, age: 1, round: 4 }), room: { bots: ["p2", "p4", "p6"], turnRemainingMs: 44000 } },
  timeout: { note: "我超时了，人机替我出（加 anim=1 看提示）", game: () => scene("midgame", { players: 4, age: 1, round: 3 }), room: { timedOut: "p1", turnRemainingMs: 6000 } },
  lowTime: { note: "倒计时只剩 8 秒", game: () => scene("midgame", { players: 4, age: 2, round: 5 }), room: { turnRemainingMs: 8000 } },
  spectate: { note: "观战（只看公开信息）", game: () => scene("midgame", { players: 7, age: 2, round: 2 }), room: { spectating: true } },
  age2arrow: { note: "Age II 第 1 轮（传牌方向朝右）", game: () => playTo({ players: 4, age: 2, round: 1 }), room: { turnRemainingMs: 58000 } },
  tutorialStart: {
    note: "教程剧本开局（补充 §4.3：3 人，金字塔 A / 巴比伦 A / 奥林匹亚 A）",
    game: () => buildScene({
      players: [
        { name: "你", wonder: "giza", hand: ["Stone Pit", "Altar", "Theater", "Guard Tower", "Clay Pit", "Workshop", "Marketplace"] },
        { name: "咕噜一号", wonder: "babylon", hand: ["Scriptorium", "Clay Pool", "Timber Yard", "Loom", "Glassworks", "Barracks", "West Trading Post"] },
        { name: "咕噜二号", wonder: "olympia", hand: ["Baths", "Stockade", "Press", "Lumber Yard", "East Trading Post", "Ore Vein", "Apothecary"] },
      ],
    }),
    room: { bots: ["p2", "p3"], turnRemainingMs: 60000 },
  },
  tutorialShowcase: {
    note: "教程讲终局计分用的「一局打完的样子」（科技 3/2/1 = 21、工人行会 7 分）",
    game: () => createShowcaseGame("你"),
    room: { bots: ["p2", "p3"] },
  },
  tutorialPractice: {
    note: "教程剧本走完、接练习局时的局面（时代 II 第 2 轮）；练习局里有「提示」，这里预览不出",
    game: () => {
      let state = createTutorialGame("你");
      for (const step of TUTORIAL_STEPS) {
        if (step.kind === "do") state = applyMove(state, step.expect);
        if (step.kind === "watch") for (const move of step.moves) state = applyMove(state, move);
      }
      return state;
    },
    room: { bots: ["p2", "p3"] },
  },
};

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "";

function Index() {
  return (
    <main className="app-shell" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, color: "var(--gold)" }}>七大奇迹 · 预览页</h1>
      <p className="wd-muted">点一个场景打开。参数：viewer=p2、anim=1、click=选择器|选择器。</p>
      <ul style={{ columns: 2, fontSize: 12, lineHeight: 2 }}>
        {Object.entries(SCENES).map(([name, entry]) => (
          <li key={name}><a href={`?s=${name}`} style={{ color: "var(--text)" }}><b style={{ color: "var(--gold)" }}>{name}</b> — {entry.note}</a></li>
        ))}
      </ul>
    </main>
  );
}

function Preview({ entry }: { entry: Scene }) {
  const initial = useMemo(() => entry.game(), [entry]);
  const [state, setState] = useState<GameState>(initial);
  const [error, setError] = useState("");
  const [theme, toggleTheme] = useTheme();
  const options = { ...(entry.room ?? {}) } as PreviewRoomOptions & { viewer?: string };
  let viewer = params.get("viewer") ?? options.viewer ?? state.players[0]!.id;
  if (sceneName === "chooseWonders" && !params.get("viewer")) viewer = chooserId(initial);
  if (viewer === "__other__") viewer = initial.players.find((player) => player.id !== chooserId(initial) && !player.wonder)?.id ?? initial.players[0]!.id;
  const spectating = options.spectating === true;
  Object.defineProperty(socket, "id", { get: () => (spectating ? "socket-spectator" : `socket-${viewer}`), configurable: true });
  const baseRoom = previewRoom(state, { ...options, viewer });
  // seeall=1：房主打开了「观战看手牌」
  const realRoom = params.get("seeall") === "1" ? { ...baseRoom, access: { ...baseRoom.access, spectatorsSeeAll: true }, spectators: [{ id: "socket-spectator", name: "看客" }] } : baseRoom;
  // anim=1：先给上一步（version − 1、没有事件），再换成这一步，GameBoard 才会播这一步的过场
  const [room, setRoom] = useState<LobbyRoomSnapshot>(() => {
    if (params.get("anim") !== "1") return realRoom;
    const game = { ...realRoom.game!, version: realRoom.game!.version - 1, events: [] };
    return { ...realRoom, game };
  });
  useEffect(() => {
    if (params.get("anim") === "1" && room.game!.version !== realRoom.game!.version) {
      const timer = window.setTimeout(() => setRoom(realRoom), 300);
      return () => window.clearTimeout(timer);
    }
    setRoom(realRoom);
    return undefined;
  }, [state, viewer]);
  useEffect(() => {
    const clicks = (params.get("click") ?? "").split("|").filter(Boolean);
    if (clicks.length === 0) return;
    let index = 0;
    const timer = window.setInterval(() => {
      const target = document.querySelector<HTMLElement>(clicks[index]!);
      target?.click();
      index += 1;
      if (index >= clicks.length) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  const onCommand = (command: GameCommand) => {
    try {
      setError("");
      setState(apply(state, viewer, command).state);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };
  return (
    <main className="app-shell wd-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<a className="brand" href="?" aria-label="预览页目录"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="brand-name">七大奇迹<span> WONDERS</span></span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" /><span className="connection-text">服务已连接</span></div>}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<div className="room-chat light"><p className="room-chat-empty">（预览页没有聊天）</p></div>}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={viewer}
        onWatch={() => undefined}
        onLeave={() => undefined}
      />
    </main>
  );
}

const entry = SCENES[sceneName];
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>{entry ? <Preview entry={entry} /> : <Index />}</StrictMode>,
);
