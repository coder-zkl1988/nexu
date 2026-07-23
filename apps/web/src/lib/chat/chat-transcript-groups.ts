import type { ExtractedMessage } from "@/lib/chat/chat-message-extract";

export interface TranscriptEntry<
  TMessage extends { id: string; role: string },
> {
  msg: TMessage;
  extracted: ExtractedMessage;
}

export type TranscriptItem<TMessage extends { id: string; role: string }> =
  | {
      kind: "message";
      entry: TranscriptEntry<TMessage>;
    }
  | {
      kind: "activity";
      id: string;
      entries: TranscriptEntry<TMessage>[];
    };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripRenderedAssistantText(
  streamingText: string,
  renderedTexts: readonly string[],
): string {
  let remainder = streamingText;

  for (const renderedText of renderedTexts) {
    const words = renderedText.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      continue;
    }

    const flexibleWhitespacePattern = words.map(escapeRegExp).join("\\s+");
    remainder = remainder.replace(
      new RegExp(flexibleWhitespacePattern, "u"),
      "",
    );
  }

  return remainder.trim();
}

function hasVisibleExtractedContent(extracted: ExtractedMessage): boolean {
  return (
    extracted.text.trim().length > 0 ||
    (extracted.replyContextText?.trim().length ?? 0) > 0 ||
    extracted.hasToolCall ||
    extracted.reasoning.length > 0 ||
    extracted.hasA2UI ||
    extracted.sidebarA2UI !== null ||
    extracted.a2uiAction !== null ||
    extracted.canvasOpBatch !== null ||
    extracted.canvasOpResult !== null ||
    extracted.images.length > 0 ||
    extracted.fileCards.length > 0
  );
}

export function isExecutionEntry<TMessage extends { id: string; role: string }>(
  entry: TranscriptEntry<TMessage>,
): boolean {
  return (
    entry.msg.role === "assistant" &&
    (entry.extracted.hasToolCall || entry.extracted.reasoning.length > 0)
  );
}

export function buildTranscriptItems<
  TMessage extends { id: string; role: string },
>(entries: TranscriptEntry<TMessage>[]): TranscriptItem<TMessage>[] {
  const items: TranscriptItem<TMessage>[] = [];
  let assistantEntries: TranscriptEntry<TMessage>[] = [];

  const flushAssistantEntries = (): void => {
    let lastExecutionIndex = -1;
    let renderedActivityTexts: string[] = [];
    for (let index = assistantEntries.length - 1; index >= 0; index -= 1) {
      const entry = assistantEntries[index];
      if (entry && isExecutionEntry(entry)) {
        lastExecutionIndex = index;
        break;
      }
    }

    if (lastExecutionIndex >= 0) {
      const activityEntries = assistantEntries.slice(0, lastExecutionIndex + 1);
      const first = activityEntries[0];
      const last = activityEntries[activityEntries.length - 1];
      renderedActivityTexts = activityEntries.flatMap((entry) => [
        ...entry.extracted.reasoning,
        entry.extracted.text,
      ]);
      if (first && last) {
        items.push({
          kind: "activity",
          id: `activity:${first.msg.id}:${last.msg.id}`,
          entries: activityEntries,
        });
      }
    }

    for (const entry of assistantEntries.slice(lastExecutionIndex + 1)) {
      const remainingText = stripRenderedAssistantText(
        entry.extracted.text,
        renderedActivityTexts,
      );
      const deduplicatedEntry =
        remainingText === entry.extracted.text.trim()
          ? entry
          : {
              ...entry,
              extracted: {
                ...entry.extracted,
                text: remainingText,
              },
            };

      if (hasVisibleExtractedContent(deduplicatedEntry.extracted)) {
        items.push({ kind: "message", entry: deduplicatedEntry });
      }
    }

    assistantEntries = [];
  };

  for (const entry of entries) {
    if (entry.msg.role === "assistant") {
      assistantEntries.push(entry);
      continue;
    }

    flushAssistantEntries();
    items.push({ kind: "message", entry });
  }

  flushAssistantEntries();
  return items;
}
