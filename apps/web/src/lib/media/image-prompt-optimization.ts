import { postApiV1MediaGenerateText } from "../../../lib/api/sdk.gen";

export type XhsPostPromptContext = {
  title: string;
  content: string;
  hashtags: string[];
};

const MAX_SOURCE_TEXT_CHARS = 8_000;

function normalizeGeneratedPrompt(text: string): string {
  const trimmed = text.trim();
  const unfenced =
    trimmed.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i)?.[1] ??
    trimmed;
  return unfenced
    .trim()
    .replace(/^(?:优化后的提示词|图片提示词|提示词)\s*[:：]\s*/i, "")
    .replace(/^[“”"]|[“”"]$/g, "")
    .trim();
}

function serializeXhsPost(context: XhsPostPromptContext): string {
  const title = context.title.trim().slice(0, 120);
  const hashtags = context.hashtags
    .map((tag) => tag.trim().replace(/^#+/, "").slice(0, 64))
    .filter(Boolean)
    .slice(0, 10);
  const serialize = (content: string) =>
    JSON.stringify({ title, content, hashtags });
  const content = context.content.trim();
  const full = serialize(content);
  if (full.length <= MAX_SOURCE_TEXT_CHARS) return full;

  let lower = 0;
  let upper = content.length;
  while (lower < upper) {
    const midpoint = Math.ceil((lower + upper) / 2);
    if (serialize(content.slice(0, midpoint)).length <= MAX_SOURCE_TEXT_CHARS) {
      lower = midpoint;
    } else {
      upper = midpoint - 1;
    }
  }
  return serialize(content.slice(0, lower));
}

async function generateImagePrompt(
  instruction: string,
  sourceText: string,
): Promise<string> {
  const { data, error } = await postApiV1MediaGenerateText({
    body: { prompt: instruction, sourceText },
  });
  if (!data || error) throw new Error("AI 提示词生成失败，请重试");

  const result = normalizeGeneratedPrompt(data.text);
  if (!result) throw new Error("AI 没有返回有效提示词，请重试");
  return result;
}

export async function generateXhsImagePrompt(
  context: XhsPostPromptContext,
): Promise<string> {
  const sourceText = serializeXhsPost(context);
  if (!context.title.trim() && !context.content.trim()) {
    throw new Error("请先填写帖子标题或正文");
  }

  return generateImagePrompt(
    [
      "根据下方小红书帖子，生成一条可直接交给 GPT-image-2 的单张封面图提示词。",
      "提炼核心主题和视觉钩子，不要照抄全文；把抽象概念转换为具体、可见的画面元素。",
      "明确主体、动作、场景、构图、镜头视角、光线、色彩、材质和氛围。",
      "默认按小红书 3:4 竖版封面设计，主体清晰、层次明确，并保留合理视觉留白。",
      "除非帖子明确要求，画面中不要出现文字、品牌标识、水印或应用界面。",
      "只返回一条完整的中文图片提示词，不要解释、标题、引号或 Markdown。",
    ].join("\n"),
    sourceText,
  );
}

export async function optimizeImagePrompt(prompt: string): Promise<string> {
  const sourceText = prompt.trim();
  if (!sourceText) throw new Error("请先输入图片描述");

  return generateImagePrompt(
    [
      "将下方用户描述改写为适合 GPT-image-2 的高质量图片提示词。",
      "保留用户明确的主题、事实、人物身份、数量、指定文字、风格和限制，不要改变原意。",
      "补全可见主体、动作、环境、构图、镜头视角、光线、色彩、材质、氛围和画质要求。",
      "消除含糊、矛盾和不可视的描述，使用自然、具体、结构清晰的中文。",
      "用户要求画面文字时须逐字保留并说明排版；否则不要自行添加文字、Logo 或水印。",
      "只返回一条可直接提交的最终提示词，不要解释、标题、引号或 Markdown。",
    ].join("\n"),
    sourceText.slice(0, MAX_SOURCE_TEXT_CHARS),
  );
}
