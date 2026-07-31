import {
  type ImageQuality,
  buildImageGenOpts,
} from "@/lib/canvas/prompt-panel-utils";
import { postApiV1MediaGenerateImage } from "../../../../lib/api/sdk.gen";

export type XHSImageGenerationRequest = {
  prompt: string;
  model: string;
  quality: ImageQuality;
  aspectRatio: string;
  size: string;
  count: number;
  transparentBackground: boolean;
};

export async function generateXhsImages(
  request: XHSImageGenerationRequest,
): Promise<string[]> {
  const { data, error } = await postApiV1MediaGenerateImage({
    body: {
      prompt: request.prompt.trim(),
      ...buildImageGenOpts(request),
    },
  });
  if (!data || error) throw new Error("图片生成失败");

  const urls = data.items.map((item) => item.url).filter(Boolean);
  if (urls.length === 0 && data.url) urls.push(data.url);
  if (urls.length === 0) throw new Error("生成结果中没有可用图片");
  return urls;
}
