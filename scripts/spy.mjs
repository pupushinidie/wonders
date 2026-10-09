// 抓包：用两个真实的 socket（甲、乙）坐进同一个房间，其余座位用陪玩机器人补满，打完一整局，
// 记下服务器发给每个人的每一条 room:updated，按 game.version 配对检查：
//   - 发给乙的数据里没有甲当时的手牌、交了还没亮的牌、垫在奇迹下的牌、甲弃掉的牌（反过来也查）；
//   - 弃牌堆牌面只在哈利卡纳苏斯挑牌那一步发给他本人；
//   - 任何人都拿不到种子、随机数状态、动作序列、预先排好的手牌（seed / rngState / log / stacked 字段）。
// 甲乙每轮轮流选建造 / 垫奇迹 / 弃牌，让各种暗牌都出现。
// 用法：node scripts/spy.mjs [人数=4]（先 npm run dev；SERVER_URL 默认 http://localhost:3016）。发现泄露时退出码 1。
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { legalActions, pendingActors } from "../packages/game/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capacity = Number(process.argv[2] ?? 4);
const URL = process.env.SERVER_URL ?? "http://localhost:3016";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function client(name) {
  const socket = io(URL, { transports: ["websocket"] });
  const log = [];
  const state = { socket, name, log, latest: null };
  socket.on("room:updated", (room) => {
    state.latest = room;
    log.push(room);
  });
  state.emit = (event, ...args) => new Promise((done) => socket.emit(event, ...args, done));
  return state;
}

const a = client("甲间谍");
const b = client("乙间谍");
await Promise.all([a, b].map((entry) => new Promise((done) => entry.socket.on("connect", done))));
const created = await a.emit("room:create", { name: a.name, capacity });
if (!created.ok) throw new Error(created.error);
const code = created.data.code;
const joined = await b.emit("room:join", { name: b.name, code });
if (!joined.ok) throw new Error(joined.error);
const bots = spawn("node", ["scripts/test-bot.mjs", "fill", code, String(capacity - 2)], {
  cwd: root,
  env: { ...process.env, BOT_DELAY_MS: "20", SERVER_URL: URL },
  stdio: "ignore",
});

const seatOf = (entry) => entry.latest?.members.find((member) => member.id === entry.socket.id)?.playerId;
const counts = { 建造: 0, 垫奇迹: 0, 弃牌: 0, 撤回: 0 };
const deadline = Date.now() + 5 * 60_000;
let started = false;
while (Date.now() < deadline) {
  await sleep(30);
  const room = a.latest;
  if (!room) continue;
  if (room.status === "waiting") {
    if (!started && room.members.length === capacity) {
      started = (await a.emit("room:start")).ok;
    }
    continue;
  }
  const game = room.game;
  if (!game) continue;
  if (game.phase === "finished") break;
  for (const [index, entry] of [a, b].entries()) {
    const view = entry.latest?.game;
    const seat = seatOf(entry);
    if (!view || !pendingActors(view).includes(seat)) continue;
    const actions = legalActions(view, seat);
    const want = ["build", "wonder", "discard"][(view.round + view.age + index) % 3];
    const pick = actions.find((action) => action.type === "PLAY" && action.action === want) ?? actions[0];
    const result = await entry.emit("game:command", pick);
    if (result.ok && pick.type === "PLAY") counts[{ build: "建造", wonder: "垫奇迹", discard: "弃牌" }[pick.action]] += 1;
    // 偶尔撤回再交一次，让「交了没亮」的状态多出现几次
    if (result.ok && view.phase === "play" && view.round === 2) {
      if ((await entry.emit("game:command", { type: "UNDO" })).ok) {
        counts.撤回 += 1;
        await entry.emit("game:command", pick);
      }
    }
  }
}

const leaks = new Set();
const banned = ['"seed"', '"rngState"', '"log"', '"stacked"'];
/** 某人在某个 version 时手里、交了的、垫下去的牌，以及他自己弃掉过的牌（他自己的视角里看得到）。 */
function secretsByVersion(entry) {
  const map = new Map();
  const seat = seatOf(entry);
  const discarded = new Set();
  for (const room of entry.log) {
    const game = room.game;
    if (!game) continue;
    const me = game.players.find((player) => player.id === seat);
    for (const event of game.events) {
      if (event.type === "Revealed") for (const play of event.plays) if (play.player === seat && play.action !== "build" && play.card) discarded.add(play.card);
    }
    map.set(game.version, new Set([...me.hand, ...me.stageCards, ...(me.play ? [me.play.card] : []), ...discarded]));
  }
  return map;
}
for (const [spy, other] of [[a, b], [b, a]]) {
  const secrets = secretsByVersion(other);
  const spySeat = seatOf(spy);
  for (const room of spy.log) {
    const json = JSON.stringify(room);
    for (const key of banned) if (json.includes(key)) leaks.add(`${spy.name} 收到了 ${key}`);
    const game = room.game;
    if (!game) continue;
    const theirs = secrets.get(game.version);
    // 哈利卡纳苏斯挑牌那一步，弃牌堆本来就发给他本人
    const seesDiscard = game.phase === "discardBuild" && game.pending?.player === spySeat;
    if (theirs) for (const id of theirs) if (json.includes(`"${id}"`) && !(seesDiscard && game.discard.includes(id))) {
      // 已经建成的牌是公开的（比如对方后来把这张牌建了，同一个 version 不会既在手里又建成）
      const publicNow = game.players.some((player) => player.built.includes(id));
      if (!publicNow) leaks.add(`${spy.name} 在 version ${game.version} 看到了 ${other.name} 的 ${id}`);
    }
    for (const player of game.players) {
      if (player.id === spySeat) continue;
      if (player.hand.length > 0) leaks.add(`${spy.name} 看到了 ${player.name} 的手牌`);
      if (player.play) leaks.add(`${spy.name} 看到了 ${player.name} 交的牌`);
      if (player.stageCards.length > 0) leaks.add(`${spy.name} 看到了 ${player.name} 垫的牌`);
    }
    if (game.discard.length > 0 && !(game.phase === "discardBuild" && game.pending?.player === spySeat)) leaks.add(`${spy.name} 收到了弃牌堆牌面`);
  }
}

const final = a.latest?.game;
const summary = {
  capacity,
  updates: { [a.name]: a.log.length, [b.name]: b.log.length },
  finished: final?.phase === "finished",
  winners: final?.finalResult?.winners,
  plays: counts,
  leaks: [...leaks].slice(0, 20),
};
console.log(JSON.stringify(summary, null, 1));
console.log("非法操作提示：", (await a.emit("game:command", { type: "PLAY", card: "a1_altar_3p", action: "build" })).error ?? "（被接受了！）");
await a.emit("room:dissolve");
bots.kill();
a.socket.close();
b.socket.close();
process.exit(leaks.size > 0 || !summary.finished ? 1 : 0);
