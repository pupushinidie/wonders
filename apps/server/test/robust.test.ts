/**
 * 服务器不能被一个客户端打挂（首发验收 I7–I10）：
 * - I7 不带回调、参数乱填地发每一种事件，进程和别的房间都还在；
 * - I8 命令里的多余字段不进状态、动作序列只记白名单字段；消息体超过 32 KB 断开这条连接；高频命令限频；
 * - I9 对局开始后不能改「观战看手牌」；
 * - I10 昵称去掉零宽 / 方向控制字符，全是看不见的字符拒绝；真人不能用「咕噜」开头或带「人机」的昵称。
 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type { AckResponse, LobbyRoomSnapshot } from "@wonders/game";

process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "600000";

type AnySocket = Socket;
let server: typeof import("../src/index.js");
let serverUrl = "";
const clients: AnySocket[] = [];
const latest = new Map<AnySocket, LobbyRoomSnapshot>();
let seq = 0;

function connect(): Promise<AnySocket> {
  return new Promise((resolve, reject) => {
    const client = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    client.on("room:updated", (room: LobbyRoomSnapshot) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function call<T>(client: AnySocket, event: string, ...args: unknown[]): Promise<AckResponse<T>> {
  return new Promise((resolve) => client.emit(event, ...args, resolve));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nick = (prefix: string) => `${prefix}${(seq += 1)}`;

/** 3 个真人坐满、开局，返回房间码和三个连接。 */
async function table(): Promise<{ code: string; players: AnySocket[] }> {
  const players = [await connect(), await connect(), await connect()];
  const created = await call<LobbyRoomSnapshot>(players[0]!, "room:create", { name: nick("房主"), capacity: 3 });
  if (!created.ok) throw new Error(created.error);
  for (const client of players.slice(1)) {
    const joined = await call<LobbyRoomSnapshot>(client, "room:join", { name: nick("玩家"), code: created.data.code });
    if (!joined.ok) throw new Error(joined.error);
  }
  expect((await call(players[0]!, "room:start")).ok).toBe(true);
  await sleep(30);
  return { code: created.data.code, players };
}

const EVENTS = [
  "lobby:get", "room:create", "room:join", "room:start", "room:settings", "room:leave", "game:command", "room:chat",
  "room:rematch", "room:kick", "room:access", "room:sit", "room:stand", "room:dissolve", "room:add-bot", "room:auto",
  "admin:verify", "admin:dissolve", "admin:kick-session", "voice:join", "voice:mute", "voice:leave", "voice:signal",
  "no:such-event", "constructor", "__proto__",
];
const JUNK: unknown[][] = [[], [null], [123], ["x"], [[1, 2]], [{ message: "hi" }], [null, null], [{}, 5, "y"], [true], [{ type: "PLAY", card: { evil: 1 } }]];

describe("服务器不会被一个客户端打挂", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("I7：每一种事件都不带回调、参数乱填地发一遍（房间外、等候中、对局中、观战），进程和别的房间都还在；带回调的拿到正常的回执", async () => {
    const bystander = await table();
    const before = latest.get(bystander.players[0]!)!.game!.version;

    const outsider = await connect();
    const game = await table();
    const watcher = await connect();
    expect((await call(watcher, "room:join", { name: nick("看客"), code: game.code, spectate: true })).ok).toBe(true);
    const waitingHost = await connect();
    expect((await call(waitingHost, "room:create", { name: nick("等人"), capacity: 4 })).ok).toBe(true);

    for (const client of [outsider, game.players[1]!, watcher, waitingHost]) {
      for (const event of EVENTS) {
        for (const args of JUNK) client.emit(event, ...args);
        await sleep(2);
      }
    }
    await sleep(100);
    // 带回调但参数乱填：回执要么 ok 要么带中文错误
    for (const event of EVENTS.filter((name) => name !== "voice:signal" && !name.includes("no:") && name !== "constructor" && name !== "__proto__")) {
      for (const args of [[], [null], ["x"], [{ evil: true }]]) {
        const response = await Promise.race([call(outsider, event, ...args), sleep(500).then(() => "timeout" as const)]);
        expect(response, event).not.toBe("timeout");
        if (response !== "timeout" && !response.ok) expect(response.error.length).toBeGreaterThan(0);
      }
    }
    // 进程还在：列表能拿到；旁边那桌照常能出牌
    const lobby = await call<unknown[]>(await connect(), "lobby:get");
    expect(lobby.ok).toBe(true);
    const mover = bystander.players[0]!;
    const view = latest.get(mover)!.game!;
    const seat = latest.get(mover)!.members.find((member) => member.id === mover.id)!.playerId;
    const hand = view.players.find((player) => player.id === seat)!.hand;
    const played = await call<LobbyRoomSnapshot>(mover, "game:command", { type: "PLAY", card: hand[0], action: "discard" });
    expect(played.ok).toBe(true);
    expect(played.ok && played.data.game!.version).toBeGreaterThan(before);
  }, 30_000);

  it("I8：命令里的多余字段不进状态，动作序列只记白名单字段；畸形命令回「命令格式不对」", async () => {
    const { code, players } = await table();
    const me = players[0]!;
    const seat = latest.get(me)!.members.find((member) => member.id === me.id)!.playerId;
    const hand = latest.get(me)!.game!.players.find((player) => player.id === seat)!.hand;
    const junk = "x".repeat(8 * 1024);
    expect((await call(me, "game:command", { type: "PLAY", card: hand[0], action: "discard", junk, player: "p2" })).ok).toBe(true);
    expect((await call(me, "game:command", { type: "UNDO", junk })).ok).toBe(true);
    const raw = server.testHooks.game(code)!;
    expect(raw.log!.slice(-2).map((entry) => entry.command)).toEqual([{ type: "PLAY", card: hand[0], action: "discard" }, { type: "UNDO" }]);
    expect(JSON.stringify(raw).includes("xxxx")).toBe(false);
    for (const bad of [null, "PLAY", [1], { type: "PLAY", card: "y".repeat(500), action: "discard" }, { type: "PLAY", card: hand[0], action: "discard", trade: "WW" }, { type: "HACK" }]) {
      const response = await call(me, "game:command", bad);
      expect(response).toMatchObject({ ok: false });
    }
  });

  it("I8：消息体超过 32 KB 直接断开这条连接，服务器照常；交牌 / 撤回刷太快会被限频", async () => {
    const { players } = await table();
    const big = players[2]!;
    const closed = new Promise<string>((resolve) => big.once("disconnect", resolve));
    big.emit("game:command", { type: "UNDO", junk: "z".repeat(100 * 1024) }, () => {});
    expect(await closed).toBeTruthy();
    expect((await call(await connect(), "lobby:get")).ok).toBe(true);

    const spammer = players[0]!;
    const responses = await Promise.all(Array.from({ length: 80 }, () => call(spammer, "game:command", { type: "UNDO" })));
    const limited = responses.filter((response) => !response.ok && response.error.includes("太快"));
    expect(limited.length).toBeGreaterThan(0);
    // 歇一会儿又能正常操作
    await sleep(1200);
    const seat = latest.get(spammer)!.members.find((member) => member.id === spammer.id)!.playerId;
    const hand = latest.get(spammer)!.game!.players.find((player) => player.id === seat)!.hand;
    expect((await call(spammer, "game:command", { type: "PLAY", card: hand[0], action: "discard" })).ok).toBe(true);
  });

  it("I9：「观战看手牌」只能在等候房间改，对局开始后改会被拒；别的设置照常能改", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>(host, "room:create", { name: nick("房主"), capacity: 3 });
    expect(created.ok).toBe(true);
    expect((await call(host, "room:access", { spectatorsSeeAll: true })).ok).toBe(true);
    expect((await call(host, "room:access", { spectatorsSeeAll: false })).ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:start")).ok).toBe(true);
    const locked = await call(host, "room:access", { spectatorsSeeAll: true });
    expect(locked).toMatchObject({ ok: false });
    expect(!locked.ok && locked.error).toContain("观战看手牌");
    expect((await call(host, "room:access", { open: true })).ok).toBe(true);
    expect((await call(host, "room:access", { spectatorsSeeAll: false, allowSpectators: true })).ok).toBe(true);
  });

  it("I55：先开「观战看手牌」再关「允许观战」，看手牌跟着关掉；开局后重新打开允许观战，没房间码的人从列表观战也看不到手牌", async () => {
    const host = await connect();
    const hostName = nick("绕开");
    const created = await call<LobbyRoomSnapshot>(host, "room:create", { name: hostName, capacity: 3 });
    expect(created.ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:access", { spectatorsSeeAll: true })).ok).toBe(true);
    expect((await call(host, "room:access", { allowSpectators: false })).ok).toBe(true);
    await sleep(20);
    expect(latest.get(host)!.access).toMatchObject({ allowSpectators: false, spectatorsSeeAll: false });
    expect((await call(host, "room:start")).ok).toBe(true);
    // 局中重新打开允许观战：接受，但看手牌还是关着
    expect((await call(host, "room:access", { allowSpectators: true })).ok).toBe(true);
    await sleep(20);
    expect(latest.get(host)!.access).toMatchObject({ allowSpectators: true, spectatorsSeeAll: false });
    const spy = await connect();
    const lobby = await call<{ id: string; players: { name: string }[] }[]>(spy, "lobby:get");
    const listed = lobby.ok ? lobby.data.find((room) => room.players.some((player) => player.name === hostName)) : undefined;
    expect(listed).toBeDefined();
    const watched = await call<LobbyRoomSnapshot>(spy, "room:join", { name: nick("小号"), roomId: listed!.id, spectate: true });
    expect(watched.ok).toBe(true);
    expect(watched.ok && watched.data.game!.players.every((player) => player.hand.length === 0)).toBe(true);
    // 局中一次把两个都打开也不行；局中关掉观战（看手牌也跟着关）再打开也打不开看手牌
    expect((await call(host, "room:access", { allowSpectators: false })).ok).toBe(true);
    expect((await call(host, "room:access", { allowSpectators: true, spectatorsSeeAll: true })).ok).toBe(false);
  });

  it("I55：局中「观战看手牌」开着时可以关观战（看手牌一起关），之后重新打开观战，看手牌不会回来", async () => {
    const host = await connect();
    expect((await call(host, "room:create", { name: nick("房主"), capacity: 3 })).ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    expect((await call(host, "room:access", { spectatorsSeeAll: true })).ok).toBe(true);
    expect((await call(host, "room:start")).ok).toBe(true);
    expect((await call(host, "room:access", { allowSpectators: false })).ok).toBe(true);
    await sleep(20);
    expect(latest.get(host)!.access).toMatchObject({ allowSpectators: false, spectatorsSeeAll: false });
    expect((await call(host, "room:access", { allowSpectators: true })).ok).toBe(true);
    await sleep(20);
    expect(latest.get(host)!.access).toMatchObject({ allowSpectators: true, spectatorsSeeAll: false });
  });

  it("I10：昵称去掉零宽 / 方向控制字符；全是看不见的拒绝；真人不能叫「咕噜……」或带「人机」", async () => {
    const tryName = async (name: string) => {
      const client = await connect();
      const response = await call<LobbyRoomSnapshot>(client, "room:create", { name, capacity: 3 });
      return response.ok ? response.data.members[0]!.name : `拒绝：${response.error}`;
    };
    expect(await tryName("​​​")).toMatch(/^拒绝/);
    expect(await tryName("ㅤㅤ")).toMatch(/^拒绝/);
    expect(await tryName("​甲‍乙﻿")).toBe("甲乙");
    expect(await tryName("‮号一噜咕")).toBe("号一噜咕");
    for (const name of ["咕噜一号", "咕噜 7号", "咕嚕一號", "咕​噜二号", "「咕噜」三号", "我是人机"]) {
      expect(await tryName(name), name).toMatch(/^拒绝：「咕噜」开头/);
    }
    expect(await tryName("小咕噜")).toBe("小咕噜");
    // 观战的名字也一样
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>(host, "room:create", { name: nick("房主"), capacity: 3 });
    const watcher = await connect();
    const watched = await call(watcher, "room:join", { name: "咕噜一号", code: created.ok ? created.data.code : "", spectate: true });
    expect(watched.ok).toBe(false);
    // 人机照样叫咕噜一号
    expect((await call(host, "room:add-bot")).ok).toBe(true);
    await sleep(30);
    expect(latest.get(host)!.members.find((member) => member.bot)!.name).toBe("咕噜一号");
  });
});
