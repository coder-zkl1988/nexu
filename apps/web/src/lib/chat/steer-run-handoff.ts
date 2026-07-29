export type SteerRunHandoff = {
  previousRunId: string | null;
  replacementRunId: string | null;
  previousRunAborted: boolean;
  replacementRunTerminated: boolean;
  accepted: boolean;
};

export function beginSteerRunHandoff(
  previousRunId: string | null,
): SteerRunHandoff {
  return {
    previousRunId,
    replacementRunId: null,
    previousRunAborted: false,
    replacementRunTerminated: false,
    accepted: false,
  };
}

export function acceptSteerRunHandoff(
  handoff: SteerRunHandoff,
  replacementRunId: string | null,
): void {
  handoff.accepted = true;
  handoff.replacementRunId = replacementRunId;
}

export function consumeReplacementRunTerminal(
  handoff: SteerRunHandoff | null,
  terminalRunId: string,
): boolean {
  if (!handoff || handoff.replacementRunTerminated) return false;
  if (handoff.replacementRunId) {
    if (terminalRunId !== handoff.replacementRunId) return false;
  } else if (!handoff.previousRunAborted) {
    return false;
  } else {
    handoff.replacementRunId = terminalRunId;
  }
  handoff.replacementRunTerminated = true;
  return true;
}

export function consumePreviousRunAbort(
  handoff: SteerRunHandoff | null,
  abortedRunId: string,
): boolean {
  if (!handoff || handoff.previousRunAborted) return false;
  if (handoff.previousRunId && abortedRunId !== handoff.previousRunId) {
    return false;
  }
  handoff.previousRunAborted = true;
  return true;
}
