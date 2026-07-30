import { publishExternalChatInput } from "@/lib/chat/external-chat-input";
import { openExternalUrl } from "@/lib/desktop-links";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  PenLine,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  DesktopBrowserControl,
  DesktopBrowserControlResult,
} from "../../../../desktop/shared/host";
import { getApiV1Artifacts } from "../../../lib/api/sdk.gen";
import { useAgentBrowserTabRequest } from "./agent-browser-relay";
import { BrowserAnnotationEditor } from "./browser-annotation-editor";
import type { BrowserNavigationRequest } from "./browser-panel-store";

export interface PreviewArtifact {
  id: string;
  title: string;
  status: string;
  previewUrl: string | null;
  createdAt: string;
}

export interface BrowserHistoryState {
  entries: string[];
  index: number;
}

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  address: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  history: BrowserHistoryState;
};

const MAX_TABS = 8;

type BrowserNavigationTarget =
  | { kind: "existing"; tabId: string }
  | { kind: "blank"; tabId: string }
  | { kind: "create" }
  | { kind: "replace"; tabId: string }
  | { kind: "unavailable" };

export function selectBrowserNavigationTarget(
  tabs: Pick<BrowserTab, "id" | "url">[],
  activeTabId: string,
  normalizedUrl: string,
  protectedTabId: string | null,
): BrowserNavigationTarget {
  const existing = tabs.find((tab) => tab.url === normalizedUrl);
  if (existing) return { kind: "existing", tabId: existing.id };

  const blank = tabs.find((tab) => !tab.url && tab.id !== protectedTabId);
  if (blank) return { kind: "blank", tabId: blank.id };

  if (tabs.length < MAX_TABS) return { kind: "create" };

  const active = tabs.find(
    (tab) => tab.id === activeTabId && tab.id !== protectedTabId,
  );
  const replacement = active ?? tabs.find((tab) => tab.id !== protectedTabId);
  return replacement
    ? { kind: "replace", tabId: replacement.id }
    : { kind: "unavailable" };
}

function createBrowserTab(
  url = "",
  title = "New tab",
  id: string = crypto.randomUUID(),
): BrowserTab {
  return {
    id,
    title,
    url,
    address: url,
    loading: Boolean(url),
    canGoBack: false,
    canGoForward: false,
    history: url ? { entries: [url], index: 0 } : { entries: [], index: -1 },
  };
}

export function normalizeBrowserUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(
    trimmed,
  );
  const http = /^https?:\/\//iu.test(trimmed);
  if (!http && !local && /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return null;
  try {
    const url = new URL(
      http ? trimmed : `${local ? "http" : "https"}://${trimmed}`,
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function pushBrowserHistory(
  history: BrowserHistoryState,
  url: string,
): BrowserHistoryState {
  if (history.entries[history.index] === url) return history;
  const entries = [...history.entries.slice(0, history.index + 1), url];
  return { entries, index: entries.length - 1 };
}

export function selectLatestPreviewArtifact(
  artifacts: PreviewArtifact[],
): PreviewArtifact | null {
  return (
    artifacts
      .filter(
        (artifact) =>
          artifact.status === "live" &&
          normalizeBrowserUrl(artifact.previewUrl ?? "") !== null,
      )
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0] ?? null
  );
}

export function sortPreviewArtifacts(
  artifacts: PreviewArtifact[],
): PreviewArtifact[] {
  return [...artifacts].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export function isPreviewArtifactActive(
  artifact: PreviewArtifact,
  activeUrl: string,
): boolean {
  const previewUrl = normalizeBrowserUrl(artifact.previewUrl ?? "");
  const currentUrl = normalizeBrowserUrl(activeUrl);
  if (!previewUrl || !currentUrl) return false;
  const comparable = (value: string): string =>
    value.split(/[?#]/u)[0] ?? value;
  return comparable(previewUrl) === comparable(currentUrl);
}

function hasDesktopBrowserHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = (window as Window & { nexuHost?: unknown }).nexuHost;
  return Boolean(host && typeof host === "object");
}

async function controlDesktopBrowser(
  payload: DesktopBrowserControl,
): Promise<DesktopBrowserControlResult | null> {
  const host = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!host || typeof host !== "object") return null;
  const invoke = Reflect.get(host, "invoke");
  if (typeof invoke !== "function") return null;
  return invoke.call(
    host,
    "desktop:browser-control",
    payload,
  ) as Promise<DesktopBrowserControlResult>;
}

interface EmbeddedBrowserProps {
  sessionKey: string;
  navigationRequest: BrowserNavigationRequest | null;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function EmbeddedBrowser({
  sessionKey,
  navigationRequest,
  maximized,
  onToggleMaximize,
  onClose,
}: EmbeddedBrowserProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createBrowserTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [annotationImage, setAnnotationImage] = useState<string | null>(null);
  const [selectingElement, setSelectingElement] = useState(false);
  const [capturingAnnotation, setCapturingAnnotation] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyPanelRef = useRef<HTMLElement>(null);
  const lastAutoArtifactIdRef = useRef<string | null>(null);
  const lastNavigationRequestIdRef = useRef<number | null>(null);
  const desktopBrowser = hasDesktopBrowserHost();
  const agentTabRequest = useAgentBrowserTabRequest();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const updateTab = useCallback(
    (tabId: string, update: Partial<BrowserTab>): void => {
      setTabs((current) =>
        current.map((tab) => (tab.id === tabId ? { ...tab, ...update } : tab)),
      );
    },
    [],
  );

  const { data: artifacts = [], isError: artifactsError } = useQuery({
    queryKey: ["browser-artifacts", sessionKey],
    queryFn: async () => {
      const { data, error } = await getApiV1Artifacts({
        query: { sessionKey, limit: 50, offset: 0 },
      });
      if (error) throw new Error("Unable to load artifacts");
      return (data?.artifacts ?? []) as PreviewArtifact[];
    },
    refetchInterval: 2000,
  });

  const previewArtifacts = useMemo(
    () =>
      sortPreviewArtifacts(
        artifacts.filter(
          (artifact) => normalizeBrowserUrl(artifact.previewUrl ?? "") !== null,
        ),
      ),
    [artifacts],
  );
  const latestArtifact = useMemo(
    () => selectLatestPreviewArtifact(previewArtifacts),
    [previewArtifacts],
  );

  useEffect(() => {
    if (!historyOpen) return;
    const closeHistory = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        !historyRef.current?.contains(target) &&
        !historyPanelRef.current?.contains(target)
      ) {
        setHistoryOpen(false);
      }
    };
    const closeHistoryOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("mousedown", closeHistory);
    document.addEventListener("keydown", closeHistoryOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeHistory);
      document.removeEventListener("keydown", closeHistoryOnEscape);
    };
  }, [historyOpen]);

  const navigateTab = useCallback(
    (tabId: string, value: string, title?: string): boolean => {
      const normalized = normalizeBrowserUrl(value);
      if (!normalized) {
        setNavigationError(
          t("browser.invalidUrl", {
            defaultValue: "Enter a valid web address",
          }),
        );
        return false;
      }
      setNavigationError(null);
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                title: title ?? tab.title,
                url: normalized,
                address: normalized,
                loading: true,
                history: pushBrowserHistory(tab.history, normalized),
              }
            : tab,
        ),
      );
      return true;
    },
    [t],
  );

  useEffect(() => {
    if (!latestArtifact || lastAutoArtifactIdRef.current === latestArtifact.id)
      return;
    lastAutoArtifactIdRef.current = latestArtifact.id;
    if (
      navigationRequest &&
      Date.parse(latestArtifact.createdAt) <= navigationRequest.requestedAt
    ) {
      return;
    }
    const url = latestArtifact.previewUrl ?? "";
    setTabs((current) => {
      const existing = current.find(
        (tab) => tab.url.split("?")[0] === url.split("?")[0],
      );
      if (existing) {
        setActiveTabId(existing.id);
        return current.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                url,
                address: url,
                title: latestArtifact.title,
                loading: true,
              }
            : tab,
        );
      }
      const blank = current.find((tab) => !tab.url);
      if (blank) {
        setActiveTabId(blank.id);
        return current.map((tab) =>
          tab.id === blank.id
            ? {
                ...tab,
                url,
                address: url,
                title: latestArtifact.title,
                loading: true,
                history: { entries: [url], index: 0 },
              }
            : tab,
        );
      }
      if (current.length >= MAX_TABS) return current;
      const created = createBrowserTab(url, latestArtifact.title);
      setActiveTabId(created.id);
      return [...current, created];
    });
  }, [latestArtifact, navigationRequest]);

  useEffect(() => {
    if (
      !navigationRequest ||
      lastNavigationRequestIdRef.current === navigationRequest.id
    ) {
      return;
    }
    lastNavigationRequestIdRef.current = navigationRequest.id;
    const normalized = normalizeBrowserUrl(navigationRequest.url);
    if (!normalized) {
      setNavigationError(
        t("browser.invalidUrl", {
          defaultValue: "Enter a valid web address",
        }),
      );
      return;
    }

    setNavigationError(null);
    setTabs((current) => {
      const target = selectBrowserNavigationTarget(
        current,
        activeTabId,
        normalized,
        agentTabRequest?.tabId ?? null,
      );
      if (target.kind === "unavailable") return current;
      if (target.kind === "existing") {
        setActiveTabId(target.tabId);
        return current;
      }
      if (target.kind === "create") {
        const created = createBrowserTab(normalized);
        setActiveTabId(created.id);
        return [...current, created];
      }

      setActiveTabId(target.tabId);
      return current.map((tab) =>
        tab.id === target.tabId
          ? {
              ...tab,
              url: normalized,
              address: normalized,
              loading: true,
              history:
                target.kind === "blank"
                  ? { entries: [normalized], index: 0 }
                  : pushBrowserHistory(tab.history, normalized),
            }
          : tab,
      );
    });
  }, [activeTabId, agentTabRequest?.tabId, navigationRequest, t]);

  useEffect(() => {
    if (!desktopBrowser || !activeTab?.url || annotationImage) {
      if (desktopBrowser) void controlDesktopBrowser({ action: "hide" });
      return;
    }
    const element = contentRef.current;
    if (!element) return;
    const sync = (): void => {
      const rect = element.getBoundingClientRect();
      void controlDesktopBrowser({
        action: "show",
        tabId: activeTab.id,
        url: activeTab.url,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      })
        .then(() => setNavigationError(null))
        .catch(() => setNavigationError("Could not open this page"));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      void controlDesktopBrowser({ action: "hide" });
    };
  }, [activeTab?.id, activeTab?.url, annotationImage, desktopBrowser]);

  useEffect(() => {
    if (!desktopBrowser || !activeTab?.url || annotationImage) return;
    let cancelled = false;
    const readState = async (): Promise<void> => {
      const result = await controlDesktopBrowser({
        action: "state",
        tabId: activeTab.id,
      });
      if (cancelled || result?.kind !== "state") return;
      updateTab(activeTab.id, {
        url: result.url || activeTab.url,
        address: result.url || activeTab.url,
        title: result.title,
        loading: result.loading,
        canGoBack: result.canGoBack,
        canGoForward: result.canGoForward,
      });
    };
    void readState();
    const timer = window.setInterval(() => void readState(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeTab?.id,
    activeTab?.url,
    annotationImage,
    desktopBrowser,
    updateTab,
  ]);

  // Collapsing the panel hides the view; it does not dispose it. The page, its
  // login state and the agent's element refs outlive the panel, so reopening
  // resumes rather than restarts — and an agent mid-task is not cut off just
  // because the user wanted the sidebar back.
  useEffect(
    () => () => {
      if (desktopBrowser) void controlDesktopBrowser({ action: "hide" });
    },
    [desktopBrowser],
  );

  // The agent drives its own tab in the main process. Adopt it by id so the
  // user sees the page it is working on; the main process already navigated,
  // so this only mirrors the tab into the panel's own list.
  useEffect(() => {
    if (!agentTabRequest) return;
    const { tabId, url } = agentTabRequest;
    setTabs((current) =>
      current.some((tab) => tab.id === tabId)
        ? current.map((tab) =>
            tab.id === tabId ? { ...tab, url, address: url } : tab,
          )
        : [...current, createBrowserTab(url, "New tab", tabId)],
    );
    setActiveTabId(tabId);
  }, [agentTabRequest]);

  const addTab = (): void => {
    if (tabs.length >= MAX_TABS) return;
    const created = createBrowserTab();
    setTabs((current) => [...current, created]);
    setActiveTabId(created.id);
  };

  const closeTab = (tabId: string): void => {
    if (desktopBrowser)
      void controlDesktopBrowser({ action: "close-tab", tabId });
    setTabs((current) => {
      if (current.length === 1) {
        const replacement = createBrowserTab();
        setActiveTabId(replacement.id);
        return [replacement];
      }
      const index = current.findIndex((tab) => tab.id === tabId);
      const remaining = current.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        setActiveTabId(
          remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? "",
        );
      }
      return remaining;
    });
  };

  const moveHistory = (direction: -1 | 1): void => {
    if (!activeTab) return;
    if (desktopBrowser) {
      void controlDesktopBrowser({
        action: "command",
        tabId: activeTab.id,
        command: direction < 0 ? "back" : "forward",
      });
      return;
    }
    const index = activeTab.history.index + direction;
    const url = activeTab.history.entries[index];
    if (!url) return;
    updateTab(activeTab.id, {
      url,
      address: url,
      loading: true,
      history: { ...activeTab.history, index },
    });
  };

  const selectElement = async (): Promise<void> => {
    if (!activeTab || !desktopBrowser) return;
    setSelectingElement(true);
    try {
      const result = await controlDesktopBrowser({
        action: "select-element",
        tabId: activeTab.id,
      });
      if (result?.kind !== "selection" || !result.selection) return;
      const selected = result.selection;
      publishExternalChatInput(sessionKey, {
        text: [
          "[浏览器页面元素]",
          `页面: ${selected.url}`,
          `选择器: ${selected.selector}`,
          `元素: ${selected.tagName}`,
          selected.ariaLabel ? `标签: ${selected.ariaLabel}` : "",
          selected.text ? `内容: ${selected.text}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      toast.success("已将页面元素加入输入框");
    } catch {
      toast.error("无法读取当前页面元素");
    } finally {
      setSelectingElement(false);
    }
  };

  const captureForAnnotation = async (): Promise<void> => {
    if (!activeTab || !desktopBrowser) return;
    setCapturingAnnotation(true);
    try {
      const result = await controlDesktopBrowser({
        action: "capture",
        tabId: activeTab.id,
      });
      if (result?.kind === "capture") setAnnotationImage(result.dataUrl);
    } catch {
      toast.error("无法截取当前页面");
    } finally {
      setCapturingAnnotation(false);
    }
  };

  const canGoBack = desktopBrowser
    ? Boolean(activeTab?.canGoBack)
    : (activeTab?.history.index ?? -1) > 0;
  const canGoForward = desktopBrowser
    ? Boolean(activeTab?.canGoForward)
    : Boolean(
        activeTab &&
          activeTab.history.index < activeTab.history.entries.length - 1,
      );

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-embedded-browser="true"
    >
      <div className="border-b border-border px-2 pb-2 pt-2 md:pt-[40px]">
        <div className="flex min-h-8 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`group flex h-8 min-w-24 max-w-44 items-center gap-1.5 rounded-md px-2 text-xs ${tab.id === activeTab?.id ? "bg-surface-1 text-text-primary shadow-sm" : "text-text-muted hover:bg-surface-2"}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                >
                  {tab.loading ? (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ) : (
                    <Globe2 size={12} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {tab.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-surface-3"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={tabs.length >= MAX_TABS}
              onClick={addTab}
              title="New tab"
              aria-label="New tab"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 disabled:opacity-30"
            >
              <Plus size={15} />
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleMaximize}
            title={maximized ? "Restore width" : "Expand browser"}
            aria-label={maximized ? "restore browser" : "maximize browser"}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
          >
            <X size={15} />
          </button>
        </div>

        <form
          className="mt-1.5 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeTab) navigateTab(activeTab.id, activeTab.address);
          }}
        >
          <button
            type="button"
            disabled={!canGoBack}
            onClick={() => moveHistory(-1)}
            title="Back"
            aria-label="Back"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 disabled:opacity-30"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={() => moveHistory(1)}
            title="Forward"
            aria-label="Forward"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 disabled:opacity-30"
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            disabled={!activeTab?.url}
            onClick={() => {
              if (!activeTab) return;
              if (desktopBrowser)
                void controlDesktopBrowser({
                  action: "command",
                  tabId: activeTab.id,
                  command: "reload",
                });
              else
                updateTab(activeTab.id, {
                  loading: true,
                  url: `${activeTab.url.split("#")[0]}#reload-${Date.now()}`,
                });
            }}
            title="Reload"
            aria-label="Reload"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 disabled:opacity-30"
          >
            <RefreshCw size={14} />
          </button>
          <input
            value={activeTab?.address ?? ""}
            onChange={(event) =>
              activeTab &&
              updateTab(activeTab.id, { address: event.target.value })
            }
            aria-label="Address"
            placeholder="Type a URL"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2.5 text-xs text-text-primary outline-none focus:border-text-muted"
          />
          <div ref={historyRef} className="relative shrink-0">
            <button
              type="button"
              disabled={previewArtifacts.length === 0}
              onClick={() => setHistoryOpen((current) => !current)}
              title="页面版本历史"
              aria-label="页面版本历史"
              aria-haspopup="menu"
              aria-expanded={historyOpen}
              className={`flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${historyOpen ? "bg-surface-3 text-text-primary shadow-sm ring-1 ring-border" : "text-text-secondary hover:bg-surface-2"}`}
            >
              <History size={14} />
            </button>
          </div>
          <button
            type="button"
            disabled={!desktopBrowser || !activeTab?.url || !!annotationImage}
            onClick={() => void selectElement()}
            title="选择页面元素"
            aria-label="选择页面元素"
            aria-pressed={selectingElement}
            className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${selectingElement ? "bg-surface-3 text-text-primary shadow-sm ring-1 ring-border" : "text-text-secondary hover:bg-surface-2"}`}
          >
            <MousePointer2 size={14} />
          </button>
          <button
            type="button"
            disabled={!desktopBrowser || !activeTab?.url}
            onClick={() => {
              if (annotationImage) {
                setAnnotationImage(null);
                return;
              }
              void captureForAnnotation();
            }}
            title="标注截图"
            aria-label="标注截图"
            aria-pressed={capturingAnnotation || !!annotationImage}
            className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${capturingAnnotation || annotationImage ? "bg-surface-3 text-text-primary shadow-sm ring-1 ring-border" : "text-text-secondary hover:bg-surface-2"}`}
          >
            <PenLine size={14} />
          </button>
          <button
            type="button"
            disabled={!activeTab?.url}
            onClick={() =>
              activeTab?.url && void openExternalUrl(activeTab.url)
            }
            title="Open externally"
            aria-label="Open externally"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 disabled:opacity-30"
          >
            <ExternalLink size={14} />
          </button>
        </form>

        {(navigationError || artifactsError) && (
          <p className="mt-1 text-[11px] text-danger">
            {navigationError ?? "Could not load generated pages"}
          </p>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 bg-white">
        <div
          ref={contentRef}
          data-browser-content-viewport="true"
          className="relative min-w-0 flex-1 bg-white"
        >
          {!desktopBrowser && activeTab?.url ? (
            <iframe
              src={activeTab.url}
              title={activeTab.title}
              sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => updateTab(activeTab.id, { loading: false })}
              className="size-full border-0 bg-white"
            />
          ) : !activeTab?.url ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted">
                <Globe2 size={21} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-text-primary">
                Waiting for a web page
              </p>
              <p className="mt-1 max-w-72 text-[11px] leading-5 text-text-muted">
                Generated pages from this conversation will open here
                automatically.
              </p>
            </div>
          ) : null}

          {annotationImage && (
            <BrowserAnnotationEditor
              imageUrl={annotationImage}
              onClose={() => setAnnotationImage(null)}
              onAddToChat={(imageUrl) => {
                publishExternalChatInput(sessionKey, {
                  attachment: {
                    type: "image",
                    previewUrl: imageUrl,
                    content: imageUrl.slice(imageUrl.indexOf(",") + 1),
                    mimeType: "image/png",
                    filename: `browser-annotation-${Date.now()}.png`,
                  },
                });
                setAnnotationImage(null);
                toast.success("标注截图已加入输入框");
              }}
            />
          )}
        </div>

        {historyOpen && (
          <aside
            ref={historyPanelRef}
            role="menu"
            aria-label="Bot 生成页面版本"
            data-browser-history-panel="true"
            className="flex w-72 min-w-52 max-w-[45%] shrink-0 flex-col border-l border-border bg-surface-0 p-2"
          >
            <div className="flex items-center gap-2 px-1 pb-2 pt-1 text-xs font-medium text-text-primary">
              <History size={13} className="text-text-muted" />
              页面版本历史
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {previewArtifacts.map((artifact) => {
                const active = isPreviewArtifactActive(
                  artifact,
                  activeTab?.url ?? "",
                );
                const createdAt = Date.parse(artifact.createdAt);
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      if (artifact.previewUrl && activeTab) {
                        navigateTab(
                          activeTab.id,
                          artifact.previewUrl,
                          artifact.title,
                        );
                      }
                      setHistoryOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors ${active ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {artifact.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-text-muted">
                        {Number.isNaN(createdAt)
                          ? "生成时间未知"
                          : new Intl.DateTimeFormat("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(createdAt)}
                      </span>
                    </span>
                    {active && (
                      <Check size={13} className="shrink-0 text-success" />
                    )}
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
