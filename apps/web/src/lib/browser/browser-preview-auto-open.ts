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

const INITIAL_PREVIEW_GRACE_MS = 15_000;

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

  const isInitialArtifact = tracker.lastArtifactId === null;
  const createdAt = Date.parse(input.artifact.createdAt);
  const isFreshInitialArtifact =
    Number.isFinite(createdAt) &&
    createdAt >= tracker.startedAt - INITIAL_PREVIEW_GRACE_MS;

  return {
    tracker: { ...tracker, lastArtifactId: input.artifact.id },
    shouldOpen: !isInitialArtifact || isFreshInitialArtifact,
  };
}
