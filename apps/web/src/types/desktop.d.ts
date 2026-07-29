export type SkillSource = "curated" | "managed" | "custom" | "workspace" | "user";

export type InstalledSkill = {
  slug: string;
  ownerHandle: string | null;
  version: string | null;
  source: SkillSource;
  name: string;
  description: string;
  installedAt: string | null;
  agentId: string | null;
  agentName: string | null;
};

export type QueueItemStatus =
  | "queued"
  | "downloading"
  | "installing-deps"
  | "done"
  | "failed";

export type QueueErrorCode =
  | "skill_not_found"
  | "rate_limit"
  | "npm_missing"
  | "deps_install_failed"
  | "unknown";

export type QueueItem = {
  readonly slug: string;
  readonly ownerHandle: string | null;
  readonly source: SkillSource;
  readonly status: QueueItemStatus;
  readonly position: number;
  readonly error?: string;
  readonly errorCode?: QueueErrorCode | null;
  readonly enqueuedAt: string;
};

export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  queue: QueueItem[];
  meta: CatalogMeta | null;
};

export type SkillhubCatalogPageData = SkillhubCatalogData & {
  nextCursor: string | null;
  total: number;
  facets: Array<{ tag: string; count: number }>;
};

export type SkillhubStatusData = Pick<
  SkillhubCatalogData,
  "installedSlugs" | "installedSkills" | "queue"
>;

export type MinimalSkill = {
  identity?: string;
  ownerHandle?: string;
  slug: string;
  name: string;
  description: string;
  downloads: number;
  stars: number;
  tags: string[];
  version: string;
  updatedAt: string;
};

export type CatalogMeta = {
  version: string;
  updatedAt: string;
  skillCount: number;
};

export type NexuDesktopBridge = {
  skillhub: {
    getCatalog: () => Promise<SkillhubCatalogData>;
    install: (slug: string) => Promise<{ ok: boolean; error?: string }>;
    uninstall: (slug: string) => Promise<{ ok: boolean; error?: string }>;
    refreshCatalog: () => Promise<{ ok: boolean; skillCount: number }>;
  };
};

declare global {
  interface Window {
    nexuDesktop?: NexuDesktopBridge;
  }
}
