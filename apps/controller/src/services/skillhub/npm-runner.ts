import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const isWindows = process.platform === "win32";

// Hard ceilings so a hung npm child process cannot wedge the skill install
// pipeline (the InstallQueue only fires onIdle once every install settles).
// SIGKILL because a stuck network read may ignore SIGTERM.
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const NPM_PROBE_TIMEOUT_MS = 15 * 1000;

/**
 * On Windows `npm` is a `.cmd` shim that cannot be launched directly with
 * `execFile` since Node 18.20.2 / 20.12.2 (CVE-2024-27980). Using `shell: true`
 * lets the OS resolve and execute the shim. Arguments here are controller-owned
 * (no user input), so shell quoting is safe.
 */
export function npmSpawnOptions(cwd: string): {
  cwd: string;
  shell?: boolean;
  windowsHide: boolean;
} {
  return isWindows
    ? { cwd, shell: true, windowsHide: true }
    : { cwd, windowsHide: true };
}

let availabilityProbe: Promise<boolean> | null = null;

export function resetNpmAvailabilityCache(): void {
  availabilityProbe = null;
}

export async function ensureNpmAvailable(): Promise<void> {
  if (!availabilityProbe) {
    availabilityProbe = (async () => {
      try {
        await execFileAsync("npm", ["--version"], {
          shell: isWindows,
          windowsHide: true,
          timeout: NPM_PROBE_TIMEOUT_MS,
          killSignal: "SIGKILL",
        });
        return true;
      } catch {
        return false;
      }
    })();
  }
  const ok = await availabilityProbe;
  if (!ok) {
    availabilityProbe = null;
    throw new Error(
      "NPM_MISSING: npm is not available on this system. Please install Node.js (which includes npm) from https://nodejs.org/ and restart Tabby.",
    );
  }
}

export async function runNpmInstall(skillDir: string): Promise<void> {
  const args = ["install", "--production", "--no-audit", "--no-fund"];
  await execFileAsync("npm", args, {
    ...npmSpawnOptions(skillDir),
    timeout: NPM_INSTALL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}
