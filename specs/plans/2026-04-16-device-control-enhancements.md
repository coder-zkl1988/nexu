# Device Control Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three follow-ups to the Android Device Control integration: (A) a Settings UI panel to toggle the plugin and edit ports, (B) task history persistence with list and detail pages, and (C) a browser-based screen mirror with click/swipe/input relay.

**Architecture:** All three features build on the already-shipped `apps/controller/src/services/device-control-service.ts` + `apps/controller/src/routes/device-control-routes.ts` + `apps/web/src/pages/devices/` stack. Settings UI is purely additive (existing SDK endpoint). Task history adds a `lowdb`-backed `DeviceTaskHistoryStore` and two read endpoints; executeTask persists on completion. Screen mirror adds a WebSocket proxy in the controller that bridges the browser to the plugin's `ws://127.0.0.1:${wsPort}/phone` endpoint.

**Tech Stack:** TypeScript, Hono + zod-openapi (controller), React + TanStack Query + Tailwind (web), Zod (schemas), `lowdb` (persistence — already a controller dep), `ws` (WebSocket — **new dep, requires explicit approval**).

---

## ⚠️ BLOCKING: New Dependency Approval Required

Task 3 (screen mirror) needs the `ws` package added to `apps/controller/package.json` (`^8.18.0`). Per `AGENTS.md`:

> Do not add dependencies without explicit approval.

**Before Task 3 is dispatched, get user approval.** Tasks 1 and 2 have no new-dep requirement and can ship independently.

**If `ws` is declined:** Fall back to `Alt-Task 3` (HTTP polling of `GET /api/v1/devices/{deviceId}/screenshot` at 1–2 Hz). The UX is degraded (no click/swipe relay) but ships with zero new deps.

---

## Pre-reading (required before starting)

| File | Why |
|---|---|
| `apps/controller/src/store/schemas.ts:565-571` | `deviceControl` config shape — `{ enabled, wsPort: 18790, rpcPort: 18801 }` |
| `apps/controller/src/routes/runtime-config-routes.ts:62-98` | Existing `PATCH /api/v1/runtime-config/device-control` endpoint (Task 1 consumer) |
| `apps/controller/src/store/lowdb-store.ts` | `LowDbStore<T>` pattern used by every persistence store |
| `apps/controller/src/store/artifacts-store.ts:17-27` | Reference pattern for a new `LowDbStore`-backed store |
| `apps/controller/src/app/container.ts:80-156` | Where `DeviceControlService` is wired — Task 2 adds `deviceTaskHistoryStore` alongside |
| `apps/controller/src/services/device-control-service.ts` | Existing service — Task 2 adds persistence into `executeTask` |
| `apps/controller/src/routes/device-control-routes.ts` | Pattern to mirror for Task 2 task-history routes |
| `apps/controller/src/index.ts` | `@hono/node-server` serve() — Task 3 upgrade handler hooks here |
| `apps/web/src/pages/models.tsx:1-80` | Settings page; Task 1 adds a `<Card>` section |
| `apps/web/src/components/ui/switch.tsx`, `card.tsx`, `input.tsx`, `label.tsx` | Existing primitives — Task 1 composes |
| `apps/web/src/pages/devices/index.tsx` | Polling pattern + error UI — reused by Task 2's history list |
| `apps/web/src/app.tsx:55-94` | Route table — Task 2 adds `/workspace/devices/tasks` and `:id` |
| `~/workspace/openclaw-lobster-device-control/src/protocol.ts:58-167` | `MirrorSnapshotSchema`, `MirrorClickParamsSchema`, `MirrorSwipeParamsSchema`, etc. — Task 3 schema source |
| `~/workspace/openclaw-lobster-device-control/src/ws-server.ts` | `/phone` channel multiplexing — Task 3 proxies these frames |

---

## File Structure

### New files (Nexu)
- `packages/shared/src/schemas/device-task-history.ts` — Task 2 schemas
- `packages/shared/src/schemas/device-mirror.ts` — Task 3 schemas (re-export of plugin mirror types)
- `apps/controller/src/store/device-task-history-store.ts` — Task 2 `LowDbStore`-backed ring buffer
- `apps/controller/src/routes/device-task-history-routes.ts` — Task 2 `GET /api/v1/devices/tasks` + `/:taskId`
- `apps/controller/src/services/device-mirror-proxy.ts` — Task 3 WS proxy (browser ↔ plugin)
- `apps/controller/tests/device-task-history-store.test.ts` — Task 2 unit test
- `apps/web/src/pages/devices/settings-section.tsx` — Task 1 composable section mounted in `models.tsx`
- `apps/web/src/pages/devices/task-history-page.tsx` — Task 2 list view
- `apps/web/src/pages/devices/task-detail-page.tsx` — Task 2 detail view
- `apps/web/src/pages/devices/mirror-dialog.tsx` — Task 3 browser mirror component
- `apps/web/src/pages/devices/use-mirror-socket.ts` — Task 3 WebSocket hook

### Modified files (Nexu)
- `packages/shared/src/index.ts` — export new schemas (Tasks 2 & 3)
- `apps/controller/src/app/env.ts` — add `deviceTaskHistoryPath` (Task 2)
- `apps/controller/src/app/container.ts` — wire `DeviceTaskHistoryStore` (Task 2) and `DeviceMirrorProxy` (Task 3)
- `apps/controller/src/app/create-app.ts` — register new routes (Tasks 2 & 3)
- `apps/controller/src/services/device-control-service.ts` — persist results in `executeTask` (Task 2)
- `apps/controller/src/index.ts` — register WS upgrade handler (Task 3)
- `apps/controller/package.json` — add `ws` + `@types/ws` (Task 3, gated on approval)
- `apps/web/src/pages/models.tsx` — mount `<DeviceControlSettingsSection />` (Task 1)
- `apps/web/src/pages/devices/index.tsx` — add "Task history" link + "View screen" button wiring (Tasks 2 & 3)
- `apps/web/src/pages/devices/device-card.tsx` — add "View screen" button (Task 3)
- `apps/web/src/app.tsx` — add two routes (Task 2)

---

## Task 1: Device Control settings panel

**Goal:** A card in `/workspace/settings` with a toggle for `deviceControl.enabled` and numeric inputs for `wsPort` / `rpcPort`. Uses the already-deployed `PATCH /api/v1/runtime-config/device-control` endpoint; no backend changes.

**Files:**
- Create: `apps/web/src/pages/devices/settings-section.tsx`
- Modify: `apps/web/src/pages/models.tsx` (add import + mount section)

- [ ] **Step 1: Create the settings section component**

Write `apps/web/src/pages/devices/settings-section.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  getApiV1RuntimeConfig,
  patchApiV1RuntimeConfigDeviceControl,
} from "../../../lib/api/sdk.gen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;

export function DeviceControlSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: RUNTIME_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await getApiV1RuntimeConfig();
      if (res.error) throw new Error("Failed to load runtime config");
      return res.data;
    },
  });

  const deviceControl = data?.deviceControl;
  const [wsPort, setWsPort] = useState("");
  const [rpcPort, setRpcPort] = useState("");

  useEffect(() => {
    if (deviceControl) {
      setWsPort(String(deviceControl.wsPort));
      setRpcPort(String(deviceControl.rpcPort));
    }
  }, [deviceControl]);

  const patchMutation = useMutation({
    mutationFn: async (body: {
      enabled?: boolean;
      wsPort?: number;
      rpcPort?: number;
    }) => {
      const res = await patchApiV1RuntimeConfigDeviceControl({ body });
      if (res.error) throw new Error("Update failed");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNTIME_CONFIG_QUERY_KEY });
      toast.success("Device control updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleToggle = (checked: boolean) => {
    patchMutation.mutate({ enabled: checked });
  };

  const handleSavePorts = () => {
    const ws = Number(wsPort);
    const rpc = Number(rpcPort);
    if (!Number.isInteger(ws) || ws <= 0 || !Number.isInteger(rpc) || rpc <= 0) {
      toast.error("Ports must be positive integers");
      return;
    }
    patchMutation.mutate({ wsPort: ws, rpcPort: rpc });
  };

  if (isLoading || !deviceControl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading device control config…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Android Device Control</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Enable plugin</div>
            <div className="text-[12px] text-text-muted mt-0.5">
              Runs the lobster-device-control plugin to accept Android
              connections at ws://0.0.0.0:{deviceControl.wsPort}/phone
            </div>
          </div>
          <Switch
            checked={deviceControl.enabled}
            onCheckedChange={handleToggle}
            disabled={patchMutation.isPending}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <Label htmlFor="ws-port">WebSocket port (phone)</Label>
            <Input
              id="ws-port"
              type="number"
              min={1}
              max={65535}
              value={wsPort}
              onChange={(e) => setWsPort(e.target.value)}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <Label htmlFor="rpc-port">HTTP RPC port (controller)</Label>
            <Input
              id="rpc-port"
              type="number"
              min={1}
              max={65535}
              value={rpcPort}
              onChange={(e) => setRpcPort(e.target.value)}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={handleSavePorts}
              disabled={patchMutation.isPending}
            >
              Save ports
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount in models.tsx**

Edit `apps/web/src/pages/models.tsx`. Add near other page-scoped imports:

```tsx
import { DeviceControlSettingsSection } from "./devices/settings-section";
```

Find the JSX section that renders settings cards (search for `className="mx-auto max-w-3xl space-y-6"` or similar wrapping element). Add as the last child of the wrapper:

```tsx
<DeviceControlSettingsSection />
```

- [ ] **Step 3: Typecheck & lint**

Run: `pnpm --filter @nexu/web typecheck && pnpm --filter @nexu/web lint`
Expected: 0 errors.

- [ ] **Step 4: Manual verification**

```bash
pnpm dev start
```
Open `http://localhost:<web-port>/workspace/settings` → the Device Control card renders, toggle round-trips through the API, ports save and persist across reload.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/devices/settings-section.tsx apps/web/src/pages/models.tsx
git commit -m "feat(web): add device control settings panel"
```

---

## Task 2: Task history persistence + list/detail pages

**Goal:** Persist every task result (success and failure) in a `lowdb` ring buffer (capped at 200), expose `GET /api/v1/devices/tasks` and `GET /api/v1/devices/tasks/:taskId`, and render two new pages at `/workspace/devices/tasks` and `/workspace/devices/tasks/:id`.

**Files:**
- Create: `packages/shared/src/schemas/device-task-history.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/controller/src/store/device-task-history-store.ts`
- Create: `apps/controller/tests/device-task-history-store.test.ts`
- Modify: `apps/controller/src/app/env.ts`
- Modify: `apps/controller/src/app/container.ts`
- Modify: `apps/controller/src/services/device-control-service.ts`
- Create: `apps/controller/src/routes/device-task-history-routes.ts`
- Modify: `apps/controller/src/app/create-app.ts`
- Create: `apps/web/src/pages/devices/task-history-page.tsx`
- Create: `apps/web/src/pages/devices/task-detail-page.tsx`
- Modify: `apps/web/src/pages/devices/index.tsx`
- Modify: `apps/web/src/app.tsx`

### 2a. Backend persistence

- [ ] **Step 1: Add shared schemas**

Create `packages/shared/src/schemas/device-task-history.ts`:

```typescript
import { z } from "zod";
import { taskResultSchema } from "./device-control.js";

export const deviceTaskHistoryEntrySchema = z.object({
  deviceId: z.string(),
  taskId: z.string(),
  task: z.string(),
  maxSteps: z.number().int().optional(),
  dispatchedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  result: taskResultSchema,
});

export const deviceTaskHistoryIndexSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  entries: z.array(deviceTaskHistoryEntrySchema).default([]),
});

export const deviceTaskHistoryListResponseSchema = z.object({
  entries: z.array(deviceTaskHistoryEntrySchema),
});

export type DeviceTaskHistoryEntry = z.infer<
  typeof deviceTaskHistoryEntrySchema
>;
export type DeviceTaskHistoryIndex = z.infer<
  typeof deviceTaskHistoryIndexSchema
>;
export type DeviceTaskHistoryListResponse = z.infer<
  typeof deviceTaskHistoryListResponseSchema
>;
```

- [ ] **Step 2: Export from shared**

Edit `packages/shared/src/index.ts`, add:

```typescript
export * from "./schemas/device-task-history.js";
```

- [ ] **Step 3: Build shared**

Run: `pnpm --filter @nexu/shared build`
Expected: 0 errors.

- [ ] **Step 4: Write failing test for DeviceTaskHistoryStore**

Create `apps/controller/tests/device-task-history-store.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeviceTaskHistoryStore } from "../src/store/device-task-history-store.js";

describe("DeviceTaskHistoryStore", () => {
  let tmpDir: string;
  let store: DeviceTaskHistoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "nexu-task-history-"));
    store = new DeviceTaskHistoryStore(path.join(tmpDir, "history.json"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends entries and returns them newest-first", async () => {
    await store.append({
      deviceId: "d1",
      taskId: "t1",
      task: "open wechat",
      dispatchedAt: "2026-04-16T00:00:00.000Z",
      completedAt: "2026-04-16T00:00:05.000Z",
      result: { taskId: "t1", success: true },
    });
    await store.append({
      deviceId: "d1",
      taskId: "t2",
      task: "send message",
      dispatchedAt: "2026-04-16T00:00:10.000Z",
      completedAt: "2026-04-16T00:00:15.000Z",
      result: { taskId: "t2", success: false },
    });

    const entries = await store.list();
    expect(entries.map((e) => e.taskId)).toEqual(["t2", "t1"]);
  });

  it("caps history at 200 entries (oldest dropped)", async () => {
    for (let i = 0; i < 210; i++) {
      await store.append({
        deviceId: "d1",
        taskId: `t${i}`,
        task: "x",
        dispatchedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:00.000Z",
        result: { taskId: `t${i}`, success: true },
      });
    }
    const entries = await store.list();
    expect(entries).toHaveLength(200);
    expect(entries[0].taskId).toBe("t209");
    expect(entries[199].taskId).toBe("t10");
  });

  it("getByTaskId returns the matching entry or null", async () => {
    await store.append({
      deviceId: "d1",
      taskId: "t1",
      task: "x",
      dispatchedAt: "2026-04-16T00:00:00.000Z",
      completedAt: "2026-04-16T00:00:00.000Z",
      result: { taskId: "t1", success: true },
    });
    expect((await store.getByTaskId("t1"))?.taskId).toBe("t1");
    expect(await store.getByTaskId("missing")).toBeNull();
  });
});
```

- [ ] **Step 5: Verify test fails**

Run: `pnpm --filter @nexu/controller test device-task-history-store`
Expected: FAIL — `Cannot find module '.../device-task-history-store.js'`

- [ ] **Step 6: Implement the store**

Create `apps/controller/src/store/device-task-history-store.ts`:

```typescript
import {
  type DeviceTaskHistoryEntry,
  type DeviceTaskHistoryIndex,
  deviceTaskHistoryIndexSchema,
} from "@nexu/shared";
import { LowDbStore } from "./lowdb-store.js";

const MAX_ENTRIES = 200;

export class DeviceTaskHistoryStore {
  private readonly store: LowDbStore<DeviceTaskHistoryIndex>;

  constructor(filePath: string) {
    this.store = new LowDbStore<DeviceTaskHistoryIndex>(
      filePath,
      deviceTaskHistoryIndexSchema,
      () => ({ schemaVersion: 1, entries: [] }),
    );
  }

  async list(): Promise<DeviceTaskHistoryEntry[]> {
    const data = await this.store.read();
    return data.entries;
  }

  async getByTaskId(taskId: string): Promise<DeviceTaskHistoryEntry | null> {
    const entries = await this.list();
    return entries.find((entry) => entry.taskId === taskId) ?? null;
  }

  async append(entry: DeviceTaskHistoryEntry): Promise<void> {
    await this.store.update((current) => ({
      ...current,
      entries: [entry, ...current.entries].slice(0, MAX_ENTRIES),
    }));
  }
}
```

- [ ] **Step 7: Verify test passes**

Run: `pnpm --filter @nexu/controller test device-task-history-store`
Expected: 3/3 passing.

- [ ] **Step 8: Add `deviceTaskHistoryPath` to env**

Edit `apps/controller/src/app/env.ts`. Locate the existing path resolution for `artifactsIndexPath` (grep for `artifactsIndexPath` in the file). Immediately after its assignment add:

```typescript
deviceTaskHistoryPath: path.join(nexuHomeDir, "device-task-history.json"),
```

Also add the field to the `ControllerEnv` type/interface defined in the same file (mirror the existing `artifactsIndexPath: string;` line).

- [ ] **Step 9: Wire store in container**

Edit `apps/controller/src/app/container.ts`. At the top add:

```typescript
import { DeviceTaskHistoryStore } from "../store/device-task-history-store.js";
```

Immediately after `const artifactsStore = new ArtifactsStore(env);` add:

```typescript
const deviceTaskHistoryStore = new DeviceTaskHistoryStore(
  env.deviceTaskHistoryPath,
);
```

Pass it into `DeviceControlService`. Change the existing:

```typescript
const deviceControlService = new DeviceControlService(configStore);
```

to:

```typescript
const deviceControlService = new DeviceControlService(
  configStore,
  deviceTaskHistoryStore,
);
```

Add `deviceTaskHistoryStore` to the returned `ControllerContainer` object (both the return literal and the interface — mirror how `artifactsStore` is exposed).

- [ ] **Step 10: Persist results in executeTask**

Edit `apps/controller/src/services/device-control-service.ts`:

Update imports at the top:

```typescript
import type { DeviceTaskHistoryStore } from "../store/device-task-history-store.js";
```

Change the constructor:

```typescript
constructor(
  private readonly configStore: NexuConfigStore,
  private readonly taskHistoryStore: DeviceTaskHistoryStore,
) {}
```

Replace the existing `executeTask` body with:

```typescript
async executeTask(
  deviceId: string,
  body: DeviceExecuteTaskBody,
): Promise<{ result: TaskResult }> {
  const taskTimeout = body.timeout ?? 120_000;
  const dispatchedAt = new Date().toISOString();
  const result = await this.rpc<TaskResult>(
    "device.execute_task",
    { deviceId, task: body.task, timeoutMs: taskTimeout },
    taskTimeout + 5_000,
  );
  await this.taskHistoryStore.append({
    deviceId,
    taskId: result.taskId,
    task: body.task,
    maxSteps: body.maxSteps,
    dispatchedAt,
    completedAt: new Date().toISOString(),
    result,
  });
  return { result };
}
```

- [ ] **Step 11: Add task-history routes**

Create `apps/controller/src/routes/device-task-history-routes.ts`:

```typescript
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  deviceTaskHistoryEntrySchema,
  deviceTaskHistoryListResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const taskIdParamSchema = z.object({ taskId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerDeviceTaskHistoryRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices/tasks",
      tags: ["Device Control"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: deviceTaskHistoryListResponseSchema,
            },
          },
          description: "Task history (newest first, max 200)",
        },
      },
    }),
    async (c) => {
      const entries = await container.deviceTaskHistoryStore.list();
      return c.json({ entries }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/devices/tasks/{taskId}",
      tags: ["Device Control"],
      request: { params: taskIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: deviceTaskHistoryEntrySchema },
          },
          description: "Task history entry",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Task not found in history",
        },
      },
    }),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const entry = await container.deviceTaskHistoryStore.getByTaskId(taskId);
      if (entry === null) {
        return c.json({ message: "Task not found in history" }, 404);
      }
      return c.json(entry, 200);
    },
  );
}
```

- [ ] **Step 12: Register routes in create-app**

Edit `apps/controller/src/app/create-app.ts`. Add:

```typescript
import { registerDeviceTaskHistoryRoutes } from "../routes/device-task-history-routes.js";
```

and, next to the existing `registerDeviceControlRoutes(app, container);` call:

```typescript
registerDeviceTaskHistoryRoutes(app, container);
```

- [ ] **Step 13: Typecheck & regenerate SDK**

```bash
pnpm --filter @nexu/controller typecheck
pnpm generate-types
pnpm --filter @nexu/web typecheck
```
Expected: 0 errors, new `getApiV1DevicesTasks` / `getApiV1DevicesTasksByTaskId` appear in `apps/web/lib/api/sdk.gen.ts`.

- [ ] **Step 14: Commit backend**

```bash
git add packages/shared/src/schemas/device-task-history.ts packages/shared/src/index.ts \
        apps/controller/src/store/device-task-history-store.ts \
        apps/controller/tests/device-task-history-store.test.ts \
        apps/controller/src/app/env.ts \
        apps/controller/src/app/container.ts \
        apps/controller/src/services/device-control-service.ts \
        apps/controller/src/routes/device-task-history-routes.ts \
        apps/controller/src/app/create-app.ts \
        apps/web/lib/api/
git commit -m "feat(controller): persist device task history with list/detail endpoints"
```

### 2b. Frontend pages

- [ ] **Step 15: Build task history list page**

Create `apps/web/src/pages/devices/task-history-page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DeviceTaskHistoryEntry } from "@nexu/shared";
import { getApiV1DevicesTasks } from "../../../lib/api/sdk.gen";

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function DeviceTaskHistoryPage() {
  const [entries, setEntries] = useState<DeviceTaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getApiV1DevicesTasks();
        if (cancelled) return;
        if (res.error) {
          setError("Failed to load history");
        } else {
          setEntries(res.data?.entries ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            Device task history
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Last 200 tasks dispatched via the device control plugin
          </p>
        </div>
        <Link
          to="/workspace/devices"
          className="text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
        >
          ← Back to devices
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[13px] text-text-muted">
          No tasks dispatched yet.
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-1 overflow-hidden">
          {entries.map((entry) => (
            <Link
              key={entry.taskId}
              to={`/workspace/devices/tasks/${entry.taskId}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
            >
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  entry.result.success ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary truncate">
                  {entry.task}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2">
                  <span>{entry.deviceId}</span>
                  <span>·</span>
                  <span>{new Date(entry.completedAt).toLocaleString()}</span>
                  <span>·</span>
                  <span>{formatDuration(entry.result.duration)}</span>
                  {entry.result.totalSteps !== undefined && (
                    <>
                      <span>·</span>
                      <span>{entry.result.totalSteps} steps</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 16: Build task detail page**

Create `apps/web/src/pages/devices/task-detail-page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DeviceTaskHistoryEntry } from "@nexu/shared";
import { getApiV1DevicesTasksByTaskId } from "../../../lib/api/sdk.gen";

export function DeviceTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<DeviceTaskHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getApiV1DevicesTasksByTaskId({
          path: { taskId: id },
        });
        if (cancelled) return;
        if (res.error) {
          setError("Task not found");
        } else {
          setEntry(res.data ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      <div className="mb-6">
        <Link
          to="/workspace/devices/tasks"
          className="text-[12px] text-text-secondary hover:text-text-primary"
        >
          ← Back to history
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (error || entry === null) && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-600">
          {error ?? "Task not found"}
        </div>
      )}

      {entry && (
        <div className="flex flex-col gap-6">
          <div>
            <div className="text-[13px] text-text-muted mb-1">Task</div>
            <div className="text-[15px] font-medium text-text-primary">
              {entry.task}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[12px]">
            <div>
              <div className="text-text-muted">Device</div>
              <div className="text-text-primary mt-0.5 truncate">
                {entry.deviceId}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Status</div>
              <div
                className={`mt-0.5 font-medium ${
                  entry.result.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {entry.result.success ? "Success" : "Failed"}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Duration</div>
              <div className="text-text-primary mt-0.5">
                {entry.result.duration !== undefined
                  ? `${(entry.result.duration / 1000).toFixed(1)}s`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Steps</div>
              <div className="text-text-primary mt-0.5">
                {entry.result.totalSteps ?? "—"}
              </div>
            </div>
          </div>

          {entry.result.message && (
            <div>
              <div className="text-[13px] text-text-muted mb-1">Message</div>
              <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary whitespace-pre-wrap">
                {entry.result.message}
              </div>
            </div>
          )}

          {entry.result.steps && entry.result.steps.length > 0 && (
            <div>
              <div className="text-[13px] text-text-muted mb-2">Steps</div>
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-1 overflow-hidden">
                {entry.result.steps.map((step) => (
                  <div
                    key={step.step}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span
                      className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                        step.success ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-text-primary">
                        <span className="text-text-muted mr-2">
                          #{step.step}
                        </span>
                        {step.action}
                        {step.target && (
                          <span className="text-text-muted ml-1">
                            → {step.target}
                          </span>
                        )}
                      </div>
                      {step.error && (
                        <div className="text-[11px] text-red-600 mt-0.5">
                          {step.error}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {entry.result.finalScreenshot && (
            <div>
              <div className="text-[13px] text-text-muted mb-2">
                Final screenshot
              </div>
              <img
                src={`data:image/png;base64,${entry.result.finalScreenshot}`}
                alt="Final screen"
                className="max-w-[320px] rounded-lg border border-border"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 17: Add routes in app.tsx**

Edit `apps/web/src/app.tsx`. Add imports:

```tsx
import { DeviceTaskHistoryPage } from "./pages/devices/task-history-page";
import { DeviceTaskDetailPage } from "./pages/devices/task-detail-page";
```

After the existing `<Route path="/workspace/devices" element={<DevicesPage />} />` add:

```tsx
<Route
  path="/workspace/devices/tasks"
  element={<DeviceTaskHistoryPage />}
/>
<Route
  path="/workspace/devices/tasks/:id"
  element={<DeviceTaskDetailPage />}
/>
```

- [ ] **Step 18: Add "Task history" link in devices page header**

Edit `apps/web/src/pages/devices/index.tsx`. Replace the header's `<button>` for Refresh with a row that includes a history link first:

```tsx
<div className="flex items-center gap-2">
  <a
    href="/workspace/devices/tasks"
    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all"
  >
    Task history
  </a>
  <button
    type="button"
    onClick={handleRefresh}
    disabled={loading}
    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-2 transition-all disabled:opacity-60"
  >
    <span
      className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full ${loading ? "animate-spin" : ""}`}
    />
    Refresh
  </button>
</div>
```

(Replace the single `<button>` that currently sits to the right of the `<h1>`.)

- [ ] **Step 19: Typecheck & lint**

```bash
pnpm --filter @nexu/web typecheck
pnpm --filter @nexu/web lint
```
Expected: 0 errors.

- [ ] **Step 20: Manual verification**

```bash
pnpm dev start
```
- Dispatch a task to an Android device from `/workspace/devices`.
- Navigate to `/workspace/devices/tasks` → the task appears newest-first.
- Click the entry → detail page renders message, steps, and final screenshot (if present).

- [ ] **Step 21: Commit frontend**

```bash
git add apps/web/src/pages/devices/task-history-page.tsx \
        apps/web/src/pages/devices/task-detail-page.tsx \
        apps/web/src/pages/devices/index.tsx \
        apps/web/src/app.tsx
git commit -m "feat(web): add device task history list and detail pages"
```

---

## Task 3: Screen mirror WebSocket proxy

**⚠️ Gate:** Only start this task after user approves adding `ws` + `@types/ws` to `apps/controller/package.json`. If declined, switch to `Alt-Task 3` at the end of this document.

**Goal:** Browser subscribes to `ws://<controller>/api/v1/devices/{deviceId}/mirror`; the controller opens an upstream client to `ws://127.0.0.1:{wsPort}/phone`, forwards mirror snapshots to the browser, and relays user click/swipe/input/key frames back upstream.

**Files:**
- Create: `packages/shared/src/schemas/device-mirror.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/controller/package.json`
- Create: `apps/controller/src/services/device-mirror-proxy.ts`
- Modify: `apps/controller/src/app/container.ts`
- Modify: `apps/controller/src/index.ts`
- Create: `apps/web/src/pages/devices/use-mirror-socket.ts`
- Create: `apps/web/src/pages/devices/mirror-dialog.tsx`
- Modify: `apps/web/src/pages/devices/device-card.tsx`

### 3a. Shared schemas

- [ ] **Step 1: Create mirror schemas**

Create `packages/shared/src/schemas/device-mirror.ts`:

```typescript
import { z } from "zod";

export const mirrorSnapshotFrameSchema = z.object({
  channel: z.literal("mirror"),
  type: z.enum(["snapshot", "realtime"]),
  deviceId: z.string(),
  screenshot: z.string(), // base64 PNG
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
  currentApp: z.string().optional(),
  deviceStatus: z.enum(["idle", "busy", "error"]),
});

export const mirrorClientActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("swipe"),
    startX: z.number().int().nonnegative(),
    startY: z.number().int().nonnegative(),
    endX: z.number().int().nonnegative(),
    endY: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("input_text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("press_key"),
    key: z.string(),
  }),
]);

export type MirrorSnapshotFrame = z.infer<typeof mirrorSnapshotFrameSchema>;
export type MirrorClientAction = z.infer<typeof mirrorClientActionSchema>;
```

- [ ] **Step 2: Export from shared**

Edit `packages/shared/src/index.ts`, add:

```typescript
export * from "./schemas/device-mirror.js";
```

- [ ] **Step 3: Build shared**

Run: `pnpm --filter @nexu/shared build`
Expected: 0 errors.

### 3b. Controller WS proxy

- [ ] **Step 4: Add `ws` dep (requires prior approval)**

Edit `apps/controller/package.json`. Add to `dependencies`:

```json
"ws": "^8.18.0"
```

Add to `devDependencies`:

```json
"@types/ws": "^8.5.12"
```

Run: `pnpm install`
Expected: lockfile updates, new `ws` appears under `apps/controller/node_modules/`.

- [ ] **Step 5: Create DeviceMirrorProxy service**

Create `apps/controller/src/services/device-mirror-proxy.ts`:

```typescript
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { mirrorClientActionSchema } from "@nexu/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const MIRROR_PATH_PREFIX = "/api/v1/devices/";
const MIRROR_PATH_SUFFIX = "/mirror";

export class DeviceMirrorProxy {
  private readonly wss: WebSocketServer;

  constructor(private readonly configStore: NexuConfigStore) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Attach HTTP server upgrade handler. */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    const url = req.url ?? "";
    if (!url.startsWith(MIRROR_PATH_PREFIX) || !url.endsWith(MIRROR_PATH_SUFFIX)) {
      return false;
    }
    const deviceId = url.slice(
      MIRROR_PATH_PREFIX.length,
      url.length - MIRROR_PATH_SUFFIX.length,
    );
    if (deviceId === "") {
      socket.destroy();
      return true;
    }

    this.wss.handleUpgrade(req, socket, head, (clientWs) => {
      void this.bridge(clientWs, deviceId);
    });
    return true;
  }

  private async bridge(clientWs: WebSocket, deviceId: string): Promise<void> {
    const config = await this.configStore.getConfig();
    if (!config.deviceControl.enabled) {
      clientWs.close(4404, "Device control disabled");
      return;
    }

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.deviceControl.wsPort}/phone`,
    );

    upstream.on("open", () => {
      // Subscribe to mirror channel for this device (protocol per ws-server.ts)
      upstream.send(
        JSON.stringify({
          channel: "mirror",
          type: "subscribe",
          deviceId,
        }),
      );
    });

    upstream.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      // Forward raw frames; browser decodes JSON and filters by channel === "mirror".
      clientWs.send(data);
    });

    clientWs.on("message", (raw) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      try {
        const parsed = JSON.parse(raw.toString());
        const action = mirrorClientActionSchema.parse(parsed);
        upstream.send(
          JSON.stringify({
            channel: "mirror",
            type: action.type,
            deviceId,
            params: action,
          }),
        );
      } catch {
        // Silently drop malformed client frames.
      }
    });

    const teardown = () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    clientWs.on("close", teardown);
    clientWs.on("error", teardown);
    upstream.on("close", teardown);
    upstream.on("error", teardown);
  }

  close(): void {
    this.wss.close();
  }
}
```

- [ ] **Step 6: Wire proxy in container**

Edit `apps/controller/src/app/container.ts`. Add import:

```typescript
import { DeviceMirrorProxy } from "../services/device-mirror-proxy.js";
```

After the existing `const deviceControlService = new DeviceControlService(...)`:

```typescript
const deviceMirrorProxy = new DeviceMirrorProxy(configStore);
```

Add `deviceMirrorProxy` to the returned object and to the `ControllerContainer` interface.

- [ ] **Step 7: Register WS upgrade handler**

Edit `apps/controller/src/index.ts`. Replace the body of `main()` with:

```typescript
async function main(): Promise<void> {
  const container = await createContainer();
  const stopBackgroundLoops = await bootstrapController(container);
  const app = createApp(container);
  const server = serve(
    {
      fetch: app.fetch,
      hostname: container.env.host,
      port: container.env.port,
    },
    (info) => {
      logger.info(
        { host: info.address, port: info.port },
        "controller started",
      );
    },
  );

  server.on("upgrade", (req, socket, head) => {
    const handled = container.deviceMirrorProxy.handleUpgrade(
      req,
      socket,
      head,
    );
    if (!handled) {
      socket.destroy();
    }
  });

  // ... keep existing shutdown/closeServer logic unchanged, but in the finally
  // block of shutdown() add container.deviceMirrorProxy.close(); before
  // process.exit(0);
```

Concretely, also edit the `shutdown` handler. Before `flushV8CoverageIfEnabled()` add:

```typescript
container.deviceMirrorProxy.close();
```

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @nexu/controller typecheck
```
Expected: 0 errors.

- [ ] **Step 9: Commit controller**

```bash
git add packages/shared/src/schemas/device-mirror.ts packages/shared/src/index.ts \
        apps/controller/package.json \
        apps/controller/src/services/device-mirror-proxy.ts \
        apps/controller/src/app/container.ts \
        apps/controller/src/index.ts \
        pnpm-lock.yaml
git commit -m "feat(controller): add device mirror WebSocket proxy"
```

### 3c. Frontend mirror UI

- [ ] **Step 10: Create the WebSocket hook**

Create `apps/web/src/pages/devices/use-mirror-socket.ts`:

```typescript
import { useEffect, useRef, useState } from "react";
import type { MirrorClientAction, MirrorSnapshotFrame } from "@nexu/shared";

type Status = "connecting" | "open" | "closed";

export function useMirrorSocket(deviceId: string | null) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<Status>("closed");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (deviceId === null) {
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => setStatus("open"));
    ws.addEventListener("close", () => setStatus("closed"));
    ws.addEventListener("error", () => setStatus("closed"));
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as { channel?: string };
        if (parsed.channel !== "mirror") return;
        setFrame(parsed as MirrorSnapshotFrame);
      } catch {
        // drop malformed frame
      }
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [deviceId]);

  const sendAction = (action: MirrorClientAction) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(action));
  };

  return { frame, status, sendAction };
}
```

- [ ] **Step 11: Build the MirrorDialog**

Create `apps/web/src/pages/devices/mirror-dialog.tsx`:

```tsx
import { useId, useRef } from "react";
import type { DeviceInfo } from "./device-card";
import { useMirrorSocket } from "./use-mirror-socket";

interface Props {
  device: DeviceInfo;
  open: boolean;
  onClose: () => void;
}

export function MirrorDialog({ device, open, onClose }: Props) {
  const titleId = useId();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { frame, status, sendAction } = useMirrorSocket(
    open ? device.deviceId : null,
  );

  if (!open) return null;

  const mapPointerToDevice = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (img === null || frame === null) return null;
    const rect = img.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
    return {
      x: Math.round(relX * frame.width),
      y: Math.round(relY * frame.height),
    };
  };

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const point = mapPointerToDevice(e.clientX, e.clientY);
    if (point === null) return;
    sendAction({ type: "click", x: point.x, y: point.y });
  };

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 m-0 max-w-none max-h-none w-full h-full border-none bg-transparent"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div
              id={titleId}
              className="text-[14px] font-semibold text-text-primary"
            >
              Screen mirror
            </div>
            <div className="text-[12px] text-text-muted mt-0.5 truncate">
              {device.deviceId} · {status}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-text-secondary hover:text-text-primary"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-4">
          {frame === null ? (
            <div className="aspect-[9/16] flex items-center justify-center text-[12px] text-text-muted">
              {status === "open" ? "Waiting for first frame…" : status}
            </div>
          ) : (
            <img
              ref={imgRef}
              src={`data:image/png;base64,${frame.screenshot}`}
              alt="Device screen"
              onClick={handleClick}
              className="w-full rounded-lg cursor-pointer select-none"
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 12: Add "View screen" button to DeviceCard**

Edit `apps/web/src/pages/devices/device-card.tsx`. Add an import at the top:

```tsx
import { MirrorDialog } from "./mirror-dialog";
```

Add a second `useState` for mirror:

```tsx
const [mirrorOpen, setMirrorOpen] = useState(false);
```

Replace the single "Dispatch task" button with two side-by-side buttons:

```tsx
<div className="mt-auto flex gap-2">
  <button
    type="button"
    disabled={device.status === "busy"}
    onClick={() => setDialogOpen(true)}
    className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-hover disabled:opacity-50 disabled:cursor-not-allowed"
  >
    Dispatch task
  </button>
  <button
    type="button"
    onClick={() => setMirrorOpen(true)}
    className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-hover"
  >
    View screen
  </button>
</div>
```

Under the existing `<TaskDispatchDialog ... />` add:

```tsx
<MirrorDialog
  device={device}
  open={mirrorOpen}
  onClose={() => setMirrorOpen(false)}
/>
```

- [ ] **Step 13: Vite proxy passthrough for WS (dev only)**

Edit `apps/web/vite.config.ts` (or equivalent). Inside `server.proxy` find the existing `/api/v1` entry and set `ws: true`. If no entry exists, add:

```typescript
"/api/v1": {
  target: `http://127.0.0.1:${process.env.CONTROLLER_PORT ?? 3002}`,
  changeOrigin: true,
  ws: true,
},
```

(Check current `vite.config.ts` before editing — if `ws: true` is already set on the matching entry, skip this step.)

- [ ] **Step 14: Typecheck & lint**

```bash
pnpm --filter @nexu/web typecheck
pnpm --filter @nexu/web lint
```
Expected: 0 errors.

- [ ] **Step 15: Manual verification**

```bash
pnpm dev start
```
- Enable device control in `/workspace/settings`.
- Connect an Android phone running LobsterAgentAndroid.
- In `/workspace/devices`, click "View screen" on the connected device.
- The phone screen renders; clicking the image sends a tap to the phone.

- [ ] **Step 16: Commit mirror UI**

```bash
git add apps/web/src/pages/devices/use-mirror-socket.ts \
        apps/web/src/pages/devices/mirror-dialog.tsx \
        apps/web/src/pages/devices/device-card.tsx \
        apps/web/vite.config.ts
git commit -m "feat(web): add Android device screen mirror with click relay"
```

---

## Alt-Task 3: HTTP-polled screen snapshot (fallback if `ws` declined)

**Use only if user declines the `ws` dependency.** Ships a snapshot-only mirror (no click/swipe relay), polled at 1 Hz.

**Files:**
- Modify: `apps/controller/src/services/device-control-service.ts` (add `getScreenshot`)
- Modify: `apps/controller/src/routes/device-control-routes.ts` (add `GET /api/v1/devices/{deviceId}/screenshot`)
- Create: `apps/web/src/pages/devices/mirror-dialog.tsx` (uses `setInterval` + fetch instead of WS)

- [ ] **Alt Step 1: Extend service**

Edit `apps/controller/src/services/device-control-service.ts`, add method:

```typescript
async getScreenshot(
  deviceId: string,
): Promise<{ screenshot: string; width: number; height: number; timestamp: number }> {
  return this.rpc<{
    screenshot: string;
    width: number;
    height: number;
    timestamp: number;
  }>("device.get_screenshot", { deviceId });
}
```

(Verify `device.get_screenshot` exists in `~/workspace/openclaw-lobster-device-control/src/index.ts` RPC handler map before implementing. If absent, the fallback path is infeasible; the only other option is the full WS proxy.)

- [ ] **Alt Step 2: Add shared schema**

In `packages/shared/src/schemas/device-mirror.ts`:

```typescript
export const deviceScreenshotSchema = z.object({
  screenshot: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
});
```

- [ ] **Alt Step 3: Add route**

Edit `apps/controller/src/routes/device-control-routes.ts`. After the existing GET device route add:

```typescript
app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/devices/{deviceId}/screenshot",
    tags: ["Device Control"],
    request: { params: deviceIdParamSchema },
    responses: {
      200: {
        content: {
          "application/json": { schema: deviceScreenshotSchema },
        },
        description: "Latest screenshot",
      },
      404: {
        content: { "application/json": { schema: errorSchema } },
        description: "Device not found",
      },
      503: {
        content: { "application/json": { schema: errorSchema } },
        description: "Device control plugin is not running",
      },
    },
  }),
  async (c) => {
    if (!(await container.deviceControlService.isAvailable())) {
      return c.json({ message: "Device control plugin is not running" }, 503);
    }
    const { deviceId } = c.req.valid("param");
    try {
      const shot = await container.deviceControlService.getScreenshot(deviceId);
      return c.json(shot, 200);
    } catch (err) {
      const mapped = mapRpcErrorToStatus(err);
      return c.json({ message: mapped.message }, mapped.status);
    }
  },
);
```

Add `deviceScreenshotSchema` to the imports from `@nexu/shared`.

- [ ] **Alt Step 4: `MirrorDialog` polling implementation**

Create `apps/web/src/pages/devices/mirror-dialog.tsx` with `useEffect` + `setInterval` calling `getApiV1DevicesByDeviceIdScreenshot` every 1000 ms, unsubscribing when dialog closes. Render the `<img>` without the `onClick` relay (no tap support in fallback).

Skeleton (expand inline — no click handler, polling replaces WS):

```tsx
import { useEffect, useId, useState } from "react";
import { getApiV1DevicesByDeviceIdScreenshot } from "../../../lib/api/sdk.gen";
import type { DeviceInfo } from "./device-card";

export function MirrorDialog({
  device,
  open,
  onClose,
}: { device: DeviceInfo; open: boolean; onClose: () => void }) {
  const titleId = useId();
  const [shot, setShot] = useState<{ screenshot: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchOnce = async () => {
      const res = await getApiV1DevicesByDeviceIdScreenshot({
        path: { deviceId: device.deviceId },
      });
      if (!cancelled && !res.error && res.data) setShot(res.data);
    };
    void fetchOnce();
    const id = setInterval(fetchOnce, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, device.deviceId]);

  if (!open) return null;
  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 m-0 max-w-none max-h-none w-full h-full border-none bg-transparent"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl border border-border bg-surface-1 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div id={titleId} className="px-5 py-4 border-b border-border text-[14px] font-semibold">
          Screen · {device.deviceId}
        </div>
        <div className="px-5 py-4">
          {shot === null ? (
            <div className="aspect-[9/16] flex items-center justify-center text-[12px] text-text-muted">Loading…</div>
          ) : (
            <img
              src={`data:image/png;base64,${shot.screenshot}`}
              alt="Device screen"
              className="w-full rounded-lg"
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
```

Wire it into `device-card.tsx` identically to Task 3 step 12.

---

## End-to-end Verification

After Tasks 1, 2, and 3 (or Alt-Task 3) land:

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 2: Full lint**

```bash
pnpm lint
```
Expected: 0 errors.

- [ ] **Step 3: Test suite**

```bash
pnpm test
```
Expected: all pass, including new `DeviceTaskHistoryStore` tests.

- [ ] **Step 4: SDK up-to-date**

```bash
pnpm generate-types
```
Expected: clean or idempotent regeneration.

- [ ] **Step 5: Full stack smoke test**

```bash
pnpm dev start
```
- `/workspace/settings` → Device Control section loads, toggle round-trips.
- Dispatch task → appears in `/workspace/devices/tasks` within a second.
- Click history entry → detail renders full result.
- Click "View screen" → live mirror renders; clicks relay to phone (full task) or screen polls at 1 Hz (alt task).
- `pnpm dev stop` → no orphan WebSocket processes.

---

## Notes

- **History storage location:** `~/.nexu/device-task-history.json` in packaged app; `.tmp/desktop/nexu-home/device-task-history.json` in dev. Auto-migrated by `LowDbStore` (creates on first append).
- **Ring buffer:** 200 entries is an opinionated cap (~few MB with base64 screenshots). If users complain, expose as `deviceControl.historyMaxEntries` in NexuConfig.
- **Mirror frame rate:** Plugin emits `snapshot` at ~10 s idle and `realtime` at 1–2 Hz while busy (per `~/workspace/openclaw-lobster-device-control/src/ws-server.ts`). Browser receives whatever plugin emits; no throttling needed in the proxy.
- **Auth:** The browser's WS request inherits no explicit auth. In dev and packaged-single-user mode, controller is bound to `127.0.0.1` — same-origin policy is sufficient. Do not expose the controller on a public interface without adding auth.
- **Config change → effect:** Toggling `enabled` in Task 1 triggers `openclawSyncService.syncAll()` which regenerates `openclaw.json`. OpenClaw picks up the new plugin entry via its file watcher — no controller restart needed.
