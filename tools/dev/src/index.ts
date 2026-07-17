import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";

import {
  getCurrentControllerDevSnapshot,
  readControllerDevLog,
  restartControllerDevProcess,
  startControllerDevProcess,
  stopControllerDevProcess,
} from "./services/controller.js";
import {
  captureDesktopDevInspectScreenshot,
  evaluateDesktopDevInspectScript,
  getCurrentDesktopDevSnapshot,
  getDesktopDevInspectDomSnapshot,
  getDesktopDevInspectRendererLogs,
  readDesktopDevLog,
  restartDesktopDevProcess,
  startDesktopDevProcess,
  stopDesktopDevProcess,
} from "./services/desktop.js";
import {
  getCurrentOpenclawDevSnapshot,
  readOpenclawDevLog,
  restartOpenclawDevProcess,
  startOpenclawDevProcess,
  stopOpenclawDevProcess,
} from "./services/openclaw.js";
import {
  getCurrentWebDevSnapshot,
  readWebDevLog,
  restartWebDevProcess,
  startWebDevProcess,
  stopWebDevProcess,
} from "./services/web.js";
import { logger as rootLogger } from "./shared/logger.js";
import { defaultLogTailLineCount } from "./shared/logs.js";
import { createDevSessionId } from "./shared/trace.js";

const cli = cac("dev");
const logger = rootLogger.child({ component: "cli" });

const devTargets = ["desktop", "openclaw", "controller", "web"] as const;

type DevTarget = (typeof devTargets)[number];

type SnapshotLike = {
  service: string;
  status: "running" | "stopped" | "stale";
  staleReason?: string;
};

function readDevCommandTimeoutMs(
  action: "start" | "restart",
  isStack: boolean,
): number {
  const envKey = isStack
    ? `NEXU_DEV_${action.toUpperCase()}_STACK_TIMEOUT_MS`
    : `NEXU_DEV_${action.toUpperCase()}_TIMEOUT_MS`;
  const fallback = isStack ? 180000 : 45000;
  const rawValue = process.env[envKey];
  const parsed = Number.parseInt(rawValue ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function runWithCommandTimeout<T>(
  action: "start" | "restart",
  scope: string,
  isStack: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const timeoutMs = readDevCommandTimeoutMs(action, isStack);
  const timeoutHandle = setTimeout(() => {
    logger.error(`${action} timed out`, {
      action,
      scope,
      timeoutMs,
    });
    process.exit(1);
  }, timeoutMs);

  timeoutHandle.unref();

  try {
    return await run();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function warnIfSnapshotIsStale(snapshot: SnapshotLike): void {
  if (snapshot.status !== "stale") {
    return;
  }

  logger.warn(`${snapshot.service} is stale`, {
    service: snapshot.service,
    staleReason: snapshot.staleReason ?? "unknown stale reason",
  });
}

function getNoActiveLogMessage(snapshot: SnapshotLike): string {
  if (snapshot.status === "stale") {
    return snapshot.staleReason
      ? `${snapshot.service} is stale (${snapshot.staleReason}); active session logs may reflect the failed run`
      : `${snapshot.service} is stale; active session logs may reflect the failed run`;
  }

  return `${snapshot.service} is not running; no active session log is available`;
}

async function runDefaultStartStage(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  logger.info("starting service", { target, sessionId });
  await startTarget(target, sessionId);
  logger.info("startup stage complete", { target, sessionId });
}

async function runDefaultStopStage(target: DevTarget): Promise<void> {
  logger.info("stopping service", { target });
  await stopTarget(target);
  logger.info("stop stage complete", { target });
}

function readTargetOrThrow(target: string | undefined): DevTarget {
  if (!target) {
    throw new Error(
      "target is required; use `pnpm dev <start|status|stop|restart> <desktop|openclaw|controller|web>`",
    );
  }

  if (!(devTargets as readonly string[]).includes(target)) {
    throw new Error(`unsupported target: ${target}`);
  }

  return target as DevTarget;
}

function getWorkspaceRoot(): string {
  // Walk up from this file until we find pnpm-workspace.yaml
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find workspace root (pnpm-workspace.yaml)");
}

function ensureSharedBuilt(): void {
  const workspaceRoot = getWorkspaceRoot();
  logger.info("[preflight] @nexu/shared build");
  try {
    execFileSync("pnpm", ["--filter", "@nexu/shared", "build"], {
      cwd: workspaceRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
    logger.info("[preflight] @nexu/shared build done");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Preflight failed — @nexu/shared build error: ${message}`);
  }
}

async function startDefaultStack(): Promise<void> {
  ensureSharedBuilt();
  await runDefaultStartStage("openclaw", createDevSessionId());
  await runDefaultStartStage("controller", createDevSessionId());
  await runDefaultStartStage("web", createDevSessionId());
  await runDefaultStartStage("desktop", createDevSessionId());
}

async function stopDefaultStack(): Promise<void> {
  for (const target of ["desktop", "web", "controller", "openclaw"] as const) {
    try {
      await runDefaultStopStage(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("is not running")) {
        logger.info(`${target} already stopped`, { target });
        continue;
      }

      throw error;
    }
  }
}

async function restartDefaultStack(): Promise<void> {
  await stopDefaultStack();
  await startDefaultStack();
}

async function printDefaultStackStatus(): Promise<void> {
  for (const target of ["openclaw", "controller", "web", "desktop"] as const) {
    await printStatus(target);
  }
}

async function startTarget(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  switch (target) {
    case "desktop": {
      const desktopFact = await startDesktopDevProcess({ sessionId });
      logger.info("desktop started", desktopFact);
      return;
    }
    case "openclaw": {
      const openclawFact = await startOpenclawDevProcess({ sessionId });
      logger.info("openclaw started", openclawFact);
      return;
    }
    case "controller": {
      const controllerFact = await startControllerDevProcess({ sessionId });
      logger.info("controller started", controllerFact);
      return;
    }
    case "web": {
      const webFact = await startWebDevProcess({ sessionId });
      logger.info("web started", webFact);
      return;
    }
    default:
      throw new Error(`unsupported start target: ${target}`);
  }
}

async function stopTarget(target: DevTarget): Promise<void> {
  switch (target) {
    case "desktop": {
      const desktopFact = await stopDesktopDevProcess();
      logger.info("desktop stopped", desktopFact);
      return;
    }
    case "openclaw": {
      const openclawFact = await stopOpenclawDevProcess();
      logger.info("openclaw stopped", openclawFact);
      return;
    }
    case "controller": {
      const controllerFact = await stopControllerDevProcess();
      logger.info("controller stopped", controllerFact);
      return;
    }
    case "web": {
      const webFact = await stopWebDevProcess();
      logger.info("web stopped", webFact);
      return;
    }
    default:
      throw new Error(`unsupported stop target: ${target}`);
  }
}

async function restartTarget(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  switch (target) {
    case "desktop": {
      const desktopFact = await restartDesktopDevProcess({ sessionId });
      logger.info("desktop restarted", desktopFact);
      return;
    }
    case "openclaw": {
      const openclawFact = await restartOpenclawDevProcess({ sessionId });
      logger.info("openclaw restarted", openclawFact);
      return;
    }
    case "controller": {
      const controllerFact = await restartControllerDevProcess({ sessionId });
      logger.info("controller restarted", controllerFact);
      return;
    }
    case "web": {
      const webFact = await restartWebDevProcess({ sessionId });
      logger.info("web restarted", webFact);
      return;
    }
    default:
      throw new Error(`unsupported restart target: ${target}`);
  }
}

async function printStatus(target: DevTarget): Promise<void> {
  switch (target) {
    case "desktop": {
      const desktopSnapshot = await getCurrentDesktopDevSnapshot();
      logger.info("desktop status", desktopSnapshot);
      warnIfSnapshotIsStale(desktopSnapshot);
      return;
    }
    case "openclaw": {
      const openclawSnapshot = await getCurrentOpenclawDevSnapshot();
      logger.info("openclaw status", openclawSnapshot);
      warnIfSnapshotIsStale(openclawSnapshot);
      return;
    }
    case "controller": {
      const controllerSnapshot = await getCurrentControllerDevSnapshot();
      logger.info("controller status", controllerSnapshot);
      warnIfSnapshotIsStale(controllerSnapshot);
      return;
    }
    case "web": {
      const webSnapshot = await getCurrentWebDevSnapshot();
      logger.info("web status", webSnapshot);
      warnIfSnapshotIsStale(webSnapshot);
      return;
    }
    default:
      throw new Error(`unsupported status target: ${target}`);
  }
}

function printLogHeader(logFilePath: string, totalLineCount: number): void {
  logger.info("showing current session log tail", {
    totalLines: totalLineCount,
    maxLines: defaultLogTailLineCount,
    logFilePath,
  });
}

function readOptionalPositiveNumber(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received: ${String(value)}`);
  }

  return parsed;
}

cli
  .command("start [target]", "Start one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await runWithCommandTimeout("start", "stack", true, () =>
        startDefaultStack(),
      );
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    if (resolvedTarget === "controller") {
      ensureSharedBuilt();
    }
    const sessionId = createDevSessionId();
    await runWithCommandTimeout("start", resolvedTarget, false, () =>
      startTarget(resolvedTarget, sessionId),
    );
  });

cli
  .command("restart [target]", "Restart one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await runWithCommandTimeout("restart", "stack", true, () =>
        restartDefaultStack(),
      );
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    const sessionId = createDevSessionId();
    await runWithCommandTimeout("restart", resolvedTarget, false, () =>
      restartTarget(resolvedTarget, sessionId),
    );
  });

cli
  .command("stop [target]", "Stop one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await stopDefaultStack();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);

    try {
      await stopTarget(resolvedTarget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("is not running")) {
        logger.info(`${resolvedTarget} already stopped`, {
          target: resolvedTarget,
        });
        return;
      }

      throw error;
    }
  });

cli
  .command("status [target]", "Show status for one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await printDefaultStackStatus();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    await printStatus(resolvedTarget);
  });

cli
  .command("logs <target>", "Print the local dev logs")
  .action(async (target: string) => {
    const resolvedTarget = readTargetOrThrow(target);

    if (resolvedTarget === "desktop") {
      const snapshot = await getCurrentDesktopDevSnapshot();

      warnIfSnapshotIsStale(snapshot);

      const content = await readDesktopDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      if (snapshot.status === "stopped") {
        logger.warn(getNoActiveLogMessage(snapshot), {
          service: snapshot.service,
          logFilePath: content.logFilePath,
        });
      }
      process.stdout.write(content.content);
      return;
    }

    if (resolvedTarget === "openclaw") {
      const snapshot = await getCurrentOpenclawDevSnapshot();

      warnIfSnapshotIsStale(snapshot);

      const content = await readOpenclawDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      if (snapshot.status === "stopped") {
        logger.warn(getNoActiveLogMessage(snapshot), {
          service: snapshot.service,
          logFilePath: content.logFilePath,
        });
      }
      process.stdout.write(content.content);
      return;
    }

    if (resolvedTarget === "controller") {
      const snapshot = await getCurrentControllerDevSnapshot();

      warnIfSnapshotIsStale(snapshot);

      const content = await readControllerDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      if (snapshot.status === "stopped") {
        logger.warn(getNoActiveLogMessage(snapshot), {
          service: snapshot.service,
          logFilePath: content.logFilePath,
        });
      }
      process.stdout.write(content.content);
      return;
    }

    const snapshot = await getCurrentWebDevSnapshot();

    warnIfSnapshotIsStale(snapshot);

    const content = await readWebDevLog();
    printLogHeader(content.logFilePath, content.totalLineCount);
    if (snapshot.status === "stopped") {
      logger.warn(getNoActiveLogMessage(snapshot), {
        service: snapshot.service,
        logFilePath: content.logFilePath,
      });
    }
    process.stdout.write(content.content);
  });

cli
  .command(
    "inspect <action> [input]",
    "Inspect the desktop dev renderer: screenshot|eval <expr>|dom|logs",
  )
  .option("--out <path>", "Write screenshot PNG to this path (screenshot)")
  .option("--max-html-length <number>", "Cap returned DOM HTML length (dom)")
  .option("--limit <number>", "Limit renderer log entries (logs)")
  .action(
    async (
      action: string,
      input: string | undefined,
      options?: {
        out?: string;
        maxHtmlLength?: string | number;
        limit?: string | number;
      },
    ) => {
      switch (action) {
        case "screenshot": {
          const result = await captureDesktopDevInspectScreenshot({
            outputPath: options?.out,
          });
          process.stdout.write(`${result.outputPath}\n`);
          return;
        }
        case "eval": {
          if (!input) {
            throw new Error("inspect eval requires a script input");
          }
          const result = await evaluateDesktopDevInspectScript(input);
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        case "dom": {
          const result = await getDesktopDevInspectDomSnapshot({
            maxHtmlLength: readOptionalPositiveNumber(options?.maxHtmlLength),
          });
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        case "logs": {
          const result = await getDesktopDevInspectRendererLogs({
            limit: readOptionalPositiveNumber(options?.limit),
          });
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        default:
          throw new Error(
            `unsupported inspect action: ${action} (expected screenshot|eval|dom|logs)`,
          );
      }
    },
  );

cli.help();

cli.parse();
