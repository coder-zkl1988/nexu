import type { VideoComponent as VideoComp } from "../a2ui-types";

interface Props {
  comp: VideoComp;
  resolve: <T>(val: T) => unknown;
}

export function VideoComponent({ comp, resolve }: Props) {
  const source = String(resolve(comp.source) ?? "");
  const autoplay = resolve(comp.autoplay) === true;
  const muted = resolve(comp.muted) === true;

  return (
    <video
      className="a2ui-video"
      src={source}
      autoPlay={autoplay}
      muted={muted}
      controls
    />
  );
}
