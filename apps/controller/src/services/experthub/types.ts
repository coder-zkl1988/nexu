import type { ExpertManifest, InstalledExpert } from "@nexu/shared";

export type ExpertSource = "managed" | "bundled";

export type ExpertLedger = {
  version: 1;
  updatedAt: string | null;
  entries: Record<string, InstalledExpert>;
};

export type CatalogMeta = {
  version: string;
  updatedAt: string;
  count: number;
};

export type ResolvedExpert = {
  manifest: ExpertManifest;
  source: ExpertSource;
};
