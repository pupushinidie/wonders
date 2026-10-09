/** 默认时限（不设 TURN_MS）：每轮出牌 60 秒、插入选择 20 秒、挑奇迹 30 秒。 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { scene, type AckResponse, type ClientToServerEvents, type LobbyRoomSnapshot, type ServerToClientEvents } from "@wonders/game";

process.env.BOT_DELAY_SCALE = "0";
delete process.env.TURN_MS;

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let server: typeof import("../src/index.js");
let serverUrl = "";
const clients: TestSocket[] = [];

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

describe("默认时限", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("出牌 60 秒、巴比伦第 7 张 20 秒、自选奇迹 30 秒", async () => {
    const players = [await connect(), await connect(), await connect()];
    const created = await call<LobbyRoomSnapshot>((ack) => players[0]!.emit("room:create", { name: "甲甲", capacity: 3 }, ack));
    if (!created.ok) throw new Error(created.error);
    for (const [index, client] of players.slice(1).entries()) {
      expect((await call<LobbyRoomSnapshot>((ack) => client.emit("room:join", { name: `乙乙${index}`, code: created.data.code }, ack))).ok).toBe(true);
    }
    expect((await call<LobbyRoomSnapshot>((ack) => players[0]!.emit("room:start", ack))).ok).toBe(true);
    const left = () => server.testHooks.turnInfo(created.data.code)!.deadline - Date.now();
    expect(left()).toBeGreaterThan(58_000);
    expect(left()).toBeLessThanOrEqual(60_000);
    server.testHooks.setGame(created.data.code, scene("babylonSeventh"));
    expect(left()).toBeGreaterThan(18_000);
    expect(left()).toBeLessThanOrEqual(20_000);
    server.testHooks.setGame(created.data.code, scene("chooseWonders", { players: 3 }));
    expect(left()).toBeGreaterThan(28_000);
    expect(left()).toBeLessThanOrEqual(30_000);
  });
});
