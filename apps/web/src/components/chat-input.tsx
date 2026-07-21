import { cn } from "@/lib/utils";
import { Loader2, Plus, SendHorizonal, Sparkles, Square } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onCancel?: () => void;
  placeholder?: string;
  disabled?: boolean;
  sending?: boolean;
  waitingReply?: boolean;
  canSend?: boolean;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
}

export function ChatInput({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onSend,
  onCancel,
  placeholder = "Ask Tabby",
  disabled = false,
  sending = false,
  waitingReply = false,
  canSend,
  leftActions,
  rightActions,
  inputRef,
}: ChatInputProps) {
  const { t } = useTranslation();
  const effectiveCanSend =
    canSend ?? (!disabled && !sending && value.trim().length > 0);

  return (
    <div className="w-full max-w-[800px] mx-auto">
      <div className="bg-[var(--color-tabby-bg)] rounded-3xl border border-[var(--color-tabby-border)] shadow-sm">
        <div className="px-4 pt-4 pb-2">
          {sending && (
            <div className="flex items-center justify-center pb-2">
              <Loader2
                size={16}
                className="animate-spin text-[var(--color-tabby-muted)]"
              />
              <span className="ml-2 text-xs text-[var(--color-tabby-muted)]">
                {t("experts.custom.sending")}
              </span>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={1}
            className="w-full resize-none bg-transparent text-[var(--color-tabby-foreground)] placeholder:text-[var(--color-tabby-muted)] outline-none min-h-[40px] text-sm disabled:cursor-not-allowed"
          />
        </div>
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0.5">{leftActions}</div>
          <div className="flex items-center gap-4">
            {rightActions}
            {waitingReply && onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="w-9 h-9 flex items-center justify-center rounded-full transition-colors bg-[var(--color-tabby-orange)] hover:bg-[var(--color-tabby-orange-hover)] text-white"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!effectiveCanSend}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                  effectiveCanSend
                    ? "bg-[var(--color-tabby-orange)] hover:bg-[var(--color-tabby-orange-hover)] text-white"
                    : "bg-[var(--color-tabby-canvas)] text-[var(--color-tabby-muted)] cursor-not-allowed",
                )}
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <SendHorizonal className="w-5 h-5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatInputAttachButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-[var(--color-tabby-muted)]"
    >
      <Plus className="w-5 h-5" />
    </button>
  );
}

export function ChatInputSkillsButton() {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-[var(--color-tabby-muted)] text-sm"
    >
      <Sparkles className="w-4 h-4" />
      Skills
    </button>
  );
}
