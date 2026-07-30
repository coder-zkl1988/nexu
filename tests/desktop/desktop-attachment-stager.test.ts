import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageDesktopAttachmentPaths } from "../../apps/desktop/main/services/desktop-attachment-stager";

describe("desktop attachment staging", () => {
  it("stages files without encoding their content into the IPC result", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-stage-"),
    );
    const stateDir = path.join(root, "state");
    const source = path.join(root, "quarterly-report.docx");
    await writeFile(source, "office-content");

    const [staged] = await stageDesktopAttachmentPaths({
      openclawStateDir: stateDir,
      kind: "file",
      sourcePaths: [source],
    });

    expect(staged).toMatchObject({
      type: "file",
      filename: "quarterly-report.docx",
      size: 14,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(staged?.stagedPath).toContain(path.join("media", "inbound"));
    expect(await readFile(staged?.stagedPath ?? "", "utf8")).toBe(
      "office-content",
    );
  });

  it("preserves a selected directory as one attachment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nexu-directory-stage-"));
    const stateDir = path.join(root, "state");
    const source = path.join(root, "project");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await writeFile(path.join(source, "index.html"), "index");
    await writeFile(path.join(source, "nested", "data.txt"), "data");

    const [staged] = await stageDesktopAttachmentPaths({
      openclawStateDir: stateDir,
      kind: "directory",
      sourcePaths: [source],
    });

    expect(staged).toMatchObject({
      type: "directory",
      filename: "project",
      mimeType: "application/x-directory",
      size: 9,
    });
    expect(
      await readFile(
        path.join(staged?.stagedPath ?? "", "nested", "data.txt"),
        "utf8",
      ),
    ).toBe("data");
  });

  it("rejects a file larger than 100 MB before copying", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nexu-large-stage-"));
    const source = path.join(root, "large.bin");
    await writeFile(source, "");
    await truncate(source, 100_000_001);

    await expect(
      stageDesktopAttachmentPaths({
        openclawStateDir: path.join(root, "state"),
        kind: "file",
        sourcePaths: [source],
      }),
    ).rejects.toThrow("100 MB");
    await expect(stat(source)).resolves.toBeDefined();
  });
});
