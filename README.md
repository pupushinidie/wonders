# 七大奇迹

3–7 人同时轮抽、建城池和奇迹的桌游，网页联机版。规则按 `~/Desktop/游戏规则/七大奇迹.md` 和补充勘误 `七大奇迹-补充.md`（以补充为准，按官方第一版）实现；美术和规则说明文字都是自己的。

> 正在搭建：仓库从 kingdomino@89bebe4 复制，引擎、服务器、网页还在替换中。

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3016，网页 :5189（WEB_PORT / SERVER_PORT 可改）
npm test
npm run typecheck
BASE_PATH=/wonders/ npm run build
```
