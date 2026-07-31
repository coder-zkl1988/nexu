/**
 * Plist Generator for Nexu Desktop launchd services.
 *
 * Generates launchd plist XML for Controller and OpenClaw services.
 */

import * as os from "node:os";
import * as path from "node:path";
import { SERVICE_LABELS } from "./launchd-manager";

export interface PlistEnv {
  isDev: boolean;
  logDir: string;
  controllerPort: number;
  openclawPort: number;
  /** Path to node binary */
  nodePath: string;
  /** Path to controller entry point */
  controllerEntryPath: string;
  /** Path to openclaw binary */
  openclawPath: string;
  /** OpenClaw config path */
  openclawConfigPath: string;
  /** OpenClaw state directory */
  openclawStateDir: string;
  /** Working directory for controller */
  controllerCwd: string;
  /** Working directory for openclaw */
  openclawCwd: string;
  /** NEXU_HOME override (dev: repo-local, prod: default ~/.nexu) */
  nexuHome?: string;
  /** Gateway auth token (shared between controller and openclaw) */
  gatewayToken?: string;
  /** System PATH for launchd environment */
  systemPath?: string;
  /** Absolute path to the bundled OfficeCLI executable */
  officeCliBinPath?: string;
  /** NODE_PATH for module resolution (TypeScript plugins need this) */
  nodeModulesPath?: string;

  // --- Controller-specific env vars (must match manifests.ts) ---
  /** Web UI URL for CORS/redirects */
  webUrl: string;
  /** OpenClaw skills directory */
  openclawSkillsDir: string;
  /** Bundled static skills directory */
  skillhubStaticSkillsDir: string;
  /** Bundled static experts directory */
  experthubStaticExpertsDir: string;
  /** Platform templates directory */
  platformTemplatesDir: string;
  /** OpenClaw binary path */
  openclawBinPath: string;
  /** OpenClaw extensions directory */
  openclawExtensionsDir: string;
  /** Platform-specific Computer Use backend */
  computerUseBackend?: "cua-driver" | null;
  /** Absolute path to the materialized Computer Use sidecar */
  computerUseBinPath?: string | null;
  /** Explicit opt-in for local automation in production builds */
  localAutomationPreviewEnabled?: string;
  /** Skill NODE_PATH for controller module resolution */
  skillNodePath: string;
  /** TMPDIR for openclaw temp files */
  openclawTmpDir: string;
  /** Normalized proxy env propagated to child processes */
  proxyEnv: Record<string, string>;
  /** PostHog API key for controller analytics */
  posthogApiKey?: string;
  /** PostHog host for controller analytics */
  posthogHost?: string;
  /** Langfuse public key for controller/openclaw tracing */
  langfusePublicKey?: string;
  /** Langfuse secret key for controller/openclaw tracing */
  langfuseSecretKey?: string;
  /** Langfuse base URL for controller/openclaw tracing */
  langfuseBaseUrl?: string;
  /** Optional Node V8 coverage output directory */
  nodeV8Coverage?: string;
  /** Optional desktop E2E coverage mode switch */
  desktopE2ECoverage?: string;
  /** Optional desktop E2E coverage run identifier */
  desktopE2ECoverageRunId?: string;
}

function renderCoverageEnvEntries(env: PlistEnv): string {
  const optionalCoverageEntries = [
    ["NODE_V8_COVERAGE", env.nodeV8Coverage],
    ["NEXU_DESKTOP_E2E_COVERAGE", env.desktopE2ECoverage],
    ["NEXU_DESKTOP_E2E_COVERAGE_RUN_ID", env.desktopE2ECoverageRunId],
  ] as const;

  return optionalCoverageEntries
    .flatMap(([key, value]) => {
      if (!value) {
        return [];
      }

      return [
        `\n        <key>${key}</key>`,
        `\n        <string>${escapeXml(value)}</string>`,
      ];
    })
    .join("");
}

function renderProxyEnvEntries(proxyEnv: Record<string, string>): string {
  const orderedKeys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
  ];

  return orderedKeys
    .flatMap((key) => {
      const value = proxyEnv[key];
      if (!value) {
        return [];
      }

      return [
        `\n        <key>${key}</key>`,
        `\n        <string>${escapeXml(value)}</string>`,
      ];
    })
    .join("");
}

function renderComputerUseEnvEntries(env: PlistEnv): string {
  if (!env.computerUseBackend || !env.computerUseBinPath) {
    return "";
  }

  return `
        <key>COMPUTER_USE_BACKEND</key>
        <string>${escapeXml(env.computerUseBackend)}</string>
        <key>COMPUTER_USE_BIN</key>
        <string>${escapeXml(env.computerUseBinPath)}</string>`;
}

function renderOfficeCliEnvEntries(env: PlistEnv): string {
  if (!env.officeCliBinPath) return "";
  return `
        <key>OFFICECLI_BIN</key>
        <string>${escapeXml(env.officeCliBinPath)}</string>`;
}

function launchdPath(env: PlistEnv): string | undefined {
  const officeCliDir = env.officeCliBinPath
    ? path.dirname(env.officeCliBinPath)
    : undefined;
  const entries = [officeCliDir, env.systemPath].filter(
    (entry): entry is string => Boolean(entry),
  );
  // launchd always runs on macOS, so its PATH syntax must not depend on the
  // host that happens to generate or test the plist.
  return entries.length > 0 ? entries.join(":") : undefined;
}

/**
 * Generate plist XML for a service.
 */
export function generatePlist(
  service: "controller" | "openclaw",
  env: PlistEnv,
): string {
  const label = SERVICE_LABELS[service](env.isDev);

  if (service === "controller") {
    return generateControllerPlist(label, env);
  }
  return generateOpenclawPlist(label, env);
}

function generateControllerPlist(label: string, env: PlistEnv): string {
  const logPath = path.join(env.logDir, "controller.log");
  const errorPath = path.join(env.logDir, "controller.error.log");
  const openclawLabel = SERVICE_LABELS.openclaw(env.isDev);
  const effectivePath = launchdPath(env);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(env.nodePath)}</string>
        <string>${escapeXml(env.controllerEntryPath)}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${escapeXml(env.controllerCwd)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>PORT</key>
        <string>${env.controllerPort}</string>
        <key>HOST</key>
        <string>127.0.0.1</string>
        <key>WEB_URL</key>
        <string>${escapeXml(env.webUrl)}</string>
        <key>OPENCLAW_GATEWAY_PORT</key>
        <string>${env.openclawPort}</string>
        <key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>
        <string>false</string>
        <key>RUNTIME_GATEWAY_PROBE_ENABLED</key>
        <string>false</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>${escapeXml(env.openclawStateDir)}</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_SKILLS_DIR</key>
        <string>${escapeXml(env.openclawSkillsDir)}</string>
        <key>SKILLHUB_STATIC_SKILLS_DIR</key>
        <string>${escapeXml(env.skillhubStaticSkillsDir)}</string>
        <key>EXPERTHUB_STATIC_EXPERTS_DIR</key>
        <string>${escapeXml(env.experthubStaticExpertsDir)}</string>
        <key>PLATFORM_TEMPLATES_DIR</key>
        <string>${escapeXml(env.platformTemplatesDir)}</string>
        <key>OPENCLAW_BIN</key>
        <string>${escapeXml(env.openclawBinPath)}</string>
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>${escapeXml(openclawLabel)}</string>
        <key>OPENCLAW_ELECTRON_EXECUTABLE</key>
        <string>${escapeXml(env.nodePath)}</string>
        <key>OPENCLAW_EXTENSIONS_DIR</key>
        <string>${escapeXml(env.openclawExtensionsDir)}</string>${renderOfficeCliEnvEntries(
          env,
        )}${renderComputerUseEnvEntries(env)}${
          env.localAutomationPreviewEnabled !== undefined
            ? `
        <key>NEXU_LOCAL_AUTOMATION_PREVIEW_ENABLED</key>
        <string>${escapeXml(env.localAutomationPreviewEnabled)}</string>`
            : ""
        }
        <key>NODE_PATH</key>
        <string>${escapeXml(env.skillNodePath)}</string>
        <key>OPENCLAW_DISABLE_BONJOUR</key>
        <string>1</string>
        <key>TMPDIR</key>
        <string>${escapeXml(env.openclawTmpDir)}</string>${renderProxyEnvEntries(
          env.proxyEnv,
        )}${renderCoverageEnvEntries(env)}${
          env.nexuHome
            ? `
        <key>NEXU_HOME</key>
        <string>${escapeXml(env.nexuHome)}</string>`
            : ""
        }${
          env.gatewayToken
            ? `
        <key>OPENCLAW_GATEWAY_TOKEN</key>
        <string>${escapeXml(env.gatewayToken)}</string>`
            : ""
        }${
          effectivePath
            ? `
        <key>PATH</key>
        <string>${escapeXml(effectivePath)}</string>`
            : ""
        }${
          env.posthogApiKey
            ? `
        <key>POSTHOG_API_KEY</key>
        <string>${escapeXml(env.posthogApiKey)}</string>`
            : ""
        }${
          env.posthogHost
            ? `
        <key>POSTHOG_HOST</key>
        <string>${escapeXml(env.posthogHost)}</string>`
            : ""
        }${
          env.langfusePublicKey
            ? `
        <key>LANGFUSE_PUBLIC_KEY</key>
        <string>${escapeXml(env.langfusePublicKey)}</string>`
            : ""
        }${
          env.langfuseSecretKey
            ? `
        <key>LANGFUSE_SECRET_KEY</key>
        <string>${escapeXml(env.langfuseSecretKey)}</string>`
            : ""
        }${
          env.langfuseBaseUrl
            ? `
        <key>LANGFUSE_BASE_URL</key>
        <string>${escapeXml(env.langfuseBaseUrl)}</string>`
            : ""
        }
        <key>NODE_ENV</key>
        <string>${env.isDev ? "development" : "production"}</string>
        <key>HOME</key>
        <string>${escapeXml(os.homedir())}</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(errorPath)}</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <!-- Auto-start at login so a machine reboot attaches to the already-running
         services instead of falling back to the full cold-start ("preparing
         workspace") flow. Teardown only boots services out (keeps the plist), so
         launchd re-runs them on the next login. -->
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`;
}

function generateOpenclawPlist(label: string, env: PlistEnv): string {
  const logPath = path.join(env.logDir, "openclaw.log");
  const errorPath = path.join(env.logDir, "openclaw.error.log");
  const controllerLabel = SERVICE_LABELS.controller(env.isDev);
  const effectivePath = launchdPath(env);

  // In dev mode, use --auth none to simplify local development
  const authArgs = env.isDev
    ? `
        <string>--auth</string>
        <string>none</string>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(env.nodePath)}</string>
        <string>${escapeXml(env.openclawPath)}</string>
        <string>gateway</string>
        <string>run</string>
        <string>--port</string>
        <string>${env.openclawPort}</string>
        <string>--allow-unconfigured</string>${authArgs}
    </array>

    <key>WorkingDirectory</key>
    <string>${escapeXml(env.openclawCwd)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>OPENCLAW_CONFIG</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>${escapeXml(env.openclawStateDir)}</string>
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>${label}</string>
        <key>OPENCLAW_SERVICE_MARKER</key>
        <string>launchd</string>
        <key>OPENCLAW_IMAGE_BACKEND</key>
        <string>sips</string>${renderOfficeCliEnvEntries(env)}${
          env.gatewayToken
            ? `
        <key>OPENCLAW_GATEWAY_TOKEN</key>
        <string>${escapeXml(env.gatewayToken)}</string>`
            : ""
        }${
          env.langfusePublicKey
            ? `
        <key>LANGFUSE_PUBLIC_KEY</key>
        <string>${escapeXml(env.langfusePublicKey)}</string>`
            : ""
        }${
          env.langfuseSecretKey
            ? `
        <key>LANGFUSE_SECRET_KEY</key>
        <string>${escapeXml(env.langfuseSecretKey)}</string>`
            : ""
        }${
          env.langfuseBaseUrl
            ? `
        <key>LANGFUSE_BASE_URL</key>
        <string>${escapeXml(env.langfuseBaseUrl)}</string>`
            : ""
        }
        <key>HOME</key>
        <string>${escapeXml(os.homedir())}</string>${renderProxyEnvEntries(
          env.proxyEnv,
        )}${renderCoverageEnvEntries(env)}${
          effectivePath
            ? `
        <key>PATH</key>
        <string>${escapeXml(effectivePath)}</string>`
            : ""
        }${
          env.nodeModulesPath
            ? `
        <key>NODE_PATH</key>
        <string>${escapeXml(env.nodeModulesPath)}</string>`
            : ""
        }
    </dict>

    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(errorPath)}</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>OtherJobEnabled</key>
        <dict>
            <key>${controllerLabel}</key>
            <true/>
        </dict>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <!-- Auto-start at login so a machine reboot attaches to the already-running
         services instead of falling back to the full cold-start ("preparing
         workspace") flow. Teardown only boots services out (keeps the plist), so
         launchd re-runs them on the next login. -->
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`;
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
