import type { HostDesktopCommand } from "../../shared/host";

export type DesktopCommandTarget = {
  isDestroyed: () => boolean;
  send: (channel: string, command: HostDesktopCommand) => void;
};

export function broadcastDesktopCommandToTargets(
  targets: readonly DesktopCommandTarget[],
  command: HostDesktopCommand,
): void {
  for (const target of targets) {
    if (!target.isDestroyed()) {
      target.send("host:desktop-command", command);
    }
  }
}
