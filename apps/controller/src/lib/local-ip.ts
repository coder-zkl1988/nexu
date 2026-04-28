import os from "node:os";

/**
 * Returns the first non-loopback IPv4 address on the machine.
 * Falls back to "127.0.0.1" if no LAN IP is found.
 */
export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}
