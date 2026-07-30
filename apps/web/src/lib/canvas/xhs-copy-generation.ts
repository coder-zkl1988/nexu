import { postApiV1MediaGenerateText } from "../../../lib/api/sdk.gen";

export type GeneratedXhsCopy = {
  title: string;
  content: string;
  hashtags: string[];
};

const MAX_XHS_SOURCE_TEXT_CHARS = 8_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonPayload(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start
    ? candidate.slice(start, end + 1)
    : candidate;
}

export function parseGeneratedXhsCopy(text: string): GeneratedXhsCopy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload(text));
  } catch {
    throw new Error("AI 返回的文案格式无法解析，请重试");
  }

  const record = asRecord(parsed);
  if (!record) throw new Error("AI 返回的文案格式不正确，请重试");

  const title = typeof record.title === "string" ? record.title.trim() : "";
  const content =
    typeof record.content === "string" ? record.content.trim() : "";
  const rawHashtags = Array.isArray(record.hashtags) ? record.hashtags : [];
  const hashtags = [
    ...new Set(
      rawHashtags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean),
    ),
  ].slice(0, 10);

  if (!title || !content) {
    throw new Error("AI 没有生成完整的标题和正文，请重试");
  }

  return { title: title.slice(0, 20), content, hashtags };
}

export function buildXhsCopySourceText(
  current?: Partial<GeneratedXhsCopy>,
): string | undefined {
  if (!current) return undefined;

  const title = current.title?.trim().slice(0, 20) ?? "";
  const content = current.content?.trim() ?? "";
  const hashtags = (current.hashtags ?? [])
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#+/, "").slice(0, 64))
    .filter(Boolean)
    .slice(0, 10);
  if (!title && !content && hashtags.length === 0) return undefined;

  const serialize = (candidateContent: string): string =>
    JSON.stringify({ title, content: candidateContent, hashtags });
  const full = serialize(content);
  if (full.length <= MAX_XHS_SOURCE_TEXT_CHARS) return full;

  // JSON escaping can expand a character, so binary-search the largest valid
  // prefix instead of subtracting a raw character count.
  let lower = 0;
  let upper = content.length;
  while (lower < upper) {
    const midpoint = Math.ceil((lower + upper) / 2);
    if (
      serialize(content.slice(0, midpoint)).length <= MAX_XHS_SOURCE_TEXT_CHARS
    ) {
      lower = midpoint;
    } else {
      upper = midpoint - 1;
    }
  }
  return serialize(content.slice(0, lower));
}

export async function generateXhsCopy(
  theme: string,
  current?: Partial<GeneratedXhsCopy>,
): Promise<GeneratedXhsCopy> {
  const normalizedTheme = theme.trim();
  if (!normalizedTheme) throw new Error("请先输入帖子主题");

  const sourceText = buildXhsCopySourceText(current);
  const { data, error } = await postApiV1MediaGenerateText({
    body: {
      prompt: [
        `围绕主题“${normalizedTheme}”生成一篇可直接发布的小红书图文文案。`,
        "标题不超过20个字符；正文自然、有信息量，避免Markdown标题；生成3到8个相关话题。",
        '只输出严格 JSON，不要代码块和额外说明：{"title":"...","content":"...","hashtags":["..."]}',
      ].join("\n"),
      ...(sourceText ? { sourceText } : {}),
    },
  });

  if (!data || error) throw new Error("AI 文案生成失败，请重试");
  return parseGeneratedXhsCopy(data.text);
}
