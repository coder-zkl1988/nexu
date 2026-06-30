import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export async function getUpdateFileInfo(filePath) {
  const bytes = await readFile(filePath);
  const fileStat = await stat(filePath);

  return {
    url: basename(filePath),
    sha512: createHash("sha512").update(bytes).digest("base64"),
    size: fileStat.size,
  };
}

export function createLatestMacYml({ version, file, releaseDate }) {
  if (!file.url.endsWith(".zip")) {
    throw new Error(
      `macOS electron-updater metadata must reference a .zip artifact, received ${file.url}.`,
    );
  }

  return [
    `version: ${version}`,
    "files:",
    `  - url: ${file.url}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`,
    `path: ${file.url}`,
    `sha512: ${file.sha512}`,
    `releaseDate: '${releaseDate ?? new Date().toISOString()}'`,
    "",
  ].join("\n");
}

export async function writeLatestMacYml({
  releaseRoot,
  updateZipPath,
  version,
  releaseDate,
}) {
  const file = await getUpdateFileInfo(updateZipPath);
  const latestMacYml = createLatestMacYml({ version, file, releaseDate });
  await writeFile(resolve(releaseRoot, "latest-mac.yml"), latestMacYml);
  return latestMacYml;
}
