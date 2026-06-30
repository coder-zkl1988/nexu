// find-expert runtime plugin: registers the `find_expert` tool, which ranks the
// Nexu expert catalog by keyword/tag overlap so a chat bot can auto-route a
// question to a domain specialist. Retrieval only — delegation is native
// (sessions_spawn). See specs/design-docs/2026-06-30-in-chat-expert-auto-route.md.

const CATALOG_PATH = "/api/v1/experthub/catalog";
const CACHE_TTL_MS = 30_000;
const MAX_MATCHES = 5;

/** @type {{ ts: number, experts: Array<object>, installedSlugs: Set<string>, installedBySlug: Map<string,string> } | null} */
let catalogCache = null;

function controllerOrigin() {
  const raw =
    process.env.WEB_API_ORIGIN ||
    process.env.NEXU_CONTROLLER_URL ||
    process.env.CONTROLLER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

async function loadCatalog() {
  if (catalogCache && Date.now() - catalogCache.ts < CACHE_TTL_MS) {
    return catalogCache;
  }
  const origin = controllerOrigin();
  if (!origin) {
    return catalogCache;
  }
  try {
    const res = await fetch(`${origin}${CATALOG_PATH}`);
    if (!res.ok) {
      return catalogCache;
    }
    const data = await res.json();
    catalogCache = {
      ts: Date.now(),
      experts: Array.isArray(data.experts) ? data.experts : [],
      installedSlugs: new Set(
        Array.isArray(data.installedSlugs) ? data.installedSlugs : [],
      ),
      installedBySlug: new Map(
        (Array.isArray(data.installedExperts) ? data.installedExperts : []).map(
          (e) => [e.slug, e.botId],
        ),
      ),
    };
    return catalogCache;
  } catch {
    return catalogCache;
  }
}

/** Tokenize a query into Latin words (>=2 chars) + CJK bigrams. */
function tokenize(query) {
  const q = String(query || "").toLowerCase();
  const tokens = new Set();
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

function scoreExpert(expert, tokens) {
  const fields = [
    { text: String(expert.name || "").toLowerCase(), weight: 5 },
    { text: (expert.tags || []).join(" ").toLowerCase(), weight: 3 },
    { text: String(expert.category || "").toLowerCase(), weight: 2 },
    { text: String(expert.description || "").toLowerCase(), weight: 1 },
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

async function findExperts(query) {
  const cat = await loadCatalog();
  if (!cat) {
    return { matches: [], note: "expert catalog unavailable" };
  }
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return { matches: [] };
  }
  const ranked = cat.experts
    .map((expert) => ({ expert, score: scoreExpert(expert, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES);
  return {
    matches: ranked.map(({ expert }) => ({
      slug: expert.slug,
      name: expert.name,
      description: expert.description || "",
      installed: cat.installedSlugs.has(expert.slug),
      agentId: cat.installedBySlug.get(expert.slug) || null,
    })),
  };
}

const TOOL_DESCRIPTION = `Search the Nexu expert catalog for a domain specialist that fits the user's request.

WHEN TO USE:
- Call this when the user's question would be answered noticeably better by a domain specialist than by you, and you are not already that specialist.
- Answer simple, general, or conversational questions yourself — do NOT route those.

RESULT: top matching experts, each as { slug, name, description, installed, agentId }.

WHAT TO DO WITH THE RESULT:
- If a strong match is installed (installed:true, has agentId): delegate ONE turn to it with sessions_spawn({ agentId, task: "<the user's request plus any needed context>" }), then call sessions_yield to wait, and relay the expert's answer to the user (you may briefly note which expert you consulted).
- If the best match is NOT installed (installed:false): tell the user that a matching expert ("name") is available and ask whether to install and use it. Do NOT fabricate the expert's answer yourself.
- If there is no good match: just answer as best you can yourself.`;

const plugin = {
  id: "find-expert",
  name: "Nexu Find Expert",
  description:
    "Registers the find_expert tool for auto-routing chat questions to a matching domain expert.",
  register(api) {
    api.registerTool({
      name: "find_expert",
      label: "Find Expert",
      description: TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "The user's need or topic to find a matching expert for.",
          },
        },
        required: ["query"],
      },
      async execute(_toolCallId, params) {
        const result = await findExperts(params?.query);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    });
  },
};

export default plugin;
