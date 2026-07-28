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
  "停止当前任务吧",
  "终止当前任务",
  "终止这个任务",
  "取消当前任务",
  "取消这个任务",
  "停止执行",
  "终止执行",
  "取消执行",
  "暂停",
  "暂停一下",
  "先停一下",
  "先暂停",
  "先暂停一下",
  "别做了",
  "不做了",
  "不用继续了",
  "不要继续了",
  "stop",
  "stopthetask",
  "stopcurrenttask",
  "stopthistask",
  "abort",
  "abortthetask",
  "abortcurrenttask",
  "cancelcurrenttask",
  "cancelthistask",
  "donotcontinue",
  "dontcontinue",
]);

const HIGH_CONFIDENCE_SIDE_QUESTION_PATTERNS = [
  /^(?:请|麻烦|帮我)?(?:看下|看看|告诉我|汇报下|说下)?(?:现在|当前|目前)?(?:的)?(?:进度|状态|情况)(?:如何|怎么样|到哪(?:一步)?了?)?[？?。.!！]*$/,
  /^(?:现在|当前|目前)?(?:已经)?做到哪(?:一步)?了?[？?。.!！]*$/,
  /^(?:现在|当前|目前)?(?:已经)?完成了?(?:什么|哪些|多少|几步)[？?。.!！]*$/,
  /^(?:还|大概)?(?:需要|要)?多久(?:能|才)?(?:完成|结束)?[？?。.!！]*$/,
  /^(?:现在|目前)?(?:怎么样|如何)了?[？?。.!！]*$/,
  /^(?:完成|结束|做好|跑完)了?吗[？?。.!！]*$/,
  /^(?:what(?:'s| is) the )?(?:current )?(?:status|progress)[?.!]*$/i,
  /^(?:show|tell|give) me (?:the )?(?:current )?(?:status|progress)[?.!]*$/i,
  /^(?:where are we|how far (?:are we|have you gotten))[?.!]*$/i,
  /^(?:how (?:much )?longer|how long (?:will|does) it take)[?.!]*$/i,
  /^(?:are you|is it) (?:done|finished|complete)[?.!]*$/i,
  /^what (?:have you|has been) (?:done|completed)(?: so far)?[?.!]*$/i,
];

const DIRECTIVE_PATTERNS = [
  /^(?:请|麻烦|帮我)?(?:改|调整|修改|重构|修复|实现|新增|添加|删除|移除|替换|切换|换成|改成|继续|暂停|停止|终止|取消|跳过|忽略|只看|只查|只跑|先做|优先)/,
  /^(?:不要|别|不用|无需|继续|暂停|停止|终止|取消|跳过|忽略|只|先|优先)/,
  /(?:改成|换成|调整为|修改为|替换为|切换到|只看|只查|只跑|不用全|不要再|别再)/,
  /(?:能不能|可不可以|是否可以|应该).*(?:改|调整|修改|重构|修复|实现|新增|添加|删除|移除|替换|切换|换|使用|改用|继续|暂停|停止|跳过|忽略|只)/,
  /^(?:please\s+)?(?:change|adjust|modify|refactor|fix|implement|add|remove|delete|replace|switch|use|continue|pause|stop|abort|cancel|skip|ignore|only|focus|summarize|run|test|check)\b/i,
  /^(?:do not|don't|dont|no longer)\b/i,
  /\b(?:can|could|would|will|should) (?:you|we)\b.*\b(?:change|adjust|modify|refactor|fix|implement|add|remove|delete|replace|switch|use|continue|pause|stop|skip|ignore|focus|run|test|check)\b/i,
];

const QUESTION_PATTERNS = [
  /[？?]\s*$/,
  /^(?:什么|为什么|为何|怎么|怎样|如何|哪里|哪一步|哪个|哪些|谁|何时|什么时候|多久|多少|是否|有没有|是不是|现在|当前|目前)/,
  /^(?:what|why|how|when|where|who|which|is|are|am|was|were|do|does|did|has|have|had)\b/i,
];

const SIDE_QUESTION_PATTERNS = [
  /^(?:顺便|另外|额外|题外话|旁路)?(?:问一下|想问|想知道|解释一下|告诉我|说一下|帮我看下|帮我看看)/,
  /^(?:by the way|btw|separately|quick question)\b/i,
];

function normalizeStopMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’]/g, "");
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function classifyRunMessage(input: string): ClassifiedRunMessage {
  const message = input.trim();
  const command = message.match(/^\/(btw|side|steer|tell)\b\s*/i);
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

  if (matchesAny(message, HIGH_CONFIDENCE_SIDE_QUESTION_PATTERNS)) {
    return { intent: "side-question", message, explicit: false };
  }

  if (matchesAny(message, DIRECTIVE_PATTERNS)) {
    return { intent: "steer", message, explicit: false };
  }

  if (matchesAny(message, QUESTION_PATTERNS)) {
    return { intent: "side-question", message, explicit: false };
  }

  if (matchesAny(message, SIDE_QUESTION_PATTERNS)) {
    return { intent: "side-question", message, explicit: false };
  }

  // Ambiguous input must not alter the active task. Users can still force an
  // adjustment with /steer, while a mistaken side question stays isolated.
  return { intent: "side-question", message, explicit: false };
}
