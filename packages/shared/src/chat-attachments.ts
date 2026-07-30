export const CHAT_ATTACHMENT_LIMITS = {
  maxCount: 200,
  maxFileBytes: 100_000_000,
  maxImageBytes: 25_000_000,
  maxTotalBytes: 500_000_000,
  maxInlineFileBytes: 5_000_000,
  maxInlineTotalBytes: 25_000_000,
  maxInlineContentChars: 10_000_000,
} as const;

export type DesktopAttachmentPickerKind = "image" | "file" | "directory";

export type DesktopStagedAttachment = {
  type: DesktopAttachmentPickerKind;
  filename: string;
  mimeType: string;
  size: number;
  stagedPath: string;
};
