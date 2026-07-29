import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  CatalogRevisionChangedError,
  hasPollingQueueItems,
  isCatalogRevisionChangedResponse,
  resetCatalogPaginationOnRevisionChange,
} from "../src/hooks/use-community-catalog";
import type { QueueItem, QueueItemStatus } from "../src/types/desktop";

function queueItem(status: QueueItemStatus): QueueItem {
  return {
    slug: "weather",
    ownerHandle: "publisher",
    source: "managed",
    status,
    position: 0,
    error: status === "failed" ? "network error" : undefined,
    errorCode: status === "failed" ? "unknown" : null,
    enqueuedAt: "2026-07-29T00:00:00.000Z",
  };
}

describe("SkillHub queue polling", () => {
  it("recognizes a stale catalog cursor response", () => {
    expect(
      isCatalogRevisionChangedResponse({
        error: "Catalog revision changed; restart pagination",
        code: "catalog_revision_changed",
      }),
    ).toBe(true);
    expect(isCatalogRevisionChangedResponse({ code: "other" })).toBe(false);
  });

  it("resets stale infinite pages and refetches from the first page", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ["skillhub", "catalog-page", "", "", "downloads"];
    const pageParams: Array<string | undefined> = [];
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey,
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => {
        pageParams.push(pageParam);
        return {
          skills: [],
          nextCursor: pageParam ? null : "stale-cursor",
        };
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
    const unsubscribe = observer.subscribe(() => {});

    await observer.refetch();
    await observer.fetchNextPage();
    expect(pageParams).toEqual([undefined, "stale-cursor"]);

    pageParams.length = 0;
    await resetCatalogPaginationOnRevisionChange(
      queryClient,
      queryKey,
      new CatalogRevisionChangedError(),
    );

    expect(pageParams).toEqual([undefined]);
    unsubscribe();
    queryClient.clear();
  });

  it.each(["queued", "downloading", "installing-deps"] as const)(
    "continues while a queue item is %s",
    (status) => {
      expect(hasPollingQueueItems({ queue: [queueItem(status)] })).toBe(true);
    },
  );

  it.each(["done", "failed"] as const)(
    "stops for terminal status %s",
    (status) => {
      expect(hasPollingQueueItems({ queue: [queueItem(status)] })).toBe(false);
    },
  );
});
