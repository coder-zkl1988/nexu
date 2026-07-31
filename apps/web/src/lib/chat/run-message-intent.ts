export type RunMessageIntent = "steer" | "side-question" | "abort";

export interface ClassifiedRunMessage {
  intent: RunMessageIntent;
  message: string;
  explicit: boolean;
}

const STOP_MESSAGES = new Set([
  "停止",
  "停下",
  "停一下",
  "停止当前任务",
  "停止这个任务",
  "停止执行",
  "终止当前任务",
  "取消当前任务",
  "暂停",
  "先暂停一下",
  "别做了",
  "不用继续了",
  "不要继续了",
  "stop",
  "stopthetask",
  "stopcurrenttask",
  "abort",
  "abortthetask",
  "cancelcurrenttask",
  "donotcontinue",
  "dontcontinue",
]);

function normalizeStopMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’]/g, "");
}

/**
 * Resolve only explicit commands and exact stop phrases locally. Natural
 * language is intentionally left unclassified so it can use the isolated
 * model classifier instead of depending on a language-specific keyword list.
 */
export function classifyExplicitRunMessage(
  input: string,
): ClassifiedRunMessage | null {
  const message = input.trim();
  const command = message.match(
    /^[\/／、](btw|side|steer|tell)(?=$|\s|[:：]|\p{Script=Han})[\s:：]*/iu,
  );
  if (command) {
    const explicitMessage = message.slice(command[0].length).trim();
    return {
      intent:
        command[1]?.toLowerCase() === "btw" ||
        command[1]?.toLowerCase() === "side"
          ? "side-question"
          : "steer",
      message: explicitMessage,
      explicit: true,
    };
  }

  if (/^\/(?:stop|abort)\s*$/i.test(message)) {
    return { intent: "abort", message: "", explicit: true };
  }

  if (STOP_MESSAGES.has(normalizeStopMessage(message))) {
    return { intent: "abort", message: "", explicit: false };
  }

  return null;
}
