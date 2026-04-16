import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  type ExpertManifest,
  type MinimalExpert,
  expertManifestSchema,
  minimalExpertSchema,
} from "@nexu/shared";
import type { CatalogMeta, ExpertLedger, ResolvedExpert } from "./types.js";

const execFileAsync = promisify(execFile);

export type ExperthubLogFn = (
  level: "info" | "warn" | "error",
  message: string,
) => void;

const noopLog: ExperthubLogFn = () => {};

type RemoteVersionInfo = {
  version: string;
  updatedAt: string;
  count: number;
};

export type ExperthubCatalogManagerOptions = {
  cacheDir: string;
  ledgerPath: string;
  staticDir: string;
  versionUrl: string;
  downloadUrl: string;
  fetch?: typeof globalThis.fetch;
  log?: ExperthubLogFn;
};

const META_FILENAME = "meta.json";

function toMinimal(manifest: ExpertManifest): MinimalExpert {
  return minimalExpertSchema.parse(manifest);
}

function tryParseManifest(
  raw: unknown,
  source: string,
  log: ExperthubLogFn,
): ExpertManifest | null {
  const parsed = expertManifestSchema.safeParse(raw);
  if (!parsed.success) {
    log(
      "warn",
      `experthub: invalid manifest at ${source} — ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data;
}

async function extractTarball(
  archivePath: string,
  destDir: string,
): Promise<void> {
  // Mirrors skillhub behavior: shell out to the system `tar` binary (no
  // npm `tar` dependency). GNU tar on Windows (Git Bash's tar.exe) needs
  // `--force-local` for paths with drive letters and rejects backslashes,
  // while bsdtar (System32) does not accept `--force-local`.
  const toPosixPath = (p: string): string => p.replace(/\\/g, "/");
  const baseArgs = [
    "-xzf",
    toPosixPath(archivePath),
    "-C",
    toPosixPath(destDir),
  ];
  if (process.platform === "win32") {
    try {
      await execFileAsync("tar", ["--force-local", ...baseArgs]);
      return;
    } catch {
      // fall through to bsdtar
    }
  }
  await execFileAsync("tar", baseArgs);
}

/**
 * ExperthubCatalogManager — read-only catalog of expert manifests plus a
 * simple JSON ledger that tracks which bots were created from which expert.
 *
 * Two expert sources are merged by slug; managed (remote) overrides bundled
 * (static). Remote catalog is a tarball of `<slug>/expert.json` entries and
 * is refreshed by comparing a remote `version.json` against a cached meta.
 */
export class ExperthubCatalogManager {
  private readonly cacheDir: string;
  private readonly ledgerPath: string;
  private readonly staticDir: string;
  private readonly versionUrl: string;
  private readonly downloadUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly log: ExperthubLogFn;

  constructor(opts: ExperthubCatalogManagerOptions) {
    this.cacheDir = opts.cacheDir;
    this.ledgerPath = opts.ledgerPath;
    this.staticDir = opts.staticDir;
    this.versionUrl = opts.versionUrl;
    this.downloadUrl = opts.downloadUrl;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.log = opts.log ?? noopLog;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  // ---- Catalog queries --------------------------------------------------

  async listExperts(): Promise<MinimalExpert[]> {
    const merged = new Map<string, MinimalExpert>();
    for (const manifest of this.scanBundledManifests()) {
      merged.set(manifest.slug, toMinimal(manifest));
    }
    for (const manifest of this.scanManagedManifests()) {
      merged.set(manifest.slug, toMinimal(manifest));
    }
    return Array.from(merged.values()).sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
  }

  async resolveExpert(slug: string): Promise<ResolvedExpert | null> {
    // Managed wins: scan managed first, fall back to bundled.
    for (const manifest of this.scanManagedManifests()) {
      if (manifest.slug === slug) {
        return { manifest, source: "managed" };
      }
    }
    for (const manifest of this.scanBundledManifests()) {
      if (manifest.slug === slug) {
        return { manifest, source: "bundled" };
      }
    }
    return null;
  }

  // ---- Remote refresh ---------------------------------------------------

  async refresh(): Promise<CatalogMeta | null> {
    const remote = await this.fetchRemoteVersion();
    if (!remote) {
      return null;
    }

    const currentMeta = await this.getMeta();
    if (currentMeta && currentMeta.version === remote.version) {
      return currentMeta;
    }

    const archivePath = resolve(
      this.cacheDir,
      `download-${remote.version}.tar.gz`,
    );
    const finalDir = resolve(this.cacheDir, remote.version);
    const stagingDir = resolve(this.cacheDir, `.staging-${remote.version}`);

    try {
      const body = await this.downloadTarball();
      if (!body) {
        return null;
      }

      writeFileSync(archivePath, body);

      rmSync(stagingDir, { recursive: true, force: true });
      mkdirSync(stagingDir, { recursive: true });
      await extractTarball(archivePath, stagingDir);

      rmSync(finalDir, { recursive: true, force: true });
      renameSync(stagingDir, finalDir);

      const meta: CatalogMeta = {
        version: remote.version,
        updatedAt: remote.updatedAt || new Date().toISOString(),
        count: typeof remote.count === "number" ? remote.count : 0,
      };
      this.writeMeta(meta);
      return meta;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", `experthub refresh failed: ${message}`);
      return null;
    } finally {
      rmSync(archivePath, { force: true });
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async getMeta(): Promise<CatalogMeta | null> {
    const metaPath = resolve(this.cacheDir, META_FILENAME);
    if (!existsSync(metaPath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as CatalogMeta;
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `experthub meta parse failed: ${message}`);
      return null;
    }
  }

  // ---- Ledger -----------------------------------------------------------

  async readLedger(): Promise<ExpertLedger> {
    if (!existsSync(this.ledgerPath)) {
      return { version: 1, updatedAt: null, entries: {} };
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.ledgerPath, "utf8"),
      ) as ExpertLedger;
      if (parsed && parsed.version === 1 && parsed.entries) {
        return parsed;
      }
      this.log("warn", "experthub ledger schema mismatch — returning empty");
      return { version: 1, updatedAt: null, entries: {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `experthub ledger parse failed: ${message}`);
      return { version: 1, updatedAt: null, entries: {} };
    }
  }

  async writeLedger(ledger: ExpertLedger): Promise<void> {
    const tmpPath = `${this.ledgerPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(ledger, null, 2), "utf8");
    renameSync(tmpPath, this.ledgerPath);
  }

  // ---- Internals --------------------------------------------------------

  private writeMeta(meta: CatalogMeta): void {
    const metaPath = resolve(this.cacheDir, META_FILENAME);
    const tmpPath = `${metaPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(meta, null, 2), "utf8");
    renameSync(tmpPath, metaPath);
  }

  private async fetchRemoteVersion(): Promise<RemoteVersionInfo | null> {
    try {
      const response = await this.fetchImpl(this.versionUrl);
      if (!response.ok) {
        this.log("warn", `experthub version fetch not ok: ${response.status}`);
        return null;
      }
      const json = (await response.json()) as Partial<RemoteVersionInfo>;
      if (typeof json?.version !== "string" || json.version.length === 0) {
        this.log("warn", "experthub version.json missing version field");
        return null;
      }
      return {
        version: json.version,
        updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : "",
        count: typeof json.count === "number" ? json.count : 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `experthub version fetch failed: ${message}`);
      return null;
    }
  }

  private async downloadTarball(): Promise<Buffer | null> {
    try {
      const response = await this.fetchImpl(this.downloadUrl);
      if (!response.ok || !response.body) {
        this.log(
          "warn",
          `experthub tarball download not ok: ${response.status}`,
        );
        return null;
      }
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `experthub tarball download failed: ${message}`);
      return null;
    }
  }

  private scanBundledManifests(): ExpertManifest[] {
    return this.scanManifestDir(this.staticDir);
  }

  private scanManagedManifests(): ExpertManifest[] {
    const cachedVersionDir = this.latestCachedVersionDir();
    if (!cachedVersionDir) {
      return [];
    }
    return this.scanManifestDir(cachedVersionDir);
  }

  private latestCachedVersionDir(): string | null {
    // Managed experts live under `cacheDir/<meta.version>/`. Prefer the
    // version declared in cached meta; if meta is missing or its directory
    // does not exist, there are no managed entries yet.
    const metaPath = resolve(this.cacheDir, META_FILENAME);
    if (!existsSync(metaPath)) {
      return null;
    }
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as CatalogMeta;
      if (!meta || typeof meta.version !== "string") return null;
      const versionDir = resolve(this.cacheDir, meta.version);
      return existsSync(versionDir) ? versionDir : null;
    } catch {
      return null;
    }
  }

  private scanManifestDir(root: string): ExpertManifest[] {
    if (!root || !existsSync(root)) {
      return [];
    }
    const results: ExpertManifest[] = [];
    let entries: string[];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", `experthub scan failed for ${root}: ${message}`);
      return [];
    }

    for (const name of entries) {
      const manifestPath = resolve(root, name, "expert.json");
      if (!existsSync(manifestPath)) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(
          "warn",
          `experthub manifest parse failed at ${manifestPath}: ${message}`,
        );
        continue;
      }
      const parsed = tryParseManifest(raw, manifestPath, this.log);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  }
}
