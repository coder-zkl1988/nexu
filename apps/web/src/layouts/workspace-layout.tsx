import { BudgetWarningBanner } from "@/components/budget-warning-banner";
import { PlatformIcon } from "@/components/platform-icons";
import { useAutoUpdate } from "@/hooks/use-auto-update";
import { useCloudConnect } from "@/hooks/use-cloud-connect";
import { useCommunitySkills } from "@/hooks/use-community-catalog";
import {
  getBudgetBannerRouteVariant,
  useDesktopBudgetGuard,
} from "@/hooks/use-desktop-budget-guard";
import { useDesktopCloudStatus } from "@/hooks/use-desktop-cloud-status";
import { useDesktopRewardsStatus } from "@/hooks/use-desktop-rewards";
import {
  A2UISidebarProvider,
  useA2UISidebar,
} from "@/lib/a2ui/a2ui-sidebar-context";
import { authClient } from "@/lib/auth-client";
import { useCanvas } from "@/lib/canvas/canvas-store";
import { CanvasSurface } from "@/lib/canvas/infinite-canvas";
import { openExternalUrl } from "@/lib/desktop-links";
import {
  isMacDesktopPlatform,
  isWindowsDesktopPlatform,
} from "@/lib/desktop-platform";
import { logoutToWelcome } from "@/lib/logout";
import { normalizeChannel, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Bot,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CirclePlus,
  Clock,
  Home,
  Info,
  LogOut,
  Mail,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  ScrollText,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import "@/lib/api";
import {
  deleteApiV1SessionsById,
  getApiV1Me,
  getApiV1Sessions,
} from "../../lib/api/sdk.gen";

interface SidebarSession {
  id: string;
  title: string;
  channelType: string;
  lastTime: string | null;
  status: string;
  sessionKey: string;
}

// Cloud balance amounts arrive as integer US cents; show them as exact USD.
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The balance popup currently shows only remaining balance + consumed. The
// gifted/plan breakdown rows are kept (hidden) for when a gifted-credits
// system is wired up; flip this to re-enable them.
const SHOW_BALANCE_BREAKDOWN = false;

export function getSidebarCreditBreakdown(input: {
  progress: {
    earnedCredits: number;
  };
  cloudBalance: {
    totalBalance: number;
    giftedBalance?: number;
    planBalance?: number;
  } | null;
}) {
  if (!input.cloudBalance) {
    return {
      totalBalance: 0,
      giftedBalance: 0,
      planBalance: 0,
    };
  }

  const totalBalance = input.cloudBalance.totalBalance;
  const giftedBalance = Math.min(
    Math.max(input.cloudBalance.giftedBalance ?? 0, 0),
    totalBalance,
  );
  const planBalance =
    input.cloudBalance.planBalance ?? Math.max(totalBalance - giftedBalance, 0);

  return {
    totalBalance,
    giftedBalance,
    planBalance: Math.max(planBalance, 0),
  };
}

function mapDbSession(s: {
  id: string;
  title: string;
  channelType?: string | null;
  lastMessageAt?: string | null;
  updatedAt?: string;
  status?: string | null;
  sessionKey?: string;
}): SidebarSession {
  return {
    id: s.id,
    title: s.title,
    channelType: s.channelType ?? "web",
    lastTime: s.lastMessageAt ?? s.updatedAt ?? null,
    status: s.status ?? "",
    sessionKey: s.sessionKey ?? "",
  };
}

type Platform =
  | "slack"
  | "discord"
  | "whatsapp"
  | "telegram"
  | "feishu"
  | "dingtalk"
  | "wecom"
  | "qqbot"
  | "wechat"
  | "openclaw-weixin"
  | "web";

const PLATFORM_LABELS: Record<Platform, string> = {
  discord: "Discord",
  slack: "Slack",
  feishu: "Feishu",
  dingtalk: "DingTalk",
  wecom: "WeCom",
  qqbot: "QQ",
  wechat: "WeChat",
  "openclaw-weixin": "WeChat",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  web: "Web",
};

function SidebarPlatformIcon({ platform }: { platform: string }) {
  return (
    <span className="flex justify-center items-center w-7 h-7 rounded-xl border border-border bg-surface-1 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <PlatformIcon platform={platform} size={15} />
    </span>
  );
}

function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? "Web";
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function EmptyState({ onGoConfig }: { onGoConfig: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col justify-center items-center h-full px-8">
      <div className="max-w-md text-center">
        <div className="flex justify-center items-center mx-auto mb-6 w-16 h-16 rounded-2xl bg-accent/10">
          <MessageSquare size={28} className="text-accent" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-text-primary">
          {t("layout.empty.title")}
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-text-muted">
          {t("layout.empty.description")}
        </p>
        <div className="flex flex-col gap-3 items-center">
          <button
            type="button"
            onClick={onGoConfig}
            className="flex gap-2 items-center px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-colors bg-accent hover:bg-accent-hover"
          >
            <Settings size={14} /> {t("layout.empty.setupBot")}
          </button>
          <div className="flex gap-4 mt-2">
            {[
              { step: "1", text: t("layout.empty.step1") },
              { step: "2", text: t("layout.empty.step2") },
              { step: "3", text: t("layout.empty.step3") },
            ].map((s, i) => (
              <div
                key={s.step}
                className="flex gap-1.5 items-center text-[12px] text-text-muted"
              >
                {i > 0 && <span className="text-border mr-1">→</span>}
                <span className="flex justify-center items-center w-4 h-4 rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                  {s.step}
                </span>
                {s.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SETUP_COMPLETE_KEY = "nexu_setup_complete";
const GITHUB_URL = "https://github.com/coder-zkl1988/tabby";
function resolveCloudUsageUrl(cloudUrl?: string | null): string {
  if (!cloudUrl) return "https://tabby.picaso.studio/workspace/usage";
  try {
    const origin = new URL(cloudUrl).origin;
    return `${origin}/workspace/usage`;
  } catch {
    return "https://tabby.picaso.studio/workspace/usage";
  }
}

const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <title>GitHub</title>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

interface UpdateFloatCardProps {
  phase: ReturnType<typeof useAutoUpdate>["phase"];
  version: string | null;
  percent: number;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, string>) => string;
  desktopOffsetLeft: number;
  desktopOffsetBottom: number;
  width: number;
}

function UpdateFloatCard({
  phase,
  version,
  percent,
  onDownload,
  onInstall,
  onDismiss,
  t,
  desktopOffsetLeft,
  desktopOffsetBottom,
  width,
}: UpdateFloatCardProps) {
  const updating = phase === "downloading" || phase === "installing";
  const downloadProgress = Math.round(percent);

  if (
    phase !== "available" &&
    phase !== "downloading" &&
    phase !== "installing" &&
    phase !== "ready"
  ) {
    return null;
  }

  return (
    <div
      className="fixed z-50 rounded-[14px] border border-border bg-surface-0/88 px-3.5 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.16)] backdrop-blur-md animate-float"
      style={
        {
          left: desktopOffsetLeft,
          bottom: desktopOffsetBottom,
          width,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
            </span>
            <span className="text-[12px] font-medium text-text-primary">
              {phase === "installing"
                ? t("layout.update.installing")
                : updating
                  ? t("layout.update.downloading")
                  : phase === "ready"
                    ? t("layout.update.readyToInstall")
                    : t("layout.update.available", {
                        version: version ?? "",
                      })}
            </span>
          </div>
        </div>
        {!updating && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-text-muted hover:text-text-primary transition-colors -mr-1"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {updating && (
        <div className="flex items-center justify-between mt-3 mb-1">
          <span className="text-[10px] tabular-nums text-text-muted">
            {phase === "installing" ? "…" : `${downloadProgress}%`}
          </span>
        </div>
      )}
      {updating ? (
        <div>
          <div className="h-[6px] w-full rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-brand-primary)] transition-all duration-300 ease-out"
              style={{
                width: phase === "installing" ? "100%" : `${downloadProgress}%`,
              }}
            />
          </div>
        </div>
      ) : phase === "ready" ? (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onInstall}
            className="rounded-[6px] px-2.5 py-1 text-[11px] font-medium bg-[var(--color-accent)] text-white hover:opacity-85 transition-opacity"
          >
            {t("layout.update.install")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            {t("layout.update.later")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onDownload}
            className="rounded-[6px] px-2.5 py-1 text-[11px] font-medium bg-[var(--color-accent)] text-white hover:opacity-85 transition-opacity"
          >
            {t("layout.update.download")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            {t("layout.update.later")}
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkspaceLayout() {
  if (localStorage.getItem(SETUP_COMPLETE_KEY) !== "1") {
    return <Navigate to="/" replace />;
  }

  return <WorkspaceLayoutInner />;
}

function WorkspaceLayoutInner() {
  return (
    <A2UISidebarProvider>
      <WorkspaceLayoutContent />
    </A2UISidebarProvider>
  );
}

function WorkspaceLayoutContent() {
  const { t } = useTranslation();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [collapsed, setCollapsed] = useState(false);
  // Collapsed = icon rail (nav icons only), not a fully hidden sidebar.
  // On the Mac desktop client the rail must clear the traffic lights plus
  // the sidebar toggle beside them (toggle at left 76px + 32px width + 8px
  // breathing room); elsewhere a slim rail suffices.
  const SIDEBAR_RAIL_WIDTH =
    isDesktopClient && isMacDesktopPlatform() ? 116 : 56;
  const navItemClass = cn(
    "nav-item flex items-center w-full rounded-[var(--radius-6)] text-[13px] transition-colors cursor-pointer mt-0.5 py-2 whitespace-nowrap",
    collapsed ? "justify-center px-0 gap-0" : "gap-2.5 px-3",
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [scheduledCollapsed, setScheduledCollapsed] = useState(true);
  const {
    status: rewardsStatus,
    loading: rewardsStatusLoading,
    resolved: rewardsStatusResolved,
  } = useDesktopRewardsStatus();
  const update = useAutoUpdate();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const queryClient = useQueryClient();
  const hasUpdate =
    update.phase === "available" ||
    update.phase === "downloading" ||
    update.phase === "installing" ||
    update.phase === "ready";
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 320;
  const SIDEBAR_DEFAULT = 192;
  const MAIN_MIN = 500;
  // One-click canvas expand leaves the chat column a bit roomier than the
  // hard drag floor so the composer stays comfortable.
  const MAIN_MIN_MAXIMIZED = 600;
  const RIGHT_SIDEBAR_MIN = 320;
  // Loose hard cap — the effective limit is keeping the chat area >= MAIN_MIN.
  const RIGHT_SIDEBAR_MAX = 2400;
  const RIGHT_SIDEBAR_DEFAULT = 420;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("nexu_sidebar_width");
    return saved
      ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)))
      : SIDEBAR_DEFAULT;
  });
  const isResizing = useRef(false);
  const { isOpen: rightSidebarOpen, close: closeRightSidebar } =
    useA2UISidebar();
  const { nodes: canvasNodes } = useCanvas();
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("nexu_right_sidebar_width");
    return saved
      ? Math.max(RIGHT_SIDEBAR_MIN, Math.min(RIGHT_SIDEBAR_MAX, Number(saved)))
      : RIGHT_SIDEBAR_DEFAULT;
  });
  const isRightResizing = useRef(false);
  // One-click workbench expand: grow the canvas until the chat main area is
  // exactly MAIN_MIN_MAXIMIZED wide; toggling back restores the previous width.
  const [rightSidebarMaximized, setRightSidebarMaximized] = useState(false);
  const preMaximizeWidthRef = useRef(RIGHT_SIDEBAR_DEFAULT);
  const toggleRightSidebarMaximize = useCallback(() => {
    setRightSidebarMaximized((maximized) => {
      if (maximized) {
        setRightSidebarWidth(preMaximizeWidthRef.current);
        return false;
      }
      preMaximizeWidthRef.current = rightSidebarWidth;
      const leftWidth = collapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth;
      setRightSidebarWidth(
        Math.max(
          RIGHT_SIDEBAR_MIN,
          window.innerWidth - leftWidth - MAIN_MIN_MAXIMIZED,
        ),
      );
      return true;
    });
  }, [rightSidebarWidth, collapsed, sidebarWidth, SIDEBAR_RAIL_WIDTH]);

  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isRightResizing.current = true;
      const startX = e.clientX;
      const startW = rightSidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isRightResizing.current) return;
        const containerWidth = window.innerWidth;
        const newW = Math.max(
          RIGHT_SIDEBAR_MIN,
          Math.min(RIGHT_SIDEBAR_MAX, startW - (ev.clientX - startX)),
        );
        if (containerWidth - newW >= MAIN_MIN) {
          setRightSidebarWidth(newW);
        }
      };

      const onUp = () => {
        isRightResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setRightSidebarWidth((w) => {
          localStorage.setItem("nexu_right_sidebar_width", String(w));
          return w;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [rightSidebarWidth],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startW = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const containerWidth = window.innerWidth;
        const newW = Math.max(
          SIDEBAR_MIN,
          Math.min(SIDEBAR_MAX, startW + (ev.clientX - startX)),
        );
        if (containerWidth - newW >= MAIN_MIN) {
          setSidebarWidth(newW);
        }
      };

      const onUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setSidebarWidth((w) => {
          localStorage.setItem("nexu_sidebar_width", String(w));
          return w;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  const [showBalancePopup, setShowBalancePopup] = useState(false);
  const logoutRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const balanceRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // The A2UI side panel belongs to the session conversation — close it when
  // navigating to any other tab so it never lingers over unrelated pages.
  const isSessionRoute = location.pathname.startsWith("/workspace/sessions");
  useEffect(() => {
    if (!isSessionRoute && rightSidebarOpen) {
      closeRightSidebar();
    }
  }, [isSessionRoute, rightSidebarOpen, closeRightSidebar]);
  const { data: session } = authClient.useSession();
  const { data: skillsData } = useCommunitySkills();
  const {
    data: desktopCloudStatus,
    isLoading: cloudStatusLoading,
    refetch: refetchDesktopCloudStatus,
  } = useDesktopCloudStatus();
  const installedSkillsCount = skillsData?.installedSkills?.length ?? 0;
  const cloudConnected = desktopCloudStatus?.connected ?? false;
  const { cloudConnecting, handleCloudConnect } = useCloudConnect({
    cloudConnected,
    onPoll: refetchDesktopCloudStatus,
  });

  useEffect(() => {
    track("workspace_view");
  }, []);

  useEffect(() => {
    if (!isDesktopClient) {
      return;
    }

    const root = document.getElementById("root");
    const previousHtmlBackground =
      document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousRootBackground = root?.style.backgroundColor ?? "";
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) {
      root.style.backgroundColor = "transparent";
    }

    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
      if (root) {
        root.style.backgroundColor = previousRootBackground;
      }
    };
  }, [isDesktopClient]);

  useEffect(() => {
    if (!showLogoutConfirm) return;
    const handler = (e: MouseEvent) => {
      if (logoutRef.current && !logoutRef.current.contains(e.target as Node)) {
        setShowLogoutConfirm(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLogoutConfirm]);

  useEffect(() => {
    if (!showHelpMenu) return;
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelpMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHelpMenu]);

  useEffect(() => {
    if (!showBalancePopup) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const portalEl = document.querySelector(
        "[data-sidebar-rewards-balance-popup]",
      );
      if (
        balanceRef.current &&
        !balanceRef.current.contains(target) &&
        (!portalEl || !portalEl.contains(target))
      ) {
        setShowBalancePopup(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBalancePopup]);

  const { data: sessionsData } = useQuery({
    queryKey: ["sidebar-sessions"],
    queryFn: async (): Promise<SidebarSession[]> => {
      const { data } = await getApiV1Sessions({ query: { limit: 100 } });
      return (data?.sessions ?? []).map(mapDbSession);
    },
    refetchInterval: 10_000,
  });
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getApiV1Me();
      return data;
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await deleteApiV1SessionsById({ path: { id: sessionId } });
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      // If the deleted session is currently viewed, navigate away
      if (selectedSessionId === deletedId) {
        navigate("/workspace");
      }
    },
  });

  const sessions = sessionsData ?? [];

  const sessionMatch = location.pathname.match(/\/workspace\/sessions\/(.+)/);
  const selectedSessionId = sessionMatch?.[1] ?? null;
  const isHomePage =
    location.pathname === "/workspace" ||
    location.pathname === "/workspace/home";
  const isRewardsPage = location.pathname.includes("/rewards");
  const isSkillsPage = location.pathname.includes("/skills");
  const isExpertsPage = location.pathname.includes("/experts");
  const isTeamsPage = location.pathname.includes("/teams");
  const isLocalChatPage = location.pathname === "/workspace/chat";
  const isModelsPage =
    location.pathname.includes("/models") ||
    location.pathname.includes("/settings");
  const isDevicesPage = location.pathname.includes("/devices");

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    track("workspace_logout_click");
    await logoutToWelcome({ queryClient });
  };

  const userEmail = me?.email ?? session?.user?.email ?? "";
  const userName = me?.name?.trim() || session?.user?.name || userEmail;
  const userImage = me?.image ?? session?.user?.image ?? null;
  const userInitial = (userName[0] ?? userEmail[0] ?? "U").toUpperCase();
  const rewardsBalancePending =
    cloudConnected &&
    !rewardsStatus.cloudBalance &&
    (rewardsStatusLoading || !rewardsStatusResolved);
  const canOpenBalancePopup =
    cloudConnected || rewardsStatus.cloudBalance !== null;
  const rewardBalanceValue = rewardsStatus.cloudBalance
    ? formatUsdCents(rewardsStatus.cloudBalance.totalBalance)
    : cloudConnected
      ? rewardsBalancePending
        ? t("layout.sidebar.balancePlaceholder")
        : formatUsdCents(0)
      : t("layout.sidebar.balancePlaceholder");
  const rewardBalancePopupValue = rewardsStatus.cloudBalance
    ? formatUsdCents(rewardsStatus.cloudBalance.totalBalance)
    : rewardBalanceValue;
  const sidebarCreditBreakdown = getSidebarCreditBreakdown({
    progress: rewardsStatus.progress,
    cloudBalance: rewardsStatus.cloudBalance,
  });
  const rewardsCardLoading =
    cloudStatusLoading && desktopCloudStatus === undefined;
  const { bannerDismissible, budgetStatus, dismissBanner, shouldShowPrompt } =
    useDesktopBudgetGuard({
      pathname: location.pathname,
      cloudConnected,
    });
  const budgetBannerRouteVariant = getBudgetBannerRouteVariant(
    location.pathname,
  );

  const showEmptyState =
    sessions.length === 0 &&
    !isHomePage &&
    !isRewardsPage &&
    !isSkillsPage &&
    !isExpertsPage &&
    !isTeamsPage &&
    !isModelsPage &&
    !isDevicesPage &&
    !isLocalChatPage &&
    !location.pathname.includes("/automations") &&
    !location.pathname.includes("/integrations") &&
    !location.pathname.includes("/channels") &&
    !selectedSessionId;

  const _selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null;
  const isWindowsDesktopClient = isDesktopClient && isWindowsDesktopPlatform();
  const isMacDesktopClient = isDesktopClient && isMacDesktopPlatform();
  const desktopGlassTint = isWindowsDesktopClient
    ? "#ffffff"
    : "rgba(255, 255, 255, 0.08)";
  const updateFloatLeft = 10;
  // Match the sidebar width (with a 10px gutter on each side) so the update card
  // sits inside the rail instead of overflowing into the main content area, and
  // tracks the sidebar when the user resizes it.
  const updateFloatWidth = sidebarWidth - updateFloatLeft * 2;
  const updateFloatBottom = 80;

  return (
    <div
      className="flex h-screen relative overflow-hidden"
      style={
        isDesktopClient
          ? ({ background: desktopGlassTint } as React.CSSProperties)
          : undefined
      }
    >
      {!isDesktopClient && hasUpdate && !updateDismissed && (
        <UpdateFloatCard
          phase={update.phase}
          version={update.version}
          percent={update.percent}
          onDownload={() => update.download()}
          onInstall={() => update.install()}
          onDismiss={() => setUpdateDismissed(true)}
          t={t}
          desktopOffsetLeft={updateFloatLeft}
          desktopOffsetBottom={updateFloatBottom}
          width={updateFloatWidth}
        />
      )}

      {/* Mac sidebar toggle — fixed next to traffic lights, always visible */}
      {isMacDesktopClient && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="fixed top-[10px] left-[76px] h-8 w-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors hidden md:flex items-center justify-center z-50"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={
            collapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")
          }
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      )}
      {/* Non-mac, non-windows collapsed toggle */}
      {!isMacDesktopClient && !isWindowsDesktopClient && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="fixed top-[16px] left-[24px] h-8 w-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors hidden md:flex items-center justify-center z-50"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={t("layout.expandSidebar")}
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      {isWindowsDesktopClient && (
        <div className="fixed px-2 z-50">
          <div className="px-2.5 h-8 flex items-center">
            {collapsed ? (
              <PanelLeftOpen
                onClick={() => setCollapsed(!collapsed)}
                size={16}
              />
            ) : (
              <PanelLeftClose
                onClick={() => setCollapsed(!collapsed)}
                size={16}
              />
            )}
          </div>
        </div>
      )}

      {/* Desktop sidebar — transparent bg, no border (matches design-system) */}
      <div
        className="hidden md:flex flex-col shrink-0 overflow-hidden"
        style={
          {
            width: collapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth,
            transition: isResizing.current ? "none" : "width 200ms",
            WebkitAppRegion: "drag",
            background: isDesktopClient
              ? desktopGlassTint
              : "var(--color-tabby-sidebar)",
          } as React.CSSProperties
        }
      >
        {/* Traffic light clearance (desktop client) */}
        {!isWindowsDesktopClient && <div className={cn("shrink-0", "h-14")} />}

        {/* Header / Brand — hidden in rail mode (fixed toggles reopen) */}
        {!isWindowsDesktopClient && !collapsed && (
          <div
            className={cn(
              "flex items-center justify-between px-3 pb-2 shrink-0",
              isMacDesktopClient && "px-4 pb-1",
              !isDesktopClient && "border-b border-border py-3 px-4 gap-2.5",
            )}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {isDesktopClient ? (
              <>
                <img
                  src="/images/happytabby-logo.png"
                  alt="Tabby"
                  className="h-10 object-contain"
                />
                <div className="flex items-center gap-2">
                  {hasUpdate && updateDismissed && (
                    <button
                      type="button"
                      onClick={() => setUpdateDismissed(false)}
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--color-brand-primary)] text-white hover:opacity-85 transition-opacity"
                    >
                      {t("layout.update.badge")}
                    </button>
                  )}
                  {!isMacDesktopClient && (
                    <button
                      type="button"
                      onClick={() => setCollapsed(true)}
                      className="p-1.5 rounded-lg transition-colors text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0"
                      title={t("layout.collapseSidebar")}
                    >
                      <PanelLeftClose size={14} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <img
                  src="/images/happytabby-logo.png"
                  alt="Tabby"
                  className="h-10 w-auto shrink-0"
                />
              </>
            )}
          </div>
        )}

        {isWindowsDesktopClient && <div className="h-8 shrink-0" />}

        {/* Main nav + conversations. The nav stays fixed; only the
            conversation list scrolls (long session lists used to scroll the
            whole sidebar, hiding the nav). */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Nav items */}
          <div className="shrink-0 px-2 pt-3 pb-1">
            <Link
              to="/workspace/home"
              title={t("layout.nav.home")}
              onClick={() => {
                track("workspace_home_click");
                track("workspace_sidebar_click", { target: "home" });
              }}
              className={cn(navItemClass, isHomePage && "nav-item-active")}
            >
              <Home size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.home")}
            </Link>
            <Link
              to="/workspace/chat"
              title={t("layout.nav.newChat")}
              onClick={() => {
                track("workspace_sidebar_click", { target: "local-chat" });
              }}
              className={cn(navItemClass, isLocalChatPage && "nav-item-active")}
            >
              <CirclePlus size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.newChat")}
            </Link>
            <Link
              to="/workspace/skills"
              title={t("layout.nav.skillStore")}
              onClick={() => {
                track("workspace_skills_click");
                track("workspace_sidebar_click", { target: "skills" });
              }}
              className={cn(navItemClass, isSkillsPage && "nav-item-active")}
            >
              <Puzzle size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.skillStore")}
              {!collapsed && installedSkillsCount > 0 && (
                <span className="ml-auto text-[10px] text-text-tertiary font-normal">
                  {installedSkillsCount}
                </span>
              )}
            </Link>
            <Link
              to="/workspace/automations"
              title={t("layout.nav.automations")}
              onClick={() => {
                track("workspace_sidebar_click", { target: "automations" });
              }}
              className={cn(
                navItemClass,
                location.pathname.includes("/automations") && "nav-item-active",
              )}
            >
              <Sparkles size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.automations")}
            </Link>
            <Link
              to="/workspace/experts"
              title={t("layout.nav.agents")}
              onClick={() => {
                track("workspace_experts_click");
                track("workspace_sidebar_click", { target: "experts" });
              }}
              className={cn(navItemClass, isExpertsPage && "nav-item-active")}
            >
              <Bot size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.agents")}
            </Link>
            <Link
              to="/workspace/teams"
              title={t("layout.nav.teams")}
              onClick={() => {
                track("workspace_sidebar_click", { target: "teams" });
              }}
              className={cn(navItemClass, isTeamsPage && "nav-item-active")}
            >
              <UsersRound size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.teams")}
            </Link>
            <Link
              to="/workspace/devices"
              title={t("layout.nav.devices")}
              onClick={() => {
                track("workspace_sidebar_click", { target: "devices" });
              }}
              className={cn(navItemClass, isDevicesPage && "nav-item-active")}
            >
              <Smartphone size={16} className="shrink-0" />
              {!collapsed && t("layout.nav.devices")}
            </Link>
          </div>

          {/* Conversations section — no rail representation; hidden */}
          {!collapsed && (
            <div className="flex min-h-0 flex-1 flex-col px-2 pt-6">
              <div className="sidebar-section-label shrink-0 whitespace-nowrap">
                {t("layout.conversations")}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                {(() => {
                  // Split sessions into regular and scheduled
                  const regularSessions = sessions.filter(
                    (s) => !s.sessionKey.includes(":schedule-"),
                  );
                  const scheduledSessions = sessions.filter((s) =>
                    s.sessionKey.includes(":schedule-"),
                  );

                  // Regular sessions grouped by channelType
                  const regularGroups = Object.entries(
                    regularSessions.reduce(
                      (acc, s) => {
                        const key = s.channelType ?? "web";
                        const group = acc[key] ?? [];
                        group.push(s);
                        acc[key] = group;
                        return acc;
                      },
                      {} as Record<string, SidebarSession[]>,
                    ),
                  );

                  return (
                    <>
                      {regularGroups.map(([channelType, groupSessions]) => (
                        <div key={channelType}>
                          <div className="space-y-0.5">
                            {groupSessions.map((s) => {
                              const isActive = selectedSessionId === s.id;
                              return (
                                <div
                                  key={s.id}
                                  data-sidebar-session-row={s.id}
                                  data-session-channel-type={
                                    s.channelType ?? "web"
                                  }
                                  data-session-state={s.status || "idle"}
                                  className={cn(
                                    "group flex items-center gap-2.5 w-full rounded-[10px] transition-colors cursor-pointer px-3 py-2 text-left",
                                    isActive && "nav-item-active",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const channel = normalizeChannel(
                                        s.channelType,
                                      );
                                      track("workspace_channel_click", {
                                        channel_type: s.channelType,
                                      });
                                      track("workspace_sidebar_click", {
                                        target: "conversations",
                                        ...(channel ? { channel } : {}),
                                      });
                                      navigate(`/workspace/sessions/${s.id}`);
                                    }}
                                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                  >
                                    <SidebarPlatformIcon
                                      platform={s.channelType ?? "web"}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div
                                          className={cn(
                                            "text-[12px] truncate whitespace-nowrap font-medium",
                                            !isActive && "text-text-primary",
                                          )}
                                        >
                                          {s.title}
                                        </div>
                                        {s.status === "active" && (
                                          <span className="shrink-0 rounded-full bg-[var(--color-success-subtle)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-success)]">
                                            Live
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted truncate whitespace-nowrap">
                                        <span>
                                          {getPlatformLabel(
                                            s.channelType ?? "web",
                                          )}
                                        </span>
                                        <span className="text-border">·</span>
                                        <span>{formatTime(s.lastTime)}</span>
                                      </div>
                                    </div>
                                  </button>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {s.status === "active" && (
                                      <div className="w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0" />
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSessionMutation.mutate(s.id);
                                      }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-surface-2 text-text-muted hover:text-danger"
                                      title={t("layout.deleteSession")}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* Scheduled tasks section */}
                      {scheduledSessions.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setScheduledCollapsed(!scheduledCollapsed)
                            }
                            className="flex items-center gap-2 w-full px-1 py-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                          >
                            <ChevronRight
                              size={12}
                              className={cn(
                                "transition-transform",
                                !scheduledCollapsed && "rotate-90",
                              )}
                            />
                            <Clock size={12} />
                            <span>
                              {t("layout.scheduledTasks", "定时任务")}
                            </span>
                            <span className="ml-auto text-[10px] text-text-muted/60">
                              {scheduledSessions.length}
                            </span>
                          </button>
                          {!scheduledCollapsed && (
                            <div className="space-y-0.5 mt-1">
                              {scheduledSessions.map((s) => {
                                const isActive = selectedSessionId === s.id;
                                return (
                                  <div
                                    key={s.id}
                                    data-sidebar-session-row={s.id}
                                    data-session-channel-type={
                                      s.channelType ?? "web"
                                    }
                                    data-session-state={s.status || "idle"}
                                    className={cn(
                                      "group flex items-center gap-2.5 w-full rounded-[10px] transition-colors cursor-pointer px-3 py-2 text-left",
                                      isActive && "nav-item-active",
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        track("workspace_sidebar_click", {
                                          target: "conversations",
                                        });
                                        navigate(`/workspace/sessions/${s.id}`);
                                      }}
                                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                    >
                                      <Clock
                                        size={16}
                                        className="shrink-0 text-text-muted"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div
                                            className={cn(
                                              "text-[12px] truncate whitespace-nowrap font-medium",
                                              !isActive && "text-text-primary",
                                            )}
                                          >
                                            {s.title}
                                          </div>
                                          {s.status === "active" && (
                                            <span className="shrink-0 rounded-full bg-[var(--color-success-subtle)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-success)]">
                                              Live
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted truncate whitespace-nowrap">
                                          <span>{formatTime(s.lastTime)}</span>
                                        </div>
                                      </div>
                                    </button>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteSessionMutation.mutate(s.id);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-surface-2 text-text-muted hover:text-danger"
                                        title={t("layout.deleteSession")}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar growth card — hidden in rail mode */}
        {!collapsed && (
          <div
            className="pb-1 shrink-0"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {rewardsCardLoading ? (
              <div data-rewards-card-loading="true" className="animate-pulse">
                <div className="mx-3 mb-2 flex items-center gap-3 rounded-[12px] border border-[#F5DFC0]/40 bg-gradient-to-br from-[#FFF8F0] via-[#FFFAF5] to-[#FFF5EB] px-3.5 py-3">
                  <div className="h-7 w-7 rounded-[8px] bg-[#F6D7A8]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 rounded-full bg-[#E7D4B5]" />
                    <div className="h-2.5 w-14 rounded-full bg-[#F0E1C8]" />
                  </div>
                  <div className="h-3 w-8 rounded-full bg-[#E7D4B5]" />
                </div>
                <div className="px-3 mb-1.5">
                  <div className="w-full rounded-[8px] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-border/70" />
                        <div className="h-2.5 w-12 rounded-full bg-border/70" />
                      </div>
                      <div className="h-2.5 w-16 rounded-full bg-border/60" />
                    </div>
                  </div>
                </div>
              </div>
            ) : !cloudConnected ? (
              <div className="px-3 mb-1.5">
                <button
                  type="button"
                  data-sidebar-growth-card="login"
                  onClick={() =>
                    void handleCloudConnect(
                      isHomePage ? "home" : isModelsPage ? "settings" : "home",
                    )
                  }
                  className="group flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-primary)]"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-border bg-surface-2">
                    {cloudConnecting ? (
                      <Sparkles
                        size={12}
                        className="animate-pulse text-text-secondary"
                      />
                    ) : (
                      <img
                        src="/images/happytabby-logo.png"
                        alt="Tabby"
                        className="h-3.5 w-3.5"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[11px] font-medium text-text-secondary">
                      {t("layout.sidebar.loginTitle")}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-none text-text-muted">
                      {cloudConnecting
                        ? t("layout.sidebar.loginPending")
                        : t("layout.sidebar.loginSubtitle")}
                    </div>
                  </div>
                  <ChevronRight
                    size={12}
                    className="shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </button>
              </div>
            ) : (
              <div>
                <div className="px-3 mb-1.5 relative" ref={balanceRef}>
                  <button
                    type="button"
                    data-sidebar-rewards-balance="true"
                    className="group block w-full rounded-[8px] px-2.5 py-2 transition-colors hover:bg-surface-2 text-left"
                    onClick={() => {
                      if (canOpenBalancePopup) {
                        setShowBalancePopup((prev) => !prev);
                      } else {
                        track("workspace_rewards_click");
                        track("workspace_sidebar_click", { target: "credits" });
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-[11px] text-[var(--color-brand-primary)]">
                          ✦
                        </span>
                        <span className="truncate text-[11px] font-semibold leading-none text-text-secondary">
                          {t("layout.sidebar.balanceLabel")}
                        </span>
                      </div>
                      <span className="shrink-0 tabular-nums text-[11px] font-medium leading-none text-text-secondary">
                        {rewardBalanceValue}
                      </span>
                    </div>
                  </button>
                  {canOpenBalancePopup && showBalancePopup
                    ? createPortal(
                        <div
                          data-sidebar-rewards-balance-popup="true"
                          className="fixed z-[9999] pb-2"
                          style={(() => {
                            const rect =
                              balanceRef.current?.getBoundingClientRect();
                            if (!rect) return { display: "none" };
                            return {
                              left: rect.left,
                              width: Math.max(rect.width, 240),
                              bottom: window.innerHeight - rect.top,
                            };
                          })()}
                        >
                          <div className="rounded-xl border border-border bg-surface-1 p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-text-primary">
                                ✦ {t("layout.sidebar.balancePopup.total")}
                              </span>
                              <span className="tabular-nums text-[14px] font-bold text-text-primary">
                                {rewardBalancePopupValue}
                              </span>
                            </div>
                            <div className="space-y-2 border-t border-border/60 pt-2.5">
                              {SHOW_BALANCE_BREAKDOWN && (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-[11px] text-text-muted">
                                      {t("layout.sidebar.balancePopup.earned")}
                                      <span className="group relative inline-flex cursor-default items-center">
                                        <Info
                                          size={10}
                                          className="text-text-muted/60"
                                        />
                                        <span
                                          role="tooltip"
                                          className="pointer-events-none absolute bottom-full left-0 z-[10000] mb-1.5 w-52 rounded-md bg-neutral-800 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                                        >
                                          {t(
                                            "layout.sidebar.balancePopup.earnedTooltip",
                                          )}
                                        </span>
                                      </span>
                                    </span>
                                    <span className="tabular-nums text-[11px] font-medium text-text-secondary">
                                      {formatUsdCents(
                                        sidebarCreditBreakdown.giftedBalance,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-[11px] text-text-muted">
                                      {t(
                                        "layout.sidebar.balancePopup.recharged",
                                      )}
                                      <span className="group relative inline-flex cursor-default items-center">
                                        <Info
                                          size={10}
                                          className="text-text-muted/60"
                                        />
                                        <span
                                          role="tooltip"
                                          className="pointer-events-none absolute bottom-full left-0 z-[10000] mb-1.5 w-52 rounded-md bg-neutral-800 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                                        >
                                          {t(
                                            "layout.sidebar.balancePopup.rechargedTooltip",
                                          )}
                                        </span>
                                      </span>
                                    </span>
                                    <span className="tabular-nums text-[11px] font-medium text-text-secondary">
                                      {formatUsdCents(
                                        sidebarCreditBreakdown.planBalance,
                                      )}
                                    </span>
                                  </div>
                                </>
                              )}
                              {/* This divider separates the breakdown rows from
                                the consumed total; with the breakdown hidden it
                                would stack on the container's border-t as a
                                doubled line. */}
                              <div
                                className={`flex items-center justify-between ${SHOW_BALANCE_BREAKDOWN ? "border-t border-border/60 pt-2" : ""}`}
                              >
                                <span className="text-[11px] text-text-muted">
                                  {t("layout.sidebar.balancePopup.consumed")}
                                </span>
                                <span className="tabular-nums text-[11px] font-medium text-text-secondary">
                                  {formatUsdCents(
                                    rewardsStatus.cloudBalance?.totalConsumed ??
                                      0,
                                  )}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-sidebar-rewards-balance-detail="true"
                              className="mt-2.5 flex w-full items-center justify-between border-t border-border/60 pt-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                              onClick={() => {
                                track("workspace_click_usage_detail");
                                track("workspace_sidebar_click", {
                                  target: "credits_popup_detail",
                                });
                                void openExternalUrl(
                                  resolveCloudUsageUrl(
                                    desktopCloudStatus?.cloudUrl,
                                  ),
                                );
                                setShowBalancePopup(false);
                              }}
                            >
                              {t("layout.sidebar.balancePopup.viewDetail")}
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        </div>,
                        document.body,
                      )
                    : null}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom action row — stacks vertically in rail mode */}
        <div
          className={cn(
            "shrink-0 border-t border-border/60 pt-1.5 pb-2 px-2 flex gap-0.5",
            collapsed ? "flex-col items-center gap-1" : "items-center",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => {
              track("workspace_settings_click");
              track("workspace_sidebar_click", { target: "settings_footer" });
              navigate("/workspace/settings");
            }}
            title={t("layout.nav.settings")}
            className={cn(
              "nav-item flex items-center rounded-[var(--radius-6)] text-[13px] transition-colors cursor-pointer py-2",
              collapsed ? "justify-center px-2" : "flex-1 min-w-0 gap-2 px-2.5",
              isModelsPage && "nav-item-active",
            )}
          >
            <Settings size={16} className="shrink-0" />
            {!collapsed && (
              <span className="truncate text-left">
                {t("layout.nav.settings")}
              </span>
            )}
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <div className="relative" ref={helpRef}>
              {showHelpMenu && (
                <div className="absolute z-20 bottom-full left-1/2 mb-2 w-44 -translate-x-1/2">
                  <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                    <div className="p-1.5">
                      <a
                        href="https://tabby.picaso.studio/docs/"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          track("workspace_docs_click", { type: "doc" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
                      >
                        <BookOpen size={14} />
                        {t("layout.help.docs")}
                      </a>
                      <a
                        href="mailto:work4zkl@gmail.com"
                        onClick={() =>
                          track("workspace_docs_click", { type: "contact" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
                      >
                        <Mail size={14} />
                        {t("layout.help.contact")}
                      </a>
                    </div>
                    <div className="border-t border-border p-1.5">
                      <a
                        href="https://github.com/coder-zkl1988/tabby/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          track("workspace_docs_click", { type: "changelog" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
                      >
                        <ScrollText size={14} />
                        {t("layout.help.changelog")}
                      </a>
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!showHelpMenu) {
                    track("workspace_help_menu_open");
                  }
                  setShowHelpMenu(!showHelpMenu);
                }}
                className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer",
                  showHelpMenu
                    ? "text-text-primary bg-surface-2"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-2",
                )}
                title={t("layout.help.title")}
              >
                <CircleHelp size={16} />
              </button>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                track("workspace_github_click", { source: "sidebar" })
              }
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
              title="GitHub"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>

        {/* Account — hidden in desktop client */}
        {!isDesktopClient && (
          <div className="relative shrink-0" ref={logoutRef}>
            {showLogoutConfirm && (
              <div className="absolute z-20 bottom-full left-1.5 right-1.5 mb-2">
                <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                  <div className="px-3.5 py-3 border-b border-border">
                    <div className="text-[12px] font-medium text-text-primary truncate whitespace-nowrap">
                      {userEmail}
                    </div>
                  </div>
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-muted hover:text-red-500 hover:bg-red-500/5 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <LogOut size={13} />
                      {t("layout.signOut")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border px-2 py-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                className="flex gap-2.5 items-center w-full px-2 py-2 rounded-lg transition-all hover:bg-surface-3 cursor-pointer"
              >
                {userImage ? (
                  <img
                    src={userImage}
                    alt={userName}
                    className="w-7 h-7 rounded-md object-cover ring-1 ring-accent/10 shrink-0"
                  />
                ) : (
                  <div className="flex justify-center items-center w-7 h-7 rounded-md bg-gradient-to-br from-accent/20 to-accent/5 text-[10px] font-bold text-accent ring-1 ring-accent/10 shrink-0">
                    {userInitial}
                  </div>
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] text-text-primary truncate font-medium whitespace-nowrap">
                    {userName}
                  </div>
                  <div className="text-[10px] text-text-muted truncate whitespace-nowrap">
                    {userEmail}
                  </div>
                </div>
                <ChevronUp
                  size={12}
                  className={cn(
                    "text-text-muted/50 shrink-0 transition-transform duration-150",
                    showLogoutConfirm ? "rotate-0" : "rotate-180",
                  )}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="hidden md:block w-px shrink-0 cursor-col-resize group relative z-10"
          style={
            {
              WebkitAppRegion: "no-drag",
              background: desktopGlassTint,
            } as React.CSSProperties
          }
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
      )}

      {/* Main content */}
      <div className="relative flex-1 min-w-0">
        <div
          className={cn(
            "relative flex h-full min-w-0 flex-col bg-surface-1 rounded-l-[20px]",
          )}
          style={{ background: "var(--color-tabby-bg)" }}
        >
          <main className="flex-1 overflow-y-auto min-h-0 p-0 md:p-3">
            {budgetBannerRouteVariant === "global" &&
            shouldShowPrompt &&
            budgetStatus !== "healthy" ? (
              <div className="mx-auto max-w-4xl px-4 pb-0 pt-4 sm:px-6 md:px-8">
                <BudgetWarningBanner
                  status={budgetStatus}
                  dismissible={bannerDismissible}
                  onDismiss={dismissBanner}
                />
              </div>
            ) : null}
            {showEmptyState ? (
              <EmptyState onGoConfig={() => navigate("/workspace/settings")} />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>

      {/* Right sidebar resize handle */}
      {rightSidebarOpen && (
        <div
          onMouseDown={handleRightResizeStart}
          className="hidden md:block w-px shrink-0 cursor-col-resize group relative z-10"
          style={
            {
              WebkitAppRegion: "no-drag",
              background: desktopGlassTint,
            } as React.CSSProperties
          }
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
      )}

      {/* Right canvas workbench (all sidebar surfaces live here as nodes) */}
      {rightSidebarOpen && (
        <div
          className="hidden md:flex shrink-0 flex-col bg-[var(--color-surface-1)]"
          style={
            {
              width: rightSidebarWidth,
              background: "var(--color-tabby-bg)",
              // Desktop title bar (hiddenInset) makes the top strip a system
              // drag region; opt the whole panel out so its header buttons
              // remain clickable on desktop.
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties
          }
        >
          {/* Header band matches the chat header's top clearance + height so the
              two border-b dividers line up: pt compensates the chat column's
              md:p-3 top pad (12px) on top of its md:pt-7 (28px); min-h matches
              the chat header's badge row. */}
          <div className="flex min-h-[34px] items-center justify-between border-b border-[var(--color-border-subtle)] px-4 pb-2 pt-2 md:pt-[40px]">
            <span className="text-sm font-medium text-[var(--color-text-heading)]">
              工作台
              {canvasNodes.length > 0 ? (
                <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">
                  {canvasNodes.length}
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleRightSidebarMaximize}
                title={rightSidebarMaximized ? "还原宽度" : "展开画布"}
                aria-label={
                  rightSidebarMaximized ? "restore canvas" : "maximize canvas"
                }
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className="p-1 rounded-md hover:bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {rightSidebarMaximized ? (
                  <Minimize2 size={14} />
                ) : (
                  <Maximize2 size={14} />
                )}
              </button>
              <button
                type="button"
                onClick={closeRightSidebar}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className="p-1 rounded-md hover:bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M4 4L12 12M12 4L4 12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          {/* Always mount the surface, even with zero nodes: the toolbar is
              the way users CREATE the first node, and mounting keeps the
              S8 mirror pushing so the chat agent's canvas_read stays live. */}
          <div className="a2ui-sidebar-host flex-1 min-h-0">
            <CanvasSurface />
          </div>
        </div>
      )}
    </div>
  );
}
