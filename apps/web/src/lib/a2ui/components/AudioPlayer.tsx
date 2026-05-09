import type { AudioPlayerComponent as AudioPlayerComp } from "../a2ui-types";

interface Props {
  comp: AudioPlayerComp;
  resolve: <T>(val: T) => unknown;
}

export function AudioPlayerComponent({ comp, resolve }: Props) {
  const source = String(resolve(comp.source) ?? "");
  const title = comp.title ? String(resolve(comp.title) ?? "") : undefined;

  return (
    <div className="a2ui-audio">
      {title && <span className="a2ui-audio__title">{title}</span>}
      <audio className="a2ui-audio__player" src={source} controls>
        <track kind="captions" />
      </audio>
    </div>
  );
}
