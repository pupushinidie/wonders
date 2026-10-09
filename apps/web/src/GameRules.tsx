import { useEffect, useState } from "react";
import { findCard } from "@wonders/game";
import { art } from "./art.js";
import { CardFace, Icon } from "./Card.js";
import { SCORE_ITEMS } from "./Dialogs.js";
import { WonderBoard } from "./Wonder.js";

/** 顶栏「规则」按钮：用自己的话讲七大奇迹怎么玩，配上牌桌上的图。 */
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
      <button className={`${className} wd-rules-button`} type="button" data-tutorial="rules" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" onClick={() => setOpen(false)}>
          <section className="gm-panel wd-rules" role="dialog" aria-modal="true" aria-labelledby="wd-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="wd-rules-title">七大奇迹怎么玩</h2>
            <div className="wd-rules-grid">
              <section>
                <h3>目标</h3>
                <p>三个时代打完，七项分数加起来最高的城赢。平分比金币，再平就并列。</p>
                <div className="wd-rules-pics">
                  {SCORE_ITEMS.map((item) => <span key={item.key} title={item.label}><Icon name={item.icon} s={2} /></span>)}
                </div>
              </section>
              <section>
                <h3>每轮：大家同时出一张</h3>
                <p>每个时代每人 7 张牌、打 6 轮。每轮所有人<b>同时</b>挑一张，三选一：</p>
                <ul>
                  <li><Icon name="act-build" s={1} /> <b>建造</b>：付卡上左上角的成本，空的就免费。</li>
                  <li><Icon name="act-wonder" s={1} /> <b>建奇迹</b>：把牌垫到奇迹下面，付奇迹板上下一层的成本。</li>
                  <li><Icon name="act-sell" s={1} /> <b>弃掉</b>：换 3 金。</li>
                </ul>
                <p>都交了一起亮牌。交了还能撤回，直到最后一个人交。</p>
              </section>
              <section>
                <h3>卡长这样</h3>
                <div className="wd-rules-pics">
                  <CardFace id={findCard("Temple")} n={2} />
                  <p>上面色带：卡的种类和成本（小方块，一块一份资源）。<br />中间：插画。<br />下面：名字和效果（神庙 = 3 分）。<br />色带右边的链子：建过它的前身就<b>免费</b>。同名的建筑只能有一张。</p>
                </div>
              </section>
              <section>
                <h3>资源：只跟左右邻居买</h3>
                <p>自己产的资源每轮都能用，<b>不会用掉</b>。缺的向<b>左右两个邻居</b>买，每份 2 金（有贸易站、市场的 1 金），钱给邻居，对方不能拒绝。</p>
                <p>这一轮赚的钱下一轮才能花；邻居这一轮刚建的，也要下一轮才买得到。</p>
              </section>
              <section>
                <h3>传牌：方向每个时代换</h3>
                <p>打完把剩下的牌传给邻居：时代 I、III 传<b>左</b>，时代 II 传<b>右</b>（顶栏的箭头）。第 6 轮剩下那张作废，不给钱。</p>
              </section>
              <section>
                <h3>奇迹</h3>
                <WonderBoard wonder="giza" side="A" stages={1} n={1} />
                <p>从左到右一层层建，每层付板上的成本；垫下去的牌没有效果，别人也看不到。左上角是开局就有的资源。</p>
              </section>
              <section>
                <h3>军事：时代结束跟两个邻居比盾</h3>
                <div className="wd-rules-pics">
                  {[1, 3, 5, -1].map((value) => <img key={value} src={art.token(value)} alt={String(value)} width={32} height={32} />)}
                </div>
                <p>盾比邻居多拿胜利标记（时代 I +1、II +3、III +5），少拿 −1，一样多不拿。</p>
              </section>
              <section>
                <h3>科技、行会</h3>
                <p><Icon name="sci-compass" s={1} /><Icon name="sci-gear" s={1} /><Icon name="sci-tablet" s={1} /> 每种符号张数的平方相加，三种各凑齐一张再加 7 分。时代 III 的紫卡（行会）多半按邻居城里的卡计分。金币每 3 枚 1 分。</p>
              </section>
              <section>
                <h3>本站</h3>
                <p>每轮 60 秒（巴比伦第 7 张、哈利卡纳苏斯挑弃牌 20 秒），超时由人机替你出；连续超时 2 次转托管，掉线时人机代打，用原昵称回来能接上。键盘：1–7 选牌，B 建造、W 建奇迹、D 弃掉、U 撤回。</p>
              </section>
            </div>
            <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
          </section>
        </div>
      )}
    </>
  );
}
