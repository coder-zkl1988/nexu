import { ExpertCardFace } from "@/components/experts/expert-card";
import type { MinimalExpert } from "@nexu/shared";
import { useState } from "react";
import type { CustomComponentProps } from "./registry";

/**
 * In-chat expert install card. Rendered when find_expert matches an uninstalled
 * expert: reuses the experts-page card face (ExpertCardFace) so the style stays
 * unified, and wires confirm/cancel to the A2UI action channel. On confirm the
 * model receives an "install_expert" action carrying { slug, question }.
 */
export function ExpertInstallCard({
  comp,
  resolve,
  onAction,
}: CustomComponentProps) {
  const expert = resolve(
    (comp as { expert?: MinimalExpert }).expert,
  ) as MinimalExpert | null;
  const question =
    (resolve((comp as { question?: string }).question) as string) || "";
  const [submitted, setSubmitted] = useState<"install" | "cancel" | null>(null);

  if (!expert?.slug) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-1">
      <p className="max-w-[260px] text-center text-[13px] text-text-secondary">
        为更好地回答你的问题，建议安装并调用这位专家
      </p>
      <div className="w-[240px]">
        <ExpertCardFace
          expert={expert}
          avatarUrl={expert.avatarDataUrl}
          footerActions={
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={submitted !== null}
                onClick={() => {
                  if (submitted) return;
                  setSubmitted("cancel");
                  onAction?.("install_expert_cancel", { slug: expert.slug });
                }}
                className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={submitted !== null}
                onClick={() => {
                  if (submitted) return;
                  setSubmitted("install");
                  onAction?.("install_expert", {
                    slug: expert.slug,
                    name: expert.name,
                    question,
                  });
                }}
                className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitted === "install" ? "安装中…" : "安装并调用"}
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
