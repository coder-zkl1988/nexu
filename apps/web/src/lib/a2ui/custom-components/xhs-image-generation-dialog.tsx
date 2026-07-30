import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCanvasModelOptions } from "@/lib/canvas/canvas-model-options";
import { ParamPill, SettingsGroup } from "@/lib/canvas/param-pills";
import {
  type ImageQuality,
  buildImageGenOpts,
  imageQualityLabel,
} from "@/lib/canvas/prompt-panel-utils";
import { ImagePlus, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { postApiV1MediaGenerateImage } from "../../../../lib/api/sdk.gen";

type XHSImageGenerationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (urls: string[]) => void;
};

export function XHSImageGenerationDialog({
  open,
  onOpenChange,
  onGenerated,
}: XHSImageGenerationDialogProps) {
  const models = useCanvasModelOptions("image");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [aspectRatio, setAspectRatio] = useState("");
  const [size, setSize] = useState("");
  const [count, setCount] = useState(1);
  const [transparentBackground, setTransparentBackground] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || generating) return;

    setGenerating(true);
    try {
      const { data, error } = await postApiV1MediaGenerateImage({
        body: {
          prompt: normalizedPrompt,
          ...buildImageGenOpts({
            count,
            model,
            quality,
            aspectRatio,
            size,
            transparentBackground,
          }),
        },
      });
      if (!data || error) throw new Error("图片生成失败");

      const urls = data.items.map((item) => item.url).filter(Boolean);
      if (urls.length === 0 && data.url) urls.push(data.url);
      if (urls.length === 0) throw new Error("生成结果中没有可用图片");

      onGenerated(urls);
      onOpenChange(false);
      toast.success(`已生成 ${urls.length} 张图片并添加到帖子`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-hidden rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-rose-600" />
            AI 生成帖子图片
          </DialogTitle>
          <DialogDescription className="mt-1">
            描述画面并选择生成参数，结果会直接加入当前帖子。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[calc(88vh-150px)] overflow-y-auto">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-text-secondary">
              画面描述
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：清晨咖啡馆窗边的手账与拿铁，自然光，生活方式摄影"
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-text-secondary"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-text-secondary">
              生成模型
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="h-8 min-w-44 rounded-lg border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none"
            >
              <option value="">默认模型</option>
              {models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-border bg-surface-1 p-3">
            <SettingsGroup label="质量">
              {(["auto", "high", "medium", "low"] as const).map((option) => (
                <ParamPill
                  key={option}
                  active={quality === option}
                  onClick={() => setQuality(option)}
                >
                  {imageQualityLabel(option)}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="宽高比">
              {["", "1:1", "3:4", "4:3", "9:16", "16:9"].map((option) => (
                <ParamPill
                  key={option || "default"}
                  active={aspectRatio === option}
                  onClick={() => setAspectRatio(option)}
                >
                  {option || "默认"}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="尺寸">
              {["", "1K", "2K", "4K"].map((option) => (
                <ParamPill
                  key={option || "default"}
                  active={size === option}
                  onClick={() => setSize(option)}
                >
                  {option || "默认"}
                </ParamPill>
              ))}
            </SettingsGroup>
            <SettingsGroup label="生成张数">
              {Array.from({ length: 12 }, (_, index) => index + 1).map(
                (option) => (
                  <ParamPill
                    key={option}
                    active={count === option}
                    onClick={() => setCount(option)}
                  >
                    {option} 张
                  </ParamPill>
                ),
              )}
            </SettingsGroup>
            <SettingsGroup label="透明背景">
              <ParamPill
                active={!transparentBackground}
                onClick={() => setTransparentBackground(false)}
              >
                关
              </ParamPill>
              <ParamPill
                active={transparentBackground}
                onClick={() => setTransparentBackground(true)}
              >
                开
              </ParamPill>
            </SettingsGroup>
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={generating}
            className="h-9 rounded-lg border border-border px-4 text-sm text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !prompt.trim()}
            className="flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {generating ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ImagePlus size={15} />
            )}
            {generating ? "生成中" : "生成并添加"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
