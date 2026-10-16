import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";
import { gmPreload } from "./gm-preload-plugin";

// 端口从环境变量读，默认是分配给七大奇迹的 5189 / 3016；另起一套服务（人机、界面用特殊环境变量测）时改 WEB_PORT / SERVER_PORT 就不会撞。
const webPort = Number(process.env.WEB_PORT ?? 5189);
const serverTarget = `http://localhost:${Number(process.env.SERVER_PORT ?? 3016)}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/wonders/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette), gmPreload()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: serverTarget, ws: true },
      "/health": serverTarget
    }
  }
});
