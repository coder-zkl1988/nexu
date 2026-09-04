import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { afterAll, describe, expect, it } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerXhsOpsRoutes } from "../src/routes/xhs-ops-routes.js";
import { XhsOpsRunService } from "../src/services/xhs-ops-run-service.js";
import { XhsOpsStore } from "../src/store/xhs-ops-store.js";
import type { ControllerBindings } from "../src/types.js";

const tempDir = mkdtempSync(join(tmpdir(), "xhs-ops-routes-"));
const store = new XhsOpsStore(join(tempDir, "xhs-ops.json"));
const runService = new XhsOpsRunService({
  store,
  // 路由冒烟不执行 run；三个方法按接口签名给桩即可。
  deviceControl: {
    getDevice: async () => null,
    executeTask: async () => {
      throw new Error("not used in route smoke test");
    },
    cancelTask: async () => {},
  },
});

function buildApp() {
  const app = new OpenAPIHono<ControllerBindings>();
  registerXhsOpsRoutes(app, {
    xhsOpsStore: store,
    xhsOpsRunService: runService,
  } as ControllerContainer);
  return app;
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("xhs-ops routes wiring", () => {
  it("GET /api/v1/xhs-ops/projects starts empty", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/xhs-ops/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toEqual([]);
  });

  it("project create → list → get round-trips", async () => {
    const app = buildApp();
    const create = await app.request("/api/v1/xhs-ops/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "亲子度假测试项目",
        business: { industry: "亲子旅游", product: "亲子酒店套餐" },
        audience: { ageRange: "28-38" },
      }),
    });
    expect(create.status).toBe(200);
    const created = (
      (await create.json()) as { project: { id: string; name: string } }
    ).project;
    expect(created.name).toBe("亲子度假测试项目");

    const list = await app.request("/api/v1/xhs-ops/projects");
    const listed = (await list.json()) as { projects: { id: string }[] };
    expect(listed.projects.map((p) => p.id)).toContain(created.id);

    const got = await app.request(`/api/v1/xhs-ops/projects/${created.id}`);
    expect(got.status).toBe(200);
    const one = (
      (await got.json()) as {
        project: { business: { industry: string } | null };
      }
    ).project;
    expect(one.business?.industry).toBe("亲子旅游");

    const missing = await app.request("/api/v1/xhs-ops/projects/nope");
    expect(missing.status).toBe(404);
  });

  it("account create under project path wins over body projectId", async () => {
    const app = buildApp();
    const projResp = (await (
      await app.request("/api/v1/xhs-ops/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "账号测试" }),
      })
    ).json()) as { project: { id: string } };
    const proj = projResp.project;

    const res = await app.request(
      `/api/v1/xhs-ops/projects/${proj.id}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "北京职场妈妈",
          positioning: "周末遛娃+亲子酒店",
          persona: {
            age: "32岁",
            gender: "女",
            region: "北京海淀",
            occupation: "互联网产品经理",
            lifeStatus: "2岁娃新手妈妈",
          },
          interestPool: {
            core: ["亲子酒店"],
            extended: ["周末遛娃"],
            general: ["咖啡"],
          },
        }),
      },
    );
    expect(res.status).toBe(200);
    const account = (
      (await res.json()) as {
        account: {
          id: string;
          projectId: string;
          interestPool: { core: string[] };
          persona: { age: string; lifeStatus: string };
        };
      }
    ).account;
    expect(account.projectId).toBe(proj.id);
    expect(account.interestPool.core).toEqual(["亲子酒店"]);
    expect(account.persona).toMatchObject({
      age: "32岁",
      lifeStatus: "2岁娃新手妈妈",
    });

    // 旧数据/未填 persona 时按空字符串补齐，兼容既有账号
    const legacy = await app.request(
      `/api/v1/xhs-ops/projects/${proj.id}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "无人设账号" }),
      },
    );
    const legacyAccount = (
      (await legacy.json()) as { account: { persona: Record<string, string> } }
    ).account;
    expect(legacyAccount.persona).toEqual({
      age: "",
      gender: "",
      region: "",
      occupation: "",
      lifeStatus: "",
    });
  });

  it("GET plan-suggest generates a plan per bound account and 404s for unknown projects", async () => {
    const app = buildApp();
    const proj = (
      (await (
        await app.request("/api/v1/xhs-ops/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "计划建议测试" }),
        })
      ).json()) as { project: { id: string } }
    ).project;
    const mk = (label: string, deviceId: string | null) =>
      app.request(`/api/v1/xhs-ops/projects/${proj.id}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          deviceId,
          interestPool: {
            core: ["亲子酒店", "周末遛娃", "带娃攻略"],
            extended: ["亲子旅行"],
            general: ["咖啡"],
          },
        }),
      });
    await mk("已绑定", "dev-1");
    await mk("未绑定", null);

    const res = await app.request(
      `/api/v1/xhs-ops/projects/${proj.id}/plan-suggest`,
    );
    expect(res.status).toBe(200);
    const { plans } = (await res.json()) as {
      plans: Array<{
        accountLabel: string;
        keywords: Array<{ keyword: string; count: number }>;
        homeFeedCount: number;
        rationale: string[];
      }>;
    };
    expect(plans.map((p) => p.accountLabel)).toEqual(["已绑定"]);
    expect(plans[0]?.keywords.map((k) => k.keyword)).toEqual([
      "亲子酒店",
      "周末遛娃",
      "带娃攻略",
      "亲子旅行",
      "咖啡",
    ]);
    expect(plans[0]?.homeFeedCount).toBe(6);
    expect(plans[0]?.rationale.join(" ")).toContain("搜索占比 80%");

    const missing = await app.request(
      "/api/v1/xhs-ops/projects/nope/plan-suggest",
    );
    expect(missing.status).toBe(404);
  });
});
