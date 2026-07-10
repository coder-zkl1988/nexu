/**
 * IME-safe keyboard helpers.
 *
 * While an input method editor (Chinese/Japanese/Korean) is composing, Enter
 * commits the highlighted candidate. That keystroke must NOT also trigger
 * "send" / "submit" / "confirm", or a half-typed pinyin sentence gets sent the
 * moment the user picks a word.
 *
 * Browsers signal this with `isComposing`; older ones only with the legacy
 * keyCode/which 229. React's synthetic event does not surface `isComposing`,
 * so the native event has to be checked too — hence the belt-and-braces read
 * of both, through a structural type that a React.KeyboardEvent satisfies.
 */

type NativeKeyboardEventLike = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
};

export type KeyboardEventLike = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: NativeKeyboardEventLike;
};

/** True while an IME is composing — the keystroke belongs to the IME, not us. */
export function isImeComposing(event: KeyboardEventLike): boolean {
  const native = event.nativeEvent;
  return Boolean(
    event.isComposing ||
      native?.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      native?.keyCode === 229 ||
      native?.which === 229,
  );
}
