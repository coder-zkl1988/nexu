import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiV1Devices } from "../../../../lib/api/sdk.gen";
import { XHS_EDITOR_NODE_SIZE, useA2UISidebar } from "../a2ui-sidebar-context";
import type { A2UIComponent, A2UIMessage } from "../a2ui-types";
import type { CustomComponentProps } from "./registry";
import {
  type RowStatus,
  type XHSPost,
  seedBatch,
  setRowStatus,
  updatePost,
  useBatch,
} from "./xhs-batch-store";
import {
  type XHSPublishResultItem,
  publishXhsPost,
  reportXhsPublishResults,
} from "./xhs-publish";

const NEXU_CATALOG = "https://nexu.app/a2ui/custom-catalog.json";

interface SeedPost {
  id?: string;
  title?: string;
  content?: string;
  images?: string[];
  hashtags?: string[];
  deviceId?: string;
}

interface XHSBatchData {
  batchId?: string;
  posts?: SeedPost[];
}

const STATUS_LABEL: Record<RowStatus, string> = {
  idle: "待发布",
  pushing: "推图中",
  publishing: "发布中",
  success: "已发布",
  error: "失败",
};
const STATUS_COLOR: Record<RowStatus, string> = {
  idle: "var(--color-text-tertiary, #999)",
  pushing: "#185FA5",
  publishing: "#185FA5",
  success: "#0F6E56",
  error: "#A32D2D",
};

/** Grid layout for fanning every post out as its own XHSEditor canvas node. */
const FANOUT_COLS = 3;
const FANOUT_NODE = XHS_EDITOR_NODE_SIZE;
const FANOUT_GAP = 24;
function fanoutPosition(index: number): { x: number; y: number } {
  const col = index % FANOUT_COLS;
  const row = Math.floor(index / FANOUT_COLS);
  return {
    x: 32 + col * (FANOUT_NODE.width + FANOUT_GAP),
    y: 32 + row * (FANOUT_NODE.height + FANOUT_GAP),
  };
}

/** Build the A2UI surface that renders one post's XHSEditor in the side panel,
 * bound to the store via batchId/postId so edits sync back to this table. */
function buildEditorSurface(
  surfaceId: string,
  batchId: string,
  post: XHSPost,
): A2UIMessage[] {
  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: NEXU_CATALOG } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "xhs-editor",
            type: "XHSEditor",
            title: post.title,
            content: post.content,
            images: post.images,
            hashtags: post.hashtags,
            deviceId: post.deviceId,
            batchId,
            postId: post.id,
          } as unknown as A2UIComponent,
        ],
      },
    },
  ];
}

export function XHSBatchTable({ comp, onAction }: CustomComponentProps) {
  const data = comp as unknown as XHSBatchData;
  const batchId = data.batchId ?? "default";
  const { openWith } = useA2UISidebar();

  const { data: devicesData } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data: d } = await getApiV1Devices();
      return d;
    },
    refetchInterval: 10_000,
  });
  const devices = devicesData?.devices ?? [];

  // Seed the store once from the A2UI message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once per batch
  useEffect(() => {
    seedBatch(
      batchId,
      (data.posts ?? []).map((p, i) => ({
        id: p.id ?? `post-${i}`,
        title: p.title ?? "",
        content: p.content ?? "",
        images: p.images ?? [],
        hashtags: p.hashtags ?? [],
        deviceId: p.deviceId ?? "",
      })),
    );
  }, [batchId]);

  const { posts } = useBatch(batchId);

  // Round-robin device assignment for posts that don't have one yet.
  useEffect(() => {
    if (devices.length === 0) return;
    posts.forEach((p, i) => {
      if (!p.deviceId) {
        const dev = devices[i % devices.length]?.deviceId;
        if (dev) updatePost(batchId, p.id, { deviceId: dev });
      }
    });
  }, [devices, posts, batchId]);

  const openEditor = (post: XHSPost) => {
    const surfaceId = `sidebar:xhs-editor-${batchId}-${post.id}`;
    openWith(
      surfaceId,
      buildEditorSurface(surfaceId, batchId, post),
      onAction ?? (() => {}),
      {
        size: XHS_EDITOR_NODE_SIZE,
      },
    );
  };

  // Fan out every post as its own XHSEditor canvas node (grid layout). Each
  // node is bound to this batch via batchId/postId, so edits sync back to the
  // table rows; re-clicking refreshes existing nodes in place (upsert).
  const openAllInCanvas = () => {
    posts.forEach((post, i) => {
      const surfaceId = `sidebar:xhs-editor-${batchId}-${post.id}`;
      openWith(
        surfaceId,
        buildEditorSurface(surfaceId, batchId, post),
        onAction ?? (() => {}),
        {
          title: post.title || `帖子 ${i + 1}`,
          position: fanoutPosition(i),
          size: FANOUT_NODE,
        },
      );
    });
  };

  const publishOne = async (post: XHSPost): Promise<XHSPublishResultItem> => {
    try {
      await publishXhsPost(
        post.deviceId,
        {
          title: post.title,
          content: post.content,
          images: post.images,
          hashtags: post.hashtags,
        },
        (phase) => setRowStatus(batchId, post.id, phase),
      );
      setRowStatus(batchId, post.id, "success");
      return {
        postId: post.id,
        title: post.title,
        deviceId: post.deviceId,
        status: "success",
        message: "手机端已完成发布",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "发布失败";
      setRowStatus(batchId, post.id, "error", message);
      return {
        postId: post.id,
        title: post.title,
        deviceId: post.deviceId,
        status: "error",
        message,
      };
    }
  };

  const publishAll = async () => {
    // Posts on the SAME phone must publish serially: the device rejects a second
    // task while busy, and each post pushes its images then picks "the latest N"
    // from the gallery — running them concurrently would collide on both. Posts
    // on DIFFERENT phones run in parallel.
    const byDevice = new Map<string, XHSPost[]>();
    const preflightResults: XHSPublishResultItem[] = [];
    for (const post of posts) {
      if (
        post.status === "success" ||
        post.status === "pushing" ||
        post.status === "publishing"
      ) {
        continue;
      }
      if (!post.deviceId) {
        const message = "未分配在线设备";
        setRowStatus(batchId, post.id, "error", message);
        preflightResults.push({
          postId: post.id,
          title: post.title,
          deviceId: "",
          status: "error",
          message,
        });
        continue;
      }
      const group = byDevice.get(post.deviceId) ?? [];
      group.push(post);
      byDevice.set(post.deviceId, group);
    }

    const deviceResults = await Promise.all(
      [...byDevice.values()].map(async (group) => {
        const results: XHSPublishResultItem[] = [];
        for (const post of group) {
          results.push(await publishOne(post));
        }
        return results;
      }),
    );
    reportXhsPublishResults(onAction, {
      source: "batch",
      batchId,
      results: [...preflightResults, ...deviceResults.flat()],
    });
  };

  const batchPublishing = posts.some(
    (post) => post.status === "pushing" || post.status === "publishing",
  );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        border: "0.5px solid var(--color-border)",
        borderRadius: 12,
        background: "var(--color-surface-1, #fff)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--color-border)",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          批量发布 · {posts.length} 篇
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={openAllInCanvas}
            disabled={posts.length === 0}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "0.5px solid var(--color-border)",
              background: "var(--color-surface-1, #fff)",
              color: "var(--color-text-secondary, #666)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            在画布中编辑
          </button>
          <button
            type="button"
            onClick={() => {
              void publishAll();
            }}
            disabled={posts.length === 0 || batchPublishing}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "none",
              background: "#bb0028",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              cursor: batchPublishing ? "not-allowed" : "pointer",
            }}
          >
            {batchPublishing ? "发布中…" : "全部发布"}
          </button>
        </div>
      </div>

      {/* Fixed height — shows ~5 rows, scrolls beyond. */}
      <div style={{ maxHeight: 5 * 64, overflowY: "auto" }}>
        {posts.map((post) => (
          <div
            key={post.id}
            // biome-ignore lint/a11y/useSemanticElements: row contains a <select>, so it cannot be a <button> element; role+keydown gives equivalent semantics
            role="button"
            tabIndex={0}
            onClick={() => openEditor(post)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openEditor(post);
              }
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 1.4fr 1fr auto",
              gap: 10,
              alignItems: "center",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              borderBottom: "0.5px solid var(--color-border-subtle, #eee)",
              background: "transparent",
              cursor: "pointer",
              height: 64,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "var(--color-surface-2, #f5f5f5)",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#bbb",
                fontSize: 11,
              }}
            >
              {post.images[0] ? (
                <img
                  src={post.images[0]}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                "无图"
              )}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {post.title || "（未填标题）"}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary, #666)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {post.content || "（未填正文）"}
            </span>
            <select
              value={
                devices.some((d) => d.deviceId === post.deviceId)
                  ? post.deviceId
                  : ""
              }
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                updatePost(batchId, post.id, { deviceId: e.target.value });
              }}
              style={{
                fontSize: 12,
                padding: "3px 6px",
                maxWidth: "100%",
                borderRadius: 6,
                border: "0.5px solid var(--color-border)",
                background: "var(--color-surface-1, #fff)",
                color: "var(--color-text-secondary, #666)",
                cursor: "pointer",
              }}
            >
              {!devices.some((d) => d.deviceId === post.deviceId) && (
                <option value="">未分配</option>
              )}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.name || d.deviceId}
                </option>
              ))}
            </select>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: STATUS_COLOR[post.status],
                whiteSpace: "nowrap",
              }}
            >
              {STATUS_LABEL[post.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
