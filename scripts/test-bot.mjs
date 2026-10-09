// 本地测试用的陪玩机器人（先 npm run dev；或者指向 qa-env / 服务器上的 localhost:3016）。
//   node scripts/test-bot.mjs host [人数=3] [机器人数=人数-1]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//                                                            （机器人数 = 人数时全是机器人，自己打完一整局）
//   node scripts/test-bot.mjs join <房间码> [昵称]            → 以一个机器人身份加入别人的房间
//   node scripts/test-bot.mjs fill <房间码> <几个>            → 往别人的房间里塞几个机器人（抓包脚本用）
// 机器人每次轮到自己（这一轮还没交牌、或者插入选择在等它）就从 legalActions 里随机挑一个（偏向建造），
// 每次收到回执都按最新状态重新看一遍。BOT_SMART=1 用人机 botCommand（只给它自己座位的视角）。
// 环境变量：SERVER_URL（默认 http://localhost:3016）、SOCKET_PATH（默认 /socket.io）、BOT_DELAY_MS（每步思考时间，默认 1500）、
//   BOT_IDLE=1（只挂着不动，等超时由人机替它出）、BOT_UNDO=1（偶尔交了又撤回）、
//   WD_RANDOM_SIDES=1 / WD_CHOOSE=1（建房时开「随机 A/B 面」「自选奇迹」）、BOT_STAY=1（终局后不退出，同意再来一局）。
import { io } from "socket.io-client";
import { botCommand, legalActions, pendingActors, redactGameForViewer } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3016";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const SMART = process.env.BOT_SMART === "1";
const UNDO = process.env.BOT_UNDO === "1";
const STAY = process.env.BOT_STAY === "1";
const NAMES = ["金字塔", "巨像", "灯塔", "神庙", "花园", "宙斯", "陵墓"];
const OPTIONS = { randomSides: process.env.WD_RANDOM_SIDES === "1", chooseWonders: process.env.WD_CHOOSE === "1" };

/** 随机挑一个合法行动：建造 60%、垫奇迹 15%、其余随便（弃牌、挑奇迹、挑弃牌）。 */
function randomMove(actions) {
  const builds = actions.filter((action) => action.type === "PLAY" && action.action === "build");
  const wonders = actions.filter((action) => action.type === "PLAY" && action.action === "wonder");
  const roll = Math.random();
  const pool = roll < 0.6 && builds.length ? builds : roll < 0.75 && wonders.length ? wonders : actions;
  return pool[Math.floor(Math.random() * pool.length)];
}

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  const tick = async () => {
    const room = latest;
    const game = room?.game;
    if (!room || IDLE || !game || game.phase === "finished" || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || !pendingActors(game).includes(seat)) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY * (0.5 + Math.random())));
    try {
      const fresh = latest.game;
      if (!fresh || fresh.phase === "finished" || !pendingActors(fresh).includes(seat)) return;
      const actions = legalActions(fresh, seat);
      if (actions.length === 0) return;
      const command = SMART ? botCommand(redactGameForViewer(fresh, seat), seat) ?? actions[0] : randomMove(actions);
      let result = await emit("game:command", command);
      const stillMine = result.ok && result.data.game?.players.find((player) => player.id === seat)?.submitted === true;
      if (stillMine && UNDO && command.type === "PLAY" && result.data.game?.phase === "play" && Math.random() < 0.15) {
        result = await emit("game:command", { type: "UNDO" });
        console.log(name, "交了又撤回", result.ok ? "" : result.error);
      }
      if (!result.ok) console.log(name, "行动失败", result.error);
      else latest = result.data;
    } finally {
      acting = false;
      void tick();
    }
  };
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "finished" && !room.rematch?.acceptedIds.includes(socket.id)) {
      const scores = game.finalResult?.scores.map((score) => `${score.player}:${score.total}`).join(" ") ?? "";
      console.log(name, "游戏结束，得分", scores, "赢家", game.finalResult?.winners.join(","));
      if (STAY) void emit("room:rematch", true);
      else setTimeout(() => process.exit(0), 300);
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => {
    console.log(name, "房间关闭：", reason);
    process.exit(0);
  });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const name = arg2 ?? NAMES[0];
  const { socket, emit } = bot(name);
  socket.on("connect", async () => console.log("加入", name, (await emit("room:join", { name, code: arg1 })).ok));
} else if (mode === "fill") {
  const count = Number(arg2 ?? 1);
  for (let index = 0; index < count; index += 1) {
    const name = `${NAMES[(index + 1) % NAMES.length]}${index + 1}`;
    const other = bot(name);
    other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: arg1 })).ok));
  }
} else {
  const capacity = Number(arg1 ?? 3);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: OPTIONS });
    if (!created.ok) {
      console.log(created.error);
      process.exit(1);
    }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index % NAMES.length];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
