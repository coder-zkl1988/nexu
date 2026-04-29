import { cn } from "@/lib/utils";
import {
  Clock,
  GitBranch,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";

interface Automation {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  status: "active" | "paused";
  lastRun: string;
  icon: FC<{ className?: string }>;
  iconColor: string;
}

const mockAutomations: Automation[] = [
  {
    id: "1",
    name: "Daily Report Generator",
    description: "Automatically generate and send daily analytics reports",
    trigger: "Schedule · Every day at 9:00 AM",
    action: "Generate report → Send email",
    status: "active",
    lastRun: "2 hours ago",
    icon: Mail,
    iconColor: "bg-blue-50 text-blue-500",
  },
  {
    id: "2",
    name: "Slack Summary Bot",
    description: "Summarize important conversations and post to channel",
    trigger: "Webhook · New message in #general",
    action: "Summarize → Post to Slack",
    status: "active",
    lastRun: "15 min ago",
    icon: MessageSquare,
    iconColor: "bg-purple-50 text-purple-500",
  },
  {
    id: "3",
    name: "Code Review Assistant",
    description: "Auto-review pull requests and suggest improvements",
    trigger: "GitHub · New PR opened",
    action: "Analyze code → Comment on PR",
    status: "paused",
    lastRun: "3 days ago",
    icon: GitBranch,
    iconColor: "bg-orange-50 text-orange-500",
  },
  {
    id: "4",
    name: "Customer Support Triage",
    description: "Classify and route incoming support tickets",
    trigger: "Webhook · New ticket created",
    action: "Classify → Assign to agent",
    status: "active",
    lastRun: "1 hour ago",
    icon: Zap,
    iconColor: "bg-green-50 text-green-500",
  },
];

function AutomationCard({ automation }: { automation: Automation }) {
  const Icon = automation.icon;
  const { t } = useTranslation();

  return (
    <div className="flex flex-col p-4 rounded-xl border border-[var(--color-tabby-border)] bg-white hover:bg-neutral-50 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
            automation.iconColor,
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-[var(--color-tabby-foreground)] truncate">
              {automation.name}
            </h3>
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                automation.status === "active"
                  ? "bg-green-50 text-green-600"
                  : "bg-amber-50 text-amber-600",
              )}
            >
              {automation.status === "active"
                ? t("automations.active")
                : t("automations.paused")}
            </span>
          </div>
          <p className="text-xs text-[var(--color-tabby-muted)] mt-1 line-clamp-2">
            {automation.description}
          </p>
          <div className="flex items-center gap-1 mt-2 text-[11px] text-[var(--color-tabby-muted)]">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate">{automation.trigger}</span>
          </div>
          <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--color-tabby-muted)]">
            <Zap className="w-3 h-3 shrink-0" />
            <span className="truncate">{automation.action}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              automation.status === "active"
                ? "text-green-500 hover:bg-green-50"
                : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)] hover:bg-neutral-100",
            )}
          >
            {automation.status === "active" ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            className="p-1.5 rounded-md text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)] hover:bg-neutral-100 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");

  const filtered = mockAutomations.filter((a) => {
    if (filter === "all") return true;
    return a.status === filter;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8 pt-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
              {t("layout.nav.automations")}
            </h1>
            <p className="text-xs text-[var(--color-tabby-muted)] mt-0.5">
              {t("automations.subtitle")}
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-tabby-foreground)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">
              {t("automations.newAutomation")}
            </span>
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-6 mb-5 border-b border-[var(--color-tabby-border)]">
          {(
            [
              {
                id: "all" as const,
                label: t("automations.all"),
                count: mockAutomations.length,
              },
              {
                id: "active" as const,
                label: t("automations.active"),
                count: mockAutomations.filter((a) => a.status === "active")
                  .length,
              },
              {
                id: "paused" as const,
                label: t("automations.paused"),
                count: mockAutomations.filter((a) => a.status === "paused")
                  .length,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "relative pb-2.5 text-sm font-medium transition-colors",
                filter === tab.id
                  ? "text-[var(--color-tabby-foreground)]"
                  : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)]",
              )}
            >
              {tab.label}
              <span className="ml-1 text-[var(--color-tabby-muted)]">
                {tab.count}
              </span>
              {filter === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-tabby-foreground)] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <Sparkles className="w-12 h-12 text-[var(--color-tabby-muted)] opacity-30 mb-4" />
            <p className="text-sm text-[var(--color-tabby-muted)]">
              {t("automations.noAutomations")}
            </p>
            <p className="text-xs text-[var(--color-tabby-muted)] mt-1">
              {t("automations.createFirst")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
