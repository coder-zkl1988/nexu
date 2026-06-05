export function createMacBuildCapabilities({
  env,
  releaseRoot,
  targetMacArch,
  isUnsigned,
}) {
  const {
    APPLE_ID: appleId,
    APPLE_APP_SPECIFIC_PASSWORD: appleAppSpecificPassword,
    APPLE_TEAM_ID: appleTeamId,
    APPLE_NOTARY_PROFILE: appleNotaryProfile,
    ...notarizeEnv
  } = env;

  if (appleId) {
    notarizeEnv.NEXU_APPLE_ID = appleId;
  }

  if (appleAppSpecificPassword) {
    notarizeEnv.NEXU_APPLE_APP_SPECIFIC_PASSWORD = appleAppSpecificPassword;
  }

  if (appleTeamId) {
    notarizeEnv.NEXU_APPLE_TEAM_ID = appleTeamId;
  }

  if (appleNotaryProfile) {
    notarizeEnv.NEXU_APPLE_NOTARY_PROFILE = appleNotaryProfile;
  }

  if (appleTeamId && !notarizeEnv.CSC_NAME) {
    notarizeEnv.CSC_NAME = appleTeamId;
  }

  return {
    platformId: "mac",
    artifactLayout: {
      primaryTargets: ["dmg", "zip"],
      appBundleDirPrefix: "mac",
      arch: targetMacArch,
    },
    webBuildEnv: env,
    sidecarReleaseEnv: {
      ...env,
      ...(isUnsigned ? { NEXU_DESKTOP_MAC_UNSIGNED: "true" } : {}),
    },
    notarizeEnv,
    createElectronBuilderArgs({ electronVersion, buildVersion }) {
      return [
        "--mac",
        `--${targetMacArch}`,
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        `--config.buildVersion=${buildVersion}`,
        `--config.directories.output=${releaseRoot}`,
        ...(isUnsigned
          ? ["--config.mac.identity=null", "--config.mac.hardenedRuntime=false"]
          : []),
      ];
    },
    createElectronBuilderEnv() {
      return isUnsigned
        ? {
            ...notarizeEnv,
            CSC_IDENTITY_AUTO_DISCOVERY: "false",
            NEXU_DESKTOP_MAC_UNSIGNED: "true",
          }
        : notarizeEnv;
    },
  };
}
