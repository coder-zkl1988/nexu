import {
  type ImageQuality,
  buildImageGenOpts,
} from "@/lib/canvas/prompt-panel-utils";
import { generateImageViaJob } from "@/lib/media/image-generation-jobs";

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
  const data = await generateImageViaJob({
    prompt: request.prompt.trim(),
    ...buildImageGenOpts(request),
  });

  const urls = data.items.map((item) => item.url).filter(Boolean);
  if (urls.length === 0 && data.url) urls.push(data.url);
  if (urls.length === 0) throw new Error("生成结果中没有可用图片");
  return urls;
}
