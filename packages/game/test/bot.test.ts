/**
 * 人机：只看自己视角、自对弈全合法不死循环、耗时、关键决策、每一步都有理由。
 * 强度（对随机 / 贪心基线的胜率）在 ~/projects/qa-reports/tools/bots/sim-wonders.ts 里测，数字写在交接报告。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  apply,
  botCommand,
  botDecision,
  buildScene,
  card,
  createGame,
  paymentOptions,
  pendingActors,
  redactGameForViewer,
  scene,
  WONDER_KEYS,
  type GameCommand,
  type GameState,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** 人机替 id 想一步（照服务器的做法：先 redact）。 */
function decide(state: GameState, id: string) {
  return botDecision(redactGameForViewer(state, id), id);
}

function nameOf(command: GameCommand | undefined): string {
  return command && "card" in command && command.card ? card(command.card).name : "";
}

describe("人机只看自己座位的视角", () => {
  it("服务器调用人机时先 redactGameForViewer(game, playerId)", () => {
    const source = readFileSync(resolve(here, "../../../apps/server/src/index.ts"), "utf8");
    const calls = [...source.matchAll(/botCommand\(([^;]*)\)/g)].map((match) => match[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^redactGameForViewer\(game, playerId\), playerId$/);
  });

  it("别人的手牌、垫的牌、弃牌堆、种子换成别的，人机的决定一模一样", () => {
    for (const n of [3, 5, 7]) {
      for (const round of [1, 3, 5]) {
        const base = scene("midgame", { players: n, age: 2, round, seed: 40 + n + round });
        // 把别人的手牌整体轮换、弃牌堆和垫的牌打乱、种子换掉：公开信息不变
        const other = structuredClone(base);
        const hands = other.players.slice(1).map((player) => player.hand);
        other.players.slice(1).forEach((player, index) => {
          player.hand = hands[(index + 1) % hands.length]!;
          player.stageCards = [...player.stageCards].reverse();
        });
        other.discard = [...other.discard].reverse();
        other.seed = 999;
        other.rngState = 123;
        const me = base.players[0]!.id;
        const viewA = redactGameForViewer(base, me);
        const viewB = redactGameForViewer(other, me);
        expect(viewB).toEqual(viewA);
        const a = botDecision(viewA, me);
        expect(botDecision(viewB, me)).toEqual(a);
        // 给出来的命令在完整状态上合法
        expect(() => apply(base, me, a!.command)).not.toThrow();
      }
    }
  });

  it("redact 之后别人的手牌是空的，人机照样能出牌（不依赖别人的手牌）", () => {
    const state = scene("midgame", { players: 4, age: 1, round: 2, seed: 3 });
    const view = redactGameForViewer(state, "p2");
    expect(view.players.filter((player) => player.id !== "p2").every((player) => player.hand.length === 0)).toBe(true);
    expect(view.seed).toBeUndefined();
    const decision = botDecision(view, "p2");
    expect(decision).not.toBeNull();
    expect(() => apply(state, "p2", decision!.command)).not.toThrow();
  });

  it("不该它行动时返回 null（这一轮已经交了）", () => {
    const state = scene("submitted");
    expect(state.players[0]!.submitted).toBe(true);
    expect(botCommand(redactGameForViewer(state, "p1"), "p1")).toBeNull();
    expect(botCommand(redactGameForViewer(state, "p3"), "p3")).not.toBeNull();
  });
});

const GAMES = Number(process.env.BOT_SELFPLAY_GAMES ?? 300);
/** 一局最多多少步：3 × 6 轮 × 人数 + 巴比伦 / 哈利卡纳苏斯的插入选择 + 挑奇迹，远小于这个数。 */
const MAX_STEPS = 400;

describe(`人机自对弈：3–7 人各 ${GAMES} 局`, () => {
  for (const n of [3, 4, 5, 6, 7]) {
    it(`${n} 人：每一步都合法、不死循环、有理由、付款选最便宜的、决策够快`, () => {
      const problems: string[] = [];
      let decisions = 0;
      let totalMs = 0;
      let worstMs = 0;
      let maxSteps = 0;
      const seen = new Set<string>();
      for (let game = 0; game < GAMES; game += 1) {
        const seed = 90_000 + 1000 * n + game;
        let state = createGame(
          Array.from({ length: n }, (_, index) => ({ id: `p${index}`, name: `咕噜${index}` })),
          seed,
          { randomSides: game % 2 === 1, chooseWonders: game % 5 === 0 },
        );
        let steps = 0;
        while (state.phase !== "finished") {
          steps += 1;
          if (steps > MAX_STEPS) {
            problems.push(`seed ${seed}：超过 ${MAX_STEPS} 步`);
            break;
          }
          const id = pendingActors(state)[0];
          if (!id) {
            problems.push(`seed ${seed}：没人能行动（${state.phase}）`);
            break;
          }
          const view = redactGameForViewer(state, id);
          const t0 = performance.now();
          const decision = botDecision(view, id);
          const ms = performance.now() - t0;
          decisions += 1;
          totalMs += ms;
          worstMs = Math.max(worstMs, ms);
          if (!decision) {
            problems.push(`seed ${seed}：${id} 该行动却没给命令`);
            break;
          }
          const { command, reason } = decision;
          if (!reason || /undefined|NaN|null|\[object/.test(reason)) problems.push(`seed ${seed}：理由不对「${reason}」`);
          if (command.type === "PLAY" && command.action !== "discard" && !command.olympia) {
            const target = command.action === "build" ? { card: command.card } : { stage: true as const };
            const options = paymentOptions(state, id, target).options.filter((option) => option.kind !== "olympia");
            const chosen = options.find((option) => option.left === (command.trade?.left ?? "") && option.right === (command.trade?.right ?? ""));
            const cheapest = Math.min(...options.map((option) => option.total));
            if (!chosen || chosen.total !== cheapest) problems.push(`seed ${seed}：付款没选最便宜的 ${JSON.stringify(command)}`);
          }
          seen.add(state.phase === "seventh" ? "seventh" : command.type === "PLAY" ? `${command.action}${command.olympia ? ":olympia" : ""}` : command.type);
          try {
            state = apply(state, id, command).state;
          } catch (error) {
            problems.push(`seed ${seed}：非法命令 ${JSON.stringify(command)}：${(error as Error).message}`);
            break;
          }
        }
        maxSteps = Math.max(maxSteps, steps);
      }
      const avgMs = totalMs / decisions;
      console.log(`${n} 人 ${GAMES} 局：最多 ${maxSteps} 步，决策 ${decisions} 次，平均 ${avgMs.toFixed(2)}ms，最坏 ${worstMs.toFixed(1)}ms`);
      expect(problems.slice(0, 5)).toEqual([]);
      expect(maxSteps).toBeLessThanOrEqual(MAX_STEPS);
      expect(avgMs).toBeLessThan(50);
      expect(worstMs).toBeLessThan(300);
      // 各种决定都真的出现过
      for (const kind of ["build", "wonder", "discard", "CHOOSE_WONDER"]) expect(seen.has(kind)).toBe(true);
    }, 120_000);
  }
});

describe("人机的关键决策", () => {
  it("能免费链的好牌不会弃掉：有写字间、祭坛时建图书馆或神庙（免费链）", () => {
    const state = scene("chain");
    const decision = decide(state, "p1")!;
    expect(decision.command).toMatchObject({ type: "PLAY", action: "build" });
    expect(["Library", "Temple"]).toContain(nameOf(decision.command));
    expect(decision.reason).toContain("免费链");
  });

  it("科技凑套：有圆规、齿轮，能自己建石板卡就建（一套 +7）", () => {
    const state = buildScene({
      age: 2,
      round: 4,
      players: [
        { wonder: "giza", built: ["Apothecary", "Workshop", "Lumber Yard", "Press@1"], coins: 2, hand: ["School", "Loom@2", "Stockade@1", "Tavern"].slice(0, 4) },
        { wonder: "rhodes", built: ["Ore Vein"] },
        { wonder: "babylon", built: ["Clay Pool"] },
      ],
    });
    const decision = decide(state, "p1")!;
    expect(nameOf(decision.command)).toBe("School");
    expect(decision.command).toMatchObject({ action: "build" });
    expect(decision.reason).toContain("凑齐圆规、齿轮、石板一套");
  });

  it("截牌：自己什么都建不了时，弃掉对下家最值钱的那张（下家有 3 张石板，大学对他免费链 +7）", () => {
    const state = buildScene({
      age: 3,
      round: 3,
      players: [
        { wonder: "giza", built: [], coins: 0, hand: ["Arsenal", "Palace", "Town Hall", "University", "Gardens"] },
        // 左邻 = 下家（Age III 往左传）
        { wonder: "ephesus", built: ["Scriptorium", "Library", "School"], coins: 0 },
        { wonder: "rhodes", built: [], coins: 0 },
      ],
    });
    const decision = decide(state, "p1")!;
    expect(decision.command).toMatchObject({ type: "PLAY", action: "discard" });
    expect(nameOf(decision.command)).toBe("University");
    expect(decision.reason).toContain("不让下家");
  });

  it("第 6 轮不截牌（剩下那张作废，不传给任何人），理由里不提下家", () => {
    const state = scene("lastRound");
    const decision = decide(state, "p1")!;
    expect(decision.reason).not.toContain("下家");
  });

  it("军事够用就停：已经比两邻多 5 盾以上，Age III 不再白建红卡", () => {
    const state = buildScene({
      age: 3,
      round: 5,
      players: [
        {
          wonder: "rhodes",
          stages: 3,
          built: ["Walls", "Training Ground", "Stables", "Barracks", "Stone Pit", "Ore Vein@1", "Foundry"],
          coins: 5,
          hand: ["Fortifications", "Arsenal", "Gardens"],
        },
        { wonder: "giza", built: ["Stockade"] },
        { wonder: "babylon", built: ["Guard Tower"] },
      ],
    });
    const decision = decide(state, "p1")!;
    expect(["Fortifications", "Arsenal"]).not.toContain(decision.command.type === "PLAY" && decision.command.action === "build" ? nameOf(decision.command) : "");
  });

  it("军事该拿就拿：Age I 第 6 轮和两邻都平，建一张红卡两边都赢", () => {
    const state = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "giza", built: ["Stockade", "Lumber Yard", "Ore Vein"], coins: 3, hand: ["Barracks", "Clay Pool"] },
        { wonder: "rhodes", built: ["Guard Tower"] },
        { wonder: "babylon", built: ["Barracks"] },
      ],
    });
    const decision = decide(state, "p1")!;
    expect(nameOf(decision.command)).toBe("Barracks");
    expect(decision.command).toMatchObject({ action: "build" });
    expect(decision.reason).toContain("从平变赢");
  });

  it("资源卡：Age I 开局奇迹要的资源两邻都不产，先建它", () => {
    // 吉萨 A 第 1 层 2 石、第 3 层 4 石；两邻都不产石
    const state = buildScene({
      age: 1,
      round: 1,
      players: [
        { wonder: "giza", hand: ["Stone Pit", "Altar", "Theater", "Loom", "Stockade", "Glassworks", "Lumber Yard"] },
        { wonder: "rhodes" },
        { wonder: "olympia" },
      ],
    });
    const decision = decide(state, "p1")!;
    expect(nameOf(decision.command)).toBe("Stone Pit");
    expect(decision.reason).toMatch(/石/);
  });

  it("巴比伦 B 第 7 张：一定会打（建、垫奇迹或弃），命令合法", () => {
    const state = scene("babylonSeventh");
    const decision = decide(state, "p1")!;
    expect(decision.command.type).toBe("PLAY");
    expect(() => apply(state, "p1", decision.command)).not.toThrow();
    expect(decision.reason.length).toBeGreaterThan(5);
  });

  it("哈利卡纳苏斯：从弃牌堆挑一张能建的（不挑同名建过的），不放弃", () => {
    const state = scene("halicarnassus");
    const decision = decide(state, "p1")!;
    expect(decision.command.type).toBe("DISCARD_BUILD");
    expect(decision.command.type === "DISCARD_BUILD" && decision.command.card).toBeTruthy();
    expect(nameOf(decision.command)).not.toBe("Glassworks");
    expect(() => apply(state, "p1", decision.command)).not.toThrow();
    expect(decision.reason).toContain("从弃牌堆免费建");
  });

  it("奥林匹亚 A 的免费建造：Age III 手里有贵牌时用在贵牌上", () => {
    const state = scene("olympiaFree");
    const decision = decide(state, "p1")!;
    expect(decision.command).toMatchObject({ type: "PLAY", action: "build" });
    const info = paymentOptions(state, "p1", { card: (decision.command as { card: string }).card });
    expect(info.options.length).toBeGreaterThan(0);
    expect(() => apply(state, "p1", decision.command)).not.toThrow();
  });

  it("自选奇迹：挑一块还没人挑的板和面，附理由", () => {
    const state = scene("chooseWonders");
    const actor = pendingActors(state)[0]!;
    const decision = decide(state, actor)!;
    expect(decision.command.type).toBe("CHOOSE_WONDER");
    if (decision.command.type !== "CHOOSE_WONDER") return;
    expect(WONDER_KEYS).toContain(decision.command.wonder);
    expect(["giza", "rhodes"]).not.toContain(decision.command.wonder);
    expect(() => apply(state, actor, decision.command)).not.toThrow();
    expect(decision.reason).toMatch(/^挑/);
  });

  it("一样贵的两种买法，少付给领先的邻居（默认方案会找右邻，右邻领先时改找左邻）", () => {
    // 我缺 1 石建浴场：左右邻居都产石、都是 2 金；右邻分数遥遥领先 → 向左邻买
    const state = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "halicarnassus", built: ["Lumber Yard", "Clay Pool"], coins: 3, hand: ["Baths", "Loom"] },
        { wonder: "giza", built: ["Ore Vein"] },
        { wonder: "rhodes", built: ["Stone Pit", "Altar", "Theater", "Pawnshop"], stages: 1 },
      ],
    });
    const baths = state.players[0]!.hand.find((id) => card(id).name === "Baths")!;
    const options = paymentOptions(state, "p1", { card: baths }).options;
    expect(options[0]).toMatchObject({ left: "", right: "S" });
    const decision = decide(state, "p1")!;
    expect(decision.command).toMatchObject({ type: "PLAY", action: "build", trade: { left: "S", right: "" } });
    expect(decision.reason).toContain("向左邻买 1 石");
  });
});
