import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverLocalWebPreviews,
  localWebPreviewAssetPathFromUrl,
  readLocalWebPreviewFile,
} from "../src/services/local-web-preview.js";

const temporaryRoots: string[] = [];

async function createStateDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nexu-local-preview-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local web previews", () => {
  it("extracts nested and encoded asset paths from preview URLs", () => {
    expect(
      localWebPreviewAssetPathFromUrl({
        requestUrl:
          "http://127.0.0.1:50800/api/v1/artifacts/local-preview/bot-1/c2l0ZQ/assets/icons/logo%20dark.png?v=1",
        botId: "bot-1",
        encodedRoot: "c2l0ZQ",
      }),
    ).toBe("assets/icons/logo dark.png");
  });

  it("discovers an index page in the current Bot workspace", async () => {
    const stateDir = await createStateDir();
    const projectRoot = path.join(stateDir, "agents", "bot-1", "landing-page");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "index.html"), "<h1>Hello</h1>");

    const previews = await discoverLocalWebPreviews({
      openclawStateDir: stateDir,
      sessionKey: "agent:bot-1:main",
      requestOrigin: "http://127.0.0.1:18801",
    });

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      botId: "bot-1",
      title: "landing-page preview",
      status: "live",
      contentType: "text/html",
      deployTarget: "local-workspace",
    });
    expect(previews[0]?.previewUrl).toContain(
      "/api/v1/artifacts/local-preview/bot-1/",
    );
  });

  it("serves project assets with the expected content type", async () => {
    const stateDir = await createStateDir();
    const projectRoot = path.join(stateDir, "agents", "bot-1", "site");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "index.html"), "<h1>Hello</h1>");
    await writeFile(
      path.join(projectRoot, "styles.css"),
      "body { color: red; }",
    );

    const encodedRoot = Buffer.from("site", "utf8").toString("base64url");
    const file = await readLocalWebPreviewFile({
      openclawStateDir: stateDir,
      botId: "bot-1",
      encodedRoot,
      assetPath: "styles.css",
    });

    expect(file?.contentType).toBe("text/css; charset=utf-8");
    expect(new TextDecoder().decode(file?.data)).toBe("body { color: red; }");
  });

  it("blocks traversal and symlink escapes from the Bot workspace", async () => {
    const stateDir = await createStateDir();
    const projectRoot = path.join(stateDir, "agents", "bot-1", "site");
    const outsideFile = path.join(stateDir, "secret.txt");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, path.join(projectRoot, "linked.txt"));
    const encodedRoot = Buffer.from("site", "utf8").toString("base64url");

    await expect(
      readLocalWebPreviewFile({
        openclawStateDir: stateDir,
        botId: "bot-1",
        encodedRoot,
        assetPath: "../../secret.txt",
      }),
    ).resolves.toBeNull();
    await expect(
      readLocalWebPreviewFile({
        openclawStateDir: stateDir,
        botId: "bot-1",
        encodedRoot,
        assetPath: "linked.txt",
      }),
    ).resolves.toBeNull();
  });
});
