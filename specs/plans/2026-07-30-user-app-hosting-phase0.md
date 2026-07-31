# happywork.today 用户应用托管 · 阶段 0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跑通「agent 在 nexu workspace 里写一个带数据库的自用应用 → 一键构建上传 → 在 `app-<id>.happywork.today` 上线 → 邮箱验证登录能用」的完整链路，`DeployTarget` 接口就位。

**Architecture:** 新增一个独立的云端服务 `apps/deploy-broker`（Hono，跑在 Cloudflare Workers + D1 上，用 wrangler 部署，与 nexu desktop-first 的 controller/desktop/web 三件套完全分离）。它持有 Cloudflare API Token，代表 nexu 的 CF 账号做三件事：把用户构建产物上传进 Workers for Platforms 的 dispatch namespace、为每个 app 建一个独立 D1 数据库、为每个 app 建一个 Cloudflare Access 应用做邮箱鉴权。`apps/controller` 新增一个瘦客户端服务，通过 HTTP 调用 broker（同 SkillHub 与 cloud-reward 的既有模式），desktop 端的 agent 通过一个新 skill 调用本地构建脚本再打给 controller。一个独立的 dispatch worker 负责把 `app-<id>.happywork.today` 的请求路由到对应的用户 Worker，读取 Access 已验证的邮箱头，并在 D1 里查一次 `status` 做即时下线开关。

**Tech Stack:** Hono 4 + `@hono/zod-openapi`（broker 与 controller 路由一致写法）、Cloudflare Workers（`workerd` 运行时）、D1（broker 控制面数据 + 每 app 一个用户数据库）、Cloudflare Access（`self_hosted` 应用类型）、`wrangler`（broker 与 dispatch worker 的部署工具）、Vitest（现有测试栈，`vi.stubGlobal("fetch", ...)` 桩外部调用）、esbuild（本地打包用户 app）。

## Global Constraints

以下数值均从 [specs/design-docs/2026-07-30-user-app-hosting.md](../design-docs/2026-07-30-user-app-hosting.md) 逐字复制，每个任务的实现都隐含遵守：

- 承载用户应用的域名固定为 **`happywork.today`**（与品牌域名 `picaso.studio` 隔离），Cloudflare NS 已生效（`marty.ns.cloudflare.com` / `dee.ns.cloudflare.com`），与 `picaso.studio` 同一账号。
- 应用地址格式固定为 **一级子域** `app-<id>.happywork.today`，禁止多级子域（Universal SSL 不覆盖多级通配符）。
- **CF API Token 只存在于 broker，绝不下发到桌面端/客户端**。
- 每个应用一个独立 **D1** 数据库，禁止走 per-app Supabase 项目（40 倍成本差）。
- 鉴权用 **Cloudflare Access**，user worker 内**零行 auth 代码**；Access 已验证的身份通过 `Cf-Access-Authenticated-User-Email` 头传给 user worker，dispatch worker 不重复校验 JWT。
- 滥用检测与秒级下线**是阶段 0 的一部分**（design doc：「这属于第一天的功能，不是 v2」）——本计划的 dispatch worker 必须支持按 `status` 字段即时拒绝请求，无需重新部署。
- 阶段 0 范围内**不使用 Workers Assets**（其在 dispatch namespace 内的可用性尚未验证，design doc 列为待验证项）；agent scaffold 只产出单文件 Hono Worker，静态内容通过 `c.html()` 由 Worker 自身渲染，不依赖独立静态资源绑定。
- `packages/shared` 新增 schema 需在 `packages/shared/src/index.ts` 用 `export * from "./schemas/deploy.js"` 导出（既有约定）。
- controller 新路由必须用 `createRoute()` + `app.openapi()`（AGENTS.md 硬性规则），改动后跑 `pnpm generate-types`。
- **不引入 `@paralleldrive/cuid2`**：虽是 AGENTS.md 文档化的公开 ID 约定，但仓库内尚无该依赖的实际安装（仅在一处注释提及，未安装）。按「不擅自添加依赖」硬性规则，阶段 0 用 `randomBytes(4).toString("hex")` 生成 8 位小写十六进制 ID（如 `a1b2c3d4`），零新依赖，且天然满足 DNS label 与 Cloudflare Worker 脚本名的合法字符集。是否切换到 cuid2 留给后续任务，不在本计划内做主张。
- `apps/deploy-broker` 与 `apps/deploy-broker/dispatch-worker` 是全新的顶层 pnpm workspace 成员（`pnpm-workspace.yaml` 的 `apps/*` glob 已覆盖，无需改动该文件），与 desktop/controller 的依赖图完全隔离——它们不会被打进桌面端产物，因此 AGENTS.md「控制器依赖需保持精简」的硬性规则不适用于这两个新包。

---

## 已验证的 Cloudflare API 事实（写代码前核实，避免臆造端点）

以下端点均于 2026-07-30 通过 Cloudflare 官方文档核实，非训练记忆：

| 操作 | 方法 + 路径 | 关键字段 |
|---|---|---|
| 上传脚本到 dispatch namespace | `PUT /accounts/{account_id}/workers/dispatch/namespaces/{namespace}/scripts/{script_name}` | `multipart/form-data`：`metadata` part（JSON `{main_module, compatibility_date, bindings}`）+ 脚本内容 part（文件名需与 `main_module` 一致） |
| D1 binding 写法 | metadata.bindings 数组元素 | `{"type": "d1", "name": "DB", "id": "<database_uuid>"}` |
| 创建 D1 数据库 | `POST /accounts/{account_id}/d1/database` | body `{name}` → `result.uuid` |
| D1 执行 SQL | `POST /accounts/{account_id}/d1/database/{database_id}/query` | body `{sql, params}` |
| 创建 Access 应用 | `POST /accounts/{account_id}/access/apps` | body `{type: "self_hosted", domain, name, app_launcher_visible: false}` → `result.id` |
| 创建 Access 策略 | `POST /accounts/{account_id}/access/apps/{app_id}/policies` | body `{decision: "allow", include: [{email: {email: "..."}}], name}` |
| 删除 Access 应用 | `DELETE /accounts/{account_id}/access/apps/{app_id}` | — |
| 删除 D1 数据库 | `DELETE /accounts/{account_id}/d1/database/{database_id}` | — |
| 删除 dispatch namespace 脚本 | `DELETE /accounts/{account_id}/workers/dispatch/namespaces/{namespace}/scripts/{script_name}` | — |

**子域路由架构（官方文档确认，非路径路由）：**

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const subdomain = url.hostname.split(".")[0];
    const userWorker = env.DISPATCHER.get(subdomain);
    return await userWorker.fetch(request);
  },
};
```

只需**一条**通配符 DNS 记录（`*.happywork.today`，橙云代理）+ **一条** Worker Route（`*.happywork.today/*`）绑定到 dispatch worker，一次性设置，不随 app 增减而变化——per-app `provision()` 不需要调用任何 DNS/Route API。

**关键简化（本计划相对 design doc 架构图的两处修正，均已验证）：**

1. Cloudflare Access 保护 `self_hosted` 应用时，未通过鉴权的请求在 Cloudflare 边缘就被拦截、重定向登录，**根本不会到达 dispatch worker**；到达时请求已带有 Cloudflare 自己验证过的 `Cf-Access-Authenticated-User-Email` 头。dispatch worker 只需读这个头，**不需要自己验证 JWT 签名**。
2. 脚本名与子域 label 是同一个值（`app-<id>`），dispatch worker 用 `env.DISPATCHER.get(subdomain)` 就能直接找到对应 Worker，**不需要额外的「子域 → 脚本名」映射表**。dispatch worker 仍需查一次 D1 的 `status` 字段——但目的是「秒级下线」这一必需能力，不是路由本身。

---

## 文件结构总览

```
apps/deploy-broker/                       # 新增：云端 broker，跑在 Cloudflare Workers
  package.json
  wrangler.toml
  tsconfig.json
  src/
    types.ts                              # Env bindings 类型
    index.ts                              # Hono app 入口（Workers export default）
    lib/
      id.ts                               # generateAppId()
      cloudflare-client.ts                # 底层 fetch 封装（鉴权头、错误处理）
    db/
      schema.sql                          # 控制面 D1 schema（apps 表）
      apps-repository.ts                  # D1-backed CRUD
    cloudflare/
      d1.ts                               # provisionDatabase() / deleteDatabase()
      workers.ts                          # uploadBundle() / deleteScript()
      access.ts                           # configureAccess() / removeAccess()
    deploy-target.ts                      # DeployTarget 接口 + CloudflareTarget 实现
    middleware/
      broker-auth.ts                      # broker API key 校验
    routes/
      apps-routes.ts                      # POST /apps, POST /apps/:id/deploy, DELETE /apps/:id, GET /apps/:id
  tests/
    id.test.ts
    apps-repository.test.ts
    cloudflare-d1.test.ts
    cloudflare-workers.test.ts
    cloudflare-access.test.ts
    deploy-target.test.ts
    apps-routes.test.ts
    fakes/fake-d1.ts

apps/deploy-broker/dispatch-worker/       # 新增：独立的路由 Worker
  package.json
  wrangler.toml
  src/index.ts
  tests/dispatch-worker.test.ts

packages/shared/src/schemas/deploy.ts     # 新增：controller ↔ broker 共享 schema
packages/shared/src/index.ts              # 修改：追加一行 export

apps/controller/src/services/deploy-broker-client.ts   # 新增：broker 的瘦客户端
apps/controller/src/routes/deploy-routes.ts             # 新增：暴露给 desktop/web 的路由
apps/controller/src/app/env.ts                          # 修改：追加 DEPLOY_BROKER_URL / DEPLOY_BROKER_API_KEY
apps/controller/src/app/container.ts                    # 修改：注入 deployBrokerClient
apps/controller/src/app/create-app.ts                   # 修改：挂载 registerDeployRoutes
apps/controller/tests/deploy-broker-client.test.ts       # 新增
apps/controller/tests/deploy-routes.test.ts              # 新增

nexu-skills/skills/deploy-app/SKILL.md                   # 新增：agent 可调用的部署 skill
nexu-skills/skills/deploy-app/scripts/build-and-deploy.mjs  # 新增：esbuild 打包 + 调用 controller
nexu-skills/skills/deploy-app/templates/hono-d1-app.ts    # 新增：agent scaffold 起始模板
```

---

## Task 1: `packages/shared` 部署域 schema

**Files:**
- Create: `packages/shared/src/schemas/deploy.ts`
- Modify: `packages/shared/src/index.ts`（追加一行 export）
- Test: `packages/shared/tests/deploy-schema.test.ts`

**Interfaces:**
- Produces：`deployedAppStatusSchema`、`deployedAppSchema`、`createDeployedAppRequestSchema`、`deployBundleRequestSchema`、`DeployedApp`（`z.infer`）类型，供 Task 9（broker 路由）、Task 12/13（controller 客户端与路由）复用。

`packages/shared` 目前没有 `tests/` 目录或独立 vitest 配置——先确认后再决定测试怎么跑。

- [ ] **Step 1: 确认 packages/shared 现有测试基础设施**

```bash
ls packages/shared/tests 2>/dev/null; cat packages/shared/vitest.config.ts 2>/dev/null; echo "---root---"; grep -n "packages/shared" vitest.config.ts
```

如果都没有输出（预期结果，因为 grounding 阶段已确认 `packages/shared/package.json` 没有 `test` 脚本），说明这个包目前不跑独立测试——schema 的正确性由消费方（controller/broker）的测试间接验证。**跳过本任务的独立测试文件**，改为把 schema 校验断言直接写进 Task 9 和 Task 12 的测试里（消费处验证，不新建测试基础设施——这是 YAGNI：不为一个新包发明一整套之前不存在的测试跑法）。

- [ ] **Step 2: 编写 schema**

```typescript
// packages/shared/src/schemas/deploy.ts
import { z } from "zod";

export const deployedAppStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "deleting",
]);

export const deployedAppSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  status: deployedAppStatusSchema,
  allowedEmails: z.array(z.string().email()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createDeployedAppRequestSchema = z.object({
  allowedEmails: z.array(z.string().email()).min(1),
});

export const deployBundleRequestSchema = z.object({
  script: z.string().min(1, "script source is required"),
});

export const deployBundleResponseSchema = z.object({
  ok: z.literal(true),
  hostname: z.string(),
});

export type DeployedApp = z.infer<typeof deployedAppSchema>;
export type CreateDeployedAppRequest = z.infer<
  typeof createDeployedAppRequestSchema
>;
export type DeployBundleRequest = z.infer<typeof deployBundleRequestSchema>;
```

- [ ] **Step 3: 导出**

```typescript
// packages/shared/src/index.ts
// 在既有 export * 列表末尾追加：
export * from "./schemas/deploy.js";
```

- [ ] **Step 4: typecheck 验证**

```bash
pnpm --filter @nexu/shared typecheck
```
Expected: 无错误退出。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/deploy.ts packages/shared/src/index.ts
git commit -m "feat: add deploy domain schemas to shared package"
```

---

## Task 2: broker 应用骨架 + 控制面 D1 schema + app 仓储

**Files:**
- Create: `apps/deploy-broker/package.json`
- Create: `apps/deploy-broker/wrangler.toml`
- Create: `apps/deploy-broker/tsconfig.json`
- Create: `apps/deploy-broker/src/types.ts`
- Create: `apps/deploy-broker/src/lib/id.ts`
- Create: `apps/deploy-broker/src/db/schema.sql`
- Create: `apps/deploy-broker/src/db/apps-repository.ts`
- Create: `apps/deploy-broker/tests/fakes/fake-d1.ts`
- Create: `apps/deploy-broker/tests/id.test.ts`
- Create: `apps/deploy-broker/tests/apps-repository.test.ts`

**Interfaces:**
- Produces：`generateAppId(): string`、`AppRecord` 类型、`AppsRepository`（`create/get/getByHostname/updateStatus/delete`）、`createFakeD1(): D1Database`（测试用假实现，供 Task 4-9 复用）。
- Consumes：Task 1 的 `DeployedApp` / `CreateDeployedAppRequest` 类型（仅做类型对齐参考，`AppRecord` 是内部持久化形状，字段与 `DeployedApp` 一一对应）。

- [ ] **Step 1: package.json**

```json
{
  "name": "@nexu/deploy-broker",
  "version": "0.0.1",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run tests"
  },
  "dependencies": {
    "@hono/zod-openapi": "^0.18.4",
    "@nexu/shared": "workspace:*",
    "hono": "^4.7.5",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250214.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5",
    "wrangler": "^3.109.3"
  }
}
```

- [ ] **Step 2: 确认根 workspace 是否已经有 vitest/wrangler 版本可复用，避免版本漂移**

```bash
grep -n '"vitest"' package.json apps/*/package.json packages/*/package.json 2>/dev/null | grep -v node_modules
```

把输出里出现过的 vitest 版本号覆盖 Step 1 里的 `^3.0.5`（若结果不同，以仓库现有版本为准，保持一致，避免多份 vitest 装出兼容性问题）。`wrangler` 是本仓库首次引入，无需对齐。

- [ ] **Step 3: wrangler.toml**

```toml
name = "nexu-deploy-broker"
main = "src/index.ts"
compatibility_date = "2026-07-01"

[[d1_databases]]
binding = "CONTROL_DB"
database_name = "nexu-deploy-broker-control"
database_id = "REPLACE_AFTER_TASK_11_BOOTSTRAP"

[[dispatch_namespaces]]
binding = "DISPATCHER"
namespace = "nexu-user-apps"
```

`database_id` 是占位——在 Task 11（一次性账号引导 runbook）里通过 `wrangler d1 create` 拿到真实值后手动填入。这是**唯一**允许在本计划中出现真实占位符的地方，因为它的值只有在人工执行 Cloudflare 账号操作后才存在，不属于「写代码时可确定的值」。

- [ ] **Step 4: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Env 类型**

```typescript
// apps/deploy-broker/src/types.ts
export interface Env {
  CONTROL_DB: D1Database;
  DISPATCHER: DispatchNamespace;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  BROKER_API_KEY: string;
}
```

- [ ] **Step 6: 写 id 生成的失败测试**

```typescript
// apps/deploy-broker/tests/id.test.ts
import { describe, expect, it } from "vitest";
import { generateAppId } from "../src/lib/id.js";

describe("generateAppId", () => {
  it("returns an 8-character lowercase hex string", () => {
    const id = generateAppId();
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("returns different ids on repeated calls", () => {
    const a = generateAppId();
    const b = generateAppId();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 7: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- id.test.ts
```
Expected: FAIL，`Cannot find module '../src/lib/id.js'`。

- [ ] **Step 8: 实现 id 生成**

```typescript
// apps/deploy-broker/src/lib/id.ts
import { randomBytes } from "node:crypto";

export function generateAppId(): string {
  return randomBytes(4).toString("hex");
}
```

- [ ] **Step 9: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- id.test.ts
```
Expected: PASS，2 个用例。

- [ ] **Step 10: 控制面 D1 schema**

```sql
-- apps/deploy-broker/src/db/schema.sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'deleting')),
  allowed_emails TEXT NOT NULL, -- JSON array of strings
  d1_database_id TEXT,
  access_app_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_apps_hostname ON apps (hostname);
```

- [ ] **Step 11: 假 D1 实现（测试用）**

```typescript
// apps/deploy-broker/tests/fakes/fake-d1.ts
// 最小可用的 D1Database 假实现：内存表，支持 apps-repository 用到的 SQL 子集。
// 不是通用 SQL 引擎——只识别本仓库实际发出的语句形状。

interface Row {
  [key: string]: unknown;
}

export function createFakeD1(): D1Database {
  const rows: Row[] = [];

  function prepare(query: string) {
    let boundArgs: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return stmt;
      },
      async run() {
        if (query.startsWith("INSERT INTO apps")) {
          const [
            id,
            hostname,
            status,
            allowedEmails,
            d1DatabaseId,
            accessAppId,
            createdAt,
            updatedAt,
          ] = boundArgs;
          rows.push({
            id,
            hostname,
            status,
            allowed_emails: allowedEmails,
            d1_database_id: d1DatabaseId,
            access_app_id: accessAppId,
            created_at: createdAt,
            updated_at: updatedAt,
          });
          return { success: true, meta: {} };
        }
        if (query.startsWith("UPDATE apps SET status")) {
          const [status, updatedAt, id] = boundArgs;
          const row = rows.find((r) => r.id === id);
          if (row) {
            row.status = status;
            row.updated_at = updatedAt;
          }
          return { success: true, meta: {} };
        }
        if (query.startsWith("DELETE FROM apps")) {
          const [id] = boundArgs;
          const idx = rows.findIndex((r) => r.id === id);
          if (idx >= 0) rows.splice(idx, 1);
          return { success: true, meta: {} };
        }
        throw new Error(`fake-d1: unhandled run() query: ${query}`);
      },
      async first<T>() {
        if (query.startsWith("SELECT * FROM apps WHERE id")) {
          const [id] = boundArgs;
          return (rows.find((r) => r.id === id) as T) ?? null;
        }
        if (query.startsWith("SELECT * FROM apps WHERE hostname")) {
          const [hostname] = boundArgs;
          return (rows.find((r) => r.hostname === hostname) as T) ?? null;
        }
        throw new Error(`fake-d1: unhandled first() query: ${query}`);
      },
      async all<T>() {
        return { results: rows as T[], success: true, meta: {} };
      },
    };
    return stmt;
  }

  return {
    prepare,
  } as unknown as D1Database;
}
```

- [ ] **Step 12: 写仓储的失败测试**

```typescript
// apps/deploy-broker/tests/apps-repository.test.ts
import { describe, expect, it } from "vitest";
import { AppsRepository } from "../src/db/apps-repository.js";
import { createFakeD1 } from "./fakes/fake-d1.js";

describe("AppsRepository", () => {
  it("creates and retrieves an app by id", async () => {
    const repo = new AppsRepository(createFakeD1());
    await repo.create({
      id: "a1b2c3d4",
      hostname: "app-a1b2c3d4.happywork.today",
      status: "provisioning",
      allowedEmails: ["user@example.com"],
      d1DatabaseId: null,
      accessAppId: null,
    });

    const found = await repo.get("a1b2c3d4");
    expect(found?.hostname).toBe("app-a1b2c3d4.happywork.today");
    expect(found?.status).toBe("provisioning");
    expect(found?.allowedEmails).toEqual(["user@example.com"]);
  });

  it("finds an app by hostname", async () => {
    const repo = new AppsRepository(createFakeD1());
    await repo.create({
      id: "a1b2c3d4",
      hostname: "app-a1b2c3d4.happywork.today",
      status: "active",
      allowedEmails: [],
      d1DatabaseId: "db-1",
      accessAppId: "access-1",
    });

    const found = await repo.getByHostname("app-a1b2c3d4.happywork.today");
    expect(found?.id).toBe("a1b2c3d4");
  });

  it("returns null for an unknown id", async () => {
    const repo = new AppsRepository(createFakeD1());
    expect(await repo.get("missing")).toBeNull();
  });

  it("updates status", async () => {
    const repo = new AppsRepository(createFakeD1());
    await repo.create({
      id: "a1b2c3d4",
      hostname: "app-a1b2c3d4.happywork.today",
      status: "provisioning",
      allowedEmails: [],
      d1DatabaseId: null,
      accessAppId: null,
    });
    await repo.updateStatus("a1b2c3d4", "active");
    const found = await repo.get("a1b2c3d4");
    expect(found?.status).toBe("active");
  });

  it("deletes an app", async () => {
    const repo = new AppsRepository(createFakeD1());
    await repo.create({
      id: "a1b2c3d4",
      hostname: "app-a1b2c3d4.happywork.today",
      status: "provisioning",
      allowedEmails: [],
      d1DatabaseId: null,
      accessAppId: null,
    });
    await repo.delete("a1b2c3d4");
    expect(await repo.get("a1b2c3d4")).toBeNull();
  });
});
```

- [ ] **Step 13: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- apps-repository.test.ts
```
Expected: FAIL，`Cannot find module '../src/db/apps-repository.js'`。

- [ ] **Step 14: 实现仓储**

```typescript
// apps/deploy-broker/src/db/apps-repository.ts
export type AppStatus = "provisioning" | "active" | "suspended" | "deleting";

export interface AppRecord {
  id: string;
  hostname: string;
  status: AppStatus;
  allowedEmails: readonly string[];
  d1DatabaseId: string | null;
  accessAppId: string | null;
}

interface AppRow {
  id: string;
  hostname: string;
  status: AppStatus;
  allowed_emails: string;
  d1_database_id: string | null;
  access_app_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: AppRow): AppRecord {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    allowedEmails: JSON.parse(row.allowed_emails) as string[],
    d1DatabaseId: row.d1_database_id,
    accessAppId: row.access_app_id,
  };
}

export class AppsRepository {
  constructor(private readonly db: D1Database) {}

  async create(record: AppRecord): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO apps (id, hostname, status, allowed_emails, d1_database_id, access_app_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        record.id,
        record.hostname,
        record.status,
        JSON.stringify(record.allowedEmails),
        record.d1DatabaseId,
        record.accessAppId,
        now,
        now,
      )
      .run();
  }

  async get(id: string): Promise<AppRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM apps WHERE id = ?")
      .bind(id)
      .first<AppRow>();
    return row ? rowToRecord(row) : null;
  }

  async getByHostname(hostname: string): Promise<AppRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM apps WHERE hostname = ?")
      .bind(hostname)
      .first<AppRow>();
    return row ? rowToRecord(row) : null;
  }

  async updateStatus(id: string, status: AppStatus): Promise<void> {
    await this.db
      .prepare("UPDATE apps SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), id)
      .run();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM apps WHERE id = ?").bind(id).run();
  }
}
```

- [ ] **Step 15: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- apps-repository.test.ts
```
Expected: PASS，5 个用例。

- [ ] **Step 16: Commit**

```bash
git add apps/deploy-broker/package.json apps/deploy-broker/wrangler.toml \
  apps/deploy-broker/tsconfig.json apps/deploy-broker/src apps/deploy-broker/tests
git commit -m "feat: scaffold deploy-broker app with control-plane D1 repository"
```

---

## Task 3: Cloudflare API 底层客户端

**Files:**
- Create: `apps/deploy-broker/src/lib/cloudflare-client.ts`
- Test: `apps/deploy-broker/tests/cloudflare-client.test.ts`

**Interfaces:**
- Consumes：无（叶子模块）
- Produces：`createCloudflareClient(config: { apiToken: string; accountId: string }): CloudflareClient`，`CloudflareClient` 暴露 `request(path, init): Promise<CloudflareApiResult<T>>`，供 Task 4/5/6 复用，统一处理 base URL、鉴权头、`success:false` 错误体解析。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/deploy-broker/tests/cloudflare-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudflareClient } from "../src/lib/cloudflare-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCloudflareClient", () => {
  it("sends bearer auth and account-scoped path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: { ok: 1 } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCloudflareClient({
      apiToken: "test-token",
      accountId: "acct-1",
    });
    const result = await client.request("/d1/database", { method: "GET" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ ok: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("returns ok:false with Cloudflare error details on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: 1003, message: "Invalid name" }],
            }),
            { status: 400 },
          ),
      ),
    );

    const client = createCloudflareClient({
      apiToken: "test-token",
      accountId: "acct-1",
    });
    const result = await client.request("/d1/database", { method: "POST" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(400);
    expect(result.errors).toEqual([{ code: 1003, message: "Invalid name" }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-client.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/deploy-broker/src/lib/cloudflare-client.ts
export interface CloudflareApiError {
  code: number;
  message: string;
}

export type CloudflareApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; errors: CloudflareApiError[] };

export interface CloudflareClient {
  request<T>(
    path: string,
    init: RequestInit,
  ): Promise<CloudflareApiResult<T>>;
  accountId: string;
}

const API_BASE = "https://api.cloudflare.com/client/v4";

export function createCloudflareClient(config: {
  apiToken: string;
  accountId: string;
}): CloudflareClient {
  return {
    accountId: config.accountId,
    async request<T>(path: string, init: RequestInit) {
      const response = await fetch(
        `${API_BASE}/accounts/${config.accountId}${path}`,
        {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${config.apiToken}`,
          },
        },
      );

      const body = (await response.json()) as {
        success: boolean;
        result?: T;
        errors?: CloudflareApiError[];
      };

      if (!response.ok || !body.success) {
        return {
          ok: false as const,
          status: response.status,
          errors: body.errors ?? [],
        };
      }

      return { ok: true as const, data: body.result as T };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-client.test.ts
```
Expected: PASS，2 个用例。

- [ ] **Step 5: Commit**

```bash
git add apps/deploy-broker/src/lib/cloudflare-client.ts apps/deploy-broker/tests/cloudflare-client.test.ts
git commit -m "feat: add low-level Cloudflare API client to deploy-broker"
```

---

## Task 4: `provisionDatabase()` — D1 创建

**Files:**
- Create: `apps/deploy-broker/src/cloudflare/d1.ts`
- Test: `apps/deploy-broker/tests/cloudflare-d1.test.ts`

**Interfaces:**
- Consumes：Task 3 的 `CloudflareClient`。
- Produces：`provisionDatabase(client, appId): Promise<{ bindingName: string; databaseId: string }>`，`deleteDatabase(client, databaseId): Promise<void>`——供 Task 8（`CloudflareTarget`）组合。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/deploy-broker/tests/cloudflare-d1.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudflareClient } from "../src/lib/cloudflare-client.js";
import { deleteDatabase, provisionDatabase } from "../src/cloudflare/d1.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provisionDatabase", () => {
  it("creates a D1 database named after the app id and returns its uuid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(
          "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database",
        );
        expect(JSON.parse(init.body as string)).toEqual({
          name: "nexu-app-a1b2c3d4",
        });
        return new Response(
          JSON.stringify({ success: true, result: { uuid: "db-uuid-1" } }),
          { status: 200 },
        );
      }),
    );

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    const result = await provisionDatabase(client, "a1b2c3d4");

    expect(result).toEqual({ bindingName: "DB", databaseId: "db-uuid-1" });
  });

  it("throws with Cloudflare's error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: 7003, message: "quota exceeded" }],
            }),
            { status: 400 },
          ),
      ),
    );

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    await expect(provisionDatabase(client, "a1b2c3d4")).rejects.toThrow(
      "quota exceeded",
    );
  });
});

describe("deleteDatabase", () => {
  it("issues a DELETE against the database id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: null }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    await deleteDatabase(client, "db-uuid-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/db-uuid-1",
    );
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-d1.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/deploy-broker/src/cloudflare/d1.ts
import type { CloudflareClient } from "../lib/cloudflare-client.js";

export async function provisionDatabase(
  client: CloudflareClient,
  appId: string,
): Promise<{ bindingName: string; databaseId: string }> {
  const result = await client.request<{ uuid: string }>("/d1/database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `nexu-app-${appId}` }),
  });

  if (!result.ok) {
    throw new Error(
      result.errors.map((e) => e.message).join("; ") ||
        "failed to provision D1 database",
    );
  }

  return { bindingName: "DB", databaseId: result.data.uuid };
}

export async function deleteDatabase(
  client: CloudflareClient,
  databaseId: string,
): Promise<void> {
  const result = await client.request(`/d1/database/${databaseId}`, {
    method: "DELETE",
  });
  if (!result.ok) {
    throw new Error(
      result.errors.map((e) => e.message).join("; ") ||
        "failed to delete D1 database",
    );
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-d1.test.ts
```
Expected: PASS，3 个用例。

- [ ] **Step 5: Commit**

```bash
git add apps/deploy-broker/src/cloudflare/d1.ts apps/deploy-broker/tests/cloudflare-d1.test.ts
git commit -m "feat: add D1 provision/delete to deploy-broker"
```

---

## Task 5: `uploadBundle()` — 脚本上传进 dispatch namespace

**Files:**
- Create: `apps/deploy-broker/src/cloudflare/workers.ts`
- Test: `apps/deploy-broker/tests/cloudflare-workers.test.ts`

**Interfaces:**
- Consumes：Task 3 的 `CloudflareClient`；Task 4 产出的 `{ bindingName, databaseId }`。
- Produces：`uploadBundle(client, namespace, scriptName, scriptSource, db): Promise<void>`、`deleteScript(client, namespace, scriptName): Promise<void>`。

**注意：** `CloudflareClient.request()` 目前会无条件设置 `Content-Type` 由调用方传入——但 multipart 请求的 `Content-Type`（含 boundary）必须由 `FormData` 自动生成，调用方不能手写。本任务直接用全局 `fetch`（不经过 `CloudflareClient.request`），因为 `request()` 的 JSON 错误体解析假设也不完全适配 multipart 响应场景的原始需求；保持简单，避免为一个特例改动已测试稳定的公共客户端。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/deploy-broker/tests/cloudflare-workers.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteScript, uploadBundle } from "../src/cloudflare/workers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadBundle", () => {
  it("PUTs a multipart body with metadata and script content to the dispatch namespace", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadBundle(
      { apiToken: "t", accountId: "acct-1" },
      "nexu-user-apps",
      "app-a1b2c3d4",
      "export default { fetch() { return new Response('hi'); } };",
      { bindingName: "DB", databaseId: "db-uuid-1" },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/workers/dispatch/namespaces/nexu-user-apps/scripts/app-a1b2c3d4",
    );
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer t",
    );

    const form = init.body as FormData;
    const metadataPart = form.get("metadata");
    expect(metadataPart).toBeInstanceOf(Blob);
    const metadata = JSON.parse(await (metadataPart as Blob).text());
    expect(metadata.main_module).toBe("app-a1b2c3d4.js");
    expect(metadata.bindings).toEqual([
      { type: "d1", name: "DB", id: "db-uuid-1" },
    ]);

    const scriptPart = form.get("app-a1b2c3d4.js");
    expect(scriptPart).toBeInstanceOf(Blob);
    expect(await (scriptPart as Blob).text()).toContain(
      "export default",
    );
  });

  it("throws with Cloudflare's error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: 10021, message: "script exceeds size limit" }],
            }),
            { status: 400 },
          ),
      ),
    );

    await expect(
      uploadBundle(
        { apiToken: "t", accountId: "acct-1" },
        "nexu-user-apps",
        "app-a1b2c3d4",
        "export default {};",
        { bindingName: "DB", databaseId: "db-uuid-1" },
      ),
    ).rejects.toThrow("script exceeds size limit");
  });
});

describe("deleteScript", () => {
  it("issues a DELETE against the namespaced script", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: null }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deleteScript(
      { apiToken: "t", accountId: "acct-1" },
      "nexu-user-apps",
      "app-a1b2c3d4",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/workers/dispatch/namespaces/nexu-user-apps/scripts/app-a1b2c3d4",
    );
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-workers.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/deploy-broker/src/cloudflare/workers.ts
const API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareAuth {
  apiToken: string;
  accountId: string;
}

interface CloudflareErrorBody {
  success: boolean;
  errors?: { code: number; message: string }[];
}

export async function uploadBundle(
  auth: CloudflareAuth,
  namespace: string,
  scriptName: string,
  scriptSource: string,
  db: { bindingName: string; databaseId: string },
): Promise<void> {
  const fileName = `${scriptName}.js`;
  const metadata = {
    main_module: fileName,
    compatibility_date: "2026-07-01",
    bindings: [{ type: "d1", name: db.bindingName, id: db.databaseId }],
  };

  const form = new FormData();
  form.set(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.set(
    fileName,
    new Blob([scriptSource], { type: "application/javascript+module" }),
  );

  const response = await fetch(
    `${API_BASE}/accounts/${auth.accountId}/workers/dispatch/namespaces/${namespace}/scripts/${scriptName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.apiToken}` },
      body: form,
    },
  );

  const body = (await response.json()) as CloudflareErrorBody;
  if (!response.ok || !body.success) {
    throw new Error(
      body.errors?.map((e) => e.message).join("; ") ||
        "failed to upload script",
    );
  }
}

export async function deleteScript(
  auth: CloudflareAuth,
  namespace: string,
  scriptName: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/accounts/${auth.accountId}/workers/dispatch/namespaces/${namespace}/scripts/${scriptName}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.apiToken}` },
    },
  );

  const body = (await response.json()) as CloudflareErrorBody;
  if (!response.ok || !body.success) {
    throw new Error(
      body.errors?.map((e) => e.message).join("; ") ||
        "failed to delete script",
    );
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-workers.test.ts
```
Expected: PASS，3 个用例。

- [ ] **Step 5: Commit**

```bash
git add apps/deploy-broker/src/cloudflare/workers.ts apps/deploy-broker/tests/cloudflare-workers.test.ts
git commit -m "feat: add Worker script upload/delete to deploy-broker"
```

---

## Task 6: `configureAccess()` — Access 应用 + 邮箱策略

**Files:**
- Create: `apps/deploy-broker/src/cloudflare/access.ts`
- Test: `apps/deploy-broker/tests/cloudflare-access.test.ts`

**Interfaces:**
- Consumes：Task 3 的 `CloudflareClient`。
- Produces：`configureAccess(client, hostname, allowedEmails): Promise<{ accessAppId: string }>`、`removeAccess(client, accessAppId): Promise<void>`。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/deploy-broker/tests/cloudflare-access.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudflareClient } from "../src/lib/cloudflare-client.js";
import { configureAccess, removeAccess } from "../src/cloudflare/access.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configureAccess", () => {
  it("creates a self-hosted Access app then an allow policy for the given emails", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        if (url.endsWith("/access/apps")) {
          return new Response(
            JSON.stringify({ success: true, result: { id: "access-app-1" } }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ success: true, result: { id: "policy-1" } }),
          { status: 200 },
        );
      }),
    );

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    const result = await configureAccess(
      client,
      "app-a1b2c3d4.happywork.today",
      ["user@example.com"],
    );

    expect(result).toEqual({ accessAppId: "access-app-1" });
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/access/apps",
    );
    expect(calls[0]?.body).toEqual({
      type: "self_hosted",
      domain: "app-a1b2c3d4.happywork.today",
      name: "app-a1b2c3d4.happywork.today",
      app_launcher_visible: false,
    });

    expect(calls[1]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/access/apps/access-app-1/policies",
    );
    expect(calls[1]?.body).toEqual({
      decision: "allow",
      include: [{ email: { email: "user@example.com" } }],
      name: "owner-email-allowlist",
    });
  });

  it("throws if app creation fails, without attempting the policy call", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 1000, message: "duplicate hostname" }],
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    await expect(
      configureAccess(client, "app-a1b2c3d4.happywork.today", [
        "user@example.com",
      ]),
    ).rejects.toThrow("duplicate hostname");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("removeAccess", () => {
  it("DELETEs the Access app", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: null }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCloudflareClient({
      apiToken: "t",
      accountId: "acct-1",
    });
    await removeAccess(client, "access-app-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/access/apps/access-app-1",
    );
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-access.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/deploy-broker/src/cloudflare/access.ts
import type { CloudflareClient } from "../lib/cloudflare-client.js";

export async function configureAccess(
  client: CloudflareClient,
  hostname: string,
  allowedEmails: readonly string[],
): Promise<{ accessAppId: string }> {
  const appResult = await client.request<{ id: string }>("/access/apps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "self_hosted",
      domain: hostname,
      name: hostname,
      app_launcher_visible: false,
    }),
  });

  if (!appResult.ok) {
    throw new Error(
      appResult.errors.map((e) => e.message).join("; ") ||
        "failed to create Access application",
    );
  }

  const accessAppId = appResult.data.id;

  const policyResult = await client.request(
    `/access/apps/${accessAppId}/policies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "allow",
        include: allowedEmails.map((email) => ({ email: { email } })),
        name: "owner-email-allowlist",
      }),
    },
  );

  if (!policyResult.ok) {
    throw new Error(
      policyResult.errors.map((e) => e.message).join("; ") ||
        "failed to create Access policy",
    );
  }

  return { accessAppId };
}

export async function removeAccess(
  client: CloudflareClient,
  accessAppId: string,
): Promise<void> {
  const result = await client.request(`/access/apps/${accessAppId}`, {
    method: "DELETE",
  });
  if (!result.ok) {
    throw new Error(
      result.errors.map((e) => e.message).join("; ") ||
        "failed to delete Access application",
    );
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- cloudflare-access.test.ts
```
Expected: PASS，3 个用例。

- [ ] **Step 5: Commit**

```bash
git add apps/deploy-broker/src/cloudflare/access.ts apps/deploy-broker/tests/cloudflare-access.test.ts
git commit -m "feat: add Access app/policy provisioning to deploy-broker"
```

---

## Task 7: `DeployTarget` 接口 + `CloudflareTarget` 组合实现

**Files:**
- Create: `apps/deploy-broker/src/deploy-target.ts`
- Test: `apps/deploy-broker/tests/deploy-target.test.ts`

**Interfaces:**
- Consumes：Task 4 (`provisionDatabase`/`deleteDatabase`)、Task 5 (`uploadBundle`/`deleteScript`)、Task 6 (`configureAccess`/`removeAccess`)、Task 3 (`CloudflareClient`)。
- Produces：`DeployTarget` 接口、`CloudflareTarget` 类——供 Task 9（broker 路由）消费。这是 design doc 里「为国内底座留缝」的那个接口，本任务是它在代码里第一次落地，签名以这里为准（比 design doc 里的示意伪代码更精确，design doc 已在 Task 结束后同步更新）。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/deploy-broker/tests/deploy-target.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareTarget } from "../src/deploy-target.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSuccessfulFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/d1/database") && !url.includes("db-uuid")) {
        return new Response(
          JSON.stringify({ success: true, result: { uuid: "db-uuid-1" } }),
          { status: 200 },
        );
      }
      if (url.endsWith("/access/apps")) {
        return new Response(
          JSON.stringify({ success: true, result: { id: "access-app-1" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200,
      });
    }),
  );
}

describe("CloudflareTarget", () => {
  const config = {
    apiToken: "t",
    accountId: "acct-1",
    dispatchNamespace: "nexu-user-apps",
    appDomain: "happywork.today",
  };

  it("provision() derives the hostname without calling Cloudflare", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const target = new CloudflareTarget(config);
    const result = await target.provision("a1b2c3d4");

    expect(result).toEqual({ hostname: "app-a1b2c3d4.happywork.today" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provisionDatabase() delegates to the D1 module", async () => {
    stubSuccessfulFetch();
    const target = new CloudflareTarget(config);
    const db = await target.provisionDatabase("a1b2c3d4");
    expect(db).toEqual({ bindingName: "DB", databaseId: "db-uuid-1" });
  });

  it("uploadBundle() uses the derived script name and passed db binding", async () => {
    stubSuccessfulFetch();
    const target = new CloudflareTarget(config);
    await expect(
      target.uploadBundle("a1b2c3d4", "export default {};", {
        bindingName: "DB",
        databaseId: "db-uuid-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("configureAccess() delegates to the Access module with the derived hostname", async () => {
    stubSuccessfulFetch();
    const target = new CloudflareTarget(config);
    const result = await target.configureAccess("a1b2c3d4", [
      "user@example.com",
    ]);
    expect(result).toEqual({ accessAppId: "access-app-1" });
  });

  it("destroy() tears down script, database, and Access app when all ids are present", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(url);
        return new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
        });
      }),
    );

    const target = new CloudflareTarget(config);
    await target.destroy("a1b2c3d4", {
      databaseId: "db-uuid-1",
      accessAppId: "access-app-1",
    });

    expect(
      calledUrls.some((u) => u.includes("/dispatch/namespaces/") && u.includes("a1b2c3d4")),
    ).toBe(true);
    expect(calledUrls.some((u) => u.includes("/d1/database/db-uuid-1"))).toBe(
      true,
    );
    expect(
      calledUrls.some((u) => u.includes("/access/apps/access-app-1")),
    ).toBe(true);
  });

  it("destroy() skips database/Access calls when their ids are null", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(url);
        return new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
        });
      }),
    );

    const target = new CloudflareTarget(config);
    await target.destroy("a1b2c3d4", { databaseId: null, accessAppId: null });

    expect(calledUrls).toHaveLength(1); // only the script delete
    expect(calledUrls[0]).toContain("a1b2c3d4");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- deploy-target.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/deploy-broker/src/deploy-target.ts
import { removeAccess, configureAccess } from "./cloudflare/access.js";
import { createCloudflareClient } from "./lib/cloudflare-client.js";
import { deleteDatabase, provisionDatabase } from "./cloudflare/d1.js";
import { deleteScript, uploadBundle } from "./cloudflare/workers.js";

export interface DatabaseBinding {
  bindingName: string;
  databaseId: string;
}

export interface DeployTarget {
  provision(appId: string): Promise<{ hostname: string }>;
  provisionDatabase(appId: string): Promise<DatabaseBinding>;
  uploadBundle(
    appId: string,
    scriptSource: string,
    db: DatabaseBinding,
  ): Promise<void>;
  configureAccess(
    appId: string,
    allowedEmails: readonly string[],
  ): Promise<{ accessAppId: string }>;
  destroy(
    appId: string,
    ctx: { databaseId: string | null; accessAppId: string | null },
  ): Promise<void>;
}

export interface CloudflareTargetConfig {
  apiToken: string;
  accountId: string;
  dispatchNamespace: string;
  appDomain: string;
}

export class CloudflareTarget implements DeployTarget {
  private readonly client;
  private readonly auth;

  constructor(private readonly config: CloudflareTargetConfig) {
    this.client = createCloudflareClient({
      apiToken: config.apiToken,
      accountId: config.accountId,
    });
    this.auth = { apiToken: config.apiToken, accountId: config.accountId };
  }

  private scriptName(appId: string): string {
    return `app-${appId}`;
  }

  private hostname(appId: string): string {
    return `${this.scriptName(appId)}.${this.config.appDomain}`;
  }

  async provision(appId: string): Promise<{ hostname: string }> {
    return { hostname: this.hostname(appId) };
  }

  async provisionDatabase(appId: string): Promise<DatabaseBinding> {
    return provisionDatabase(this.client, appId);
  }

  async uploadBundle(
    appId: string,
    scriptSource: string,
    db: DatabaseBinding,
  ): Promise<void> {
    await uploadBundle(
      this.auth,
      this.config.dispatchNamespace,
      this.scriptName(appId),
      scriptSource,
      db,
    );
  }

  async configureAccess(
    appId: string,
    allowedEmails: readonly string[],
  ): Promise<{ accessAppId: string }> {
    return configureAccess(this.client, this.hostname(appId), allowedEmails);
  }

  async destroy(
    appId: string,
    ctx: { databaseId: string | null; accessAppId: string | null },
  ): Promise<void> {
    await deleteScript(
      this.auth,
      this.config.dispatchNamespace,
      this.scriptName(appId),
    );
    if (ctx.databaseId) {
      await deleteDatabase(this.client, ctx.databaseId);
    }
    if (ctx.accessAppId) {
      await removeAccess(this.client, ctx.accessAppId);
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- deploy-target.test.ts
```
Expected: PASS，7 个用例。

- [ ] **Step 5: 回填 design doc 里的接口签名，保持文档与实现一致**

打开 [specs/design-docs/2026-07-30-user-app-hosting.md](../design-docs/2026-07-30-user-app-hosting.md) 里「DeployTarget 抽象」一节的代码块，把伪代码换成本任务实现的真实签名（`provision`/`provisionDatabase`/`uploadBundle`/`configureAccess`/`destroy`，含参数类型）。这不是新决策，只是把已经落地的签名同步回设计文档,避免两份文档互相矛盾。

- [ ] **Step 6: Commit**

```bash
git add apps/deploy-broker/src/deploy-target.ts apps/deploy-broker/tests/deploy-target.test.ts \
  specs/design-docs/2026-07-30-user-app-hosting.md
git commit -m "feat: compose DeployTarget interface and CloudflareTarget implementation"
```

---

## Task 8: broker 鉴权中间件 + `/apps` 路由

**Files:**
- Create: `apps/deploy-broker/src/middleware/broker-auth.ts`
- Create: `apps/deploy-broker/src/routes/apps-routes.ts`
- Create: `apps/deploy-broker/src/index.ts`
- Test: `apps/deploy-broker/tests/apps-routes.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `AppsRepository`；Task 7 的 `DeployTarget`；Task 1 的共享 schema。
- Produces：`registerAppsRoutes(app, deps)`——HTTP 契约，供 Task 12（controller 客户端）对齐。

**契约（本任务权威来源，Task 12 必须严格匹配）：**

| Method | Path | Body | 响应 |
|---|---|---|---|
| POST | `/apps` | `{ allowedEmails: string[] }` | `201` `DeployedApp` |
| POST | `/apps/:id/deploy` | `{ script: string }` | `200` `{ ok: true, hostname: string }` |
| GET | `/apps/:id` | — | `200` `DeployedApp` / `404` |
| DELETE | `/apps/:id` | — | `204` |

所有路由要求 `Authorization: Bearer <BROKER_API_KEY>`，缺失或错误返回 `401`。

- [ ] **Step 1: 鉴权中间件（无独立测试——行为完全由 apps-routes 集成测试覆盖，避免为中间件单独搭一个 hono context mock）**

```typescript
// apps/deploy-broker/src/middleware/broker-auth.ts
import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.js";

export function brokerAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    const expected = `Bearer ${c.env.BROKER_API_KEY}`;
    if (header !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
```

- [ ] **Step 2: 写路由的失败测试**

```typescript
// apps/deploy-broker/tests/apps-routes.test.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppsRepository } from "../src/db/apps-repository.js";
import { registerAppsRoutes } from "../src/routes/apps-routes.js";
import type { Env } from "../src/types.js";
import { createFakeD1 } from "./fakes/fake-d1.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function buildApp() {
  const app = new OpenAPIHono<{ Bindings: Env }>();
  const repository = new AppsRepository(createFakeD1());
  const target = {
    provision: vi.fn(async (id: string) => ({
      hostname: `app-${id}.happywork.today`,
    })),
    provisionDatabase: vi.fn(async () => ({
      bindingName: "DB",
      databaseId: "db-uuid-1",
    })),
    uploadBundle: vi.fn(async () => undefined),
    configureAccess: vi.fn(async () => ({ accessAppId: "access-app-1" })),
    destroy: vi.fn(async () => undefined),
  };
  registerAppsRoutes(app, { repository, target });
  const env: Env = {
    CONTROL_DB: createFakeD1(),
    DISPATCHER: {} as never,
    CF_API_TOKEN: "unused-in-route-tests",
    CF_ACCOUNT_ID: "unused",
    CF_ZONE_ID: "unused",
    BROKER_API_KEY: "test-broker-key",
  };
  return { app, env, target, repository };
}

const AUTH = { Authorization: "Bearer test-broker-key" };

describe("apps routes", () => {
  it("rejects requests without a valid broker API key", async () => {
    const { app, env } = buildApp();
    const res = await app.request(
      "/apps",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("POST /apps provisions hostname, database, and Access, then persists", async () => {
    const { app, env, target } = buildApp();
    const res = await app.request(
      "/apps",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ allowedEmails: ["user@example.com"] }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hostname).toMatch(/^app-[a-f0-9]{8}\.happywork\.today$/);
    expect(body.status).toBe("active");
    expect(target.provision).toHaveBeenCalledTimes(1);
    expect(target.provisionDatabase).toHaveBeenCalledTimes(1);
    expect(target.configureAccess).toHaveBeenCalledTimes(1);
  });

  it("POST /apps/:id/deploy uploads the script for an existing app", async () => {
    const { app, env, target } = buildApp();
    const createRes = await app.request(
      "/apps",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ allowedEmails: ["user@example.com"] }),
      },
      env,
    );
    const { id } = await createRes.json();

    const deployRes = await app.request(
      `/apps/${id}/deploy`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ script: "export default {};" }),
      },
      env,
    );
    expect(deployRes.status).toBe(200);
    expect(target.uploadBundle).toHaveBeenCalledWith(
      id,
      "export default {};",
      { bindingName: "DB", databaseId: "db-uuid-1" },
    );
  });

  it("POST /apps/:id/deploy returns 404 for an unknown app", async () => {
    const { app, env } = buildApp();
    const res = await app.request(
      "/apps/missing/deploy",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ script: "export default {};" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /apps/:id tears down via the target and removes the record", async () => {
    const { app, env, target, repository } = buildApp();
    const createRes = await app.request(
      "/apps",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ allowedEmails: ["user@example.com"] }),
      },
      env,
    );
    const { id } = await createRes.json();

    const deleteRes = await app.request(
      `/apps/${id}`,
      { method: "DELETE", headers: AUTH },
      env,
    );
    expect(deleteRes.status).toBe(204);
    expect(target.destroy).toHaveBeenCalledWith(id, {
      databaseId: "db-uuid-1",
      accessAppId: "access-app-1",
    });
    expect(await repository.get(id)).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker test -- apps-routes.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现路由**

```typescript
// apps/deploy-broker/src/routes/apps-routes.ts
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createDeployedAppRequestSchema,
  deployBundleRequestSchema,
  deployBundleResponseSchema,
  deployedAppSchema,
} from "@nexu/shared";
import type { AppsRepository } from "../db/apps-repository.js";
import { generateAppId } from "../lib/id.js";
import type { DeployTarget } from "../deploy-target.js";
import type { Env } from "../types.js";

export interface AppsRoutesDeps {
  repository: AppsRepository;
  target: DeployTarget;
}

export function registerAppsRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
  deps: AppsRoutesDeps,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/apps",
      tags: ["Apps"],
      request: {
        body: {
          content: {
            "application/json": { schema: createDeployedAppRequestSchema },
          },
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: deployedAppSchema } },
          description: "Created app",
        },
      },
    }),
    async (c) => {
      const { allowedEmails } = c.req.valid("json");
      const id = generateAppId();

      const { hostname } = await deps.target.provision(id);
      const db = await deps.target.provisionDatabase(id);
      const { accessAppId } = await deps.target.configureAccess(
        id,
        allowedEmails,
      );

      await deps.repository.create({
        id,
        hostname,
        status: "active",
        allowedEmails,
        d1DatabaseId: db.databaseId,
        accessAppId,
      });

      const record = await deps.repository.get(id);
      return c.json(
        {
          id: record!.id,
          hostname: record!.hostname,
          status: record!.status,
          allowedEmails: [...record!.allowedEmails],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/apps/{id}/deploy",
      tags: ["Apps"],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            "application/json": { schema: deployBundleRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: deployBundleResponseSchema },
          },
          description: "Deployed",
        },
        404: { description: "App not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { script } = c.req.valid("json");

      const record = await deps.repository.get(id);
      if (!record || !record.d1DatabaseId) {
        return c.json({ error: "app not found" }, 404);
      }

      await deps.target.uploadBundle(id, script, {
        bindingName: "DB",
        databaseId: record.d1DatabaseId,
      });

      return c.json({ ok: true as const, hostname: record.hostname }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/apps/{id}",
      tags: ["Apps"],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: deployedAppSchema } },
          description: "App",
        },
        404: { description: "App not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const record = await deps.repository.get(id);
      if (!record) return c.json({ error: "app not found" }, 404);
      return c.json(
        {
          id: record.id,
          hostname: record.hostname,
          status: record.status,
          allowedEmails: [...record.allowedEmails],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/apps/{id}",
      tags: ["Apps"],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        204: { description: "Deleted" },
        404: { description: "App not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const record = await deps.repository.get(id);
      if (!record) return c.json({ error: "app not found" }, 404);

      await deps.target.destroy(id, {
        databaseId: record.d1DatabaseId,
        accessAppId: record.accessAppId,
      });
      await deps.repository.delete(id);

      return c.body(null, 204);
    },
  );
}
```

- [ ] **Step 5: broker 入口（挂中间件 + 路由 + 用真实绑定构造依赖）**

```typescript
// apps/deploy-broker/src/index.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppsRepository } from "./db/apps-repository.js";
import { CloudflareTarget } from "./deploy-target.js";
import { brokerAuth } from "./middleware/broker-auth.js";
import { registerAppsRoutes } from "./routes/apps-routes.js";
import type { Env } from "./types.js";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/apps/*", brokerAuth());

app.use("/apps/*", async (c, next) => {
  const repository = new AppsRepository(c.env.CONTROL_DB);
  const target = new CloudflareTarget({
    apiToken: c.env.CF_API_TOKEN,
    accountId: c.env.CF_ACCOUNT_ID,
    dispatchNamespace: "nexu-user-apps",
    appDomain: "happywork.today",
  });
  registerAppsRoutes(app, { repository, target });
  await next();
});

export default app;
```

**已知问题（记录，不在本任务内修）：** 上面这个「每个请求都重新调用一次 `registerAppsRoutes`」的写法能跑但不优雅——Hono 的路由表会被重复注册。下一步（Step 6）用一次性初始化替换。写出来是为了让读者看到问题演进过程；真正提交的是 Step 6 的版本。

- [ ] **Step 6: 修正为一次性路由注册（真正提交的版本）**

```typescript
// apps/deploy-broker/src/index.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppsRepository } from "./db/apps-repository.js";
import { CloudflareTarget } from "./deploy-target.js";
import { brokerAuth } from "./middleware/broker-auth.js";
import { registerAppsRoutes } from "./routes/apps-routes.js";
import type { Env } from "./types.js";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/apps/*", brokerAuth());

app.all("/apps/*", async (c) => {
  const repository = new AppsRepository(c.env.CONTROL_DB);
  const target = new CloudflareTarget({
    apiToken: c.env.CF_API_TOKEN,
    accountId: c.env.CF_ACCOUNT_ID,
    dispatchNamespace: "nexu-user-apps",
    appDomain: "happywork.today",
  });
  const perRequestApp = new OpenAPIHono<{ Bindings: Env }>();
  registerAppsRoutes(perRequestApp, { repository, target });
  return perRequestApp.fetch(c.req.raw, c.env);
});

export default app;
```

这版本每个请求仍然 new 一个 `OpenAPIHono` 子路由——在 `workerd` 里这是可接受的（Worker 本身按请求隔离执行，构造开销是几个对象字面量，不是连接池），比起为了「只注册一次」引入模块级可变状态更符合 Workers 无状态请求模型的惯例。若未来 profiling 显示这是热点，再优化。

- [ ] **Step 7: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker test -- apps-routes.test.ts
```
Expected: PASS，5 个用例。

- [ ] **Step 8: 跑 broker 全量测试 + typecheck**

```bash
pnpm --filter @nexu/deploy-broker test
pnpm --filter @nexu/deploy-broker typecheck
```
Expected: 全部 PASS，无类型错误。

- [ ] **Step 9: Commit**

```bash
git add apps/deploy-broker/src/middleware apps/deploy-broker/src/routes \
  apps/deploy-broker/src/index.ts apps/deploy-broker/tests/apps-routes.test.ts
git commit -m "feat: wire deploy-broker HTTP routes with API key auth"
```

---

## Task 9: dispatch worker（子域路由 + 秒级下线）

**Files:**
- Create: `apps/deploy-broker/dispatch-worker/package.json`
- Create: `apps/deploy-broker/dispatch-worker/wrangler.toml`
- Create: `apps/deploy-broker/dispatch-worker/tsconfig.json`
- Create: `apps/deploy-broker/dispatch-worker/src/index.ts`
- Test: `apps/deploy-broker/dispatch-worker/tests/dispatch-worker.test.ts`

**Interfaces:**
- Consumes：无新增（读同一个 `CONTROL_DB` D1 binding，直接查 `apps` 表，不依赖 Task 2 的 `AppsRepository` 类——dispatch worker 是独立部署单元，为了不引入跨 workspace 依赖，这里手写一次最小查询，字段名与 `schema.sql` 保持一致）。
- Produces：这是终端消费者，不产出给其他任务的接口。

- [ ] **Step 1: package.json + wrangler.toml + tsconfig**

```json
{
  "name": "@nexu/deploy-broker-dispatch",
  "version": "0.0.1",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run tests"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250214.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5",
    "wrangler": "^3.109.3"
  }
}
```

```toml
# apps/deploy-broker/dispatch-worker/wrangler.toml
name = "nexu-dispatch-worker"
main = "src/index.ts"
compatibility_date = "2026-07-01"

[[d1_databases]]
binding = "CONTROL_DB"
database_name = "nexu-deploy-broker-control"
database_id = "REPLACE_AFTER_TASK_11_BOOTSTRAP" # 与 broker 的 wrangler.toml 指向同一个数据库

[[dispatch_namespaces]]
binding = "DISPATCHER"
namespace = "nexu-user-apps"

[[routes]]
pattern = "*.happywork.today/*"
zone_name = "happywork.today"
```

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 2: 写失败测试**

```typescript
// apps/deploy-broker/dispatch-worker/tests/dispatch-worker.test.ts
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

function fakeControlDb(row: { status: string } | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
      }),
    }),
  } as unknown as D1Database;
}

describe("dispatch worker", () => {
  it("dispatches to the user Worker matching the subdomain when app is active", async () => {
    const userWorkerFetch = vi.fn(
      async () => new Response("hello from user app"),
    );
    const env = {
      CONTROL_DB: fakeControlDb({ status: "active" }),
      DISPATCHER: {
        get: vi.fn(() => ({ fetch: userWorkerFetch })),
      },
    } as unknown as { CONTROL_DB: D1Database; DISPATCHER: DispatchNamespace };

    const request = new Request("https://app-a1b2c3d4.happywork.today/");
    const response = await worker.fetch(request, env);

    expect(env.DISPATCHER.get).toHaveBeenCalledWith("app-a1b2c3d4");
    expect(await response.text()).toBe("hello from user app");
  });

  it("returns 403 when the app is suspended", async () => {
    const env = {
      CONTROL_DB: fakeControlDb({ status: "suspended" }),
      DISPATCHER: { get: vi.fn() },
    } as unknown as { CONTROL_DB: D1Database; DISPATCHER: DispatchNamespace };

    const request = new Request("https://app-a1b2c3d4.happywork.today/");
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(403);
    expect(env.DISPATCHER.get).not.toHaveBeenCalled();
  });

  it("returns 404 when no app matches the subdomain", async () => {
    const env = {
      CONTROL_DB: fakeControlDb(null),
      DISPATCHER: { get: vi.fn() },
    } as unknown as { CONTROL_DB: D1Database; DISPATCHER: DispatchNamespace };

    const request = new Request("https://app-unknown.happywork.today/");
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @nexu/deploy-broker-dispatch test -- dispatch-worker.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现**

```typescript
// apps/deploy-broker/dispatch-worker/src/index.ts
interface Env {
  CONTROL_DB: D1Database;
  DISPATCHER: DispatchNamespace;
}

interface AppStatusRow {
  status: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const subdomain = url.hostname.split(".")[0];

    const row = await env.CONTROL_DB.prepare(
      "SELECT status FROM apps WHERE hostname = ?",
    )
      .bind(url.hostname)
      .first<AppStatusRow>();

    if (!row) {
      return new Response("Unknown application", { status: 404 });
    }

    if (row.status !== "active") {
      return new Response("This application is currently unavailable", {
        status: 403,
      });
    }

    const userWorker = env.DISPATCHER.get(subdomain);
    return userWorker.fetch(request);
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @nexu/deploy-broker-dispatch test -- dispatch-worker.test.ts
```
Expected: PASS，3 个用例。

- [ ] **Step 6: Commit**

```bash
git add apps/deploy-broker/dispatch-worker
git commit -m "feat: add subdomain dispatch worker with instant-suspend gate"
```

---

## Task 10: 一次性 Cloudflare 账号引导（人工 runbook，非代码）

这个任务不产出代码——它是让 Task 8/9 的 `wrangler.toml` 里的占位符变成真实值、并让整条链路真正可部署所必须的账号级操作，**只做一次**，此后不再重复。写在这里是因为它是阻塞后续任务上线验证的前置条件，且是 design doc「阶段 0 必须先验证的事实」中「D1 迁移执行路径」以外几乎所有开放问题的落地位置。

**Files:** 无代码改动；产出 `apps/deploy-broker/BOOTSTRAP.md`（记录执行结果，供团队后续查阅，不是给 agent 读的运行时文件）。

- [ ] **Step 1: 确认 Zero Trust / Access 已在该 Cloudflare 账号启用**

登录 Cloudflare Dashboard → 选中 `picaso.studio`/`happywork.today` 所在账号 → 左侧 **Zero Trust**。如果是第一次进入，会要求设置一个 team domain（如 `nexu-happywork`），最终形如 `nexu-happywork.cloudflareaccess.com`。记录这个 team domain——它是 design doc 里「必须实测的大陆可达性单点故障」的地址，Task 13 的验收 runbook 要用到。

- [ ] **Step 2: 创建 dispatch namespace**

```bash
npx wrangler dispatch-namespace create nexu-user-apps
```
Expected: 输出确认创建成功，namespace 名称与 `wrangler.toml` 里 `[[dispatch_namespaces]] namespace = "nexu-user-apps"` 一致。

- [ ] **Step 3: 创建控制面 D1 数据库并应用 schema**

```bash
npx wrangler d1 create nexu-deploy-broker-control
```
输出会包含形如 `database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` 的一行。把这个值填入：
- `apps/deploy-broker/wrangler.toml` 的 `database_id`
- `apps/deploy-broker/dispatch-worker/wrangler.toml` 的 `database_id`（两处必须指向**同一个**数据库——broker 写、dispatch worker 读）

```bash
npx wrangler d1 execute nexu-deploy-broker-control --remote --file=apps/deploy-broker/src/db/schema.sql
```
Expected: 确认 `apps` 表创建成功。

- [ ] **Step 4: 创建限权 API Token（不要用 Global API Key）**

Cloudflare Dashboard → My Profile → API Tokens → Create Token → Custom Token，权限最小化为：
- Account → Workers Scripts → Edit
- Account → Workers for Platforms → Edit（对应 dispatch namespace 操作）
- Account → D1 → Edit
- Account → Access: Apps and Policies → Edit
- Zone → DNS → Edit（仅用于 Step 5 一次性配置，配完可考虑收窄）
- Zone Resources 限定为 `happywork.today` 一个 zone

**这个 token 只填进 broker 的 Cloudflare Workers Secret（`wrangler secret put CF_API_TOKEN`），绝不进 git、绝不进 `.env` 提交、绝不进桌面端任何配置文件。**

```bash
cd apps/deploy-broker
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_ZONE_ID
npx wrangler secret put BROKER_API_KEY   # 自己生成一个随机字符串，controller 侧配置同一个值
```

- [ ] **Step 5: 一次性通配符 DNS + Worker Route**

Dashboard → `happywork.today` zone → DNS → 添加记录：`A` 或 `CNAME`，name = `*`，随便指一个可解析目标（proxied/橙云打开，实际内容由 Worker Route 接管，不依赖这条记录真正解析到什么）。

Workers & Pages → 找到部署后的 `nexu-dispatch-worker` → Triggers → Routes → 确认 `*.happywork.today/*` 已绑定（`dispatch-worker/wrangler.toml` 里的 `[[routes]]` 在 `wrangler deploy` 时会自动创建，此步骤是核实，不是手工重复操作）。

- [ ] **Step 6: 部署 broker 与 dispatch worker**

```bash
pnpm --filter @nexu/deploy-broker deploy
pnpm --filter @nexu/deploy-broker-dispatch deploy
```
Expected: 两次 `wrangler deploy` 均成功，输出各自的 `*.workers.dev` 地址（broker 自己的管理 API 入口，不是用户应用地址）。记录 broker 的公网地址——Task 12 的 `DEPLOY_BROKER_URL` 要填这个值。

- [ ] **Step 7: 记录执行结果**

```markdown
<!-- apps/deploy-broker/BOOTSTRAP.md -->
# Broker Bootstrap Record

- Zero Trust team domain: <填入 Step 1 的值>
- dispatch namespace: nexu-user-apps
- control D1 database_id: <填入 Step 3 的值>
- broker public URL: <填入 Step 6 的值>
- Bootstrap 执行日期: <填入实际日期>
- 执行人: <填入>
```

这个文件记录一次性操作的结果，不含任何密钥。

- [ ] **Step 8: Commit**

```bash
git add apps/deploy-broker/wrangler.toml apps/deploy-broker/dispatch-worker/wrangler.toml apps/deploy-broker/BOOTSTRAP.md
git commit -m "chore: record deploy-broker Cloudflare bootstrap (database_id, namespace)"
```

---

## Task 11: controller 侧 broker 客户端

**Files:**
- Create: `apps/controller/src/services/deploy-broker-client.ts`
- Test: `apps/controller/tests/deploy-broker-client.test.ts`
- Modify: `apps/controller/src/app/env.ts`

**Interfaces:**
- Consumes：Task 1 的共享 schema；Task 8 的 HTTP 契约。
- Produces：`createDeployBrokerClient(options): DeployBrokerClient`，方法 `createApp(allowedEmails)`、`deployBundle(appId, script)`、`getApp(appId)`、`deleteApp(appId)`，均返回 `{ok:true,data} | {ok:false,reason}`——供 Task 12（controller 路由）消费。这一层严格照抄 `cloud-reward-service.ts` 的既有形状（`proxyFetch` + zod 解析 + 判别联合结果），不引入新模式。

- [ ] **Step 1: env.ts 追加配置（先做，客户端实现要用）**

```typescript
// apps/controller/src/app/env.ts
// 在既有 zod schema 对象里追加两个字段（沿用文件里 z.string().url().optional() 的写法）：
  DEPLOY_BROKER_URL: z.string().url().optional(),
  DEPLOY_BROKER_API_KEY: z.string().optional(),
```

具体插入位置：跟在 `OPENCLAW_BASE_URL: z.string().url().optional(),` 那一行后面（grounding 阶段确认过这行存在），保持同一组风格的字段挨在一起。

- [ ] **Step 2: 写失败测试**

```typescript
// apps/controller/tests/deploy-broker-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeployBrokerClient } from "../src/services/deploy-broker-client.js";

const BROKER_URL = "https://nexu-deploy-broker.example.workers.dev";
const API_KEY = "test-broker-key";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDeployBrokerClient", () => {
  it("createApp() posts allowedEmails and returns the parsed app on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BROKER_URL}/apps`);
        expect((init.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${API_KEY}`,
        );
        expect(JSON.parse(init.body as string)).toEqual({
          allowedEmails: ["user@example.com"],
        });
        return new Response(
          JSON.stringify({
            id: "a1b2c3d4",
            hostname: "app-a1b2c3d4.happywork.today",
            status: "active",
            allowedEmails: ["user@example.com"],
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-30T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }),
    );

    const client = createDeployBrokerClient({
      brokerUrl: BROKER_URL,
      apiKey: API_KEY,
    });
    const result = await client.createApp(["user@example.com"]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.hostname).toBe("app-a1b2c3d4.happywork.today");
  });

  it("createApp() returns ok:false on broker error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "quota exceeded" }), {
            status: 400,
          }),
      ),
    );

    const client = createDeployBrokerClient({
      brokerUrl: BROKER_URL,
      apiKey: API_KEY,
    });
    const result = await client.createApp(["user@example.com"]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("quota exceeded");
  });

  it("deployBundle() posts the script to /apps/:id/deploy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BROKER_URL}/apps/a1b2c3d4/deploy`);
        expect(JSON.parse(init.body as string)).toEqual({
          script: "export default {};",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            hostname: "app-a1b2c3d4.happywork.today",
          }),
          { status: 200 },
        );
      }),
    );

    const client = createDeployBrokerClient({
      brokerUrl: BROKER_URL,
      apiKey: API_KEY,
    });
    const result = await client.deployBundle(
      "a1b2c3d4",
      "export default {};",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.hostname).toBe("app-a1b2c3d4.happywork.today");
  });

  it("deleteApp() sends DELETE and reports ok:true on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BROKER_URL}/apps/a1b2c3d4`);
        expect(init.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      }),
    );

    const client = createDeployBrokerClient({
      brokerUrl: BROKER_URL,
      apiKey: API_KEY,
    });
    const result = await client.deleteApp("a1b2c3d4");
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @nexu/controller test -- deploy-broker-client.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现**

```typescript
// apps/controller/src/services/deploy-broker-client.ts
import { type DeployedApp, deployedAppSchema } from "@nexu/shared";
import { proxyFetch } from "../lib/proxy-fetch.js";

export type DeployBrokerResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

interface DeployBrokerClientOptions {
  brokerUrl: string;
  apiKey: string;
}

export interface DeployBrokerClient {
  createApp(
    allowedEmails: readonly string[],
  ): Promise<DeployBrokerResult<DeployedApp>>;
  deployBundle(
    appId: string,
    script: string,
  ): Promise<DeployBrokerResult<{ hostname: string }>>;
  getApp(appId: string): Promise<DeployBrokerResult<DeployedApp>>;
  deleteApp(appId: string): Promise<DeployBrokerResult<true>>;
}

async function parseErrorReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `request failed with status ${response.status}`;
  } catch {
    return `request failed with status ${response.status}`;
  }
}

export function createDeployBrokerClient(
  options: DeployBrokerClientOptions,
): DeployBrokerClient {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.apiKey}`,
  };

  return {
    async createApp(allowedEmails) {
      const response = await proxyFetch(`${options.brokerUrl}/apps`, {
        method: "POST",
        headers,
        body: JSON.stringify({ allowedEmails }),
      });
      if (!response.ok) {
        return { ok: false, reason: await parseErrorReason(response) };
      }
      const data = deployedAppSchema.parse(await response.json());
      return { ok: true, data };
    },

    async deployBundle(appId, script) {
      const response = await proxyFetch(
        `${options.brokerUrl}/apps/${appId}/deploy`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ script }),
        },
      );
      if (!response.ok) {
        return { ok: false, reason: await parseErrorReason(response) };
      }
      const data = (await response.json()) as { hostname: string };
      return { ok: true, data };
    },

    async getApp(appId) {
      const response = await proxyFetch(`${options.brokerUrl}/apps/${appId}`, {
        headers,
      });
      if (!response.ok) {
        return { ok: false, reason: await parseErrorReason(response) };
      }
      const data = deployedAppSchema.parse(await response.json());
      return { ok: true, data };
    },

    async deleteApp(appId) {
      const response = await proxyFetch(`${options.brokerUrl}/apps/${appId}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        return { ok: false, reason: await parseErrorReason(response) };
      }
      return { ok: true, data: true };
    },
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @nexu/controller test -- deploy-broker-client.test.ts
```
Expected: PASS，4 个用例。

- [ ] **Step 6: Commit**

```bash
git add apps/controller/src/services/deploy-broker-client.ts \
  apps/controller/tests/deploy-broker-client.test.ts apps/controller/src/app/env.ts
git commit -m "feat: add deploy broker HTTP client to controller"
```

---

## Task 12: controller 路由 + container 接入 + SDK 生成

**Files:**
- Create: `apps/controller/src/routes/deploy-routes.ts`
- Test: `apps/controller/tests/deploy-routes.test.ts`
- Modify: `apps/controller/src/app/container.ts`
- Modify: `apps/controller/src/app/create-app.ts`

**Interfaces:**
- Consumes：Task 11 的 `DeployBrokerClient`。
- Produces：`POST /api/v1/deploy/apps`、`POST /api/v1/deploy/apps/:id/deploy`、`DELETE /api/v1/deploy/apps/:id`——desktop/web 通过生成的 SDK 调用（本任务不写 web UI，SDK 生成到位即满足「入口留缝」，具体触发面留给 Task 13 的 skill）。

- [ ] **Step 1: container 接入**

```typescript
// apps/controller/src/app/container.ts
// 在既有 import 区追加：
import { createDeployBrokerClient, type DeployBrokerClient } from "../services/deploy-broker-client.js";

// 在 ControllerContainer interface 里追加一行：
  deployBrokerClient: DeployBrokerClient | null;

// 在 createContainer() 函数体内、构造 return 对象之前追加：
  const deployBrokerClient =
    env.DEPLOY_BROKER_URL && env.DEPLOY_BROKER_API_KEY
      ? createDeployBrokerClient({
          brokerUrl: env.DEPLOY_BROKER_URL,
          apiKey: env.DEPLOY_BROKER_API_KEY,
        })
      : null;

// 在 return { ... } 里追加一行：
    deployBrokerClient,
```

`deployBrokerClient` 允许为 `null`——本地开发者没配 broker 凭据时（大多数日常 `pnpm dev` 场景）controller 仍要能正常起，只是部署路由会返回「未配置」，不阻塞其它一切功能。这是「不为不存在的场景加防御」原则的反面情形：这里的「未配置」是真实会发生的日常状态（大多数开发者机器上根本不会填 broker 凭据），必须处理。

- [ ] **Step 2: 写路由的失败测试**

```typescript
// apps/controller/tests/deploy-routes.test.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { registerDeployRoutes } from "../src/routes/deploy-routes.js";
import type { ControllerBindings } from "../src/types.js";

function buildApp(deployBrokerClient: unknown) {
  const app = new OpenAPIHono<ControllerBindings>();
  registerDeployRoutes(app, {
    deployBrokerClient: deployBrokerClient as never,
  });
  return app;
}

describe("deploy routes", () => {
  it("POST /api/v1/deploy/apps returns 503 when broker is not configured", async () => {
    const app = buildApp(null);
    const res = await app.request("/api/v1/deploy/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedEmails: ["user@example.com"] }),
    });
    expect(res.status).toBe(503);
  });

  it("POST /api/v1/deploy/apps proxies to the broker client on success", async () => {
    const createApp = vi.fn(async () => ({
      ok: true as const,
      data: {
        id: "a1b2c3d4",
        hostname: "app-a1b2c3d4.happywork.today",
        status: "active" as const,
        allowedEmails: ["user@example.com"],
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    }));
    const app = buildApp({ createApp });

    const res = await app.request("/api/v1/deploy/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedEmails: ["user@example.com"] }),
    });

    expect(res.status).toBe(201);
    expect(createApp).toHaveBeenCalledWith(["user@example.com"]);
    const body = await res.json();
    expect(body.hostname).toBe("app-a1b2c3d4.happywork.today");
  });

  it("POST /api/v1/deploy/apps/:id/deploy proxies the script", async () => {
    const deployBundle = vi.fn(async () => ({
      ok: true as const,
      data: { hostname: "app-a1b2c3d4.happywork.today" },
    }));
    const app = buildApp({ deployBundle });

    const res = await app.request("/api/v1/deploy/apps/a1b2c3d4/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script: "export default {};" }),
    });

    expect(res.status).toBe(200);
    expect(deployBundle).toHaveBeenCalledWith("a1b2c3d4", "export default {};");
  });

  it("DELETE /api/v1/deploy/apps/:id proxies deletion", async () => {
    const deleteApp = vi.fn(async () => ({ ok: true as const, data: true as const }));
    const app = buildApp({ deleteApp });

    const res = await app.request("/api/v1/deploy/apps/a1b2c3d4", {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(deleteApp).toHaveBeenCalledWith("a1b2c3d4");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @nexu/controller test -- deploy-routes.test.ts
```
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现路由**

```typescript
// apps/controller/src/routes/deploy-routes.ts
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createDeployedAppRequestSchema,
  deployBundleRequestSchema,
  deployBundleResponseSchema,
  deployedAppSchema,
} from "@nexu/shared";
import type { DeployBrokerClient } from "../services/deploy-broker-client.js";
import type { ControllerBindings } from "../types.js";

export interface DeployRoutesDeps {
  deployBrokerClient: DeployBrokerClient | null;
}

export function registerDeployRoutes(
  app: OpenAPIHono<ControllerBindings>,
  deps: DeployRoutesDeps,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/deploy/apps",
      tags: ["Deploy"],
      request: {
        body: {
          content: {
            "application/json": { schema: createDeployedAppRequestSchema },
          },
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: deployedAppSchema } },
          description: "Created app",
        },
        503: { description: "Deploy broker not configured" },
      },
    }),
    async (c) => {
      if (!deps.deployBrokerClient) {
        return c.json({ error: "deploy broker not configured" }, 503);
      }
      const { allowedEmails } = c.req.valid("json");
      const result = await deps.deployBrokerClient.createApp(allowedEmails);
      if (!result.ok) {
        return c.json({ error: result.reason }, 502);
      }
      return c.json(result.data, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/deploy/apps/{id}/deploy",
      tags: ["Deploy"],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            "application/json": { schema: deployBundleRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: deployBundleResponseSchema },
          },
          description: "Deployed",
        },
        503: { description: "Deploy broker not configured" },
      },
    }),
    async (c) => {
      if (!deps.deployBrokerClient) {
        return c.json({ error: "deploy broker not configured" }, 503);
      }
      const { id } = c.req.valid("param");
      const { script } = c.req.valid("json");
      const result = await deps.deployBrokerClient.deployBundle(id, script);
      if (!result.ok) {
        return c.json({ error: result.reason }, 502);
      }
      return c.json({ ok: true as const, hostname: result.data.hostname }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/deploy/apps/{id}",
      tags: ["Deploy"],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        204: { description: "Deleted" },
        503: { description: "Deploy broker not configured" },
      },
    }),
    async (c) => {
      if (!deps.deployBrokerClient) {
        return c.json({ error: "deploy broker not configured" }, 503);
      }
      const { id } = c.req.valid("param");
      const result = await deps.deployBrokerClient.deleteApp(id);
      if (!result.ok) {
        return c.json({ error: result.reason }, 502);
      }
      return c.body(null, 204);
    },
  );
}
```

- [ ] **Step 5: 挂载路由**

```typescript
// apps/controller/src/app/create-app.ts
// 追加 import：
import { registerDeployRoutes } from "../routes/deploy-routes.js";

// 在既有 registerUserRoutes(app, container); 等调用旁追加：
  registerDeployRoutes(app, { deployBrokerClient: container.deployBrokerClient });
```

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm --filter @nexu/controller test -- deploy-routes.test.ts
```
Expected: PASS，4 个用例。

- [ ] **Step 7: 生成 OpenAPI + SDK**

```bash
pnpm generate-types
```
Expected: `openapi.json` 更新，`apps/web/lib/api/sdk.gen.ts` 出现 `postApiV1DeployApps` 等新函数。

- [ ] **Step 8: 全量 typecheck**

```bash
pnpm typecheck
```
Expected: 无错误。

- [ ] **Step 9: Commit**

```bash
git add apps/controller/src/routes/deploy-routes.ts apps/controller/tests/deploy-routes.test.ts \
  apps/controller/src/app/container.ts apps/controller/src/app/create-app.ts \
  apps/web/lib/api openapi.json
git commit -m "feat: expose deploy broker via controller HTTP routes and generated SDK"
```

---

## Task 13: agent 部署 skill（本地构建 + 一键触发入口）

**Files:**
- Create: `nexu-skills/skills/deploy-app/SKILL.md`
- Create: `nexu-skills/skills/deploy-app/scripts/build-and-deploy.mjs`
- Create: `nexu-skills/skills/deploy-app/templates/hono-d1-app.ts`

**Interfaces:**
- Consumes：Task 12 的 `POST /api/v1/deploy/apps`、`POST /api/v1/deploy/apps/:id/deploy`（controller 本地地址，agent 通过 workspace 内 `NEXU_CONTROLLER_URL` 环境变量或约定的 `http://127.0.0.1:<port>` 访问——与其它 skill 一致，具体端口发现机制沿用仓库既有 controller 本地寻址方式，不在本任务内新增）。

这是「阶段 0 必须先验证的事实」里「聊天里说部署 vs. web 页面按钮」这一开放问题的**最小可行落地**：先给 agent 一个可调用的命令行工具，验证全链路通了，再决定要不要包一层聊天关键词路由或 web 页面——那是阶段 1+ 的 UX 打磨，不是阶段 0 要证明的东西。

- [ ] **Step 1: SKILL.md**

```markdown
<!-- nexu-skills/skills/deploy-app/SKILL.md -->
---
name: deploy-app
description: Deploy a Hono + D1 app built in this workspace to a public URL on happywork.today, gated by email login.
---

# Deploy App

Use this skill when the user wants to put a self-built app (with a database) online at a real URL they can access from anywhere, protected by their own email login.

## What this does

1. Bundles your app's entry file with esbuild into a single script.
2. Calls the local controller to provision (first time) or update (subsequent deploys) a hosted instance.
3. Returns a URL in the form `https://app-<id>.happywork.today` that only the allowed email addresses can open.

## Prerequisites

- Your app's entry point must be a single Hono app default-exporting a Workers `fetch` handler — see `templates/hono-d1-app.ts` for the expected shape.
- Your app must not depend on Node-only APIs (`node:fs`, native modules) or static asset bindings — the runtime is Cloudflare Workers, not Node.
- Your app receives a D1 binding named `DB` automatically; do not declare your own database connection.

## Usage

First deploy (creates the app and asks who can access it):

\`\`\`bash
node scripts/build-and-deploy.mjs --entry ./src/app.ts --emails "owner@example.com"
\`\`\`

Subsequent deploys (updates the same app — pass the id printed by the first deploy):

\`\`\`bash
node scripts/build-and-deploy.mjs --entry ./src/app.ts --app-id <id-from-first-deploy>
\`\`\`

The script prints the live URL on success.
```

- [ ] **Step 2: agent scaffold 模板（供 agent 参考起始结构，不是本计划自动生成或测试的对象——它是文档性质的样例文件）**

```typescript
// nexu-skills/skills/deploy-app/templates/hono-d1-app.ts
import { Hono } from "hono";

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const email = c.req.header("cf-access-authenticated-user-email") ?? "there";
  return c.html(`<h1>Hello, ${email}</h1>`);
});

export default app;
```

- [ ] **Step 3: 构建 + 部署脚本**

```javascript
// nexu-skills/skills/deploy-app/scripts/build-and-deploy.mjs
import { build } from "esbuild";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    entry: { type: "string" },
    "app-id": { type: "string" },
    emails: { type: "string" },
  },
});

if (!values.entry) {
  console.error("Usage: build-and-deploy.mjs --entry <file> [--app-id <id> | --emails <comma,separated>]");
  process.exit(1);
}

if (!values["app-id"] && !values.emails) {
  console.error("First deploy requires --emails; subsequent deploys require --app-id.");
  process.exit(1);
}

const controllerUrl = process.env.NEXU_CONTROLLER_URL ?? "http://127.0.0.1:3010";

const result = await build({
  entryPoints: [values.entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  conditions: ["worker", "browser"],
});

const script = result.outputFiles[0].text;

let appId = values["app-id"];

if (!appId) {
  const emails = values.emails.split(",").map((e) => e.trim());
  const createRes = await fetch(`${controllerUrl}/api/v1/deploy/apps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowedEmails: emails }),
  });
  if (!createRes.ok) {
    console.error(`Failed to create app: ${createRes.status} ${await createRes.text()}`);
    process.exit(1);
  }
  const created = await createRes.json();
  appId = created.id;
  console.log(`Created app ${appId}`);
}

const deployRes = await fetch(
  `${controllerUrl}/api/v1/deploy/apps/${appId}/deploy`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script }),
  },
);

if (!deployRes.ok) {
  console.error(`Failed to deploy: ${deployRes.status} ${await deployRes.text()}`);
  process.exit(1);
}

const deployed = await deployRes.json();
console.log(`Live at https://${deployed.hostname}`);
console.log(`Redeploy later with: --app-id ${appId}`);
```

- [ ] **Step 4: 手工冒烟（无自动化测试——这个脚本的正确性由 Task 14 的端到端验收覆盖，单独 mock esbuild+fetch 的价值低于直接跑一次真实部署）**

```bash
node -e "require('esbuild')" 2>&1 | head -1
```
Expected: 不报 `Cannot find module`，确认 esbuild 在 workspace 里可解析（controller 或其它 app 的 devDependency 提升到了根 node_modules；若报错，需要在 `nexu-skills/skills/deploy-app/` 下建最小 `package.json` 声明 `esbuild` 依赖——留到 Task 14 端到端验收时按实际情况处理，不在本步骤空转猜测）。

- [ ] **Step 5: Commit**

```bash
git add nexu-skills/skills/deploy-app
git commit -m "feat: add deploy-app skill for one-command hosting from agent workspace"
```

---

## Task 14: 阶段 0 端到端验收 + 六项待验证事实核验

**Files:** 无新代码；产出 `specs/design-docs/2026-07-30-user-app-hosting.md` 的更新（把「阶段 0 必须先验证的事实」六条逐一填上实测结论）。

这是阶段 0 的验收关口。前 13 个任务的单元/集成测试都用 mock 验证了「代码按预期调用了正确的 API」，但没有一个测试证明「Cloudflare 真的按文档行为」。本任务用 Task 10 部署好的真实基础设施跑一次完整链路，把 design doc 里悬而未决的六个问题逐一坐实。

- [ ] **Step 1: 部署一个真实的最小测试应用**

```bash
node nexu-skills/skills/deploy-app/scripts/build-and-deploy.mjs \
  --entry nexu-skills/skills/deploy-app/templates/hono-d1-app.ts \
  --emails "<你自己的邮箱>"
```
Expected: 打印出 `Live at https://app-xxxxxxxx.happywork.today`。记录这个 URL 和 app id。

- [ ] **Step 2: 验证 Workers Assets 假设不需要成立（设计已规避，这里确认规避有效）**

```bash
curl -sI https://app-xxxxxxxx.happywork.today/ | head -1
```
Expected: 返回 `30x` 跳转到 Access 登录（未登录状态下的正常行为），说明 Worker 本身可达，且 Phase 0 的「不依赖 Workers Assets」范围裁剪没有引入额外故障点。

- [ ] **Step 3: 浏览器登录验证 Access 拦截 + 邮箱头注入**

用浏览器打开这个 URL，用 Step 1 里填的邮箱走 OTP 登录，确认登录后能看到模板返回的 `Hello, <你的邮箱>` —— 这一步同时验证了 Access 网关生效、`Cf-Access-Authenticated-User-Email` 头被正确注入并被 user worker 读到。

用另一个未被列入 `allowedEmails` 的邮箱尝试登录，确认被 Access 拒绝（不应该看到应用内容）。

- [ ] **Step 4: 验证秒级下线**

```bash
curl -s -X POST https://<broker-public-url>/apps/<app-id>/deploy \
  -H "Authorization: Bearer <BROKER_API_KEY>" \
  -H "content-type: application/json" \
  -d '{}' # 占位，实际用下面这条更新 status 的路径
```

阶段 0 的路由集合里没有单独的「suspend」端点（design doc 把它列为阶段 1 的「配额强制 + 秒级下线」要交付的完整能力，本任务只验证 dispatch worker 的读取逻辑本身是活的）。直接在 D1 里手工改一行验证读取路径：

```bash
npx wrangler d1 execute nexu-deploy-broker-control --remote \
  --command "UPDATE apps SET status = 'suspended' WHERE hostname = 'app-xxxxxxxx.happywork.today'"
curl -sI https://app-xxxxxxxx.happywork.today/
```
Expected: 返回 `403`，不再跳转 Access 登录（因为 dispatch worker 在查完 D1 状态之后、转发给 user worker 之前就拦下了）。跑完记得改回 `active` 或直接走 Step 6 清理。

- [ ] **Step 5: 大陆可达性实测（人工，需要真实大陆网络环境——托给能访问大陆网络的人或设备执行，不是本机能做的）**

请一位在中国大陆网络环境下的人（不经代理）分别测试：
1. `https://<team-domain>.cloudflareaccess.com` 能否打开（Access 登录页可达性）
2. `https://app-xxxxxxxx.happywork.today` 完整登录后的响应延迟（多次采样，覆盖至少一个晚高峰时段）

把结果记录进 Step 7 的 design doc 更新。

- [ ] **Step 6: 清理测试应用**

```bash
curl -s -X DELETE https://<broker-public-url>/apps/<app-id> \
  -H "Authorization: Bearer <BROKER_API_KEY>"
```
Expected: `204`。再次访问该 URL 应返回 dispatch worker 的 `404 Unknown application`。

- [ ] **Step 7: 把实测结论写回 design doc**

打开 [specs/design-docs/2026-07-30-user-app-hosting.md](../design-docs/2026-07-30-user-app-hosting.md) 的「阶段 0 必须先验证的事实」一节，逐条替换为实测结论：

1. Workers Assets 可用性 → 本阶段未使用，规避有效，记录裁剪决定长期有效还是只是临时绕过
2. Access 通配符子域策略 → 记录实际用的是「per-app Access app，非通配符」这个选择本身是否够用，还是随 app 数量增长需要重新评估
3. Outbound Worker 拦截粒度 → 本计划未实现（design doc 原列为阶段 1 范围），标注仍未验证
4. D1 迁移执行路径 → 记录 Step 1 的 `wrangler d1 execute --file=schema.sql` 方式对控制面数据库有效；用户应用自己的业务表迁移路径本计划未覆盖，标注为阶段 1 开放问题
5. Access 登录页大陆可达性 → 填入 Step 5 的实测结论
6. 动态请求大陆真实延迟 → 填入 Step 5 的实测数据

- [ ] **Step 8: Commit**

```bash
git add specs/design-docs/2026-07-30-user-app-hosting.md
git commit -m "docs: record phase 0 end-to-end acceptance findings"
```

---

## 阶段 0 完成后的状态

跑通：agent 在 workspace 写一个 Hono + D1 应用 → 一条命令构建上传 → `app-<id>.happywork.today` 上线 → 指定邮箱 OTP 登录可用 → 能秒级下线 → 能完整删除。`DeployTarget` 接口就位，`CloudflareTarget` 是第一个实现。

**明确不在阶段 0 范围内**（design doc 阶段 1/2 的内容，不要在执行本计划时顺手做掉）：
- 配额强制、用量计费、Outbound Worker 滥用检测（阶段 1）
- 聊天关键词路由「部署」、web 端「我的应用」页面（阶段 1+ UX，本计划只做 CLI 入口）
- Access suspend 的专用 API 端点（本计划验证了 dispatch worker 读取 `status` 的机制，没有暴露修改 `status` 的路由——阶段 1 的配额/滥用系统会是这个字段真正的写入方）
- Supabase 升级路径、国内可达性应急预案（阶段 2）
