export interface PreviewArtifactCandidate {
  id: string;
  createdAt: string;
}

export interface PreviewAutoOpenTracker {
  sessionKey: string | null;
  startedAt: number;
  lastArtifactId: string | null;
}

export interface PreviewAutoOpenObservation {
  tracker: PreviewAutoOpenTracker;
  shouldOpen: boolean;
}

/**
 * How far before the baseline a preview may have been produced and still count
 * as belonging to the moment. Covers the gap between the agent writing the file
 * and the panel noticing it.
 */
export const PREVIEW_AUTO_OPEN_GRACE_MS = 15_000;

/**
 * Whether a preview is recent enough to open on its own.
 *
 * Local previews are discovered by scanning the *bot's* workspace for
 * index.html files — the filesystem carries no session attribution, so the
 * list includes everything that expert ever built. Opening the newest of those
 * unconditionally meant a page from weeks ago took over the panel in every new
 * conversation. Only something produced around or after the baseline can
 * plausibly be what the user is here to see.
 */
export function isFreshPreview(createdAt: string, baseline: number): boolean {
  const created = Date.parse(createdAt);
  return (
    Number.isFinite(created) && created >= baseline - PREVIEW_AUTO_OPEN_GRACE_MS
  );
}

export function createPreviewAutoOpenTracker(): PreviewAutoOpenTracker {
  return {
    sessionKey: null,
    startedAt: 0,
    lastArtifactId: null,
  };
}

export function observePreviewArtifact(input: {
  tracker: PreviewAutoOpenTracker;
  sessionKey: string | null;
  artifact: PreviewArtifactCandidate | null;
  now: number;
}): PreviewAutoOpenObservation {
  if (!input.sessionKey) {
    return {
      tracker: createPreviewAutoOpenTracker(),
      shouldOpen: false,
    };
  }

  const tracker =
    input.tracker.sessionKey === input.sessionKey
      ? input.tracker
      : {
          sessionKey: input.sessionKey,
          startedAt: input.now,
          lastArtifactId: null,
        };

  if (!input.artifact || tracker.lastArtifactId === input.artifact.id) {
    return { tracker, shouldOpen: false };
  }

  // Freshness is required of every artifact, not just the first one seen. The
  // old rule exempted later ones ("a change must be new work"), but the newest
  // preview can change for reasons that have nothing to do with this
  // conversation — a stale one resurfacing after a refetch, or the list
  // reordering — and each of those hijacked the panel.
  return {
    tracker: { ...tracker, lastArtifactId: input.artifact.id },
    shouldOpen: isFreshPreview(input.artifact.createdAt, tracker.startedAt),
  };
}
