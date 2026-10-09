import { useEffect, useState } from "react";

/** 顶栏「规则」按钮：用自己的话讲七大奇迹怎么玩（界面阶段会重新排版）。 */
export default function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <button className={`${className} wd-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" onClick={() => setOpen(false)}>
          <section className="gm-panel wd-rules" role="dialog" aria-modal="true" aria-labelledby="wd-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="wd-rules-title">七大奇迹怎么玩</h2>
            <p>三个时代打完，七项分数（军事、金币、奇迹、文明、科技、商业、行会）加起来最高的城赢。每人开局 3 金、一块奇迹板。</p>
            <ul>
              <li>每个时代每人 7 张牌、打 6 轮。每轮<b>所有人同时</b>挑一张：<b>建造</b>它、把它<b>垫到奇迹下</b>建一层（付奇迹板上的成本），或者<b>弃掉换 3 金</b>。都交了一起亮牌。</li>
              <li>资源不会用掉。缺的只能向<b>左右邻居</b>买，每份 2 金（有贸易站、市场 1 金）；这一轮赚的钱下一轮才能花，邻居这一轮刚建的也要下一轮才买得到。</li>
              <li>同名的建筑只能有一张。建过卡上写的前一时代建筑，这张就<b>免费链</b>出来。</li>
              <li>打完把剩下的牌传给邻居：Age I、III 传左边，Age II 传右边。第 6 轮剩下的那张作废，不给钱。</li>
              <li>每个时代结束和左右邻居比盾牌：多的拿 +1 / +3 / +5，少的拿 −1。</li>
              <li>科技：每种符号张数的平方相加，每凑齐三种各一张再加 7 分。金币每 3 枚 1 分。平分比金币，再平就并列。</li>
            </ul>
            <p>每轮 60 秒，超时由人机替你出；连续超时 2 次转托管，掉线时人机代打，用原昵称回来能接上。</p>
            <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
          </section>
        </div>
      )}
    </>
  );
}
