# 七大奇迹

3–7 人同时轮抽、建城池和奇迹的桌游，网页联机版。规则按 `~/Desktop/游戏规则/七大奇迹.md` 和补充勘误 `七大奇迹-补充.md` 实现（**以补充文件为准**，勘误 E1–E17 全部按官方第一版更正）；美术和规则说明文字都是自己的。

线上地址（上线后）：<https://gulugagame.com/wonders/>（付费网关后面，要登录）

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3016，网页 :5189（WEB_PORT / SERVER_PORT 可以改，另起一套服务不撞端口）
npm test             # 约 260 个测试、20 秒：规则包、服务器、规则核对的验收测试（见下面「测试」）
npm run typecheck
BASE_PATH=/wonders/ npm run build
```

改了 `data/*.json`（卡表、奇迹板）要跑 `node scripts/gen-data.mjs` 重新生成 `packages/game/src/data.ts`，再 `touch apps/server/src/index.ts`（tsx watch 不会自己重启）。

一个人测试：`node scripts/test-bot.mjs host 3 2` 让机器人建一个 3 人房（自己再拉 1 个机器人）并打印房间码，你在网页里用房间码加入凑满后自动开局；`node scripts/test-bot.mjs host 4 4` 四个机器人自己打完一整局。用法见脚本开头的注释。

## 测试

| 文件 | 内容 |
|---|---|
| `packages/game/test/data.test.ts` | 卡表、奇迹板和补充文件一字不差；按人数统计表（§2.3）；勘误 E1–E9、E11–E15 的数据 |
| `packages/game/test/rules.test.ts` | 规则书 §9 用例（测试名带 `规则书#1`–`#14`）和补充文件新增用例（`补充#E-T1`–`#E-T14`） |
| `packages/game/test/engine.test.ts` | 规则书没写死的地方按补充 §5 的默认值（U3–U12）、撤回和计时键、纯函数、自选奇迹、超时保底动作 |
| `packages/game/test/random.test.ts` | 每种人数 300 局随机对局，普通代码查不变量（牌数守恒、金币、同名、军事、分数分项、不卡死、隐藏信息） |
| `packages/game/test/redact.test.ts` | 各座位视角、观战、观战看全部、哈利卡纳苏斯挑弃牌时的隐藏信息 |
| `packages/game/test/scenes.test.ts` | 预览局面工厂的每个局面；补充 §4.3 的教程剧本按引擎逐轮走一遍 |
| `packages/game/test/acceptance/` | **规则核对 agent 背靠背写的验收测试，引擎不改** |
| `apps/server/test/rounds.test.ts`、`timers.test.ts` | 同时出牌的房间流程、计时（别人交牌不重置）、超时人机代出、插入选择、重连、整局抓包、默认时限 |
| `apps/server/test/bots.test.ts`、`spectate.test.ts`、`kickSession.test.ts` | 继承的人机 / 托管、观战、挤登录 |

抓包（连真实服务器）：`npm run dev` 之后 `node scripts/spy.mjs 4`，两个真实 socket 加陪玩机器人打完一整局，查发给对方的数据里没有自己的暗牌，有泄露退出码 1。

## 目录

| 路径 | 内容 |
|---|---|
| `data/cards.json`、`data/wonders.json` | 148 张时代卡、7 块奇迹板 × A/B（补充文件 §2.4、§2.5 原样） |
| `packages/game/src/types.ts` | 对外类型：状态、命令、事件、付款方案、分数明细 |
| `packages/game/src/engine.ts` | 规则引擎 `apply`、开局 `createGame`、超时保底动作、`legalActions`、`pendingActors` |
| `packages/game/src/trade.ts` | 付款方案 `paymentOptions`（自产、向左右邻居买、折扣、免费链、奥林匹亚） |
| `packages/game/src/score.ts` | 计分：七项明细、科技任选符号枚举最优、奥林匹亚复制行会取最优、平局 |
| `packages/game/src/city.ts` | 城池推导：产出、折扣、盾牌、科技符号、邻居 |
| `packages/game/src/redact.ts` | 隐藏信息 `redactGameForViewer` |
| `packages/game/src/scenes.ts` | 预览局面工厂（对外接口） |
| `packages/game/src/bot.ts` | 人机（现在是占位：保底动作；人机阶段换成正式策略） |
| `apps/server` | Socket.IO 房间服务器（建房、重连、踢人、解散、再来一局、聊天、语音、观战、人机、托管、挤登录、管理员解散），同时出牌的计时 |
| `apps/web` | 网页。牌桌现在是**调试牌桌**（`src/GameBoard.tsx`：把状态列出来，每个合法行动一个按钮），正式界面由界面阶段做 |
| `scripts/test-bot.mjs` | 陪玩机器人 |
| `scripts/spy.mjs` | 抓包：连真实服务器，检查发给别人的数据里没有别人的手牌、交的牌、弃牌堆、种子 |

## 对外接口（packages/game，`@wonders/game`）

界面、人机、教程、验收都只通过这些导出读状态、发命令、造局面。类型的逐字段说明在 `packages/game/src/types.ts` 的注释里。

### 座位和方向

- `state.players` 按顺时针排座位；座位 `i` 的**左邻** = `(i + 1) % n`，**右邻** = `(i − 1 + n) % n`（`leftOf(state, i)` / `rightOf(state, i)`）。
- 传牌：Age I、III 传给左邻（我拿到右邻的牌），Age II 传给右邻；`state.direction` 是本时代的方向。
- 东贸易站 = 从右邻买原料 1 金，西贸易站 = 从左邻买原料 1 金。界面上左邻画在屏幕左边。

### 状态（`GameState`）里给界面显示的字段

| 字段 | 含义 |
|---|---|
| `phase` | `wonders`（自选奇迹，按 `chooseOrder[chooser]` 轮流挑）/ `play`（同时出牌）/ `seventh`（巴比伦打第 7 张）/ `discardBuild`（哈利卡纳苏斯挑弃牌）/ `finished` |
| `age`、`round`、`direction` | 第几时代（1–3）、本时代第几轮（1–6）、传牌方向 |
| `pending` | 插入选择在等谁（`{ type, player }`），其他人显示「某某正在结算」 |
| `players[i].wonder / side / stages` | 奇迹、面、已建阶段数 |
| `players[i].built` | 已建的卡（按建造顺序，公开） |
| `players[i].coins / tokens` | 金币、军事标记（`{ age, value: 1/3/5/−1, vs: "left"/"right" }`） |
| `players[i].hand / handCount` | 手牌（只有自己的，别人是 `[]`）/ 张数（公开） |
| `players[i].submitted / play` | 这一轮交了没有（公开）/ 交了什么（只有自己的，别人是 `null`） |
| `players[i].stageCards` | 垫在奇迹下的牌（只有自己的） |
| `players[i].freeBuildUsed` | 奥林匹亚 A 这个时代的免费建造用过了 |
| `discard / discardCount` | 弃牌堆牌面（只有哈利卡纳苏斯挑牌那一步发给他本人）/ 张数 |
| `lastReveal` | 上一次亮牌每个人做了什么（别人垫奇迹、弃掉的牌是 `null`） |
| `events` | 这一步的事件（见 `GameEvent`）；`version` 每步 +1，界面看它变没变触发动画 |
| `finalResult` | 终局分数明细（七项分开、名次、赢家可并列） |
| `step` | 计时的键：换轮、换阶段、换人挑奇迹才变，别人交牌 / 撤回不变 |

### 命令（`GameCommand`，经 `game:command` 发给服务器）

| 命令 | 参数 | 什么时候 |
|---|---|---|
| `PLAY` | `card`（手牌 id）、`action`（`"build"` / `"wonder"` / `"discard"`）、`trade?`（`{ left: "WW", right: "" }`，不给用默认方案）、`olympia?`（`true` = 用奥林匹亚免费建造） | `play` 阶段没交过时；`seventh` 阶段巴比伦本人。已经交了要改，先 `UNDO` |
| `UNDO` | — | `play` 阶段、自己交了、还没全员交齐 |
| `CHOOSE_WONDER` | `wonder`、`side`（`"A"` / `"B"`） | `wonders` 阶段轮到自己 |
| `DISCARD_BUILD` | `card`（弃牌堆里的 id；`null` = 放弃） | `discardBuild` 阶段本人 |

全员交齐的那一下立刻亮牌结算；不合法的命令 `apply` 抛错（错误信息是给玩家看的中文）。

### 函数

```ts
// 付款方案：建某张卡或建奇迹下一阶段，列出所有合法的付款方案（默认方案排第一、isDefault，其余按总价升序）。
// 不能付时 options 为空、reason 说明原因（同名建过 / 资源凑不齐 / 钱不够 / 奇迹建满）。
paymentOptions(state, playerId, { card: CardId } | { stage: true }): PaymentInfo
//   PaymentOption = { kind: "own" | "trade" | "chain" | "olympia", left, right, leftCost, rightCost, bankCost, total, isDefault }
playOptions(state, playerId): CardPlayOptions[]          // 手里每张牌三种用法各自的 PaymentInfo（界面的出牌面板）
legalActions(state, playerId): GameCommand[]             // 现在能发的所有命令（每种付款方案都展开，不含 UNDO）
pendingActors(state): string[]                           // 在等谁：出牌阶段 = 还没交的人；插入选择 / 挑奇迹 = 那一个人
discardBuildOptions(state, playerId): CardId[]           // 哈利卡纳苏斯能从弃牌堆建的牌
apply(state, playerId, command, rng?): { state, events } // 纯函数，不改输入；rng 不给就用状态里存的（教程可以传按剧本出数的 rng）
createGame(players, seed?, options?, setup?): GameState  // setup 可指定每人奇迹和面、预先排好各时代手牌
autoCommand(state, playerId): GameCommand | null         // 保底动作（超时兜底）
applyTimeout(state, playerId, command?, timedOut?)       // 服务器替人出（人机给的命令，不合法就用保底动作）
redactGameForViewer(state, viewerId, { seeAll? }?)       // 发给某个座位的视角；观战 viewerId = ""；seeAll = 观战看全部
scoreBreakdown(state, playerId): ScoreBreakdown          // 现在的分数明细（局中也能算，全是公开信息）
finalScores(state): FinalResult                          // 所有人的分数、名次、赢家
scienceScore({ compass, gear, tablet }, wild): { score, best }   // 科技分，任选符号枚举最优
productionSummary(player) / shieldsOf(player) / scienceCounts(player) / hasDiscount(player, side, res)  // 城池推导
card(id) / wonder(key) / wonderStages(key, side) / CARDS / WONDERS / findCard(nameOrId)
botCommand(view, playerId): GameCommand | null           // 人机（输入必须是 redact 后的视角）
```

### 预览局面工厂（`scenes.ts`）

```ts
buildScene(spec: SceneSpec): GameState     // 按参数造任意精确局面，完整服务端状态，可以直接 apply
playTo({ players, age, round, seed }): GameState    // 真实对局（保底动作）打到某时代某轮的出牌阶段
scene(name: SceneName, opts?): GameState   // 常见局面，名字和说明见 SCENES
previewRoom(game, { viewer?, spectating?, offline?, auto?, bots?, turnRemainingMs?, timedOut? }): LobbyRoomSnapshot
                                           // 包成房间快照（已 redact），预览页直接渲染整张牌桌：离线、托管、人机、倒计时、超时
```

`SceneSpec`：`players`（3–7 位，按座位；每位 `{ wonder, side?, stages?, stageCards?, built?, coins?, tokens?, hand?, freeBuildUsed?, play? }`）、`age?`、`round?`、`phase?`（`play` / `seventh` / `discardBuild` / `finished`）、`pending?`、`discardBuildDue?`、`discard?`、`options?`、`seed?`、`stacked?`（后面时代预先排好的手牌）、`events?`。牌可以写 id、英文名或中文名，同名多张用 `名字@时代`（`"Loom@2"`）；出牌阶段没写手牌就自动从这个时代的牌里发（张数 = 8 − 轮数）。座位 id 默认 `p1…p7`，座位 0 叫「我」。

`scene` 的名字：`start`（开局）、`chooseWonders`（自选奇迹轮到第三位）、`midgame`（任意人数 / 时代 / 轮，真实对局）、`allActions`（出牌前：手里有自己能建、免费链、要向两边买、建不了但能垫奇迹、同名建过的牌）、`submitted`（我交了、还有人没交）、`lastRound`（第 6 轮）、`chain`、`tradeBoth`（`discount: true` 有折扣）、`wonderStage`（`wonder` / `side` / `stage`）、`babylonSeventh`、`halicarnassus`、`olympiaFree`、`militaryDone`、`final`（七项都有分）、`finalTie`（并列）、`fullCities`（7 人奇迹建满、城里 15 张以上，`side: "A" | "B"`）。离线、托管、超时用 `previewRoom` 的参数造。

例：

```ts
import { buildScene, previewRoom, scene } from "@wonders/game";
const game = buildScene({
  age: 2, round: 1,
  players: [
    { wonder: "giza", built: ["Scriptorium"], hand: ["Library", "Walls", "School", "Sawmill", "Temple", "Statue", "Bazar"] },
    { wonder: "rhodes" }, { wonder: "babylon", side: "B" },
  ],
});
const room = previewRoom(scene("fullCities", { side: "B" }), { offline: ["p3"], turnRemainingMs: 8000 });
```

## 规则说明（自己的话）

**目标**：三个时代打完，总分最高的人赢。分数七项：军事、金币、奇迹、文明（蓝）、科技（绿）、商业（黄）、行会（紫）。

**开局**：每人一块奇迹板（起始资源每轮都能用）、3 金。每个时代每人发 7 张。

**每一轮**：所有人同时从手里挑一张，决定怎么用：
1. **建造**这张卡：付卡上的成本。资源不会用掉，每轮都能用；缺的资源只能跟左右两个邻居买，每份 2 金（有折扣 1 金），钱给邻居，邻居不能拒绝。同名的卡一个城里只能有一张。建过卡上写的前一时代的建筑就**免费链**。
2. 把它**垫到奇迹下面**，建奇迹的下一层：付奇迹板上那一层的成本（不是这张卡的），这张卡没有别的作用、别人看不到。
3. **弃掉**换 3 金。

所有人都交了就一起亮牌、结算。然后把剩下的手牌交给邻居：Age I、III 交给左边，Age II 交给右边。第 6 轮手里只剩 2 张：打一张，另一张作废（不给钱）。

**买资源的细节**：只能买邻居的起始资源和棕、灰卡产的（黄卡、奇迹阶段产的不卖）；买东西的钱必须是这一轮开始时就有的（这一轮卖资源、弃牌拿的钱下一轮才能用）；邻居这一轮刚建的卡这一轮还买不到；贸易站的折扣从下一轮起才算；二选一的卡，买的人自己挑买哪种。

**时代结束**：和左右邻居分别比盾牌，多的拿胜利标记（Age I +1、Age II +3、Age III +5），少的拿 −1，一样多都不拿。

**终局计分**：军事标记相加；金币每 3 枚 1 分；奇迹各层的分；蓝卡的分；科技 = 每种符号张数的平方相加 + 每凑齐一套三种 7 分；商业（Age III 黄卡按自己城里的卡数）；行会（多数按左右邻居城里的卡数）。总分一样比金币，金币也一样就并列。

## 默认规则表（规则书没写死、这里这样处理的地方）

| # | 问题 | 处理 |
|---|---|---|
| 1 | 勘误 | 补充文件 E1–E17 全部按官方第一版（他拍板「全部按官方第一版更正」）：灰卡在 Age I / II、Age I 六张二选一原料卡都要 1 金、神庙 3 分、马厩 2 盾、补上攻城工坊、罗德岛 A 2 木 / 3 砖 / 4 矿、亚历山大 B3 3 石、奥林匹亚 A3 2 矿、奥林匹亚 B2 2 石、科技 3/2/1 + 1 任选 = 31 |
| 2 | 奇迹怎么分（U1，他拍板） | 默认随机分奇迹、全员 A 面；开房选项「随机 A/B 面」（每人随机一面）、「自选奇迹」 |
| 3 | 自选奇迹的流程 | 开局前从随机一位开始，按座位往左邻方向轮流挑（每人 30 秒），挑奇迹也挑面（A/B 随意）；超时由人机替他挑（现在是随机一块剩下的，开了随机 A/B 时面也随机）。挑完再发 Age I 的牌 |
| 4 | 出牌提交（U2，他拍板） | 一次提交「牌 + 用法 + 买资源方案」；全员交齐前可以撤回（`UNDO`），交了要改先撤回；全员交齐立刻结算 |
| 5 | 第 6 轮的先后（U3） | ① 所有人同时结算第 6 张（葡萄园 / 集市算邻居同轮建的卡）→ ② 巴比伦 B 打第 7 张（单独一步，其他人等）→ ③ 其余人的第 7 张作废进弃牌堆 → ④ 哈利卡纳苏斯（本轮建成能力阶段的话）从弃牌堆挑一张免费建 → ⑤ 军事结算 |
| 6 | 巴比伦第 7 张的金币和资源（U4） | 用第 6 轮结算完以后的状态：手里所有的金币（含第 6 轮收入）、邻居第 6 轮刚建的卡也能买、第 6 轮刚建的贸易站折扣也算 |
| 7 | 奥林匹亚 A 的免费建造（U5） | 每时代一次，只能建手里的建筑（不能建奇迹阶段），第 6 轮也能用，用不掉不累积；能免费链的牌一律走链、不扣次数（`olympia: true` 发给能链的牌会被拒绝）。付款方案里它是 `kind: "olympia"`，只在没有别的方案时才是默认 |
| 8 | 葡萄园 / 集市算不算插入步骤建的卡（U6） | 第 ① 步建的葡萄园 / 集市算所有人第 ① 步建的卡；之后巴比伦第 7 张、哈利卡纳苏斯建出来的不追加。反过来，第 7 张本身是葡萄园时按那一刻的数量算 |
| 9 | 哈利卡纳苏斯没有能建的（U7） | 弃牌堆空或者全是同名建过的 → 这次能力作废，不补偿；玩家也可以主动放弃（`DISCARD_BUILD card: null`） |
| 10 | 哈利卡纳苏斯第 1–5 轮 | 在这一轮结算完、传牌之前挑（可选本轮刚弃的牌），这时其他人等他 |
| 11 | 两邻都卖同一种资源（U10） | 默认方案自动选最便宜的；一样便宜时少付左邻、多向右邻买；界面可以换成别的方案（`trade`） |
| 12 | 弃牌堆谁能看（U12） | 牌面不公开，只公开张数；哈利卡纳苏斯挑牌那一步只发给他本人 |
| 13 | 免费链的条件 | 城里有链来源那张建筑（英文名）就行，不管是哪个时代建的（比如哈利卡纳苏斯在 Age II 从弃牌堆建的 Age I 写字间，也能链 Age II 的图书馆） |
| 14 | 科技任选符号、奥林匹亚复制行会 | 终局（和局中显示分数时）自动取最优：任选符号枚举所有分法；奥林匹亚 B3 在两邻已建的行会里挑让总分最高的那张（一样高取左邻、靠前的），按「自己是这张行会的主人」算；复制科学家行会 = 多 1 个任选符号 |
| 15 | 奥林匹亚复制的船主行会 | 复制来的行会不算奥林匹亚城里的一张紫卡（船主「数自己的紫卡」时不数它）。规则书没写，按「复制的是效果、不是卡」处理 |
| 16 | 买资源不能多买 | 付款方案只列「刚好够」的买法（多买一份永远更贵）；`trade` 发了多买的方案会被拒绝 |
| 17 | 2 人变体（U11） | 不做，只做 3–7 人；人不够用人机补 |

## 服务器的限制（防止被一个客户端打挂）

- 每条 socket 消息最大 32 KB（超过直接断开这条连接）；游戏命令按白名单重建（`normalizeCommand`），多余字段丢掉，动作序列只记重建后的。
- 按连接限频：游戏命令每秒 15 条（最多攒 30），其余事件每秒 30 条（最多攒 60），超了回「操作太快了」。
- 所有事件不管带不带回调、参数怎么乱填，处理函数出错都只记日志，不会让进程退出（不带回调发 `lobby:get` 曾经能把进程打挂）。
- 「观战看手牌」只能在等候房间改，对局开始后改会被拒。
- 昵称去掉零宽字符、方向控制符和空白填充字符，至少 2 个看得见的字；「咕噜」开头和带「人机」的昵称留给人机。

## 超时规则

全站约定覆盖规则书 §8.4 的写法：**超时由人机替他出**（不是一律弃牌换钱）。

| 步骤 | 时限 | 超时 |
|---|---|---|
| 每轮出牌 | 60 秒（这一轮所有人共用一个倒计时；别人交牌、撤回不重置） | 还没交的真人由人机替他出 |
| 巴比伦第 7 张、哈利卡纳苏斯挑弃牌 | 20 秒（只有他一个人有倒计时） | 人机替他出 / 挑 |
| 自选奇迹 | 每人 30 秒 | 人机替他挑 |

- 人机策略还没换成正式版时，替人出牌用保底动作：能建就建总价最低的那张（同价取手里靠前的，奥林匹亚免费排最后），都建不了就弃第一张换 3 金；哈利卡纳苏斯挑分数最高的蓝卡，没有就挑第一张能建的。
- 连续超时 2 次转托管（人机替他打，直到他自己动一下或点「取消托管」）；掉线的人先等 3 秒，再由人机代打（不算超时）；用原昵称加房间码回到自己的座位。
- 测试时 `TURN_MS` 统一缩短所有时限，`BOT_DELAY_SCALE=0` 让人机立刻行动。

## 界面（apps/web）

- 牌桌 `src/GameBoard.tsx`，尺寸 `src/layout.ts`（按可视区域算：手牌 ×2 / ×3、邻居面板宽、奇迹板 ×1 / ×2、出牌面板放手牌右边还是中栏），样式 `src/wd.css`（白天版由 `day-palette.ts` 生成，手调在 `src/theme-day.css`）。
- 座位圆环：我在下方，左邻画在屏幕左边、右邻在右边，其他人在上排（从左到右 = 左邻的左邻 … 右邻的右邻）；顶栏箭头标本时代传牌方向。
- 组件：`Card.tsx`（卡面 64×96 ×N、列表项、城池卡名条）、`Wonder.tsx`（奇迹板）、`Players.tsx`（邻居面板、其他人小卡、手机版）、`ActionPanel.tsx`（出牌面板：建造 / 建奇迹 / 弃掉 + 付款方案 + 撤回）、`Dialogs.tsx`（完整城池、自选奇迹、哈利卡纳苏斯挑弃牌）、`FinalDialog.tsx`（七项分数 + 明细）、`Fx.tsx`（帧条、传牌、军事横幅）、`art.ts`（素材地址，和 art/spec.md 同名）、`text.ts`（效果说明、事件记录）。
- 卡面上行会去掉「行会」二字（紫色本身说明是行会），详情和终局写全名。
- 键盘：1–7 选牌，B 建造、W 建奇迹、D 弃掉，U 撤回，Esc 取消。
- **预览页**：`npm run dev` 后打开 `http://localhost:5189/preview.html`（列出全部场景），`?s=<场景>&viewer=p2&anim=1&click=<选择器>|<选择器>`。不连服务器，规则引擎在浏览器里跑，渲染真正的 GameBoard，牌桌上的操作直接本地 apply。场景在 `src/preview.tsx` 的 `SCENES`，教程、验收可以往里加，不要删别人的。生产构建只打包 index.html。
- 教程锚点 `data-tutorial`：见 `~/projects/pipeline/games/wonders/handoff/ui.md`。
