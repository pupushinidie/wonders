/**
 * 七大奇迹的新手教程：在浏览器里按剧本（./script.ts）走一局，牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；
 * 剧本走完接着把这局打完（练习局），对手交给人机。不连服务器，不占房间；
 * 首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  botCommand,
  CARDS,
  previewRoom,
  redactGameForViewer,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
} from "@wonders/game";
import GameBoard from "../GameBoard.js";
import type { Theme } from "../theme.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import {
  anchorCandidates,
  applyMove,
  createPracticeGame,
  createShowcaseGame,
  createTutorialGame,
  sameMove,
  selfCanAct,
  TUTORIAL_BOTS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type TutorialMove,
  type TutorialStep,
} from "./script.js";
import { writeTutorial } from "./storage.js";
import { GAME_ID } from "./tutorialGame.js";
import { useTutorial } from "./useTutorial.js";

/** 教程里自己在 room.members 里的 id（previewRoom 按座位起的名字）。 */
const SELF_MEMBER = `socket-${TUTORIAL_SELF}`;
/** 房间码只用来按哈希挑背景图。 */
const TUTORIAL_CODE = "GULU01";

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 每一课（带 lesson 的步骤）从第几步开始。 */
const LESSONS = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);

function zhOf(name: string): string {
  return CARDS.find((entry) => entry.name === name)?.zh ?? name;
}

function visible(anchor: string): boolean {
  const element = document.querySelector(`[data-tutorial="${anchor}"]`);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 这一步实际高亮哪个锚点（看页面上有什么）：
 * - 指一张手牌（card）：找卡名对得上的那张 hand-card-N；do 步骤里选中这张以后，改成对应用法那一行（act-build / act-wonder / act-discard）；
 * - 锚点写成数组：按顺序挑页面上有的第一个（1024 和手机上没有 my-info 之类）。
 * 换了一步、还没找到之前返回 undefined（这时不画对话框，免得在旧位置闪一下）。
 */
function useStepAnchor(step: TutorialStep | undefined, gameVersion: number): string | null | undefined {
  const [found, setFound] = useState<{ id: string; anchor: string | null } | null>(null);
  useEffect(() => {
    if (!step) return;
    const candidates = anchorCandidates(step);
    if (!step.card && candidates.length === 0) {
      setFound({ id: step.id, anchor: null });
      return;
    }
    const resolve = () => {
      let next: string | null = null;
      if (step.card) {
        const zh = zhOf(step.card);
        if (step.kind === "do" && step.expect.command.type === "PLAY") {
          const row = `act-${step.expect.command.action}`;
          const prompt = document.querySelector('[data-tutorial="prompt"]');
          if (prompt?.textContent === zh && visible(row)) next = row;
        }
        if (!next) {
          const cardElement = [...document.querySelectorAll<HTMLElement>('[data-tutorial^="hand-card-"]')].find((element) => element.title.startsWith(`${zh}：`));
          next = cardElement?.dataset.tutorial ?? `hand-card-?`;
        }
      } else {
        next = candidates.find(visible) ?? candidates[0]!;
      }
      setFound((old) => (old && old.id === step.id && old.anchor === next ? old : { id: step.id, anchor: next }));
    };
    resolve();
    const timer = window.setInterval(resolve, 150);
    return () => window.clearInterval(timer);
  }, [step?.id, gameVersion]);
  if (!step) return null;
  return found && found.id === step.id ? found.anchor : undefined;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: Theme;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  const seed = useRef(randomSeed());

  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName, seed.current),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, _playerId, move) => applyMove(state, move),
    same: sameMove,
    actor: tutorialActor,
    canAct: selfCanAct,
    bot: (state, playerId) => {
      const command = botCommand(redactGameForViewer(state, playerId), playerId);
      return command ? { player: playerId, command } : null;
    },
    // 人机一个接一个交牌，留点时间让人看见邻居头上打勾
    botDelay: (state) => (state.phase === "play" ? 650 : 1200),
    watchDelay: () => 900,
  });
  const { game, step, index, practice, flash } = tutorial;
  const showcase = useMemo(() => createShowcaseGame(selfName), [selfName]);
  const shown = step?.showcase ? showcase : game;
  const anchor = useStepAnchor(step, shown.version);

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const room = useMemo<LobbyRoomSnapshot>(() => {
    const base = previewRoom(shown, { viewer: TUTORIAL_SELF, bots: [...TUTORIAL_BOTS] });
    return { ...base, code: TUTORIAL_CODE, members: base.members.map((member) => ({ ...member, isHost: false })) };
  }, [shown]);

  let view: CoachView | null = null;
  if (step && anchor !== undefined) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const lessonNow = Math.max(0, LESSONS.filter(({ at }) => at <= index).length - 1);
    view = {
      key: step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={lessonNow} total={LESSONS.length} />
          {!finale && <button className="tut-link" type="button" data-tutorial="skip" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" data-tutorial="practice" onClick={tutorial.startPractice}>和人机打完这局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" data-tutorial="next" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onCommand = (command: GameCommand) => tutorial.onCommand({ player: TUTORIAL_SELF, command });

  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        key={step?.showcase ? "showcase" : "table"}
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online wd-tut-tag"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" data-tutorial="exit" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        {...(practice ? {
          finalActions: (
            <>
              <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
              <button className="primary-button" type="button" data-tutorial="again" onClick={tutorial.newPractice}>再练一局</button>
            </>
          ),
        } : {})}
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 记录·聊天抽屉里「聊天」那一页：教程里没有聊天，放这次学哪几样。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const done = LESSONS.filter(({ at }) => at < index).length;
  return (
    <section className="tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点出牌面板上的「提示」（键盘 H），我告诉你我会怎么出。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{LESSONS.length}</small></h3>
          <ul>
            {LESSONS.map(({ step, at }) => {
              const state = at < index ? "done" : at === index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
