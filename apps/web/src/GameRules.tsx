import { useEffect, useState } from "react";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className={`${className} kd-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel kd-rules" role="dialog" aria-modal="true" aria-labelledby="kd-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="kd-rules-title">多米诺王国怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>
                每人从一座城堡起步，把挑来的骨牌（一张占两格）拼进自己的王国，最后拼成 <b>5×5</b> 的方块（2 人「强力对决」是 7×7）。
                每一片连在一起的同种地形，得分 = <b>格数 × 这片里的皇冠数</b>，没有皇冠的地方不得分。总分最高的人获胜。
              </p>
            </div>
            <div className="game-rules-block">
              <h3>一轮怎么走</h3>
              <ol>
                <li>场上有两排骨牌：<b>本轮</b>这一排上站着国王，<b>下一轮</b>这一排等着被挑。每排按编号从小到大摆。</li>
                <li>本轮这一排里，<b>编号最小</b>那张上的国王先行动：先把脚下的骨牌<b>放进自己的王国</b>，再到下一轮那一排<b>挑一张</b>还没人挑的骨牌。</li>
                <li>编号越大的骨牌通常越值钱（皇冠多），但挑了它，下一轮你就排得越靠后。</li>
                <li>开局先翻一排让大家挑，不放。2 人局每人有 2 个国王，顺序是 A 挑 1 张 → B 挑 2 张 → A 拿剩下那张；3–4 人局顺序随机。</li>
                <li>3 人局每排没人挑的那一张直接弃掉。牌堆用完后的最后一轮只放不挑。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>怎么放</h3>
              <ul>
                <li>两格都要放在空格上，可以随意转方向。</li>
                <li>至少有一格要上下或左右挨着<b>城堡</b>（城堡和什么地形都能接）或者<b>同一种地形</b>，斜着挨不算。另一格挨着什么都行。</li>
                <li>整个王国（连城堡）不能超出 5×5。城堡不一定在正中间。</li>
                <li>只要有地方能放就必须放；哪里都放不下，这张就弃掉，王国里会留空。</li>
                <li><b>提前放</b>：还没轮到你时就可以先把这张骨牌放好（可以改），轮到你时自动生效，直接去挑下一张。别人看不到你放在哪。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>计分和平局</h3>
              <ul>
                <li>每片区域单独算，城堡不属于任何区域，也不把两边连起来。</li>
                <li>开房可选：<b>中央王国</b>（城堡在王国正中心 +10；没拼满也算，只要所有格子都在城堡上下左右 2 格以内）、<b>和谐</b>（拼满而且整局没弃过骨牌 +5）。</li>
                <li>同分时比<b>最大的一片区域</b>有几格（有没有皇冠都算），再比<b>皇冠总数</b>，还一样就并列获胜。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>时间和托管</h3>
              <p>
                挑牌 45 秒、放骨牌 90 秒。超时自动替你走：挑编号最小的空位，放在放下后分数最高的位置。
                连续超时 2 次转托管（人机替你下），掉线时也由人机代下，回来就交还给你。
              </p>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
