import type { DesktopDeskpetMood } from "../../shared/host";

export type DeskpetTaskMood = Extract<
  DesktopDeskpetMood,
  "error" | "lobster-replying" | "success" | "working"
>;

const DESKPET_TASK_MOODS: ReadonlySet<DesktopDeskpetMood> = new Set([
  "error",
  "lobster-replying",
  "success",
  "working",
]);

const DEFAULT_TASK_DURATION_MS: Record<DeskpetTaskMood, number> = {
  error: 4200,
  "lobster-replying": 4800,
  success: 3600,
  working: 2200,
};

export function isDeskpetTaskMood(
  mood: DesktopDeskpetMood,
): mood is DeskpetTaskMood {
  return DESKPET_TASK_MOODS.has(mood);
}

export function resolveDeskpetTaskDurationMs(
  mood: DesktopDeskpetMood,
  durationMs?: number,
): number | null {
  if (!isDeskpetTaskMood(mood)) {
    return null;
  }

  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return DEFAULT_TASK_DURATION_MS[mood];
  }

  return Math.max(500, Math.min(durationMs, 10_000));
}

export function resolveDeskpetMood(input: {
  activityMood: DesktopDeskpetMood | null;
  inactivityMood: DesktopDeskpetMood | null;
  manualMood: DesktopDeskpetMood | null;
  runtimeMood: DesktopDeskpetMood | null;
  taskMood: DesktopDeskpetMood | null;
}): DesktopDeskpetMood {
  return (
    input.taskMood ??
    input.manualMood ??
    input.activityMood ??
    input.inactivityMood ??
    input.runtimeMood ??
    "peek"
  );
}
