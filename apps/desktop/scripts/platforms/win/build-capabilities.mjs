import { createDesktopWebBuildEnv } from "../shared/build-capabilities.mjs";

export function createWindowsBuildCapabilities({
  env,
  releaseRoot,
  processPlatform,
}) {
  const windowsTargetEnv = {
    ...env,
    NEXU_TARGET_PLATFORM: "win",
    NEXU_DESKTOP_TARGET_ARCH: "x64",
  };

  return {
    platformId: "win",
    artifactLayout: {
      primaryTargets: ["nsis", "dir"],
      unpackedDirName: "win-unpacked",
    },
    webBuildEnv: createDesktopWebBuildEnv(env, processPlatform),
    sidecarReleaseEnv: windowsTargetEnv,
    createElectronBuilderArgs({
      electronVersion,
      buildVersion,
      dirOnly,
      targets,
    }) {
      const resolvedTargets =
        Array.isArray(targets) && targets.length > 0
          ? targets
          : dirOnly
            ? ["dir"]
            : this.artifactLayout.primaryTargets;

      return [
        "--win",
        ...resolvedTargets,
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        `--config.buildVersion=${buildVersion}`,
        `--config.directories.output=${releaseRoot}`,
      ];
    },
    createElectronBuilderEnv() {
      return {
        ...windowsTargetEnv,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      };
    },
  };
}
