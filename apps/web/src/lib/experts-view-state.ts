export type ExpertsTab = "explore" | "yours";

export type ExpertsViewState = {
  tab: ExpertsTab;
  tag: string | null;
  q: string;
};

export function parseExpertsViewState(
  params: URLSearchParams,
): ExpertsViewState {
  const tabRaw = params.get("tab");
  const tab: ExpertsTab = tabRaw === "yours" ? "yours" : "explore";
  return {
    tab,
    tag: params.get("tag"),
    q: params.get("q") ?? "",
  };
}

export function serializeExpertsViewState(state: ExpertsViewState): string {
  const params = new URLSearchParams();
  if (state.tab !== "explore") params.set("tab", state.tab);
  if (state.tag) params.set("tag", state.tag);
  if (state.q) params.set("q", state.q);
  return params.toString();
}
