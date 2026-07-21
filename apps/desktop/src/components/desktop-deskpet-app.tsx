import { Square } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DesktopDeskpetMood,
  DesktopDeskpetSize,
  RuntimeEvent,
  RuntimeState,
  RuntimeUnitPhase,
} from "../../shared/host";
import bellyRubAssetUrl from "../assets/deskpet/belly-rub.webp";
import connectionAssetUrl from "../assets/deskpet/connection.webp";
import errorAssetUrl from "../assets/deskpet/error.webp";
import idleAssetUrl from "../assets/deskpet/idle.webp";
import lobsterReplyingAssetUrl from "../assets/deskpet/lobster-replying.webp";
import peekAssetUrl from "../assets/deskpet/peek.webp";
import restAssetUrl from "../assets/deskpet/rest.webp";
import successAssetUrl from "../assets/deskpet/success.webp";
import teaseLobsterAssetUrl from "../assets/deskpet/tease-lobster.webp";
import workingAssetUrl from "../assets/deskpet/working.webp";
import yawnAssetUrl from "../assets/deskpet/yawn.webp";
import {
  getRuntimeState,
  moveDeskpetWindow,
  onDesktopCommand,
  onRuntimeEvent,
  openDeskpetCurrentChat,
  pauseDeskpetCurrentReply,
  replyDeskpetCurrentChat,
  setDeskpetMouseEvents,
} from "../lib/host-api";
import { applyRuntimeEvent } from "../lib/runtime-state";

const DESKPET_ASSETS: Record<DesktopDeskpetMood, string> = {
  "belly-rub": bellyRubAssetUrl,
  connection: connectionAssetUrl,
  error: errorAssetUrl,
  idle: idleAssetUrl,
  "lobster-replying": lobsterReplyingAssetUrl,
  peek: peekAssetUrl,
  rest: restAssetUrl,
  success: successAssetUrl,
  "tease-lobster": teaseLobsterAssetUrl,
  working: workingAssetUrl,
  yawn: yawnAssetUrl,
};

const DESKPET_LABELS: Record<DesktopDeskpetMood, string> = {
  "belly-rub": "摸肚皮",
  connection: "连接中",
  error: "异常提醒",
  idle: "待命",
  "lobster-replying": "回复中",
  peek: "偷看",
  rest: "休息",
  success: "完成",
  "tease-lobster": "互动",
  working: "工作中",
  yawn: "打哈欠",
};

const SIZE_SCALE: Record<DesktopDeskpetSize, number> = {
  small: 0.72,
  medium: 0.8,
  large: 0.86,
};

const MOOD_SCALE: Partial<Record<DesktopDeskpetMood, number>> = {
  "belly-rub": 0.78,
  "lobster-replying": 4 / 9,
  yawn: 0.68,
};

const MOOD_OFFSET_Y: Partial<Record<DesktopDeskpetMood, number>> = {
  "belly-rub": 22,
};

const PET_MOVE_START_DISTANCE = 10;
const PET_TEASE_TOTAL_DISTANCE = 58;
const PET_TEASE_MAX_DISPLACEMENT = 22;
const PET_TEASE_DIRECTION_RATIO = 2.8;
const IDLE_REST_DELAY_MS = 10_000;
const IDLE_PEEK_DELAY_MS = 30_000;
const PEEK_RETURN_REST_DELAY_MS = 5000;
const PET_TEASE_CLICK_INTERVAL_MS = 280;
const PET_TEASE_HINT_MESSAGE = "双击可以逗一逗";
const DESKPET_REPLY_PAGE_INTERVAL_MS = 2600;
const DESKPET_REPLY_LINE_CHAR_LIMIT = 24;
const DESKPET_REPLY_MAX_CHARS = 420;
const DESKPET_HIT_AREA_SELECTOR = "[data-deskpet-hit-area]";
const DESKPET_PET_HIT_AREA_SELECTOR = "[data-deskpet-pet-hit-area]";

const DESKPET_DIALOGUE_MOODS = new Set<DesktopDeskpetMood>([
  "error",
  "lobster-replying",
  "success",
  "working",
]);

type PetGestureMode = "pending" | "move" | "tease";
type ReplyBubblePlacement = "near-top";

type PetGesture = {
  lastScreenX: number;
  lastScreenY: number;
  mode: PetGestureMode;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  totalDistance: number;
};

function ReturnConversationIcon({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={0.1}
      viewBox="0 0 1024 1024"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M512 898.844444c-51.2 0-96.711111-11.377778-142.222222-28.444444-5.688889 0-5.688889-5.688889-11.377778-5.688889h-5.688889l-136.533333 22.755556c-17.066667 5.688889-34.133333 5.688889-51.2 0-17.066667-5.688889-28.444444-17.066667-34.133334-34.133334-5.688889-17.066667-5.688889-28.444444 0-51.2l22.755556-142.222222v-5.688889c-17.066667-45.511111-22.755556-91.022222-22.755556-142.222222 0-210.488889 170.666667-386.844444 386.844445-386.844444 210.488889 0 386.844444 170.666667 386.844444 386.844444-5.688889 210.488889-182.044444 386.844444-392.533333 386.844444z m-153.6-119.466666h17.066667c5.688889 0 11.377778 5.688889 22.755555 5.688889 34.133333 17.066667 73.955556 22.755556 113.777778 22.755555 164.977778 0 301.511111-136.533333 301.511111-301.511111S676.977778 204.8 512 204.8C347.022222 216.177778 216.177778 347.022222 216.177778 512c0 39.822222 5.688889 73.955556 22.755555 113.777778 5.688889 11.377778 5.688889 17.066667 5.688889 22.755555v39.822223L227.555556 807.822222l113.777777-28.444444h17.066667z" />
    </svg>
  );
}

function getRandomReplyBubblePlacement(): ReplyBubblePlacement {
  return "near-top";
}

function runtimeHasPhase(
  runtimeState: RuntimeState,
  phases: RuntimeUnitPhase[],
): boolean {
  return runtimeState.units.some((unit) => phases.includes(unit.phase));
}

function resolveMoodFromRuntime(
  runtimeState: RuntimeState | null,
): DesktopDeskpetMood {
  if (!runtimeState) {
    return "peek";
  }

  if (runtimeHasPhase(runtimeState, ["failed"])) {
    return "error";
  }

  if (runtimeHasPhase(runtimeState, ["starting", "stopping"])) {
    return "connection";
  }

  if (runtimeHasPhase(runtimeState, ["running"])) {
    return "idle";
  }

  return "rest";
}

function applyEvent(
  current: RuntimeState | null,
  event: RuntimeEvent,
): RuntimeState | null {
  if (!current) {
    return current;
  }

  return applyRuntimeEvent(current, event);
}

function resolveTeasePlaceholder(
  mood: DesktopDeskpetMood,
): { mood: DesktopDeskpetMood; message: string } | null {
  if (mood === "idle") {
    return {
      mood: "belly-rub",
      message: "伸懒腰，顺便摸摸肚皮",
    };
  }

  if (mood === "rest") {
    return {
      mood: "yawn",
      message: "被摸醒了，打个哈欠",
    };
  }

  return null;
}

function getStatusBubbleText(
  mood: DesktopDeskpetMood,
  interactionMessage: string | null,
): string | null {
  if (interactionMessage) {
    return interactionMessage;
  }

  switch (mood) {
    case "connection":
      return "连接中...";
    case "error":
      return "遇到异常了";
    case "lobster-replying":
      return "思考中...";
    case "working":
      return "正在输入中";
    case "success":
      return "完成啦";
    default:
      return null;
  }
}

function getTaskStatusText(mood: DesktopDeskpetMood): string | null {
  switch (mood) {
    case "working":
      return "正在输入中";
    case "lobster-replying":
      return "正在思考";
    case "success":
      return "已完成";
    default:
      return null;
  }
}

function getReplyPreviewText(replyText: string | null): string {
  const normalized = (replyText ?? "").replace(/\s+/g, " ").trim();
  return normalized || "已完成，可以继续和我说。";
}

function normalizeReplyTextForPages(replyText: string | null): string {
  const trimmed = (replyText ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .trim();

  if (!trimmed) {
    return "已完成，可以继续和我说。";
  }

  if (trimmed.length <= DESKPET_REPLY_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, DESKPET_REPLY_MAX_CHARS).trim()}...`;
}

function findReplyLineBreakIndex(text: string, limit: number): number {
  if (text.length <= limit) {
    return text.length;
  }

  const max = Math.min(text.length, limit);
  const min = Math.max(8, Math.floor(limit * 0.58));
  const breakChars = new Set([
    " ",
    "，",
    "。",
    "、",
    "：",
    "；",
    "！",
    "？",
    ",",
    ".",
    ":",
    ";",
    "!",
    "?",
    ")",
    "）",
  ]);

  for (let index = max; index >= min; index -= 1) {
    if (breakChars.has(text[index - 1] ?? "")) {
      return index;
    }
  }

  return max;
}

function splitReplyTextIntoLines(replyText: string | null): string[] {
  const normalized = normalizeReplyTextForPages(replyText);
  const sourceLines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    let remaining = sourceLine;
    while (remaining.length > DESKPET_REPLY_LINE_CHAR_LIMIT) {
      const breakIndex = findReplyLineBreakIndex(
        remaining,
        DESKPET_REPLY_LINE_CHAR_LIMIT,
      );
      lines.push(remaining.slice(0, breakIndex).trim());
      remaining = remaining.slice(breakIndex).trim();
    }

    if (remaining) {
      lines.push(remaining);
    }
  }

  return lines.length > 0 ? lines : ["已完成，可以继续和我说。"];
}

function getReplyDisplayPages(replyText: string | null): string[] {
  const lines = splitReplyTextIntoLines(replyText);
  const pages: string[] = [];

  for (let index = 0; index < lines.length; index += 2) {
    pages.push(lines.slice(index, index + 2).join("\n"));
  }

  return pages;
}

function getTaskSummaryText(
  mood: DesktopDeskpetMood,
  replyText: string | null,
): string {
  if (mood === "working") {
    return "正在输入中";
  }

  if (mood === "lobster-replying") {
    return "Tabby 正在整理回复，请稍等一下。";
  }

  return getReplyPreviewText(replyText);
}

function isInsideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

function isDeskpetBodyPoint(event: MouseEvent | PointerEvent): boolean {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!(element instanceof Element)) {
    return false;
  }

  if (element.closest(DESKPET_HIT_AREA_SELECTOR)) {
    return true;
  }

  const petElement = element.closest(DESKPET_PET_HIT_AREA_SELECTOR);
  if (!(petElement instanceof HTMLElement)) {
    return false;
  }

  const rect = petElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  return (
    isInsideEllipse(x, y, 0.5, 0.59, 0.29, 0.33) ||
    isInsideEllipse(x, y, 0.49, 0.39, 0.27, 0.2) ||
    isInsideEllipse(x, y, 0.68, 0.62, 0.13, 0.23) ||
    isInsideEllipse(x, y, 0.5, 0.23, 0.2, 0.12)
  );
}

export function DesktopDeskpetApp() {
  const activityTimerRef = useRef<number | null>(null);
  const taskTimerRef = useRef<number | null>(null);
  const idlePeekTimerRef = useRef<number | null>(null);
  const idleRestTimerRef = useRef<number | null>(null);
  const messageTimerRef = useRef<number | null>(null);
  const petGestureRef = useRef<PetGesture | null>(null);
  const petClickCountRef = useRef(0);
  const petClickTimerRef = useRef<number | null>(null);
  const petTeaseHintShownRef = useRef(false);
  const peekReturnRestTimerRef = useRef<number | null>(null);
  const mouseEventsIgnoredRef = useRef(false);
  const suppressNextPetClickRef = useRef(false);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [manualMood, setManualMood] = useState<DesktopDeskpetMood | null>(null);
  const [activityMood, setActivityMood] = useState<DesktopDeskpetMood | null>(
    null,
  );
  const [taskMood, setTaskMood] = useState<DesktopDeskpetMood | null>(null);
  const [inactivityMood, setInactivityMood] =
    useState<DesktopDeskpetMood | null>(null);
  const [runtimeMood, setRuntimeMood] = useState<DesktopDeskpetMood | null>(
    null,
  );
  const [size, setSize] = useState<DesktopDeskpetSize>("medium");
  const [interactionMessage, setInteractionMessage] = useState<string | null>(
    null,
  );
  const [isMovingPet, setIsMovingPet] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [replyPreviewText, setReplyPreviewText] = useState<string | null>(null);
  const [replyPageIndex, setReplyPageIndex] = useState(0);
  const [isDialogueDismissed, setIsDialogueDismissed] = useState(false);
  const [followupText, setFollowupText] = useState("");
  const [replyBubblePlacement, setReplyBubblePlacement] =
    useState<ReplyBubblePlacement>("near-top");
  const [spriteReplayKey, setSpriteReplayKey] = useState(0);

  const clearIdleTimers = useCallback(() => {
    if (idleRestTimerRef.current !== null) {
      window.clearTimeout(idleRestTimerRef.current);
      idleRestTimerRef.current = null;
    }
    if (idlePeekTimerRef.current !== null) {
      window.clearTimeout(idlePeekTimerRef.current);
      idlePeekTimerRef.current = null;
    }
    if (peekReturnRestTimerRef.current !== null) {
      window.clearTimeout(peekReturnRestTimerRef.current);
      peekReturnRestTimerRef.current = null;
    }
  }, []);

  const clearPetClickTimer = useCallback(() => {
    if (petClickTimerRef.current === null) {
      return;
    }

    window.clearTimeout(petClickTimerRef.current);
    petClickTimerRef.current = null;
  }, []);

  const clearMessageTimer = useCallback(() => {
    if (messageTimerRef.current === null) {
      return;
    }

    window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = null;
  }, []);

  const setMousePassthrough = useCallback((ignore: boolean) => {
    if (mouseEventsIgnoredRef.current === ignore) {
      return;
    }

    mouseEventsIgnoredRef.current = ignore;
    void setDeskpetMouseEvents({ forward: true, ignore }).catch(() => {
      mouseEventsIgnoredRef.current = !ignore;
    });
  }, []);

  const clearTaskTimer = useCallback(() => {
    if (taskTimerRef.current === null) {
      return;
    }

    window.clearTimeout(taskTimerRef.current);
    taskTimerRef.current = null;
  }, []);

  const playTemporaryMood = useCallback(
    (
      nextMood: DesktopDeskpetMood,
      message: string | null,
      durationMs = 2600,
    ) => {
      clearMessageTimer();
      setSpriteReplayKey((key) => key + 1);
      setActivityMood(nextMood);
      if (message) {
        setReplyBubblePlacement(getRandomReplyBubblePlacement());
      }
      setInteractionMessage(message);

      if (activityTimerRef.current !== null) {
        window.clearTimeout(activityTimerRef.current);
      }

      activityTimerRef.current = window.setTimeout(() => {
        setActivityMood(null);
        setInteractionMessage(null);
        activityTimerRef.current = null;
      }, durationMs);
    },
    [clearMessageTimer],
  );

  const showTemporaryMessage = useCallback(
    (message: string, durationMs = 2200) => {
      clearMessageTimer();
      setReplyBubblePlacement(getRandomReplyBubblePlacement());
      setInteractionMessage(message);
      messageTimerRef.current = window.setTimeout(() => {
        setInteractionMessage(null);
        messageTimerRef.current = null;
      }, durationMs);
    },
    [clearMessageTimer],
  );

  useEffect(() => {
    void getRuntimeState()
      .then((state) => {
        setRuntimeState(state);
        setRuntimeMood(resolveMoodFromRuntime(state));
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    setMousePassthrough(true);

    const unsubscribe = onRuntimeEvent((event) => {
      setRuntimeState((current) => {
        const nextState = applyEvent(current, event);
        setRuntimeMood(resolveMoodFromRuntime(nextState));
        return nextState;
      });
    });

    return () => {
      if (activityTimerRef.current !== null) {
        window.clearTimeout(activityTimerRef.current);
        activityTimerRef.current = null;
      }
      void setDeskpetMouseEvents({ forward: true, ignore: false }).catch(
        () => null,
      );
      clearTaskTimer();
      clearIdleTimers();
      clearMessageTimer();
      clearPetClickTimer();
      unsubscribe();
    };
  }, [
    clearIdleTimers,
    clearMessageTimer,
    clearPetClickTimer,
    clearTaskTimer,
    setMousePassthrough,
  ]);

  useEffect(() => {
    const updateMousePassthrough = (event: MouseEvent | PointerEvent) => {
      if (petGestureRef.current) {
        setMousePassthrough(false);
        return;
      }

      setMousePassthrough(!isDeskpetBodyPoint(event));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      updateMousePassthrough(event);
    };

    window.addEventListener("mousemove", updateMousePassthrough);
    window.addEventListener("pointermove", updateMousePassthrough);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("mousemove", updateMousePassthrough);
      window.removeEventListener("pointermove", updateMousePassthrough);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [setMousePassthrough]);

  useEffect(() => {
    return onDesktopCommand((command) => {
      setLastInteractionAt(Date.now());

      if (command.type === "deskpet:set-mood") {
        console.info(
          "[deskpet-debug:pet] set-mood received",
          JSON.stringify({
            mood: command.mood,
            source: command.source,
            durationMs: command.durationMs,
            hasReplyText: Boolean(command.replyText?.trim()),
          }),
        );

        if (command.source === "manual") {
          setManualMood(command.mood);
          setActivityMood(null);
          setInactivityMood(null);
          setInteractionMessage(null);
          setSpriteReplayKey((key) => key + 1);
          return;
        }

        if (command.source === "runtime") {
          setRuntimeMood(command.mood);
          setInactivityMood(null);
          setInteractionMessage(null);
          return;
        }

        if (command.replyText?.trim()) {
          setReplyPreviewText(command.replyText.trim());
        }
        setSpriteReplayKey((key) => key + 1);
        if (DESKPET_DIALOGUE_MOODS.has(command.mood)) {
          setTaskMood(command.mood);
          setInteractionMessage(null);
          setReplyPageIndex(0);
          setIsDialogueDismissed(false);
          clearTaskTimer();
          const taskDurationMs =
            command.mood === "success" ? undefined : command.durationMs;
          if (taskDurationMs) {
            taskTimerRef.current = window.setTimeout(() => {
              setTaskMood(null);
              taskTimerRef.current = null;
            }, taskDurationMs);
          }
          return;
        }

        setManualMood(null);
        setInteractionMessage(null);
        if (command.durationMs) {
          setActivityMood(command.mood);
          if (activityTimerRef.current !== null) {
            window.clearTimeout(activityTimerRef.current);
          }
          activityTimerRef.current = window.setTimeout(() => {
            setActivityMood(null);
            setInteractionMessage(null);
            activityTimerRef.current = null;
          }, command.durationMs);
          return;
        }

        setActivityMood(command.mood);
        return;
      }

      if (command.type === "deskpet:set-size") {
        setSize(command.size);
      }
    });
  }, [clearTaskTimer]);

  const baseMood =
    manualMood ?? runtimeMood ?? resolveMoodFromRuntime(runtimeState);
  const effectiveInactivityMood =
    baseMood === "idle" || baseMood === "rest" ? inactivityMood : null;
  const mood =
    taskMood ??
    manualMood ??
    activityMood ??
    effectiveInactivityMood ??
    baseMood;
  const assetUrl = DESKPET_ASSETS[mood];
  const label = DESKPET_LABELS[mood];
  const imageScale = SIZE_SCALE[size] * (MOOD_SCALE[mood] ?? 1);
  const imageOffsetY = MOOD_OFFSET_Y[mood] ?? 0;
  const activeBubbleText = getStatusBubbleText(mood, interactionMessage);
  const isThinkingBubble = mood === "lobster-replying";
  const taskStatusText = getTaskStatusText(mood);
  const shouldShowTaskPanel =
    !isDialogueDismissed &&
    (mood === "working" || mood === "lobster-replying" || mood === "success");
  const shouldShowTaskSummary = mood !== "working";
  const replyDisplayPages = useMemo(
    () => (mood === "success" ? getReplyDisplayPages(replyPreviewText) : []),
    [mood, replyPreviewText],
  );
  const taskSummary =
    mood === "success"
      ? (replyDisplayPages[replyPageIndex % replyDisplayPages.length] ??
        getReplyPreviewText(replyPreviewText))
      : getTaskSummaryText(mood, replyPreviewText);
  const isSingleLineTaskSummary = !taskSummary.includes("\n");
  const isReplyTaskPanel = mood === "success";
  const taskPanelClassName = ["deskpet-task-panel", `is-${mood}`]
    .filter(Boolean)
    .join(" ");
  const petStyle = useMemo(
    () => ({
      width: `${imageScale * 100}%`,
      height: `${imageScale * 100}%`,
      transform: `translateY(${imageOffsetY}px)`,
    }),
    [imageOffsetY, imageScale],
  );

  useEffect(() => {
    if (mood !== "success" || replyDisplayPages.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setReplyPageIndex((index) => (index + 1) % replyDisplayPages.length);
    }, DESKPET_REPLY_PAGE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [mood, replyDisplayPages.length]);

  useEffect(() => {
    console.info(
      "[deskpet-debug:pet] render state",
      JSON.stringify({
        activityMood,
        activeBubbleText,
        baseMood,
        interactionMessage,
        isThinkingBubble,
        manualMood,
        mood,
        runtimeMood,
        taskMood,
      }),
    );
  }, [
    activityMood,
    activeBubbleText,
    baseMood,
    interactionMessage,
    isThinkingBubble,
    manualMood,
    mood,
    runtimeMood,
    taskMood,
  ]);

  useEffect(() => {
    clearIdleTimers();
    setInactivityMood(null);

    if (taskMood || manualMood || activityMood || baseMood !== "idle") {
      return;
    }

    const inactiveForMs = Math.max(0, Date.now() - lastInteractionAt);
    const restDelayMs = Math.max(0, IDLE_REST_DELAY_MS - inactiveForMs);
    const peekDelayMs = Math.max(0, IDLE_PEEK_DELAY_MS - inactiveForMs);

    idleRestTimerRef.current = window.setTimeout(() => {
      setInactivityMood("rest");
    }, restDelayMs);

    idlePeekTimerRef.current = window.setTimeout(() => {
      setSpriteReplayKey((key) => key + 1);
      setInactivityMood("peek");
      peekReturnRestTimerRef.current = window.setTimeout(() => {
        setInactivityMood("rest");
        peekReturnRestTimerRef.current = null;
      }, PEEK_RETURN_REST_DELAY_MS);
    }, peekDelayMs);

    return clearIdleTimers;
  }, [
    activityMood,
    baseMood,
    clearIdleTimers,
    lastInteractionAt,
    manualMood,
    taskMood,
  ]);

  const triggerPetTease = useCallback(
    (showUnavailableMessage = true) => {
      const placeholder = resolveTeasePlaceholder(mood);

      if (!placeholder) {
        if (showUnavailableMessage) {
          showTemporaryMessage("先专注，稍后再逗");
        }
        return false;
      }

      playTemporaryMood(placeholder.mood, placeholder.message);
      return true;
    },
    [mood, playTemporaryMood, showTemporaryMessage],
  );

  const showPetTeaseHint = useCallback(() => {
    if (
      petTeaseHintShownRef.current ||
      interactionMessage ||
      activityMood ||
      (mood !== "idle" && mood !== "rest")
    ) {
      return;
    }

    petTeaseHintShownRef.current = true;
    showTemporaryMessage(PET_TEASE_HINT_MESSAGE, 1800);
  }, [activityMood, interactionMessage, mood, showTemporaryMessage]);

  const handlePetPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }

    petGestureRef.current = {
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      mode: "pending",
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      totalDistance: 0,
    };
    suppressNextPetClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePetPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const deltaX =
      typeof event.movementX === "number"
        ? event.movementX
        : event.screenX - gesture.lastScreenX;
    const deltaY =
      typeof event.movementY === "number"
        ? event.movementY
        : event.screenY - gesture.lastScreenY;
    gesture.lastScreenX = event.screenX;
    gesture.lastScreenY = event.screenY;
    gesture.totalDistance += Math.hypot(deltaX, deltaY);

    if (gesture.mode === "move") {
      event.preventDefault();
      void moveDeskpetWindow(deltaX, deltaY).catch(() => null);
      return;
    }

    if (gesture.mode === "tease") {
      return;
    }

    const displacement = Math.hypot(
      event.screenX - gesture.startScreenX,
      event.screenY - gesture.startScreenY,
    );
    const displacementX = event.screenX - gesture.startScreenX;
    const displacementY = event.screenY - gesture.startScreenY;
    const pathToDisplacementRatio =
      displacement > 0 ? gesture.totalDistance / displacement : 0;
    const isDirectionalMove =
      displacement >= PET_MOVE_START_DISTANCE &&
      pathToDisplacementRatio < PET_TEASE_DIRECTION_RATIO;
    const canTease = mood === "idle" || mood === "rest";
    const isSmallScrub =
      canTease &&
      gesture.totalDistance >= PET_TEASE_TOTAL_DISTANCE &&
      (displacement <= PET_TEASE_MAX_DISPLACEMENT ||
        pathToDisplacementRatio >= PET_TEASE_DIRECTION_RATIO);

    if (isDirectionalMove) {
      gesture.mode = "move";
      event.preventDefault();
      clearPetClickTimer();
      clearMessageTimer();
      setInteractionMessage("移动中");
      setIsMovingPet(true);
      suppressNextPetClickRef.current = true;
      void moveDeskpetWindow(displacementX, displacementY).catch(() => null);
      return;
    }

    if (!isSmallScrub) {
      return;
    }

    const placeholder = resolveTeasePlaceholder(mood);
    if (!placeholder) {
      return;
    }

    gesture.mode = "tease";
    suppressNextPetClickRef.current = true;
    playTemporaryMood(placeholder.mood, placeholder.message);
  };

  const handlePetPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = petGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    petGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture.mode === "move") {
      setIsMovingPet(false);
      messageTimerRef.current = window.setTimeout(() => {
        setInteractionMessage(null);
        messageTimerRef.current = null;
      }, 650);
    }
  };

  const handleReplyInCurrentChat = async () => {
    try {
      const result = await openDeskpetCurrentChat({ intent: "reply" });
      if (!result.ok) {
        showTemporaryMessage("还没有可回复的会话");
      }
    } catch {
      showTemporaryMessage("打开回复失败");
    }
  };

  const handlePauseCurrentReply = async () => {
    try {
      const result = await pauseDeskpetCurrentReply();
      if (!result.ok) {
        showTemporaryMessage("还没有可暂停的回复");
        return;
      }

      clearTaskTimer();
      setTaskMood(null);
      setReplyPageIndex(0);
      showTemporaryMessage("已暂停回复");
    } catch {
      showTemporaryMessage("暂停回复失败");
    }
  };

  const handleTaskActionPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    setMousePassthrough(false);
  };

  const handleSubmitFollowup = async () => {
    const text = followupText.trim();
    if (!text) {
      return;
    }

    setFollowupText("");
    clearTaskTimer();
    setTaskMood("lobster-replying");
    setReplyPageIndex(0);
    setIsDialogueDismissed(false);

    try {
      await replyDeskpetCurrentChat(text);
    } catch {
      setTaskMood("success");
      setFollowupText(text);
      showTemporaryMessage("发送失败，请再试一次");
    }
  };

  const handleFollowupKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    event.stopPropagation();
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void handleSubmitFollowup();
  };

  const dismissTaskPanel = () => {
    clearTaskTimer();
    setIsDialogueDismissed(true);

    if (mood === "success") {
      setTaskMood(null);
      setReplyPageIndex(0);
    }
  };

  return (
    <main
      className={`deskpet-root is-size-${size}`}
      aria-label={`Tabby 桌宠：${label}`}
      onFocusCapture={() => setLastInteractionAt(Date.now())}
      onKeyDownCapture={() => setLastInteractionAt(Date.now())}
      onPointerDownCapture={() => setLastInteractionAt(Date.now())}
    >
      {shouldShowTaskPanel ? (
        <div className={taskPanelClassName} data-deskpet-hit-area>
          <div className="deskpet-task-header">
            <div className="deskpet-task-copy">
              {taskStatusText ? <strong>{taskStatusText}</strong> : null}
              {isReplyTaskPanel ? (
                <span
                  className="deskpet-task-inline-summary"
                  title={getReplyPreviewText(replyPreviewText)}
                >
                  {taskSummary}
                </span>
              ) : null}
            </div>
            <div className="deskpet-task-actions">
              <button
                aria-label="回复"
                className="deskpet-task-action-button is-open-session"
                onClick={handleReplyInCurrentChat}
                onPointerDown={handleTaskActionPointerDown}
                title="回复"
                type="button"
              >
                <ReturnConversationIcon
                  className="deskpet-task-action-icon"
                  size={22}
                />
              </button>
              {mood === "lobster-replying" ? (
                <button
                  aria-label="暂停回复"
                  className="deskpet-task-action-button is-pause-reply"
                  onClick={handlePauseCurrentReply}
                  onPointerDown={handleTaskActionPointerDown}
                  title="暂停回复"
                  type="button"
                >
                  <Square
                    aria-hidden="true"
                    className="deskpet-task-action-icon"
                    fill="currentColor"
                    size={14}
                    strokeWidth={0}
                  />
                </button>
              ) : null}
              {mood === "success" ? (
                <button
                  aria-label="完成对话"
                  className="deskpet-task-indicator is-complete is-action"
                  onClick={dismissTaskPanel}
                  onPointerDown={handleTaskActionPointerDown}
                  title="完成对话"
                  type="button"
                />
              ) : (
                <span
                  aria-label="进行中"
                  className="deskpet-task-indicator is-working"
                />
              )}
              {!isReplyTaskPanel ? (
                <button
                  aria-label="关闭气泡"
                  className="deskpet-task-close"
                  onClick={dismissTaskPanel}
                  onPointerDown={handleTaskActionPointerDown}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>

          {shouldShowTaskSummary && !isReplyTaskPanel ? (
            <p
              className={[
                "deskpet-task-summary",
                isSingleLineTaskSummary ? "is-single-line" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              title={taskSummary}
            >
              {taskSummary}
            </p>
          ) : null}
          {isReplyTaskPanel ? (
            <input
              aria-label="继续跟进，按回车发送"
              className="deskpet-task-followup"
              onChange={(event) => setFollowupText(event.target.value)}
              onKeyDown={handleFollowupKeyDown}
              onPointerDown={handleTaskActionPointerDown}
              placeholder="继续跟进"
              title="输入后按回车发送"
              type="text"
              value={followupText}
            />
          ) : null}
        </div>
      ) : activeBubbleText ? (
        <div
          data-deskpet-hit-area
          className={[
            "deskpet-reply-panel",
            isThinkingBubble ? "is-thinking" : null,
            !isThinkingBubble ? `is-${replyBubblePlacement}` : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="deskpet-reply-bubble" title={activeBubbleText}>
            <span className="deskpet-reply-text">{activeBubbleText}</span>
            {!isThinkingBubble ? (
              <button
                aria-label="回复"
                className="deskpet-reply-open-button"
                onClick={handleReplyInCurrentChat}
                onPointerDown={handleTaskActionPointerDown}
                title="回复"
                type="button"
              >
                <ReturnConversationIcon
                  className="deskpet-reply-open-icon"
                  size={18}
                />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        aria-label="双击逗一逗 Tabby 桌宠，拖动可移动"
        className={
          isMovingPet ? "deskpet-trigger is-moving" : "deskpet-trigger"
        }
        onClick={() => {
          if (suppressNextPetClickRef.current) {
            suppressNextPetClickRef.current = false;
            petClickCountRef.current = 0;
            clearPetClickTimer();
            return;
          }

          petClickCountRef.current += 1;
          if (petClickCountRef.current >= 2) {
            petClickCountRef.current = 0;
            clearPetClickTimer();
            triggerPetTease(false);
            return;
          }

          clearPetClickTimer();
          petClickTimerRef.current = window.setTimeout(() => {
            petClickCountRef.current = 0;
            petClickTimerRef.current = null;
            triggerPetTease();
          }, PET_TEASE_CLICK_INTERVAL_MS);
        }}
        onPointerCancel={handlePetPointerEnd}
        onPointerDown={handlePetPointerDown}
        onPointerEnter={showPetTeaseHint}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerEnd}
        data-deskpet-pet-hit-area
        style={petStyle}
        type="button"
      >
        <img
          alt=""
          className="deskpet-sprite"
          key={`${mood}-${spriteReplayKey}`}
          src={assetUrl}
        />
      </button>
    </main>
  );
}
