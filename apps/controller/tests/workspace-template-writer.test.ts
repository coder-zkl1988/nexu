import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import {
  WorkspaceTemplateWriter,
  injectTimezone,
} from "../src/runtime/workspace-template-writer.js";

const USER_MD_ZH_TEMPLATE = [
  "# USER.md - 关于你的人类",
  "",
  "- **姓名：**",
  "- **时区：**",
  "",
].join("\n");

describe("WorkspaceTemplateWriter", () => {
  let rootDir = "";
  let sourceDir = "";
  let stateDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-workspace-template-writer-"),
    );
    sourceDir = path.join(rootDir, "platform-templates");
    stateDir = path.join(rootDir, ".openclaw");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "AGENTS.md"),
      "# AGENTS template\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "IDENTITY.md"),
      "# IDENTITY template\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "SOUL.md"),
      "# SOUL template\n",
      "utf8",
    );

    env = {
      openclawStateDir: stateDir,
      platformTemplatesDir: sourceDir,
    } as unknown as ControllerEnv;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function workspacePathFor(botId: string, fileName: string): string {
    return path.join(stateDir, "agents", botId, fileName);
  }

  it("seeds every template file when the workspace is empty", async () => {
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-empty", status: "active" }]);

    expect(
      await readFile(workspacePathFor("bot-empty", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS template\n");
    expect(
      await readFile(workspacePathFor("bot-empty", "IDENTITY.md"), "utf8"),
    ).toBe("# IDENTITY template\n");
    expect(
      await readFile(workspacePathFor("bot-empty", "SOUL.md"), "utf8"),
    ).toBe("# SOUL template\n");
  });

  it("never overwrites a file that already exists in the workspace", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-self-edited";
    const workspaceDir = path.join(stateDir, "agents", botId);
    await mkdir(workspaceDir, { recursive: true });

    // Simulate the agent having edited every platform doc at runtime.
    const customAgents = "# my custom AGENTS content edited by the agent\n";
    const customIdentity = "# my custom IDENTITY edited by the agent\n";
    const customSoul = "# my custom SOUL edited by the agent\n";
    await writeFile(path.join(workspaceDir, "AGENTS.md"), customAgents, "utf8");
    await writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      customIdentity,
      "utf8",
    );
    await writeFile(path.join(workspaceDir, "SOUL.md"), customSoul, "utf8");

    await writer.write([{ id: botId, status: "active" }]);

    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      customAgents,
    );
    expect(await readFile(workspacePathFor(botId, "IDENTITY.md"), "utf8")).toBe(
      customIdentity,
    );
    expect(await readFile(workspacePathFor(botId, "SOUL.md"), "utf8")).toBe(
      customSoul,
    );
  });

  it("seeds missing files while preserving pre-existing ones (mixed case)", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-mixed";
    const workspaceDir = path.join(stateDir, "agents", botId);
    await mkdir(workspaceDir, { recursive: true });

    // Agent has edited IDENTITY.md but not the others.
    const customIdentity = "# IDENTITY edited\n";
    await writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      customIdentity,
      "utf8",
    );

    await writer.write([{ id: botId, status: "active" }]);

    // Pre-existing file preserved.
    expect(await readFile(workspacePathFor(botId, "IDENTITY.md"), "utf8")).toBe(
      customIdentity,
    );
    // Missing files seeded from the template source.
    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      "# AGENTS template\n",
    );
    expect(await readFile(workspacePathFor(botId, "SOUL.md"), "utf8")).toBe(
      "# SOUL template\n",
    );
  });

  it("is idempotent across repeated invocations", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-repeat";

    await writer.write([{ id: botId, status: "active" }]);

    // After the first seed, simulate the agent rewriting AGENTS.md.
    const customAgents = "# AGENTS rewritten by agent after first seed\n";
    await writeFile(
      path.join(stateDir, "agents", botId, "AGENTS.md"),
      customAgents,
      "utf8",
    );

    // A second write() — e.g. via an accidental re-seed — must not clobber it.
    await writer.write([{ id: botId, status: "active" }]);

    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      customAgents,
    );
  });

  it("resolves templates from language subdirectory when present, falling back to en/ then root", async () => {
    // Create lang-specific subdirectories
    await mkdir(path.join(sourceDir, "en"), { recursive: true });
    await mkdir(path.join(sourceDir, "zh-CN"), { recursive: true });

    await writeFile(
      path.join(sourceDir, "en", "AGENTS.md"),
      "# AGENTS en\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "zh-CN", "AGENTS.md"),
      "# AGENTS zh\n",
      "utf8",
    );

    const writer = new WorkspaceTemplateWriter(env);

    // Chinese locale picks zh-CN subdirectory
    await writer.write([{ id: "bot-zh", status: "active", lang: "zh-CN" }]);
    expect(
      await readFile(workspacePathFor("bot-zh", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS zh\n");
    // IDENTITY.md doesn't exist in zh-CN subdir — should not be seeded
    // (only files present in the resolved lang dir are seeded)
    await expect(
      readFile(workspacePathFor("bot-zh", "IDENTITY.md"), "utf8"),
    ).rejects.toThrow();

    // English locale picks en subdirectory
    await writer.write([{ id: "bot-en", status: "active", lang: "en" }]);
    expect(
      await readFile(workspacePathFor("bot-en", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS en\n");

    // Unknown locale falls back to en/
    await writer.write([{ id: "bot-ja", status: "active", lang: "ja" }]);
    expect(
      await readFile(workspacePathFor("bot-ja", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS en\n");
  });

  it("falls back to flat root directory when no language subdirectories exist", async () => {
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-flat", status: "active", lang: "zh-CN" }]);

    // Flat sourceDir has AGENTS.md, IDENTITY.md, SOUL.md directly
    expect(
      await readFile(workspacePathFor("bot-flat", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS template\n");
    expect(
      await readFile(workspacePathFor("bot-flat", "IDENTITY.md"), "utf8"),
    ).toBe("# IDENTITY template\n");
  });

  it("skips inactive bots", async () => {
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-paused", status: "paused" }]);

    // Workspace dir for the inactive bot should never have been created.
    await expect(
      readFile(workspacePathFor("bot-paused", "AGENTS.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("seeds a freshly-created bot's USER.md with the system timezone instead of leaving it blank", async () => {
    await writeFile(
      path.join(sourceDir, "USER.md"),
      USER_MD_ZH_TEMPLATE,
      "utf8",
    );
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-tz", status: "active" }]);

    const content = await readFile(
      workspacePathFor("bot-tz", "USER.md"),
      "utf8",
    );
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(content).toContain(`- **时区：** ${systemTimezone}`);
  });

  it("never touches a pre-existing USER.md, timezone included", async () => {
    await writeFile(
      path.join(sourceDir, "USER.md"),
      USER_MD_ZH_TEMPLATE,
      "utf8",
    );
    const botId = "bot-tz-preserved";
    const workspaceDir = path.join(stateDir, "agents", botId);
    await mkdir(workspaceDir, { recursive: true });
    const alreadyFilled = "# USER.md\n\n- **姓名：** 张三\n- **时区：** UTC\n";
    await writeFile(path.join(workspaceDir, "USER.md"), alreadyFilled, "utf8");

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write([{ id: botId, status: "active" }]);

    expect(await readFile(workspacePathFor(botId, "USER.md"), "utf8")).toBe(
      alreadyFilled,
    );
  });
});

describe("injectTimezone", () => {
  it("fills the empty 时区 (zh-CN) placeholder", () => {
    const result = injectTimezone(USER_MD_ZH_TEMPLATE, "Asia/Shanghai");
    expect(result).toContain("- **时区：** Asia/Shanghai");
  });

  it("fills the empty Timezone (en) placeholder", () => {
    const template = "# USER.md\n\n- **Name:**\n- **Timezone:**\n";
    const result = injectTimezone(template, "America/New_York");
    expect(result).toContain("- **Timezone:** America/New_York");
  });

  it("leaves an already-filled timezone untouched", () => {
    const template = "# USER.md\n\n- **时区：** UTC\n";
    const result = injectTimezone(template, "Asia/Shanghai");
    expect(result).toBe(template);
  });

  it("is a no-op when there is no timezone placeholder at all", () => {
    const template = "# USER.md\n\n- **姓名：**\n";
    expect(injectTimezone(template, "Asia/Shanghai")).toBe(template);
  });
});
