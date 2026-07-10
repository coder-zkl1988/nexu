// find-expert runtime plugin: in-chat expert auto-routing.
//   - find_expert(query): rank the Nexu expert catalog (retrieval only).
//   - propose_expert_install(...): render an A2UI install card for an
//     uninstalled match.
//   - install_expert(...): install an expert on user confirm, then the model
//     delegates to it via native sessions_spawn.
// See specs/design-docs/2026-06-30-in-chat-expert-auto-route.md.

const CATALOG_PATH = "/api/v1/experthub/catalog";
const INSTALL_PATH = "/api/v1/experthub/install";
const CACHE_TTL_MS = 30_000;
const MAX_MATCHES = 5;
// Time to let OpenClaw hot-reload a freshly installed expert into agents.list
// before the model delegates to it.
const INSTALL_SETTLE_MS = 2500;

/** @type {{ ts: number, experts: Array<object>, installedSlugs: Set<string>, installedBySlug: Map<string,string> } | null} */
let catalogCache = null;
/** Controller base URL, injected via plugin config by the compiler. */
let configuredControllerUrl = null;

function controllerOrigin() {
  const raw =
    configuredControllerUrl ||
    process.env.WEB_API_ORIGIN ||
    process.env.NEXU_CONTROLLER_URL ||
    process.env.CONTROLLER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

function jsonResult(value, isError) {
  const result = { content: [{ type: "text", text: JSON.stringify(value) }] };
  if (isError) {
    result.isError = true;
  }
  return result;
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

// Catalog that hosts Nexu's custom A2UI components (registered in the web app
// at apps/web/src/lib/a2ui/index.ts).
const NEXU_A2UI_CATALOG = "https://nexu.app/a2ui/custom-catalog.json";

/** Build A2UI v0.9 JSONL (createSurface + updateComponents). */
function generateA2UIJSONL(surfaceId, components, catalogId) {
  const createSurface = catalogId
    ? { surfaceId, catalogId }
    : { surfaceId };
  return [
    JSON.stringify({ version: "v0.9", createSurface }),
    JSON.stringify({
      version: "v0.9",
      updateComponents: { surfaceId, components },
    }),
  ].join("\n");
}

/**
 * An install card for an uninstalled expert, rendered with the ExpertInstallCard
 * custom component so it reuses the experts-page card style. The component wires
 * its own confirm/cancel buttons to the install_expert / install_expert_cancel
 * actions; we only pass the expert data + the question to run after install.
 */
export function buildInstallCard(expert, question) {
  const surfaceId = `expert-install-${expert.slug}`;
  const components = [
    {
      id: "install-card",
      type: "ExpertInstallCard",
      expert: {
        slug: String(expert.slug || ""),
        name: String(expert.name || ""),
        emoji: String(expert.emoji || "🧩"),
        category: String(expert.category || ""),
        description: String(expert.description || ""),
        tags: Array.isArray(expert.tags) ? expert.tags : [],
        ...(expert.avatarDataUrl
          ? { avatarDataUrl: String(expert.avatarDataUrl) }
          : {}),
      },
      question: String(question || ""),
    },
  ];
  return generateA2UIJSONL(surfaceId, components, NEXU_A2UI_CATALOG);
}

async function installExpert(slug) {
  const origin = controllerOrigin();
  if (!origin) {
    return { ok: false, error: "controller unavailable" };
  }
  try {
    const res = await fetch(`${origin}${INSTALL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) {
      return { ok: false, error: `install failed (${res.status})` };
    }
    const data = await res.json();
    return { ok: true, botId: data.botId, slug: data.slug };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

const FIND_EXPERT_DESCRIPTION = `Search the Nexu expert catalog for a domain specialist that fits the user's request.

WHEN TO USE:
- Call this when the user's question would be answered noticeably better by a domain specialist than by you, and you are not already that specialist.
- Answer simple, general, or conversational questions yourself — do NOT route those.

RESULT: top matching experts, each as { slug, name, description, installed, agentId }.

WHAT TO DO WITH THE RESULT (act with a tool call — do NOT just describe what you will do):
- Strong match INSTALLED (installed:true, has agentId): immediately call sessions_spawn({ agentId, task: "<the user's request plus any needed context>" }), then sessions_yield, and relay the expert's answer (you may briefly note which expert you consulted).
- Strong match NOT installed (installed:false): you MUST call propose_expert_install({ slug, name, description, question }) to show the install card and then STOP and wait. Do NOT call install_expert yourself, do NOT auto-install, and do NOT answer the question yourself — the user installs by clicking the card.
- No good match: answer as best you can yourself.`;

const PROPOSE_INSTALL_DESCRIPTION = `Render an install card in the chat for an UNINSTALLED expert that find_expert matched. Call this (instead of answering) when the best match has installed:false. Pass the user's original question so it can be answered after install. The user confirms in the card; on confirm you will receive an "install_expert" action carrying { slug, question } in your next message — then call the install_expert tool.`;

const INSTALL_EXPERT_DESCRIPTION = `Install an expert by slug, then delegate to it. ONLY call this AFTER the user confirms by clicking the install card — i.e. when you receive an "install_expert" action message carrying { slug, question }. NEVER call it proactively or to auto-install without that confirmation. On success it returns { installed:true, agentId, slug }; then delegate to that agent with sessions_spawn({ agentId, task: "<the user's original question>" }), call sessions_yield, and relay the answer. If installed:false, tell the user the install failed.`;

const plugin = {
  id: "find-expert",
  name: "Nexu Find Expert",
  description:
    "Registers find_expert / propose_expert_install / install_expert for in-chat expert auto-routing.",
  register(api) {
    const cfg = api && api.pluginConfig;
    if (cfg && typeof cfg.controllerUrl === "string" && cfg.controllerUrl) {
      configuredControllerUrl = cfg.controllerUrl;
    }
    api.registerTool({
      name: "find_expert",
      label: "Find Expert",
      description: FIND_EXPERT_DESCRIPTION,
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
        return jsonResult(await findExperts(params?.query));
      },
    });

    api.registerTool({
      name: "propose_expert_install",
      label: "Propose Expert Install",
      description: PROPOSE_INSTALL_DESCRIPTION,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          question: {
            type: "string",
            description: "The user's original question, to run after install.",
          },
        },
        required: ["slug", "name"],
      },
      async execute(_toolCallId, params) {
        const slug = String(params?.slug || "");
        // Enrich from the catalog so the card shows the full expert face
        // (emoji, category, tags, avatar); fall back to the model-supplied
        // fields if the catalog is unavailable.
        const cat = await loadCatalog();
        const full = cat?.experts?.find((e) => e.slug === slug);
        const expert = full || {
          slug,
          name: String(params?.name || ""),
          description: String(params?.description || ""),
        };
        const jsonl = buildInstallCard(expert, String(params?.question || ""));
        return {
          content: [{ type: "text", text: ["```a2ui", jsonl, "```"].join("\n") }],
        };
      },
    });

    api.registerTool({
      name: "install_expert",
      label: "Install Expert",
      description: INSTALL_EXPERT_DESCRIPTION,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: { type: "string" },
          question: { type: "string" },
        },
        required: ["slug"],
      },
      async execute(_toolCallId, params) {
        const result = await installExpert(String(params?.slug || ""));
        if (!result.ok) {
          return jsonResult({ installed: false, error: result.error }, true);
        }
        catalogCache = null; // refresh so find_expert sees it installed
        await new Promise((resolve) => setTimeout(resolve, INSTALL_SETTLE_MS));
        return jsonResult({
          installed: true,
          agentId: result.botId,
          slug: result.slug,
          next: "Delegate now: sessions_spawn({ agentId, task: <the user's original question> }), then sessions_yield, then relay the answer.",
        });
      },
    });
  },
};

export default plugin;
