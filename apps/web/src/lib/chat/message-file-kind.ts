export type MessageFileKind =
  | "directory"
  | "pdf"
  | "word"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "code"
  | "text"
  | "file";

const WORD_EXTENSIONS = new Set([
  "doc",
  "docm",
  "docx",
  "dot",
  "dotx",
  "odt",
  "pages",
  "rtf",
]);
const SPREADSHEET_EXTENSIONS = new Set([
  "csv",
  "numbers",
  "ods",
  "tsv",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
]);
const PRESENTATION_EXTENSIONS = new Set([
  "key",
  "odp",
  "pps",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]);
const VIDEO_EXTENSIONS = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "webm",
  "wmv",
]);
const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);
const CODE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const TEXT_EXTENSIONS = new Set(["log", "markdown", "md", "txt"]);

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/rtf",
  "application/vnd.apple.pages",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/rtf",
]);
const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.apple.numbers",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
]);
const PRESENTATION_MIME_TYPES = new Set([
  "application/vnd.apple.keynote",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const ARCHIVE_MIME_TYPES = new Set([
  "application/gzip",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-bzip2",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
]);
const CODE_MIME_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/sql",
  "application/xml",
  "application/yaml",
  "text/css",
  "text/html",
  "text/javascript",
  "text/typescript",
  "text/xml",
  "text/yaml",
]);

function fileExtension(name: string): string {
  const cleanName = name.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") ?? "";
  const lastSegment = cleanName.split("/").pop() ?? "";
  const separatorIndex = lastSegment.lastIndexOf(".");
  return separatorIndex > 0
    ? lastSegment.slice(separatorIndex + 1).toLowerCase()
    : "";
}

export function classifyMessageFile(
  name: string,
  mimeType: string,
): MessageFileKind {
  const extension = fileExtension(name);
  const normalizedMimeType =
    mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (normalizedMimeType === "application/x-directory" || name.endsWith("/")) {
    return "directory";
  }
  if (normalizedMimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }
  if (
    WORD_MIME_TYPES.has(normalizedMimeType) ||
    WORD_EXTENSIONS.has(extension)
  ) {
    return "word";
  }
  if (
    SPREADSHEET_MIME_TYPES.has(normalizedMimeType) ||
    SPREADSHEET_EXTENSIONS.has(extension)
  ) {
    return "spreadsheet";
  }
  if (
    PRESENTATION_MIME_TYPES.has(normalizedMimeType) ||
    PRESENTATION_EXTENSIONS.has(extension)
  ) {
    return "presentation";
  }
  if (
    normalizedMimeType.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(extension)
  ) {
    return "image";
  }
  if (
    normalizedMimeType.startsWith("audio/") ||
    AUDIO_EXTENSIONS.has(extension)
  ) {
    return "audio";
  }
  if (
    normalizedMimeType.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(extension)
  ) {
    return "video";
  }
  if (
    ARCHIVE_MIME_TYPES.has(normalizedMimeType) ||
    ARCHIVE_EXTENSIONS.has(extension)
  ) {
    return "archive";
  }
  if (
    CODE_MIME_TYPES.has(normalizedMimeType) ||
    CODE_EXTENSIONS.has(extension)
  ) {
    return "code";
  }
  if (
    normalizedMimeType.startsWith("text/") ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  return "file";
}
