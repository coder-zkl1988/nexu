import {
  Camera,
  FileImage,
  LoaderCircle,
  SendHorizontal,
  TextSelect,
  X,
} from "lucide-react";
import {
  type FormEvent,
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
  DesktopQuickChatAttachment,
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
  isDeskpetTaskMood,
  resolveDeskpetMood,
  resolveDeskpetTaskDurationMs,
} from "../lib/deskpet-state";
import {
  getQuickChatContext,
  getRuntimeState,
  moveDeskpetWindow,
  onDesktopCommand,
  onRuntimeEvent,
  sendDeskpetMessage,
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
const CHAT_COMPOSER_IDLE_TIMEOUT_MS = 10_000;
const PET_TEASE_HINT_MESSAGE = "双击可以逗一逗";
const DESKPET_HIT_AREA_SELECTOR = "[data-deskpet-hit-area]";
const DESKPET_PET_HIT_AREA_SELECTOR = "[data-deskpet-pet-hit-area]";

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
  if (!normalized) {
    return "任务已完成。";
  }

  return normalized.length > 180
    ? `${normalized.slice(0, 180).trim()}...`
    : normalized;
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

function getDeskpetChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("上一条消息还在处理中")) {
    return "Tabby 还在回复，请稍后再发。";
  }

  if (message.includes("没有找到可用的默认助手")) {
    return "还没有可用的助手。";
  }

  return "发送失败，请稍后重试。";
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
  const chatIdleTimerRef = useRef<number | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [isChatComposerOpen, setIsChatComposerOpen] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [quickChatAttachments, setQuickChatAttachments] = useState<
    DesktopQuickChatAttachment[]
  >([]);
  const [quickChatContextLoading, setQuickChatContextLoading] = useState<
    "selection" | "screenshot" | null
  >(null);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [replyPreviewText, setReplyPreviewText] = useState<string | null>(null);
  const [isDialogueDismissed, setIsDialogueDismissed] = useState(false);
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

  const clearChatIdleTimer = useCallback(() => {
    if (chatIdleTimerRef.current === null) {
      return;
    }

    window.clearTimeout(chatIdleTimerRef.current);
    chatIdleTimerRef.current = null;
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

  const scheduleChatIdleDismiss = useCallback(() => {
    clearChatIdleTimer();
    if (!isChatComposerOpen || isSendingChat) {
      return;
    }

    chatIdleTimerRef.current = window.setTimeout(() => {
      setIsChatComposerOpen(false);
      setChatError(null);
      setMousePassthrough(true);
      chatIdleTimerRef.current = null;
    }, CHAT_COMPOSER_IDLE_TIMEOUT_MS);
  }, [
    clearChatIdleTimer,
    isChatComposerOpen,
    isSendingChat,
    setMousePassthrough,
  ]);

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
      setManualMood(null);
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
      clearChatIdleTimer();
      clearMessageTimer();
      clearPetClickTimer();
      unsubscribe();
    };
  }, [
    clearChatIdleTimer,
    clearIdleTimers,
    clearMessageTimer,
    clearPetClickTimer,
    clearTaskTimer,
    setMousePassthrough,
  ]);

  useEffect(() => {
    if (!isChatComposerOpen) {
      return;
    }

    setMousePassthrough(false);
    const frameId = window.requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isChatComposerOpen, setMousePassthrough]);

  useEffect(() => {
    scheduleChatIdleDismiss();

    return clearChatIdleTimer;
  }, [clearChatIdleTimer, scheduleChatIdleDismiss]);

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

        setSpriteReplayKey((key) => key + 1);
        if (isDeskpetTaskMood(command.mood)) {
          clearChatIdleTimer();
          setIsChatComposerOpen(false);
          setChatError(null);
          setMousePassthrough(true);
          setReplyPreviewText(
            command.mood === "success"
              ? (command.replyText?.trim() ?? null)
              : null,
          );
          setTaskMood(command.mood);
          setInteractionMessage(null);
          setIsDialogueDismissed(false);
          clearTaskTimer();
          const taskDurationMs = resolveDeskpetTaskDurationMs(
            command.mood,
            command.durationMs,
          );
          taskTimerRef.current = window.setTimeout(() => {
            setTaskMood(null);
            taskTimerRef.current = null;
          }, taskDurationMs ?? 0);
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
        return;
      }

      if (command.type === "deskpet:open-composer") {
        if (taskMood === "working" || taskMood === "lobster-replying") {
          showTemporaryMessage("Tabby 正在回复，请稍后再发");
          return;
        }
        clearMessageTimer();
        setInteractionMessage(null);
        setChatError(null);
        setIsDialogueDismissed(true);
        setIsChatComposerOpen(true);
      }
    });
  }, [
    clearChatIdleTimer,
    clearMessageTimer,
    clearTaskTimer,
    setMousePassthrough,
    showTemporaryMessage,
    taskMood,
  ]);

  const baseMood = runtimeMood ?? resolveMoodFromRuntime(runtimeState);
  const effectiveInactivityMood =
    baseMood === "idle" || baseMood === "rest" ? inactivityMood : null;
  const mood = resolveDeskpetMood({
    activityMood,
    inactivityMood: effectiveInactivityMood,
    manualMood,
    runtimeMood: baseMood,
    taskMood,
  });
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
  const taskSummary = getTaskSummaryText(mood, replyPreviewText);
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

  const closeChatComposer = useCallback(() => {
    if (isSendingChat) {
      return;
    }

    clearChatIdleTimer();
    setIsChatComposerOpen(false);
    setChatError(null);
    setQuickChatAttachments([]);
    setMousePassthrough(true);
  }, [clearChatIdleTimer, isSendingChat, setMousePassthrough]);

  const openChatComposer = useCallback(() => {
    if (taskMood === "working" || taskMood === "lobster-replying") {
      showTemporaryMessage("Tabby 正在回复，请稍后再发");
      return;
    }

    clearMessageTimer();
    setInteractionMessage(null);
    setChatError(null);
    setIsDialogueDismissed(true);
    setIsChatComposerOpen(true);
  }, [clearMessageTimer, showTemporaryMessage, taskMood]);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text || isSendingChat) {
      return;
    }

    setChatError(null);
    setIsSendingChat(true);
    try {
      await sendDeskpetMessage(text, quickChatAttachments);
      setChatDraft("");
      setQuickChatAttachments([]);
      setIsChatComposerOpen(false);
      setIsDialogueDismissed(false);
    } catch (error) {
      console.warn("[deskpet] failed to send chat message", error);
      setChatError(getDeskpetChatErrorMessage(error));
    } finally {
      setIsSendingChat(false);
    }
  };

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

  const handleTaskActionPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    setMousePassthrough(false);
  };

  const dismissTaskPanel = () => {
    clearTaskTimer();
    setIsDialogueDismissed(true);
    setTaskMood(null);
  };

  return (
    <main
      className={`deskpet-root is-size-${size}`}
      aria-label={`Tabby 桌宠：${label}`}
      onFocusCapture={() => setLastInteractionAt(Date.now())}
      onKeyDownCapture={() => setLastInteractionAt(Date.now())}
      onPointerDownCapture={() => setLastInteractionAt(Date.now())}
    >
      {isChatComposerOpen ? (
        <form
          className="deskpet-chat-composer"
          data-deskpet-hit-area
          onPointerDown={handleTaskActionPointerDown}
          onSubmit={handleChatSubmit}
        >
          <div className="deskpet-chat-composer-row">
            <textarea
              aria-label="输入消息"
              className="deskpet-chat-input"
              disabled={isSendingChat}
              maxLength={8000}
              onChange={(event) => {
                setChatDraft(event.target.value);
                scheduleChatIdleDismiss();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeChatComposer();
                  return;
                }

                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="和 Tabby 说点什么"
              ref={chatInputRef}
              rows={2}
              value={chatDraft}
            />
            <button
              aria-label="关闭输入框"
              className="deskpet-chat-icon-button is-close"
              disabled={isSendingChat}
              onClick={closeChatComposer}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={17} strokeWidth={2.4} />
            </button>
            <button
              aria-label="发送消息"
              className="deskpet-chat-icon-button is-send"
              disabled={isSendingChat || !chatDraft.trim()}
              title="发送"
              type="submit"
            >
              {isSendingChat ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="deskpet-chat-spinner"
                  size={18}
                />
              ) : (
                <SendHorizontal aria-hidden="true" size={18} />
              )}
            </button>
          </div>
          <div className="deskpet-chat-context-row">
            <button
              aria-label="加入选中文本"
              className="deskpet-chat-context-button"
              disabled={isSendingChat || quickChatContextLoading !== null}
              onClick={() => {
                setQuickChatContextLoading("selection");
                setChatError(null);
                void getQuickChatContext({
                  includeSelectedText: true,
                  includeScreenshot: false,
                })
                  .then((context) => {
                    if (!context.selectedText) {
                      throw new Error("没有可用的选中文本或剪贴板文本。");
                    }
                    setChatDraft((current) =>
                      [current.trim(), `引用内容：\n${context.selectedText}`]
                        .filter(Boolean)
                        .join("\n\n"),
                    );
                  })
                  .catch((error: unknown) => {
                    setChatError(
                      error instanceof Error
                        ? error.message
                        : "无法读取选中文本。",
                    );
                  })
                  .finally(() => setQuickChatContextLoading(null));
              }}
              title="加入选中文本或剪贴板文本"
              type="button"
            >
              {quickChatContextLoading === "selection" ? (
                <LoaderCircle className="deskpet-chat-spinner" size={14} />
              ) : (
                <TextSelect size={14} />
              )}
              选中文本
            </button>
            <button
              aria-label="截取当前屏幕"
              className="deskpet-chat-context-button"
              disabled={isSendingChat || quickChatContextLoading !== null}
              onClick={() => {
                setQuickChatContextLoading("screenshot");
                setChatError(null);
                void getQuickChatContext({
                  includeSelectedText: false,
                  includeScreenshot: true,
                })
                  .then((context) => {
                    if (!context.screenshot) {
                      throw new Error("无法截取当前屏幕，请检查录屏权限。");
                    }
                    setQuickChatAttachments([context.screenshot]);
                  })
                  .catch((error: unknown) => {
                    setChatError(
                      error instanceof Error ? error.message : "截图失败。",
                    );
                  })
                  .finally(() => setQuickChatContextLoading(null));
              }}
              title="截取当前屏幕并随消息发送"
              type="button"
            >
              {quickChatContextLoading === "screenshot" ? (
                <LoaderCircle className="deskpet-chat-spinner" size={14} />
              ) : (
                <Camera size={14} />
              )}
              截图
            </button>
            {quickChatAttachments.length > 0 ? (
              <span className="deskpet-chat-context-chip">
                <FileImage size={13} />
                已加入截图
                <button
                  aria-label="移除截图"
                  disabled={isSendingChat}
                  onClick={() => setQuickChatAttachments([])}
                  type="button"
                >
                  <X size={12} />
                </button>
              </span>
            ) : null}
          </div>
          {chatError ? (
            <p className="deskpet-chat-error" role="alert">
              {chatError}
            </p>
          ) : null}
        </form>
      ) : shouldShowTaskPanel ? (
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
              {mood === "success" ? (
                <span
                  aria-label="已完成"
                  className="deskpet-task-indicator is-complete"
                />
              ) : (
                <span
                  aria-label="进行中"
                  className="deskpet-task-indicator is-working"
                />
              )}
              <button
                aria-label="关闭气泡"
                className="deskpet-task-close"
                onClick={dismissTaskPanel}
                onPointerDown={handleTaskActionPointerDown}
                type="button"
              >
                ×
              </button>
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
          </div>
        </div>
      ) : null}

      <button
        aria-label="单击和 Tabby 对话并摸摸，双击逗一逗，拖动可移动"
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
            closeChatComposer();
            triggerPetTease(false);
            return;
          }

          clearPetClickTimer();
          petClickTimerRef.current = window.setTimeout(() => {
            petClickCountRef.current = 0;
            petClickTimerRef.current = null;
            triggerPetTease(false);
            openChatComposer();
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
