import { useBots } from "@/hooks/use-bots";
import { useTranslation } from "react-i18next";

type BotPickerProps = {
  value: string | null;
  onChange: (botId: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Bot IDs that should be shown as disabled (already bound to a channel) */
  disabledBotIds?: Set<string>;
};

export function BotPicker({
  value,
  onChange,
  required,
  disabled,
  disabledBotIds,
}: BotPickerProps) {
  const { bots, isLoading } = useBots();
  const { t } = useTranslation();

  const isEmpty = !isLoading && bots.length === 0;
  const effectiveDisabled = disabled || isLoading;

  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <label
          htmlFor="bot-picker"
          className="text-[12px] text-text-primary font-medium"
        >
          {t("channels.botPicker.label")}
          {required ? (
            <span className="ml-0.5 text-[var(--color-error)]">*</span>
          ) : null}
        </label>
      </div>
      <select
        id="bot-picker"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={effectiveDisabled}
        required={required}
        className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-[13px] text-text-primary shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="" disabled>
          {t("channels.botPicker.placeholder")}
        </option>
        {bots.map((b) => {
          const isBound = disabledBotIds?.has(b.id) ?? false;
          return (
            // TODO(expert-slug): once Plan A merges and `expertSlug` is on BotResponse,
            // render `b.expertSlug ? `${b.name}（${b.expertSlug}）` : b.name` here.
            <option key={b.id} value={b.id} disabled={isBound}>
              {b.name}
              {isBound
                ? ` (${t("channels.botPicker.alreadyBound", { defaultValue: "已绑定" })})`
                : ""}
            </option>
          );
        })}
      </select>
      {isEmpty ? (
        <p className="mt-1.5 text-[11px] text-text-muted leading-relaxed">
          {t("channels.botPicker.emptyHint")}
        </p>
      ) : null}
    </div>
  );
}
