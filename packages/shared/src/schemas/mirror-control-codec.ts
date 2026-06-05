import type { MirrorClientAction } from "./device-mirror.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Client → Device control message types */
export const ControlType = {
  INJECT_KEYCODE: 0x01,
  INJECT_TEXT: 0x02,
  INJECT_TOUCH_EVENT: 0x03,
  INJECT_SCROLL_EVENT: 0x04,
  SET_CLIPBOARD: 0x05,
  BACK_OR_SCREEN_ON: 0x06,
  GET_CLIPBOARD: 0x07,
  LONG_PRESS: 0x08,
} as const;
export type ControlType = (typeof ControlType)[keyof typeof ControlType];

/** Device → Client message types */
export const DeviceMessageType = {
  CLIPBOARD: 0x00,
  ACK: 0x01,
} as const;
export type DeviceMessageType =
  (typeof DeviceMessageType)[keyof typeof DeviceMessageType];

/** Touch action codes */
export const TouchAction = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
} as const;
export type TouchAction = (typeof TouchAction)[keyof typeof TouchAction];

/** Key action codes */
export const KeyAction = {
  DOWN: 0,
  UP: 1,
  MULTIPLE: 2,
} as const;
export type KeyAction = (typeof KeyAction)[keyof typeof KeyAction];

/** Common Android keycodes */
export const AndroidKeycode = {
  BACK: 4,
  HOME: 3,
  RECENTS: 82,
  POWER: 26,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  ENTER: 66,
  DEL: 67, // backspace
  TAB: 61,
  ESCAPE: 111,
} as const;
export type AndroidKeycode =
  (typeof AndroidKeycode)[keyof typeof AndroidKeycode];

/** Android meta/state flags (per Android SDK KeyEvent meta state constants) */
export const AndroidMetaState = {
  NONE: 0,
  SHIFT_LEFT_ON: 0x01,
  SHIFT_RIGHT_ON: 0x02,
  ALT_LEFT_ON: 0x10,
  ALT_RIGHT_ON: 0x20,
  CTRL_LEFT_ON: 0x1000,
  CTRL_RIGHT_ON: 0x4000,
} as const;

// ─── Device message types ──────────────────────────────────────────────────────

export interface DeviceClipboardMessage {
  type: "clipboard";
  sequence: number;
  paste: boolean;
  text: string;
}

export interface DeviceAckMessage {
  type: "ack";
  code: number;
}

export type DeviceMessage = DeviceClipboardMessage | DeviceAckMessage;

// ─── Key mapping ───────────────────────────────────────────────────────────────

const KEY_MAP: Record<string, number> = {
  back: AndroidKeycode.BACK,
  home: AndroidKeycode.HOME,
  recents: AndroidKeycode.RECENTS,
  power: AndroidKeycode.POWER,
  volume_up: AndroidKeycode.VOLUME_UP,
  volume_down: AndroidKeycode.VOLUME_DOWN,
  enter: AndroidKeycode.ENTER,
  del: AndroidKeycode.DEL,
  tab: AndroidKeycode.TAB,
  escape: AndroidKeycode.ESCAPE,
};

// ─── Binary write helpers ──────────────────────────────────────────────────────

/**
 * Write a 32-bit unsigned integer in little-endian format.
 *
 * @param buf - Target buffer
 * @param offset - Byte offset to write at
 * @param value - Value to write (0 to 0xFFFFFFFF)
 */
export function writeUint32LE(
  buf: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

/**
 * Write a 64-bit unsigned integer in little-endian format.
 * Values above 2^53−1 lose precision via JavaScript number representation.
 *
 * @param buf - Target buffer
 * @param offset - Byte offset to write at
 * @param value - Value to write (safe range: 0 to Number.MAX_SAFE_INTEGER)
 */
export function writeUint64LE(
  buf: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lo = value >>> 0;
  const hi = Math.floor(value / 0x1_0000_0000) >>> 0;
  view.setUint32(offset, lo, true);
  view.setUint32(offset + 4, hi, true);
}

/**
 * Write a 32-bit IEEE 754 float in little-endian format.
 *
 * @param buf - Target buffer
 * @param offset - Byte offset to write at
 * @param value - Float value to write
 */
export function writeFloat32LE(
  buf: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setFloat32(offset, value, true);
}

/**
 * Write a 16-bit unsigned integer in little-endian format.
 *
 * @param buf - Target buffer
 * @param offset - Byte offset to write at
 * @param value - Value to write (0 to 0xFFFF)
 */
export function writeUint16LE(
  buf: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint16(offset, value, true);
}

/**
 * Read a 32-bit unsigned integer in little-endian format.
 *
 * @param buf - Source buffer
 * @param offset - Byte offset to read from
 * @returns The decoded value
 */
export function readUint32LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset, true);
}

/**
 * Read a 64-bit unsigned integer in little-endian format as a JavaScript number.
 * Values above 2^53−1 lose precision.
 *
 * @param buf - Source buffer
 * @param offset - Byte offset to read from
 * @returns The decoded value
 */
export function readUint64LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 0x1_0000_0000 + lo;
}

/**
 * Read a 32-bit IEEE 754 float in little-endian format.
 *
 * @param buf - Source buffer
 * @param offset - Byte offset to read from
 * @returns The decoded value
 */
export function readFloat32LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getFloat32(offset, true);
}

/**
 * Read a 16-bit unsigned integer in little-endian format.
 *
 * @param buf - Source buffer
 * @param offset - Byte offset to read from
 * @returns The decoded value
 */
export function readUint16LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint16(offset, true);
}

// ─── Frame builders (internal) ─────────────────────────────────────────────────

function buildInjectKeycode(
  action: number,
  keycode: number,
  repeat: number,
  metaState: number,
): Uint8Array {
  const buf = new Uint8Array(14);
  buf[0] = ControlType.INJECT_KEYCODE;
  buf[1] = action;
  writeUint32LE(buf, 2, keycode);
  writeUint32LE(buf, 6, repeat);
  writeUint32LE(buf, 10, metaState);
  return buf;
}

function buildInjectText(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const len = encoded.byteLength;
  const buf = new Uint8Array(5 + len);
  buf[0] = ControlType.INJECT_TEXT;
  writeUint32LE(buf, 1, len);
  buf.set(encoded, 5);
  return buf;
}

function buildInjectTouchEvent(
  action: number,
  pointerId: number,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pressure: number,
  actionButton: number,
  buttons: number,
): Uint8Array {
  const buf = new Uint8Array(36);
  buf[0] = ControlType.INJECT_TOUCH_EVENT;
  buf[1] = action;
  writeUint64LE(buf, 2, pointerId);
  writeUint32LE(buf, 10, x);
  writeUint32LE(buf, 14, y);
  writeUint32LE(buf, 18, screenWidth);
  writeUint32LE(buf, 22, screenHeight);
  // scrcpy expects pressure as uint16 in range [0, 0xffff]:
  // callers pass either 0.0-1.0 float (touch_raw) or 0xffff (click/swipe).
  // Normalize 0.0-1.0 → uint16; values already ≥256 are assumed pre-scaled.
  const pressureU16 =
    pressure >= 256
      ? Math.min(Math.round(pressure), 0xffff)
      : Math.round(pressure * 0xffff);
  writeUint16LE(buf, 26, pressureU16);
  writeUint32LE(buf, 28, actionButton);
  writeUint32LE(buf, 32, buttons);
  return buf;
}

function buildInjectScrollEvent(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  hScroll: number,
  vScroll: number,
  buttons: number,
): Uint8Array {
  const buf = new Uint8Array(29);
  buf[0] = ControlType.INJECT_SCROLL_EVENT;
  writeUint32LE(buf, 1, x);
  writeUint32LE(buf, 5, y);
  writeUint32LE(buf, 9, screenWidth);
  writeUint32LE(buf, 13, screenHeight);
  writeFloat32LE(buf, 17, hScroll);
  writeFloat32LE(buf, 21, vScroll);
  writeUint32LE(buf, 25, buttons);
  return buf;
}

function buildSetClipboard(
  text: string,
  paste: boolean,
  sequence: number,
): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const len = encoded.byteLength;
  const buf = new Uint8Array(14 + len);
  buf[0] = ControlType.SET_CLIPBOARD;
  writeUint64LE(buf, 1, sequence);
  buf[9] = paste ? 1 : 0;
  writeUint32LE(buf, 10, len);
  buf.set(encoded, 14);
  return buf;
}

function buildBackOrScreenOn(): Uint8Array {
  return new Uint8Array([ControlType.BACK_OR_SCREEN_ON]);
}

function buildGetClipboard(sequence: number): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = ControlType.GET_CLIPBOARD;
  writeUint64LE(buf, 1, sequence);
  return buf;
}

// ─── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode a MirrorClientAction into one or more binary frames for the control WebSocket.
 *
 * @param action - The action to encode (from MirrorClientAction schema)
 * @param screenWidth - Device screen width in pixels (from video frame)
 * @param screenHeight - Device screen height in pixels (from video frame)
 * @returns Array of Uint8Array frames to send sequentially
 */
export function encodeMirrorAction(
  action: MirrorClientAction,
  screenWidth: number,
  screenHeight: number,
): Uint8Array[] {
  switch (action.type) {
    case "click": {
      const pointerId = 0;
      const actionButton = 0;
      const buttons = 0;
      return [
        buildInjectTouchEvent(
          TouchAction.DOWN,
          pointerId,
          action.x,
          action.y,
          screenWidth,
          screenHeight,
          0xffff, // pressure = max (uint16)
          actionButton,
          buttons,
        ),
        buildInjectTouchEvent(
          TouchAction.UP,
          pointerId,
          action.x,
          action.y,
          screenWidth,
          screenHeight,
          0, // pressure = 0
          actionButton,
          buttons,
        ),
      ];
    }

    case "swipe": {
      const pointerId = 0;
      const actionButton = 0;
      const buttons = 0;
      return [
        buildInjectTouchEvent(
          TouchAction.DOWN,
          pointerId,
          action.startX,
          action.startY,
          screenWidth,
          screenHeight,
          0xffff, // pressure = max (uint16)
          actionButton,
          buttons,
        ),
        buildInjectTouchEvent(
          TouchAction.MOVE,
          pointerId,
          action.endX,
          action.endY,
          screenWidth,
          screenHeight,
          0xffff, // pressure = max (uint16)
          actionButton,
          buttons,
        ),
        buildInjectTouchEvent(
          TouchAction.UP,
          pointerId,
          action.endX,
          action.endY,
          screenWidth,
          screenHeight,
          0, // pressure = 0
          actionButton,
          buttons,
        ),
      ];
    }

    case "input_text": {
      return [buildInjectText(action.text)];
    }

    case "press_key": {
      const keycode = KEY_MAP[action.key];
      if (keycode === undefined) {
        // Unknown key: fall back to text injection
        return [buildInjectText(action.key)];
      }
      return [
        buildInjectKeycode(KeyAction.DOWN, keycode, 0, 0),
        buildInjectKeycode(KeyAction.UP, keycode, 0, 0),
      ];
    }

    case "touch_raw": {
      return [
        buildInjectTouchEvent(
          action.action,
          action.pointerId,
          action.x,
          action.y,
          screenWidth,
          screenHeight,
          action.pressure,
          action.actionButton,
          action.buttons,
        ),
      ];
    }

    case "back_or_screen_on": {
      return [buildBackOrScreenOn()];
    }

    case "set_clipboard": {
      return [buildSetClipboard(action.text, action.paste, action.sequence)];
    }

    case "get_clipboard": {
      return [buildGetClipboard(action.sequence)];
    }

    case "long_press": {
      const duration = action.durationMs ?? 500;
      const buf = new ArrayBuffer(13);
      const view = new DataView(buf);
      view.setUint8(0, ControlType.LONG_PRESS);
      view.setUint32(1, action.x, true);
      view.setUint32(5, action.y, true);
      view.setUint32(9, duration, true);
      return [new Uint8Array(buf)];
    }

    case "scroll": {
      return [
        buildInjectScrollEvent(
          action.x,
          action.y,
          screenWidth,
          screenHeight,
          action.hScroll,
          action.vScroll,
          0,
        ),
      ];
    }

    default: {
      // Exhaustiveness check at compile time
      const _exhaustive: never = action;
      throw new Error(
        `Unknown action type: ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}

// ─── Decode ────────────────────────────────────────────────────────────────────

/**
 * Decode a device→client binary message.
 *
 * @param data - Raw binary data from WebSocket
 * @returns Parsed device message, or null if unrecognized
 */
export function decodeDeviceMessage(data: ArrayBuffer): DeviceMessage | null {
  const buf = new Uint8Array(data);
  if (buf.byteLength < 1) {
    return null;
  }

  const msgType = buf[0];

  switch (msgType) {
    case DeviceMessageType.CLIPBOARD: {
      if (buf.byteLength < 14) {
        return null;
      }
      const sequence = readUint64LE(buf, 1);
      const paste = buf[9] !== 0;
      const textLen = readUint32LE(buf, 10);
      if (buf.byteLength < 14 + textLen) {
        return null;
      }
      const textBytes = buf.subarray(14, 14 + textLen);
      const text = new TextDecoder().decode(textBytes);
      return { type: "clipboard", sequence, paste, text };
    }

    case DeviceMessageType.ACK: {
      if (buf.byteLength < 2) {
        return null;
      }
      const code = buf[1] as number;
      return { type: "ack", code };
    }

    default: {
      return null;
    }
  }
}
