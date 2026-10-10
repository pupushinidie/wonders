/**
 * 真实对局里「第一次遇到」的小贴士（全站共用，随 tutorial/ 文件夹一起复制）。
 * 每条只出一次（记在本机），12 秒后自己收起；同一步撞上几条就合成一条出，只在发生的那一步出、不排队；「不再显示小贴士」全站生效。
 */
import { useEffect, useRef, useState } from "react";
import type { Tip } from "./Coach.js";
import { markTipSeen, seenTips, setTipsOff, tipsOff } from "./storage.js";

export function useFirstTimeTips(
  game: string,
  /** 局面版本号：每走一步加一，只在它变化时检查。 */
  version: number,
  /** 这一步该出哪些小贴士（按优先顺序），没看过的合成一条出。 */
  detect: () => readonly string[],
  tips: Readonly<Record<string, { readonly title: string; readonly text: string }>>,
  enabled: boolean,
) {
  const [tip, setTip] = useState<Tip | null>(null);
  // 刚进房间时的局面里是之前发生的事，不算「第一次遇到」
  const firstVersion = useRef(version);

  // 只在发生的那一步出（不排队：人机房一轮只有几秒，排队会让「往右传了」拖到别的时代才出，内容就错了）。
  // 同一步撞上几条（七大奇迹：时代结束的军事和「往右传了」）合成一条一起出；新的一步有新贴士就换掉旧的。
  useEffect(() => {
    if (!enabled || version === firstVersion.current || tipsOff()) return;
    const seen = seenTips(game);
    // 最多合两条（太长读不完）；没出的那条不记「看过」，下次再遇到还会出
    const fresh = [...new Set(detect())].filter((candidate) => tips[candidate] && !seen.has(candidate)).slice(0, 2);
    if (fresh.length === 0) return;
    for (const id of fresh) markTipSeen(game, id);
    setTip({
      id: `${version}:${fresh.join("+")}`,
      title: fresh.map((id) => tips[id]!.title).join(" · "),
      text: fresh.map((id) => tips[id]!.text).join(" "),
    });
  }, [version, enabled]);

  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [tip?.id]);

  return {
    tip,
    dismiss: () => setTip(null),
    never: () => {
      setTipsOff(true);
      setTip(null);
    },
  };
}
