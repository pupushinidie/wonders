import { useEffect, useRef } from "react";
import type { GameEvent, GameState, RevealedPlay } from "@wonders/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 七大奇迹的动作音效。声音都走共用的 gm-sound.tsx（♪ 面板「音效」那一路），这里按引擎每一步的 events
 * （GameState.events，version 每 apply 加 1）决定响什么：
 *
 * - 交牌（同时选牌）：一张牌扣在桌上；撤回：把牌拿回手里
 * - 亮牌：一声揭晓，接着自己这一手（响亮）、别人的（减半，每种用法响一次）：
 *   建造 = 牌拍在桌上；付钱买资源再加一声硬币；建奇迹阶段（招牌）= 石块落定 + 一段上行的号角；弃牌换钱 = 硬币
 * - 传牌：一阵牌擦过桌面（往左传音调往上、往右往下）；新时代：发牌 + 一声开场
 * - 军事冲突（时代结束）：两声战鼓（hit），自己这次赢了加得分、输了加一声下滑
 * - 巴比伦第 7 张、哈利卡纳苏斯从弃牌堆免费建（加 sparkle）、时代末烧掉的牌、自选奇迹（落子）
 * - 轮到你（新一轮要出牌、轮到你挑奇迹 / 第 7 张 / 弃牌堆）、超时被代打、终局输赢、最后 5 秒倒计时用共用提示音
 *
 * 观战都算别人的；第一次拿到局面（进房间、重连、观战）不出声，一下跳了好几步不出声。
 */

/** 开发时把响过的声音名字记在 window.__sfxLog（别人的动作带「@他」），给自测脚本看。 */
function log(name: string, mine = true) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(mine ? name : `${name}@他`);
  }
}

const { tone, noise, level, jitter } = synth;
const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

export const wondersSfx = {
  submit(mine: boolean) {
    log("submit", mine);
    // 一张牌扣在桌上：短促的擦 + 闷一下
    const v = level(mine) * (mine ? 1 : 0.7);
    noise({ duration: 0.06, volume: 0.24 * v, freq: 2000 * jitter(), freqTo: 3200, q: 0.7 });
    noise({ at: 0.05, duration: 0.05, volume: 0.2 * v, filter: "lowpass", freq: 700 });
  },
  withdraw(mine: boolean) {
    log("withdraw", mine);
    sfx.draw(mine);
  },
  reveal() {
    log("reveal");
    sfx.reveal(true);
  },
  build(mine: boolean, count = 1, bought = false) {
    log("build", mine);
    sfx.card(mine, count);
    if (bought) later(160, () => sfx.coin(mine));
  },
  /** 招牌：一块石头落定 + 上行的号角。 */
  wonder(mine: boolean) {
    log("wonder", mine);
    const v = level(mine);
    noise({ duration: 0.22, volume: 0.4 * v, filter: "lowpass", freq: 600, freqTo: 150 });
    tone(82, { duration: 0.4, volume: 0.32 * v, glideTo: 60 });
    tone(165, { at: 0.02, duration: 0.25, volume: 0.12 * v, type: "triangle" });
    [392, 523, 659, 784].forEach((f, i) => {
      const at = 0.22 + i * 0.1;
      const long = i === 3 ? 0.55 : 0.16;
      tone(f, { at, duration: long, volume: 0.12 * v, type: "triangle" });
      tone(f * 2, { at, duration: long * 0.8, volume: 0.03 * v, type: "square" });
    });
  },
  discard(mine: boolean) {
    log("discard", mine);
    const v = level(mine);
    noise({ duration: 0.12, volume: 0.16 * v, freq: 1600, freqTo: 600, q: 0.8 });
    for (let i = 0; i < 3; i += 1) later(120 + i * 70, () => sfx.coin(mine));
  },
  /** 手牌传给邻居：一阵牌擦过桌面，往左传音调往上、往右往下。 */
  pass(direction: "left" | "right") {
    log(`pass-${direction}`);
    const up = direction === "left";
    for (let i = 0; i < 5; i += 1) {
      const f = up ? 1600 + i * 450 : 3400 - i * 450;
      noise({ at: i * 0.045, duration: 0.08, volume: 0.14, freq: f, freqTo: f * (up ? 1.4 : 0.7), q: 0.8 });
    }
  },
  burn() {
    log("burn");
    noise({ duration: 0.3, volume: 0.1, freq: 900, freqTo: 300, q: 0.6 });
  },
  ageStart(age: number) {
    log(`age${age}`);
    sfx.roundStart();
    later(250, () => sfx.deal(7));
  },
  /** 军事冲突：两声战鼓，再按自己这次的输赢。 */
  military(net: number | null) {
    log(net === null ? "military" : net > 0 ? "military:win" : net < 0 ? "military:lose" : "military:tie");
    sfx.hit(true);
    later(260, () => sfx.hit(false));
    if (net !== null && net > 0) later(620, () => sfx.score(true, net >= 6));
    if (net !== null && net < 0) later(620, () => sfx.bust(true));
  },
  chooseWonder(mine: boolean) {
    log("chooseWonder", mine);
    sfx.place(mine);
  },
  freeBuild(mine: boolean) {
    log("freeBuild", mine);
    sfx.card(mine);
    later(180, () => sfx.sparkle(mine));
  },
};

function cue(name: "yourTurn" | "timeout" | "gameOver", won = false) {
  log(name === "gameOver" ? (won ? "gameOver:win" : "gameOver:lose") : name);
  if (name === "gameOver") sfx.gameOver(won);
  else sfx[name]();
}

/** 一手亮出来的牌的声音。 */
function playSound(play: RevealedPlay, mine: boolean) {
  if (play.action === "build") wondersSfx.build(mine, 1, play.paidLeft + play.paidRight > 0);
  else if (play.action === "wonder") wondersSfx.wonder(mine);
  else wondersSfx.discard(mine);
}

/** 轮到这位玩家出手了吗（出牌、第 7 张、弃牌堆、挑奇迹）。 */
function needs(game: GameState, me: string) {
  if (!me) return false;
  const p = game.players.find((x) => x.id === me);
  if (!p) return false;
  if (game.phase === "play") return !p.submitted && p.handCount > 0;
  if (game.phase === "seventh" || game.phase === "discardBuild") return game.pending?.player === me;
  if (game.phase === "wonders") return game.players[game.chooseOrder[game.chooser] ?? -1]?.id === me;
  return false;
}

/**
 * 对比 version 播放这一步的事件。myId：自己的玩家 id（观战传 ""）。
 */
export function useGameSfx(game: GameState, myId: string) {
  const prev = useRef<GameState | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || before.version === game.version) return;
    // 跳了好几步（重连、人机一口气走完）或换了一局：只在终局时报输赢
    const jumped = game.version !== before.version + 1;
    if (jumped || game.version < before.version) {
      if (game.phase === "finished" && before.phase !== "finished") later(300, () => cue("gameOver", !!myId && !!game.finalResult?.winners.includes(myId)));
      else if (needs(game, myId) && !needs(before, myId)) later(300, () => cue("yourTurn"));
      return;
    }

    let t = 0;
    const at = (ms: number, fn: () => void) => later(t + ms, fn);
    for (const event of game.events as GameEvent[]) {
      switch (event.type) {
        case "WonderChosen":
          wondersSfx.chooseWonder(event.player === myId);
          t += 250;
          break;
        case "Submitted":
          wondersSfx.submit(event.player === myId);
          t += 150;
          break;
        case "Withdrawn":
          wondersSfx.withdraw(event.player === myId);
          t += 150;
          break;
        case "Revealed": {
          at(0, () => wondersSfx.reveal());
          t += 280;
          const mineP = event.plays.find((p) => p.player === myId);
          if (mineP) {
            at(0, () => playSound(mineP, true));
            t += mineP.action === "wonder" ? 900 : 450;
          }
          // 别人的：每种用法响一次（三个人都建造只响一下），别成一串噪音
          const kinds = new Map<string, RevealedPlay>();
          for (const p of event.plays) if (p.player !== myId && !kinds.has(p.action)) kinds.set(p.action, p);
          for (const p of kinds.values()) {
            at(0, () => playSound(p, false));
            t += p.action === "wonder" ? 700 : 260;
          }
          break;
        }
        case "SeventhPlayed": {
          const mine = event.play.player === myId;
          at(0, () => playSound(event.play, mine));
          t += 450;
          break;
        }
        case "BuiltFromDiscard": {
          const mine = event.player === myId;
          if (event.card) at(0, () => wondersSfx.freeBuild(mine));
          else at(0, () => { log("pass", mine); sfx.pass(mine); });
          t += 450;
          break;
        }
        case "CardsBurned":
          at(0, () => wondersSfx.burn());
          t += 250;
          break;
        case "MilitaryResolved": {
          const r = myId ? event.results.find((x) => x.player === myId) : undefined;
          at(100, () => wondersSfx.military(r ? r.left + r.right : null));
          t += 1300;
          break;
        }
        case "HandsPassed":
          at(0, () => wondersSfx.pass(event.direction));
          t += 350;
          break;
        case "AgeStarted":
          at(0, () => wondersSfx.ageStart(event.age));
          t += 900;
          break;
        case "TurnTimedOut":
          if (event.player === myId) {
            at(0, () => cue("timeout"));
            t += 400;
          }
          break;
        case "GameEnded":
          at(300, () => cue("gameOver", !!myId && event.result.winners.includes(myId)));
          t += 900;
          break;
        default:
          break;
      }
    }
    // 轮到你：新一轮要出牌、轮到你挑奇迹 / 打第 7 张 / 挑弃牌堆
    const undid = game.events.some((e) => e.type === "Withdrawn");
    if (game.phase !== "finished" && !undid && needs(game, myId) && !needs(before, myId)) at(150, () => cue("yourTurn"));
  }, [game.version]);
}
