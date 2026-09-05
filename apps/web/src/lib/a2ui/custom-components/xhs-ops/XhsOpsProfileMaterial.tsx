import { useEffect, useState } from "react";
import type { CustomComponentProps } from "../registry";
import { describeXhsOpsError, xhsOpsApi } from "./xhs-ops-api";
import { ProjectPicker, useProjectResolution } from "./xhs-ops-project-picker";
import {
  type XhsOpsAccount,
  type XhsOpsProfileDraft,
  type XhsOpsProfilePart,
  asString,
  mediaFileUrl,
  normalizeProfileDraft,
} from "./xhs-ops-types";
import {
  CardShell,
  ErrorLine,
  Field,
  HintLine,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  formatClock,
  inputClass,
  readProp,
  textareaClass,
} from "./xhs-ops-ui";

/**
 * Step 3b (P2-1): 账号基础资料与素材。昵称/简介由服务端文本生成，头像/背景各
 * 生成 3 张备选（已拍板：AI 备选优先，人工上传仅兜底），运营点选并可改；
 * 「应用到手机」把选中的图推到「Tabby」相册并下发资料维护任务——它改的是
 * 公开资料，只在运营点击时执行。上报 `xhs_ops_profile_applied`。
 */
export function XhsOpsProfileMaterial({
  comp,
  resolve,
  onAction,
}: CustomComponentProps) {
  const propProjectId = asString(readProp(comp, resolve, "projectId"));
  const projectName = asString(readProp(comp, resolve, "projectName")).trim();
  const resolution = useProjectResolution(propProjectId, projectName);
  const projectId = resolution.projectId;
  const onlyAccountId = asString(readProp(comp, resolve, "accountId")) || null;
  const [accounts, setAccounts] = useState<XhsOpsAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    xhsOpsApi
      .listAccounts(projectId)
      .then((list) => {
        if (cancelled) return;
        setAccounts(
          list.filter(
            (a) => a.deviceId && (!onlyAccountId || a.id === onlyAccountId),
          ),
        );
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts([]);
        setLoadError(describeXhsOpsError(err, "账号列表加载失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, onlyAccountId]);

  const replaceAccount = (updated: XhsOpsAccount) =>
    setAccounts((prev) =>
      prev ? prev.map((a) => (a.id === updated.id ? updated : a)) : prev,
    );

  return (
    <CardShell
      testId="profile-material"
      title="账号资料与素材"
      subtitle="昵称/简介由 AI 生成，头像/背景各 3 张备选；点选后「应用到手机」会修改该账号的公开资料"
    >
      <ErrorLine message={loadError ?? resolution.error} />
      {!projectId ? (
        <ProjectPicker
          resolution={resolution}
          wanted={projectName}
          purpose="生成资料"
        />
      ) : null}
      {projectId && accounts === null ? (
        <HintLine>正在加载账号…</HintLine>
      ) : null}
      {accounts && accounts.length === 0 && !loadError ? (
        <HintLine>没有已绑定手机的账号；先在账号配置里绑定设备。</HintLine>
      ) : null}
      <div className="flex flex-col gap-3">
        {(accounts ?? []).map((account) => (
          <ProfileMaterialRow
            key={account.id}
            account={account}
            onChange={replaceAccount}
            onAction={onAction}
          />
        ))}
      </div>
    </CardShell>
  );
}

type Busy = XhsOpsProfilePart | "save" | "apply" | null;

function ProfileMaterialRow({
  account,
  onChange,
  onAction,
}: {
  account: XhsOpsAccount;
  onChange: (updated: XhsOpsAccount) => void;
  onAction?: CustomComponentProps["onAction"];
}) {
  const [draft, setDraft] = useState<XhsOpsProfileDraft>(() =>
    normalizeProfileDraft(account.profileDraft),
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy !== null;

  const run = async (kind: Busy, fn: () => Promise<XhsOpsAccount>) => {
    setBusy(kind);
    setError(null);
    try {
      const updated = await fn();
      setDraft(normalizeProfileDraft(updated.profileDraft));
      onChange(updated);
      return updated;
    } catch (err) {
      setError(describeXhsOpsError(err, "操作失败"));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const generate = (part: XhsOpsProfilePart) =>
    run(part, () => xhsOpsApi.generateProfileDraft(account.id, [part]));

  const save = () =>
    run("save", () =>
      xhsOpsApi.updateAccount(account.id, { profileDraft: draft }),
    );

  const apply = async () => {
    const hasSomething =
      draft.nickname.trim() ||
      draft.bio.trim() ||
      draft.avatarPath ||
      draft.coverPath;
    if (!hasSomething) {
      setError("没有可应用的资料：先生成/填写昵称、简介或选择头像、背景图");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `将修改「${account.label}」在小红书上的公开资料（${[
          draft.nickname.trim() && "昵称",
          draft.bio.trim() && "简介",
          draft.avatarPath && "头像",
          draft.coverPath && "背景图",
        ]
          .filter(Boolean)
          .join("、")}），手机将自动操作约 2–5 分钟。确认应用？`,
      )
    ) {
      return;
    }
    // 先持久化当前编辑与点选，再让手机按落库内容执行
    const saved = await run("save", () =>
      xhsOpsApi.updateAccount(account.id, { profileDraft: draft }),
    );
    if (!saved) return;
    const applied = await run("apply", () =>
      xhsOpsApi.applyProfileDraft(account.id),
    );
    if (applied) {
      const d = normalizeProfileDraft(applied.profileDraft);
      onAction?.("xhs_ops_profile_applied", {
        accountId: account.id,
        label: account.label,
        status: d.applyStatus,
        result: d.applyResult,
        agentInstruction:
          d.applyStatus === "applied"
            ? "资料已在手机上应用完成，不要重复应用；可提示用户核对「我」页展示。"
            : "资料只应用了一部分或失败（见 result）。说明哪些字段没成功、可能原因（修改次数限制/敏感词/相册权限），询问是否重试对应字段；不要自动重试。",
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-0/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>{account.label}</SectionTitle>
        <span className="text-[11px] text-text-tertiary">
          {account.deviceName ?? account.deviceId}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Field label="昵称">
          <input
            className={inputClass}
            value={draft.nickname}
            maxLength={20}
            disabled={disabled}
            placeholder="点右侧「生成」由 AI 起名"
            onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
          />
        </Field>
        <Field label="简介（星座+MBTI / 自我介绍 / 兴趣介绍）">
          <textarea
            className={textareaClass}
            rows={3}
            value={draft.bio}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton
          onClick={() => void generate("text")}
          disabled={disabled}
        >
          {busy === "text" ? "生成中…" : "生成昵称与简介"}
        </SecondaryButton>
        <HintLine>生成结果可直接改；不含营销话术与联系方式。</HintLine>
      </div>

      <CandidateRow
        title="头像（人物半身照 + 自然环境背景）"
        candidates={draft.avatarCandidates}
        selected={draft.avatarPath}
        square
        busy={busy === "avatar"}
        disabled={disabled}
        onGenerate={() => void generate("avatar")}
        onSelect={(p) => setDraft({ ...draft, avatarPath: p })}
      />
      <CandidateRow
        title="背景图（知名地区风景 + 人物背身）"
        candidates={draft.coverCandidates}
        selected={draft.coverPath}
        busy={busy === "cover"}
        disabled={disabled}
        onGenerate={() => void generate("cover")}
        onSelect={(p) => setDraft({ ...draft, coverPath: p })}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="text-[11px] text-text-tertiary">
          {draft.generatedAt ? (
            <span>生成 {formatClock(Date.parse(draft.generatedAt))}</span>
          ) : null}
          {draft.appliedAt ? (
            <span className="ml-2">
              应用 {formatClock(Date.parse(draft.appliedAt))}
              {draft.applyStatus ? `（${APPLY_LABEL[draft.applyStatus]}）` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => void save()} disabled={disabled}>
            {busy === "save" ? "保存中…" : "保存草稿"}
          </SecondaryButton>
          <PrimaryButton onClick={() => void apply()} disabled={disabled}>
            {busy === "apply" ? "手机执行中…" : "应用到手机"}
          </PrimaryButton>
        </div>
      </div>
      {draft.applyResult ? (
        <div
          data-testid="profile-apply-result"
          className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[11px] text-text-secondary"
        >
          手机回报：{draft.applyResult}
        </div>
      ) : null}
      <ErrorLine message={error} />
    </div>
  );
}

const APPLY_LABEL: Record<"applied" | "partial" | "failed", string> = {
  applied: "全部完成",
  partial: "部分完成",
  failed: "失败",
};

function CandidateRow({
  title,
  candidates,
  selected,
  square,
  busy,
  disabled,
  onGenerate,
  onSelect,
}: {
  title: string;
  candidates: string[];
  selected: string | null;
  square?: boolean;
  busy: boolean;
  disabled: boolean;
  onGenerate: () => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium">{title}</span>
        <SecondaryButton onClick={onGenerate} disabled={disabled}>
          {busy
            ? "生成中（约 1 分钟）…"
            : candidates.length
              ? "重新生成 3 张备选"
              : "生成 3 张备选"}
        </SecondaryButton>
      </div>
      {candidates.length === 0 ? (
        <HintLine>还没有备选图。</HintLine>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.map((p) => {
            const isSelected = selected === p;
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(p)}
                aria-pressed={isSelected}
                className={`overflow-hidden rounded-md border-2 ${
                  isSelected ? "border-accent" : "border-transparent"
                } ${square ? "h-20 w-20" : "h-20 w-36"} bg-surface-1`}
              >
                <img
                  src={mediaFileUrl(p)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
