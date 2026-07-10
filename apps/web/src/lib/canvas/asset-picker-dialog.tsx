/**
 * asset-picker-dialog.tsx — the 素材库 picker (W4.3).
 *
 * radix Dialog wired into the CanvasDialogs mount switch as { kind: "assets" }.
 * Kind tabs / search / pagination (8 per page) / insert (stays open for
 * multi-insert) / delete. Hydrates assets on open.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AudioLines, Clapperboard, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type CanvasAsset,
  ensureAssetsLoaded,
  filterAssets,
  insertAssetToCanvas,
  paginateAssets,
  removeAsset,
  useCanvasAssets,
} from "./canvas-assets";
import { closeCanvasDialog } from "./canvas-dialogs";

const KIND_TABS: ReadonlyArray<{
  value: CanvasAsset["kind"] | "all";
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "text", label: "文本" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

export function AssetPickerDialog() {
  const { assets } = useCanvasAssets();
  const [kind, setKind] = useState<CanvasAsset["kind"] | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    void ensureAssetsLoaded();
  }, []);

  const filtered = useMemo(
    () => filterAssets(assets, kind, query),
    [assets, kind, query],
  );
  const {
    pageItems,
    page: currentPage,
    pageCount,
  } = paginateAssets(filtered, page);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCanvasDialog();
      }}
    >
      <DialogContent className="max-w-[720px] w-full" style={{ maxWidth: 720 }}>
        <DialogHeader>
          <DialogTitle>素材库</DialogTitle>
        </DialogHeader>
        <div
          data-canvas-asset-picker="true"
          className="flex flex-col gap-3 px-6 pb-6"
        >
          {/* Kind tabs */}
          <div className="flex items-center gap-1">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                data-asset-kind-tab={tab.value}
                onClick={() => {
                  setKind(tab.value);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs border ${
                  kind === tab.value
                    ? "border-sky-500 text-sky-500 bg-sky-500/10"
                    : "border-border text-text-secondary hover:bg-surface-2"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索素材…"
            className="w-full rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          />

          {/* Grid */}
          {pageItems.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-text-secondary">
              {assets.length === 0 ? "无素材" : "无匹配"}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {pageItems.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-center gap-3 text-xs text-text-secondary">
            <button
              type="button"
              data-asset-prev="true"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-border px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <span className="tabular-nums">
              第 {currentPage} / {pageCount} 页
            </span>
            <button
              type="button"
              data-asset-next="true"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-border px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetCard({ asset }: { asset: CanvasAsset }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-1 p-2">
      <AssetPreview asset={asset} />
      <p className="truncate text-xs text-text-primary" title={asset.title}>
        {asset.title}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-asset-insert={asset.id}
          onClick={() => {
            insertAssetToCanvas(asset.id);
            toast.success("已插入画布");
          }}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-sky-500 px-2 py-1 text-xs font-medium text-white hover:bg-sky-600"
        >
          <Plus size={12} />
          插入
        </button>
        <button
          type="button"
          data-asset-delete={asset.id}
          aria-label="删除素材"
          title="删除素材"
          onClick={() => {
            void removeAsset(asset.id);
          }}
          className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function AssetPreview({ asset }: { asset: CanvasAsset }) {
  if (asset.kind === "image") {
    return (
      <img
        src={asset.content}
        alt={asset.title}
        className="h-20 w-full rounded object-cover"
        draggable={false}
      />
    );
  }
  if (asset.kind === "text") {
    return (
      <p className="line-clamp-3 h-20 overflow-hidden rounded bg-surface-2 p-1.5 text-[11px] leading-tight text-text-secondary">
        {asset.content}
      </p>
    );
  }
  // video / audio → type icon block
  return (
    <div className="flex h-20 w-full items-center justify-center rounded bg-surface-2 text-text-tertiary">
      {asset.kind === "video" ? (
        <Clapperboard size={24} />
      ) : (
        <AudioLines size={24} />
      )}
    </div>
  );
}
