/**
 * Lightweight lexical recall over the expert catalog, used to shortlist
 * candidates for teamless auto-dispatch (expert_run_auto). Mirrors the
 * find-expert runtime plugin's scoring (Latin words + CJK bigrams against
 * name/tags/category/description) so in-chat retrieval and controller-side
 * planning rank the catalog the same way.
 */

export type RecallableExpert = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  tags?: readonly string[];
};

export type RecalledExpert = {
  slug: string;
  name: string;
  description: string;
};

/** Tokenize a query into Latin words (>=2 chars) + CJK bigrams. */
export function tokenizeQuery(query: string): string[] {
  const q = query.toLowerCase();
  const tokens = new Set<string>();
  for (const word of q.split(/[^a-z0-9一-鿿]+/i)) {
    if (/[a-z0-9]/i.test(word) && word.length >= 2) {
      tokens.add(word);
    }
  }
  const cjk = q.replace(/[^一-鿿]/g, "");
  if (cjk.length === 1) {
    tokens.add(cjk);
  }
  for (let i = 0; i + 2 <= cjk.length; i++) {
    tokens.add(cjk.slice(i, i + 2));
  }
  return [...tokens];
}

function scoreExpert(expert: RecallableExpert, tokens: string[]): number {
  const fields = [
    { text: expert.name.toLowerCase(), weight: 5 },
    { text: (expert.tags ?? []).join(" ").toLowerCase(), weight: 3 },
    { text: (expert.category ?? "").toLowerCase(), weight: 2 },
    { text: (expert.description ?? "").toLowerCase(), weight: 1 },
  ];
  let score = 0;
  for (const token of tokens) {
    for (const field of fields) {
      if (field.text.includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

/**
 * Rank the catalog against the task and return the top candidates as a
 * planner roster. Scoreless experts are dropped; if nothing matches (e.g. a
 * task with no lexical overlap), fall back to the first `limit` experts so
 * the planner still has a roster to assign from.
 */
export function recallExperts(
  catalog: readonly RecallableExpert[],
  task: string,
  limit = 12,
): RecalledExpert[] {
  const tokens = tokenizeQuery(task);
  const ranked = catalog
    .map((expert) => ({ expert, score: scoreExpert(expert, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const picked = ranked.length > 0 ? ranked.map((r) => r.expert) : [];
  const fallback = picked.length === 0 ? catalog.slice(0, limit) : picked;
  return fallback.map((expert) => ({
    slug: expert.slug,
    name: expert.name,
    description: expert.description ?? "",
  }));
}
