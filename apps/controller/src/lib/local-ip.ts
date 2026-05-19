import os from "node:os";

/**
 * Returns the LAN IPv4 address most likely reachable from other devices
 * on the local network. Filters out VPN tunnels, virtual adapters, and
 * Docker bridges, preferring the primary physical interface (en0, eth0, wlan0).
 * Falls back to "127.0.0.1" if no suitable LAN IP is found.
 */
export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();

  // Known non-LAN interface name prefixes: tunnels, VMs, container bridges.
  const isVirtual = (name: string) =>
    /^(utun|llw|awdl|anpi|bridge|vmnet|vboxnet|docker|lo|gif|stf)/.test(name);

  const candidates: Array<{ name: string; address: string }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || isVirtual(name)) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        if (/^(en|eth|wlan|wifi)/.test(name)) {
          // Physical interface — almost always correct on macOS (en0 =
          // built-in Wi-Fi/Ethernet) and Linux (eth0/wlan0).
          return addr.address;
        }
        candidates.push({ name, address: addr.address });
      }
    }
  }

  return candidates[0]?.address ?? "127.0.0.1";
}
