import { ensureComputerUseDevSidecarPrepared } from "./shared/computer-use-sidecar.js";

const result = await ensureComputerUseDevSidecarPrepared();
if (result.status === "unsupported") {
  console.log("[computer-use-sidecar] unsupported platform; skipping");
} else {
  console.log(`[computer-use-sidecar] ${result.status}: ${result.binaryPath}`);
}
