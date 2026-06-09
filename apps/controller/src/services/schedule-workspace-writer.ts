import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { NexuConfig } from "../store/schemas.js";

const SCHEDULE_START_MARKER = "<!-- NEXU-SCHEDULES-START -->";
const SCHEDULE_END_MARKER = "<!-- NEXU-SCHEDULES-END -->";

function buildScheduleMarkdown(schedules: NexuConfig["schedules"]): string {
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) {
    return ["# SCHEDULE.md", "", "No scheduled tasks configured.", ""].join(
      "\n",
    );
  }

  const lines = [
    "# SCHEDULE.md",
    "",
    "## Scheduled Tasks",
    "",
    "Register these tasks on startup using the `cron` tool. Follow the isolation rules:",
    "",
    '- Use `sessionTarget: "isolated"` for every task — prevents cross-channel contamination',
    '- Use `delivery: { mode: "announce", channel: "<specified>" }` to deliver results to the correct channel',
    "- Set `sessionKey` to the current session for execution summaries",
    "- Write `nexuScheduleId:<id>` in the `description` field for deduplication",
    "- Check with `cron.list` before registering to avoid duplicates",
    "",
  ];

  for (const s of enabled) {
    lines.push(`### ${s.name}`);
    lines.push("");
    lines.push(`- **Schedule**: \`${s.cron}\` (${s.timezone})`);
    lines.push(`- **Task**: ${s.prompt}`);
    lines.push(`- **nexuScheduleId**: \`${s.id}\``);
    lines.push("- **sessionTarget**: `isolated`");
    if (s.channelType) {
      lines.push(
        `- **delivery**: \`{ mode: "announce", channel: "${s.channelType}" }\``,
      );
    } else {
      lines.push(
        `- **delivery**: \`{ mode: "announce" }\` (use current session's channel)`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildAgentsScheduleBlock(schedules: NexuConfig["schedules"]): string {
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) {
    return [
      SCHEDULE_START_MARKER,
      "",
      "No scheduled tasks configured.",
      "",
      SCHEDULE_END_MARKER,
    ].join("\n");
  }

  const lines = [
    SCHEDULE_START_MARKER,
    "",
    "## Scheduled Tasks",
    "",
    "Register these on startup with the `cron` tool. **Isolation rules (MUST follow):**",
    "",
    '1. `sessionTarget` must be `"isolated"` — each run gets its own session, no cross-channel leaks',
    '2. `delivery.mode` must be `"announce"`, `delivery.channel` must match the specified channel below',
    "3. `sessionKey` set to current session — for execution summary delivery",
    "4. `description` must include `nexuScheduleId:<id>` — for UI deduplication",
    "5. Use `cron.list` before registering to check for existing duplicates",
    "",
  ];

  for (const s of enabled) {
    const deliveryPart = s.channelType
      ? `channel: "${s.channelType}"`
      : "use current session channel";
    lines.push(
      `- **${s.name}**: \`${s.cron}\` (${s.timezone}) — ${s.prompt} — sessionTarget: isolated, delivery: { mode: "announce", ${deliveryPart} }, nexuScheduleId: ${s.id}`,
    );
  }

  lines.push("");
  lines.push(SCHEDULE_END_MARKER);

  return lines.join("\n");
}

async function injectSchedulesIntoAgentsMd(
  filePath: string,
  schedules: NexuConfig["schedules"],
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const block = buildAgentsScheduleBlock(schedules);
  const startIdx = content.indexOf(SCHEDULE_START_MARKER);
  const endIdx = content.indexOf(SCHEDULE_END_MARKER);

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1) {
    updated =
      content.slice(0, startIdx) +
      block +
      content.slice(endIdx + SCHEDULE_END_MARKER.length);
  } else {
    updated = `${content.trimEnd()}\n\n${block}\n`;
  }

  if (updated !== content) {
    await writeFile(filePath, updated, "utf-8");
  }
}

export class ScheduleWorkspaceWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(config: NexuConfig): Promise<void> {
    const bots = config.bots.filter((b) => b.status === "active");
    const schedules = config.schedules ?? [];

    for (const bot of bots) {
      const botSchedules = schedules.filter((s) => s.botId === bot.id);
      const workspaceDir = path.join(
        this.env.openclawStateDir,
        "agents",
        bot.id,
      );

      await mkdir(workspaceDir, { recursive: true });

      const scheduleContent = buildScheduleMarkdown(botSchedules);
      try {
        await writeFile(
          path.join(workspaceDir, "SCHEDULE.md"),
          scheduleContent,
          "utf-8",
        );
      } catch (err) {
        logger.error(
          {
            botId: bot.id,
            error: err instanceof Error ? err.message : String(err),
          },
          "schedule_workspace_write_failed",
        );
      }

      try {
        await injectSchedulesIntoAgentsMd(
          path.join(workspaceDir, "AGENTS.md"),
          botSchedules,
        );
        logger.debug(
          { botId: bot.id, scheduleCount: botSchedules.length },
          "schedule_agents_md_updated",
        );
      } catch (err) {
        logger.error(
          {
            botId: bot.id,
            error: err instanceof Error ? err.message : String(err),
          },
          "schedule_agents_md_update_failed",
        );
      }
    }
  }
}
