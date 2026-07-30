import { describe, expect, it } from "vitest";
import {
  type MessageFileKind,
  classifyMessageFile,
} from "../src/lib/chat/message-file-kind";

describe("classifyMessageFile", () => {
  it.each<{
    name: string;
    mimeType: string;
    expected: MessageFileKind;
  }>([
    { name: "receipts/", mimeType: "", expected: "directory" },
    {
      name: "receipt",
      mimeType: "application/pdf; charset=binary",
      expected: "pdf",
    },
    { name: "report.DOCX", mimeType: "", expected: "word" },
    {
      name: "report",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      expected: "word",
    },
    { name: "budget.xlsx", mimeType: "", expected: "spreadsheet" },
    { name: "data", mimeType: "text/csv", expected: "spreadsheet" },
    { name: "pitch.pptx", mimeType: "", expected: "presentation" },
    { name: "photo", mimeType: "image/webp", expected: "image" },
    { name: "recording.mp3", mimeType: "", expected: "audio" },
    { name: "demo", mimeType: "video/mp4", expected: "video" },
    { name: "source.tar.gz", mimeType: "", expected: "archive" },
    { name: "component.tsx", mimeType: "", expected: "code" },
    { name: "notes.md", mimeType: "", expected: "text" },
    {
      name: "payload.bin",
      mimeType: "application/octet-stream",
      expected: "file",
    },
  ])("classifies $name as $expected", ({ name, mimeType, expected }) => {
    expect(classifyMessageFile(name, mimeType)).toBe(expected);
  });
});
