import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceExecuteTaskBody, DevicePushMediaBody } from "@nexu/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  XhsOpsProfileService,
  buildProfileTextPrompt,
  parseProfileText,
} from "../src/services/xhs-ops-profile-service.js";
import {
  buildProfileApplyTask,
  parseProfileJson,
} from "../src/services/xhs-ops-task-builder.js";
import { XhsOpsStore } from "../src/store/xhs-ops-store.js";

const tempDir = mkdtempSync(join(tmpdir(), "xhs-ops-profile-"));
const mediaRoot = join(tempDir, "media");
mkdirSync(mediaRoot, { recursive: true });
const store = new XhsOpsStore(join(tempDir, "xhs-ops.json"));

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

async function seed(deviceId: string | null = "dev-1") {
  const project = await store.createProject({
    name: "资料测试",
    opsNotes: {
      forbiddenTopics: ["医美"],
      boostKeywords: [],
      avoidContentTypes: [],
    },
  });
  const account = await store.createAccount({
    projectId: project.id,
    label: "豆豆妈的周末计划",
    positioning: "零踩坑周末遛娃攻略",
    persona: {
      age: "32岁",
      gender: "女",
      region: "北京海淀",
      occupation: "互联网产品经理",
      lifeStatus: "2岁娃新手妈妈",
    },
    deviceId,
    deviceName: deviceId,
    interestPool: {
      core: ["亲子酒店"],
      extended: ["周边游"],
      general: ["咖啡"],
    },
  });
  return { project, account };
}

function fakeImages(prefix: string): string[] {
  return [1, 2, 3].map((i) => {
    const p = join(mediaRoot, `${prefix}-${i}.png`);
    writeFileSync(p, Buffer.from(`png-${prefix}-${i}`));
    return p;
  });
}

describe("XhsOpsProfileService.generate", () => {
  it("fills nickname/bio from text generation and 3 candidates per image slot", async () => {
    const { account } = await seed();
    const prompts: string[] = [];
    const svc = new XhsOpsProfileService({
      store,
      mediaRoot,
      deviceControl: {
        getDevice: async () => null,
        executeTask: async () => {
          throw new Error("unused");
        },
        pushMedia: async () => ({ results: [] }),
      },
      media: {
        generateText: async ({ prompt }) => {
          prompts.push(prompt);
          return {
            text: '好的：{"nickname":"豆豆妈的周末","bio":"天秤座 INFJ｜海淀二娃妈｜周末专治不知道去哪"}',
          };
        },
        generateImage: async ({ prompt, count, aspectRatio }) => {
          prompts.push(`${aspectRatio}:${count}:${prompt.slice(0, 12)}`);
          const paths = fakeImages(aspectRatio === "1:1" ? "avatar" : "cover");
          return {
            path: paths[0] ?? "",
            items: paths.map((p) => ({ path: p })),
          };
        },
      },
      now: () => Date.parse("2026-09-04T12:00:00Z"),
    });
    const updated = await svc.generate(account.id, ["text", "avatar", "cover"]);
    expect(updated.profileDraft.nickname).toBe("豆豆妈的周末");
    expect(updated.profileDraft.bio).toContain("INFJ");
    expect(updated.profileDraft.avatarCandidates).toHaveLength(3);
    expect(updated.profileDraft.coverCandidates).toHaveLength(3);
    expect(updated.profileDraft.generatedAt).toBe("2026-09-04T12:00:00.000Z");
    // 文本提示词带人设、禁忌与三段简介要求；头像 1:1、背景 16:9
    expect(prompts[0]).toContain("32岁·女·北京海淀");
    expect(prompts[0]).toContain("医美");
    expect(prompts[1]).toMatch(/^1:1:3:/);
    expect(prompts[2]).toMatch(/^16:9:3:/);
  });

  it("parseProfileText tolerates prose around the JSON and falls back to lines", () => {
    expect(
      parseProfileText(
        '这是结果：{"nickname":"桃子爸爸","bio":"射手 ENFP"} 以上',
      ),
    ).toEqual({ nickname: "桃子爸爸", bio: "射手 ENFP" });
    expect(parseProfileText("桃子爸爸\n射手 ENFP｜金融奶爸")).toEqual({
      nickname: "桃子爸爸",
      bio: "射手 ENFP｜金融奶爸",
    });
  });

  it("buildProfileTextPrompt forbids marketing and includes the interest pool", async () => {
    const { project, account } = await seed();
    const prompt = buildProfileTextPrompt(project, account);
    expect(prompt).toContain("亲子酒店");
    expect(prompt).toContain("禁止营销话术");
  });
});

describe("XhsOpsProfileService.apply", () => {
  it("pushes the selected images to the phone, dispatches the profile task and records the outcome", async () => {
    const { account } = await seed();
    const [avatar] = fakeImages("sel-avatar");
    await store.updateAccount(account.id, {
      profileDraft: {
        nickname: "豆豆妈的周末",
        bio: "天秤座 INFJ",
        avatarCandidates: [avatar ?? ""],
        coverCandidates: [],
        avatarPath: avatar ?? null,
        coverPath: null,
        generatedAt: null,
        appliedAt: null,
        applyStatus: null,
        applyResult: null,
      },
    });
    let pushed: DevicePushMediaBody | null = null;
    let executed: DeviceExecuteTaskBody | null = null;
    const svc = new XhsOpsProfileService({
      store,
      mediaRoot,
      media: {
        generateText: async () => ({ text: "" }),
        generateImage: async () => ({ path: "", items: [] }),
      },
      deviceControl: {
        getDevice: async () => ({ deviceId: "dev-1", status: "idle" }) as never,
        pushMedia: async (_id, body) => {
          pushed = body;
          return {
            results: body.images.map((i) => ({
              mediaId: i.filename,
              success: true,
            })),
          };
        },
        executeTask: async (_id, body) => {
          executed = body;
          return {
            result: {
              taskId: "t1",
              success: true,
              message:
                '资料已更新。\\n\\nPROFILE_JSON:{"nickname":"done","bio":"done","avatar":"done","cover":"skipped","note":"头像已换"}',
            },
          };
        },
      },
      now: () => Date.parse("2026-09-04T13:00:00Z"),
    });
    const updated = await svc.apply(account.id);
    expect(pushed).not.toBeNull();
    const img = (pushed as unknown as DevicePushMediaBody).images[0];
    expect(img?.filename).toMatch(/^tabby-avatar-[0-9a-f]{8}\.png$/);
    expect(img?.mimeType).toBe("image/png");
    expect(Buffer.from(img?.dataBase64 ?? "", "base64").toString()).toBe(
      "png-sel-avatar-1",
    );
    const task = (executed as unknown as DeviceExecuteTaskBody).task;
    expect(task).toContain("豆豆妈的周末");
    expect(task).toContain(img?.filename ?? "");
    expect(task).not.toContain("背景图：只点");
    expect(task).toContain("PROFILE_JSON:");
    expect(
      (executed as unknown as DeviceExecuteTaskBody).taskPolicy
        ?.confirmationPolicy?.publish,
    ).toBe("forbidden");
    expect(updated.profileDraft.applyStatus).toBe("applied");
    expect(updated.profileDraft.appliedAt).toBe("2026-09-04T13:00:00.000Z");
    expect(updated.profileDraft.applyResult).toContain("头像=done");
  });

  it("refuses when nothing is selected, when unbound, and when the device is busy", async () => {
    const { account: unbound } = await seed(null);
    const svcBase = {
      store,
      mediaRoot,
      media: {
        generateText: async () => ({ text: "" }),
        generateImage: async () => ({ path: "", items: [] }),
      },
    };
    const svc = new XhsOpsProfileService({
      ...svcBase,
      deviceControl: {
        getDevice: async () => ({ status: "busy" }) as never,
        pushMedia: async () => ({ results: [] }),
        executeTask: async () => {
          throw new Error("unused");
        },
      },
    });
    await expect(svc.apply(unbound.id)).rejects.toMatchObject({ status: 400 });

    const { account } = await seed();
    await expect(svc.apply(account.id)).rejects.toMatchObject({ status: 400 }); // 无可应用内容
    await store.updateAccount(account.id, {
      profileDraft: { ...account.profileDraft, nickname: "X" },
    });
    await expect(svc.apply(account.id)).rejects.toMatchObject({ status: 409 }); // 设备忙
  });

  it("rejects images outside the media root", async () => {
    const { account } = await seed();
    const outside = join(tempDir, "outside.png");
    writeFileSync(outside, "x");
    await store.updateAccount(account.id, {
      profileDraft: {
        ...account.profileDraft,
        avatarPath: outside,
        avatarCandidates: [outside],
      },
    });
    const svc = new XhsOpsProfileService({
      store,
      mediaRoot,
      media: {
        generateText: async () => ({ text: "" }),
        generateImage: async () => ({ path: "", items: [] }),
      },
      deviceControl: {
        getDevice: async () => ({ status: "idle" }) as never,
        pushMedia: async () => ({ results: [] }),
        executeTask: async () => {
          throw new Error("unused");
        },
      },
    });
    await expect(svc.apply(account.id)).rejects.toMatchObject({ status: 400 });
  });
});

describe("profile task builder", () => {
  it("only lists requested fields and ends with the PROFILE_JSON contract", () => {
    const t = buildProfileApplyTask({
      label: "A",
      bio: "简介文案",
      coverFilename: "tabby-cover-1.jpg",
    });
    expect(t).toContain("简介：点「简介」");
    expect(t).toContain("背景图：只点「背景图」");
    expect(t).not.toContain("名字：");
    expect(t).not.toContain("头像：点编辑主页");
    expect(t).toContain("PROFILE_JSON:");
  });
  it("parseProfileJson is lenient about literal newlines and unknown values", () => {
    const parsed = parseProfileJson(
      'done\\nPROFILE_JSON:{"nickname":"done","bio":"weird","avatar":"FAILED","note":"x"}\\n[回执] a=1',
    );
    expect(parsed).toEqual({
      nickname: "done",
      bio: "skipped",
      avatar: "failed",
      cover: "skipped",
      note: "x",
    });
    expect(parseProfileJson("no marker")).toBeNull();
  });
});
