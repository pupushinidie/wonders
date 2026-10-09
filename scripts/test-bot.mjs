// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 机器人轮到自己时随机选一个合法行动（直接调 @wonders/game 的 legalActions）；BOT_SMART=1 时用人机的走法。
// 环境变量 BOT_DELAY_MS 控制每步的思考时间（默认 1500），BOT_IDLE=1 时只挂着不动（等超时自动行动）。
// 建房时的变体：KD_MIGHTY=1（2 人 7×7）、KD_MIDDLE=1（中央王国）、KD_HARMONY=1（和谐）。
import { io } from "socket.io-client";
import { botCommand, legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3016";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const SMART = process.env.BOT_SMART === "1";
const NAMES = ["麦田", "森林", "湖泊", "草地", "沼泽", "矿山", "城堡"];
const OPTIONS = { mighty: process.env.KD_MIGHTY === "1", middleKingdom: process.env.KD_MIDDLE === "1", harmony: process.env.KD_HARMONY === "1" };

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  let latest = null;
  // 每次收到更新、每次行动的回执之后都按最新状态再看一遍（连续两步都是自己时不会漏掉）
  const tick = async () => {
    const room = latest;
    const game = room?.game;
    if (!room || IDLE || !game || game.phase === "finished" || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    const me = game.players[game.currentPlayer];
    if (!me || me.id !== seat) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const fresh = latest.game;
      if (fresh.version !== game.version) return;
      const actions = legalActions(fresh, seat);
      const command = SMART ? botCommand(fresh, seat) : actions[Math.floor(Math.random() * actions.length)];
      const result = await emit("game:command", command);
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
    if (game?.phase === "finished") {
      const scores = game.finalResult?.scores.map((s) => `${s.player.slice(0, 2)}:${s.total}`).join(" ") ?? "";
      console.log(name, "游戏结束，得分", scores);
      setTimeout(() => process.exit(0), 200);
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[0]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[0], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room, socket) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
    void socket;
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: OPTIONS });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
