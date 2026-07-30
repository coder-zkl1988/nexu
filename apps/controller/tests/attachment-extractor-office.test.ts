import { describe, expect, it } from "vitest";
import { extractAttachmentText } from "../src/services/attachment-extractor.js";

describe("Office attachment extraction fallback", () => {
  it("keeps a stored Office file path in the prompt when inline extraction is unsupported", async () => {
    const result = await extractAttachmentText({
      content: Buffer.from("fake-docx").toString("base64"),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "reports/q3.docx",
      size: 9,
      storedPath: "/tmp/openclaw/workspace/bot/attachments/q3.docx",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unsupported Office extraction");
    expect(result.reason).toBe("unsupported-mime");
    expect(result.fallbackMarker).toContain(
      'path="/tmp/openclaw/workspace/bot/attachments/q3.docx"',
    );
    expect(result.fallbackMarker).toContain("Use the officecli skill");
  });
});
