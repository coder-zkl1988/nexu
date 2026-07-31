export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const VIDEO_ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
] as const;
export const VIDEO_FRAME_PRESETS = [81, 121, 241, 441] as const;

export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "720p";
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = "16:9";
export const DEFAULT_VIDEO_NUM_FRAMES = 121;
export const DEFAULT_VIDEO_FRAME_RATE = 24;

export function isVideoAspectRatio(
  value: string | undefined,
): value is VideoAspectRatio {
  return VIDEO_ASPECT_RATIOS.some((ratio) => ratio === value);
}

export function isVideoResolution(
  value: string | undefined,
): value is VideoResolution {
  return VIDEO_RESOLUTIONS.some((resolution) => resolution === value);
}

export function isValidVideoNumFrames(
  value: number | undefined,
): value is number {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 441 &&
    (value - 1) % 8 === 0
  );
}

export function resolveVideoFrameRate(value: number | undefined): number {
  return value !== undefined &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 60
    ? value
    : DEFAULT_VIDEO_FRAME_RATE;
}

/** Normalize persisted frame settings, including the legacy seconds field. */
export function resolveCanvasVideoNumFrames(input: {
  numFrames?: number;
  durationSeconds?: number;
  frameRate?: number;
}): number {
  if (isValidVideoNumFrames(input.numFrames)) {
    return input.numFrames;
  }

  const frameRate = resolveVideoFrameRate(input.frameRate);
  if (
    input.durationSeconds === undefined ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0
  ) {
    return DEFAULT_VIDEO_NUM_FRAMES;
  }

  const nearestStep = Math.round((input.durationSeconds * frameRate - 1) / 8);
  const boundedStep = Math.min(55, Math.max(0, nearestStep));
  return boundedStep * 8 + 1;
}

export function videoDurationSeconds(
  numFrames: number,
  frameRate: number,
): number {
  if (frameRate <= 0) return 0;
  return Math.round((numFrames / frameRate) * 10) / 10;
}
