import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "../registry";
import { describeXhsOpsError, xhsOpsApi } from "./xhs-ops-api";
import {
  type XhsOpsAccount,
  type XhsOpsBrowseDefaults,
  type XhsOpsInteractionConfig,
  type XhsOpsInteractionRule,
  type XhsOpsInterestPool,
  type XhsOpsPersona,
  asString,
  defaultBrowseDefaults,
  defaultInteractionConfig,
  emptyInterestPool,
  emptyPersona,
  findPersonaOverlaps,
  normalizeBrowseDefaults,
  normalizeInteractionConfig,
  normalizeInterestPool,
  normalizePersona,
  personaSummary,
} from "./xhs-ops-types";
import {
  CardShell,
  ChipInput,
  DEVICE_STATE_LABEL,
  ErrorLine,
  Field,
  HintLine,
  NumberInput,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  type XhsOpsDevice,
  deviceDisplayName,
  deviceOnlineState,
  formatClock,
  inputClass,
  readProp,
  selectClass,
  useXhsOpsDevices,
} from "./xhs-ops-ui";

interface Suggestion {
  label: string;
  positioning: string;
  persona: XhsOpsPersona;
  interestPool: XhsOpsInterestPool;
}

interface AccountRow {
  /** Stable local key (server id is null until the first save). */
  key: string;
  id: string | null;
  label: string;
  positioning: string;
  persona: XhsOpsPersona;
  deviceId: string;
  interestPool: XhsOpsInterestPool;
  interaction: XhsOpsInteractionConfig;
  browseDefaults: XhsOpsBrowseDefaults;
  expanded: boolean;
  error: string | null;
  savedAt: number | null;
}

let rowSeq = 0;
function nextKey(): string {
  rowSeq += 1;
  return `row-${Date.now()}-${rowSeq}`;
}

function normalizeSuggestions(raw: unknown): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const s =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        label: asString(s.label).trim().slice(0, 40),
        positioning: asString(s.positioning).trim(),
        persona: normalizePersona(s.persona),
        interestPool: normalizeInterestPool(s.interestPool),
      };
    })
    .filter((s) => s.label.length > 0);
}

function rowFromAccount(account: XhsOpsAccount): AccountRow {
  return {
    key: `acct-${account.id}`,
    id: account.id,
    label: account.label ?? "",
    positioning: account.positioning ?? "",
    persona: normalizePersona(account.persona),
    deviceId: account.deviceId ?? "",
    interestPool: normalizeInterestPool(account.interestPool),
    interaction: normalizeInteractionConfig(account.interaction),
    browseDefaults: normalizeBrowseDefaults(account.browseDefaults),
    expanded: false,
    error: null,
    savedAt: null,
  };
}

function rowFromSuggestion(s: Suggestion): AccountRow {
  return {
    key: nextKey(),
    id: null,
    label: s.label,
    positioning: s.positioning,
    persona: s.persona,
    deviceId: "",
    interestPool: s.interestPool,
    interaction: defaultInteractionConfig(),
    browseDefaults: defaultBrowseDefaults(),
    expanded: true,
    error: null,
    savedAt: null,
  };
}

function blankRow(): AccountRow {
  return rowFromSuggestion({
    label: "",
    positioning: "",
    persona: emptyPersona(),
    interestPool: emptyInterestPool(),
  });
}

const RULE_LABEL: Record<"like" | "collect" | "follow", string> = {
  like: "点赞",
  collect: "收藏",
  follow: "关注",
};

/**
 * Step 3: per-account configuration. Lists the project's existing accounts
 * plus the agent's positioning suggestions (one-click add); each row edits
 * label / positioning / target phone / three-tier interest pool / interaction
 * caps / browse defaults. 「保存账号配置」POSTs new rows and PATCHes existing
 * ones, then reports `xhs_ops_accounts_saved`.
 */
export function XhsOpsAccountPlanner({
  comp,
  resolve,
  onAction,
}: CustomComponentProps) {
  const projectId = asString(readProp(comp, resolve, "projectId"));
  const rawSuggestions = readProp(comp, resolve, "suggestions");
  const suggestionsKey = JSON.stringify(rawSuggestions ?? []);
  const suggestions = useMemo(
    () => normalizeSuggestions(JSON.parse(suggestionsKey)),
    [suggestionsKey],
  );

  const { devices, error: devicesError } = useXhsOpsDevices();

  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reportedAt, setReportedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setLoadError("缺少 projectId，无法加载账号");
      return;
    }
    let cancelled = false;
    setLoading(true);
    xhsOpsApi
      .listAccounts(projectId)
      .then((accounts) => {
        if (cancelled) return;
        setRows((prev) => {
          const drafts = prev.filter((r) => r.id === null);
          return [...accounts.map(rowFromAccount), ...drafts];
        });
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(describeXhsOpsError(err, "账号列表加载失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const patchRow = (key: string, patch: Partial<AccountRow>) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const addSuggestion = (s: Suggestion) =>
    setRows((prev) => [...prev, rowFromSuggestion(s)]);

  const addedLabels = new Set(rows.map((r) => r.label.trim()));
  const pendingSuggestions = suggestions.filter(
    (s) => !addedLabels.has(s.label),
  );

  const removeRow = async (row: AccountRow) => {
    if (row.id === null) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`删除账号「${row.label || row.id}」及其运行记录？`)
    ) {
      return;
    }
    try {
      await xhsOpsApi.deleteAccount(row.id);
      setRows((prev) => prev.filter((r) => r.key !== row.key));
    } catch (err) {
      patchRow(row.key, { error: describeXhsOpsError(err, "删除失败") });
    }
  };

  const deviceById = new Map(devices.map((d) => [d.deviceId, d]));
  // P1-3 人设差异检查：两两比对，告警只提示不阻断，随保存动作一并回传给 agent。
  const overlapWarnings = useMemo(
    () =>
      findPersonaOverlaps(
        rows.map((r) => ({
          key: r.key,
          label: r.label,
          persona: r.persona,
          interestPool: r.interestPool,
        })),
      ),
    [rows],
  );
  const overlapCount = overlapWarnings.size;

  const saveAll = async () => {
    if (!projectId) {
      setFormError("缺少 projectId，无法保存");
      return;
    }
    if (rows.length === 0) {
      setFormError("请先添加至少一个账号");
      return;
    }
    setSaving(true);
    setFormError(null);
    const saved: Array<{
      id: string;
      label: string;
      deviceId: string | null;
      deviceName: string | null;
      warnings: string[];
    }> = [];
    let failed = 0;

    for (const row of rows) {
      const label = row.label.trim();
      if (!label) {
        patchRow(row.key, { error: "请填写账号定位名" });
        failed += 1;
        continue;
      }
      const device = row.deviceId ? deviceById.get(row.deviceId) : undefined;
      const deviceName = device ? deviceDisplayName(device) : null;
      const body = {
        label: label.slice(0, 40),
        positioning: row.positioning.trim(),
        persona: row.persona,
        deviceId: row.deviceId || null,
        deviceName: row.deviceId ? deviceName : null,
        interestPool: row.interestPool,
        interaction: {
          ...row.interaction,
          comment: { enabled: false as const },
        },
        browseDefaults: row.browseDefaults,
      };
      try {
        const account = row.id
          ? await xhsOpsApi.updateAccount(row.id, body)
          : await xhsOpsApi.createAccount(projectId, { projectId, ...body });
        patchRow(row.key, {
          id: account.id,
          error: null,
          savedAt: Date.now(),
        });
        saved.push({
          id: account.id,
          label: account.label,
          deviceId: account.deviceId ?? null,
          deviceName: account.deviceName ?? null,
          warnings: overlapWarnings.get(row.key) ?? [],
        });
      } catch (err) {
        patchRow(row.key, { error: describeXhsOpsError(err, "保存失败") });
        failed += 1;
      }
    }

    setSaving(false);
    if (failed > 0) {
      setFormError(
        `${failed} 个账号保存失败，请修正后再点「保存账号配置」（已保存的账号会按更新处理）`,
      );
      return;
    }
    setReportedAt(Date.now());
    const overlapReport = saved
      .filter((a) => a.warnings.length > 0)
      .map((a) => ({ id: a.id, label: a.label, warnings: a.warnings }));
    onAction?.("xhs_ops_accounts_saved", {
      projectId,
      accounts: saved,
      overlapWarnings: overlapReport,
      agentInstruction:
        overlapReport.length > 0
          ? "部分人设相似度过高（见 overlapWarnings）。请指出哪些账号相似、建议如何拉开差异，并询问是否对这些账号重新生成人设；不要自动改动已保存账号。"
          : "人设差异检查通过，可以进入当日计划。",
    });
  };

  const disabled = saving || loading;
  const missingDeviceCount = rows.filter((r) => !r.deviceId).length;

  return (
    <CardShell
      testId="account-planner"
      title={`账号配置 · ${rows.length} 个账号`}
      subtitle="账号定位只描述内容方向与风格；每个账号绑定一台手机执行浏览任务"
      actions={
        <SecondaryButton
          onClick={() => setRows((prev) => [...prev, blankRow()])}
          disabled={disabled}
        >
          <Plus size={12} /> 新增账号
        </SecondaryButton>
      }
      footer={
        <>
          <div className="min-w-0 text-[11px] text-text-tertiary">
            {reportedAt
              ? `已保存 ${formatClock(reportedAt)} · 等待 AI 生成今日关键词计划`
              : missingDeviceCount > 0
                ? `${missingDeviceCount} 个账号未绑定设备，未绑定的账号无法执行任务`
                : "保存后 AI 将为每个账号挑选当日关键词"}
          </div>
          <PrimaryButton onClick={() => void saveAll()} disabled={disabled}>
            {saving ? "保存中…" : "保存账号配置"}
          </PrimaryButton>
        </>
      }
    >
      {loading ? <HintLine>正在加载已有账号…</HintLine> : null}
      <ErrorLine message={loadError} />
      <ErrorLine message={formError} />
      {devicesError ? <HintLine>{devicesError}</HintLine> : null}

      {pendingSuggestions.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle hint="点「加入」变成可编辑的账号行">
              AI 建议的账号定位
            </SectionTitle>
            <SecondaryButton
              onClick={() => {
                for (const s of pendingSuggestions) addSuggestion(s);
              }}
              disabled={disabled}
            >
              全部加入
            </SecondaryButton>
          </div>
          {pendingSuggestions.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-[12px]">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{s.label}</span>
                {personaSummary(s.persona) ? (
                  <span className="ml-1.5 text-text-tertiary">
                    {personaSummary(s.persona)}
                  </span>
                ) : null}
                {s.positioning ? (
                  <span className="ml-1.5 text-text-secondary">
                    {s.positioning}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={() => addSuggestion(s)}
                disabled={disabled}
              >
                加入
              </SecondaryButton>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length === 0 && !loading ? (
        <HintLine>还没有账号。加入 AI 建议或点「新增账号」。</HintLine>
      ) : null}
      {overlapCount > 0 ? (
        <HintLine>
          {overlapCount} 个账号存在人设相似告警（不影响保存；保存后 AI
          会给出拉开差异的建议）。
        </HintLine>
      ) : null}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <AccountRowEditor
            key={row.key}
            row={row}
            devices={devices}
            disabled={disabled}
            onPatch={(patch) => patchRow(row.key, patch)}
            onRemove={() => void removeRow(row)}
            warnings={overlapWarnings.get(row.key) ?? []}
          />
        ))}
      </div>
    </CardShell>
  );
}

function AccountRowEditor({
  row,
  devices,
  disabled,
  onPatch,
  onRemove,
  warnings,
}: {
  row: AccountRow;
  devices: XhsOpsDevice[];
  disabled: boolean;
  onPatch: (patch: Partial<AccountRow>) => void;
  onRemove: () => void;
  warnings: string[];
}) {
  const sortedDevices = [...devices].sort((a, b) => {
    const order: Record<string, number> = { online: 0, busy: 1, offline: 2 };
    return (
      (order[deviceOnlineState(a)] ?? 3) - (order[deviceOnlineState(b)] ?? 3)
    );
  });
  const selectedKnown = devices.some((d) => d.deviceId === row.deviceId);
  const selected = devices.find((d) => d.deviceId === row.deviceId);

  const patchRule = (
    name: "like" | "collect" | "follow",
    patch: Partial<XhsOpsInteractionRule>,
  ) =>
    onPatch({
      interaction: {
        ...row.interaction,
        [name]: { ...row.interaction[name], ...patch },
      },
    });

  const patchBrowse = (patch: Partial<XhsOpsBrowseDefaults>) =>
    onPatch({ browseDefaults: { ...row.browseDefaults, ...patch } });

  const patchPool = (patch: Partial<XhsOpsInterestPool>) =>
    onPatch({ interestPool: { ...row.interestPool, ...patch } });
  const patchPersona = (patch: Partial<XhsOpsPersona>) =>
    onPatch({ persona: { ...row.persona, ...patch } });
  const PERSONA_FIELDS: Array<[keyof XhsOpsPersona, string, string]> = [
    ["age", "年龄", "32岁"],
    ["gender", "性别", "女"],
    ["region", "地区", "北京海淀"],
    ["occupation", "职业/身份", "互联网产品经理"],
    ["lifeStatus", "生活状态", "2岁娃新手妈妈"],
  ];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-0/40 p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(120px,0.9fr)_auto] sm:items-end">
        <Field label="账号定位名 *">
          <input
            className={inputClass}
            value={row.label}
            maxLength={40}
            disabled={disabled}
            placeholder="如：北京亲子周末号"
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </Field>
        <Field label="内容方向与风格">
          <input
            className={inputClass}
            value={row.positioning}
            disabled={disabled}
            placeholder="一句话，如：周末亲子酒店实测，轻松口语风"
            onChange={(e) => onPatch({ positioning: e.target.value })}
          />
        </Field>
        <Field label="执行设备">
          <select
            className={selectClass}
            value={
              selectedKnown ? row.deviceId : row.deviceId ? "__unknown" : ""
            }
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__unknown") return;
              onPatch({ deviceId: value });
            }}
          >
            <option value="">未绑定</option>
            {!selectedKnown && row.deviceId ? (
              <option value="__unknown">{row.deviceId}（未连接）</option>
            ) : null}
            {sortedDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceDisplayName(d)} ·{" "}
                {DEVICE_STATE_LABEL[deviceOnlineState(d)]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-1 pb-0.5">
          <button
            type="button"
            aria-label={row.expanded ? "收起详细配置" : "展开详细配置"}
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-secondary hover:bg-surface-2"
            onClick={() => onPatch({ expanded: !row.expanded })}
          >
            {row.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            aria-label="删除账号"
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-tertiary hover:bg-red-500/10 hover:text-red-600"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
        <span>
          兴趣池 核心 {row.interestPool.core.length} · 相邻{" "}
          {row.interestPool.extended.length} · 泛{" "}
          {row.interestPool.general.length}
        </span>
        <span>
          互动{" "}
          {(["like", "collect", "follow"] as const)
            .filter((k) => row.interaction[k].enabled)
            .map((k) => `${RULE_LABEL[k]}≤${row.interaction[k].dailyCap}`)
            .join(" ") || "关闭"}
        </span>
        {selected ? (
          <span>设备 {DEVICE_STATE_LABEL[deviceOnlineState(selected)]}</span>
        ) : null}
        {row.savedAt ? <span>已保存 {formatClock(row.savedAt)}</span> : null}
      </div>
      {warnings.length > 0 ? (
        <div
          data-testid="persona-overlap"
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-600"
        >
          人设相似：{warnings.join("；")}
        </div>
      ) : null}
      <ErrorLine message={row.error} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PERSONA_FIELDS.map(([key, label, placeholder]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              value={row.persona[key]}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(e) => patchPersona({ [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {row.expanded ? (
        <div className="flex flex-col gap-3 border-t border-border pt-2">
          <div className="flex flex-col gap-1.5">
            <SectionTitle hint="core 来自垂直兴趣，extended 相邻话题，general 来自泛兴趣">
              三层兴趣池
            </SectionTitle>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="核心（core）">
                <ChipInput
                  value={row.interestPool.core}
                  disabled={disabled}
                  placeholder="回车添加"
                  onChange={(core) => patchPool({ core })}
                />
              </Field>
              <Field label="相邻（extended）">
                <ChipInput
                  value={row.interestPool.extended}
                  disabled={disabled}
                  placeholder="回车添加"
                  onChange={(extended) => patchPool({ extended })}
                />
              </Field>
              <Field label="泛兴趣（general）">
                <ChipInput
                  value={row.interestPool.general}
                  disabled={disabled}
                  placeholder="回车添加"
                  onChange={(general) => patchPool({ general })}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionTitle hint="每日上限为 0–50 次；比例为互动帖子占浏览数的百分比">
              互动配置
            </SectionTitle>
            <div className="flex flex-col gap-1.5">
              {(["like", "collect", "follow"] as const).map((name) => {
                const rule = row.interaction[name];
                return (
                  <div
                    key={name}
                    className="grid grid-cols-[48px_auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-[12px]"
                  >
                    <span>{RULE_LABEL[name]}</span>
                    <Switch
                      size="xs"
                      checked={rule.enabled}
                      disabled={disabled}
                      aria-label={`${RULE_LABEL[name]}开关`}
                      onCheckedChange={(enabled) =>
                        patchRule(name, { enabled })
                      }
                    />
                    <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                      每日上限
                      <NumberInput
                        value={rule.dailyCap}
                        min={0}
                        max={50}
                        disabled={disabled || !rule.enabled}
                        ariaLabel={`${RULE_LABEL[name]}每日上限`}
                        className="w-16"
                        onChange={(dailyCap) => patchRule(name, { dailyCap })}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                      比例 %
                      <NumberInput
                        value={rule.ratioPercent}
                        min={0}
                        max={100}
                        disabled={disabled || !rule.enabled}
                        ariaLabel={`${RULE_LABEL[name]}比例`}
                        className="w-16"
                        onChange={(ratioPercent) =>
                          patchRule(name, { ratioPercent })
                        }
                      />
                    </label>
                  </div>
                );
              })}
              <div className="text-[11px] text-text-tertiary">
                评论：已关闭（第一阶段不开放）；发布、私信、分享一律不做。
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionTitle>浏览默认值</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Field label="最短停留（秒）">
                <NumberInput
                  value={row.browseDefaults.dwellSecMin}
                  min={5}
                  max={60}
                  disabled={disabled}
                  onChange={(dwellSecMin) =>
                    patchBrowse({
                      dwellSecMin,
                      dwellSecMax: Math.max(
                        dwellSecMin,
                        row.browseDefaults.dwellSecMax,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="最长停留（秒）">
                <NumberInput
                  value={row.browseDefaults.dwellSecMax}
                  min={5}
                  max={120}
                  disabled={disabled}
                  onChange={(dwellSecMax) =>
                    patchBrowse({
                      dwellSecMax: Math.max(
                        dwellSecMax,
                        row.browseDefaults.dwellSecMin,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="搜索占比 %">
                <NumberInput
                  value={row.browseDefaults.searchRatioPercent}
                  min={0}
                  max={100}
                  disabled={disabled}
                  onChange={(searchRatioPercent) =>
                    patchBrowse({ searchRatioPercent })
                  }
                />
              </Field>
              <Field label="每关键词篇数">
                <NumberInput
                  value={row.browseDefaults.postsPerKeyword}
                  min={1}
                  max={8}
                  disabled={disabled}
                  onChange={(postsPerKeyword) =>
                    patchBrowse({ postsPerKeyword })
                  }
                />
              </Field>
              <Field label="首页篇数">
                <NumberInput
                  value={row.browseDefaults.homeFeedCount}
                  min={0}
                  max={12}
                  disabled={disabled}
                  onChange={(homeFeedCount) => patchBrowse({ homeFeedCount })}
                />
              </Field>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
