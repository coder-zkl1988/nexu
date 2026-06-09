import type { MirrorSnapshotFrame } from "@nexu/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MirrorGLRenderer } from "./mirror-renderer";

type MirrorStatus = "connecting" | "open" | "closed";

// ── Global renderer registry ──────────────────────────────

/** Map of deviceId → renderer registration */
const rendererRegistry = new Map<
  string,
  {
    renderer: MirrorGLRenderer;
    videoCallback: (frame: VideoFrame) => void;
    jpegCallback: (
      screenshot: string,
      width: number,
      height: number,
      format: "jpeg" | "png",
    ) => void;
  }
>();

/** Register a renderer for a specific device */
export function registerMirrorRenderer(
  deviceId: string,
  renderer: MirrorGLRenderer,
): () => void {
  const videoCallback = (frame: VideoFrame) => renderer.render(frame);
  const jpegCallback = (
    screenshot: string,
    width: number,
    height: number,
    format: "jpeg" | "png",
  ) => renderer.renderJPEG(screenshot, width, height, format);
  rendererRegistry.set(deviceId, { renderer, videoCallback, jpegCallback });
  return () => {
    const entry = rendererRegistry.get(deviceId);
    if (entry && entry.renderer === renderer) {
      rendererRegistry.delete(deviceId);
    }
  };
}

/** Get the render callback for a device (used by H264Decoder) */
export function getMirrorRenderCallback(
  deviceId: string,
): ((frame: VideoFrame) => void) | null {
  return rendererRegistry.get(deviceId)?.videoCallback ?? null;
}

/** Get the JPEG render callback for a device (used by STABLE mode JSON path) */
export function getMirrorJPEGCallback(
  deviceId: string,
):
  | ((
      screenshot: string,
      width: number,
      height: number,
      format: "jpeg" | "png",
    ) => void)
  | null {
  return rendererRegistry.get(deviceId)?.jpegCallback ?? null;
}

// ── H.264 Annex B helpers ─────────────────────────────────

/**
 * Find the next Annex B start code (0x000001 or 0x00000001) starting
 * from `from`.  Returns -1 when none is found before the end.
 */
function findNextStartCode(data: Uint8Array, from: number): number {
  for (let i = from; i < data.length - 2; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) return i; // 0x000001
    if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) return i; // 0x00000001
  }
  return -1;
}

/**
 * Extract the SPS (nal type 7) and PPS (nal type 8) from Annex B data.
 * Returns null if either is missing.
 */
function extractSpsPps(
  data: Uint8Array,
): { sps: Uint8Array; pps: Uint8Array } | null {
  let sps: Uint8Array | null = null;
  let pps: Uint8Array | null = null;
  let pos = 0;

  while (true) {
    pos = findNextStartCode(data, pos);
    if (pos === -1) break;

    const startCodeLen = data[pos + 2] === 1 ? 3 : 4;
    const nalStart = pos + startCodeLen;
    if (nalStart >= data.length) break;

    const nalType = (data[nalStart] ?? 0) & 0x1f;
    const nextPos = findNextStartCode(data, nalStart);
    const nalEnd = nextPos === -1 ? data.length : nextPos;
    const nalData = data.slice(nalStart, nalEnd);

    if (nalType === 7) sps = nalData;
    else if (nalType === 8) pps = nalData;

    if (sps && pps) break;
    pos = nextPos !== -1 ? nextPos : data.length;
  }

  return sps && pps ? { sps, pps } : null;
}

/**
 * Build an AVCC (ISO 14496-15) extradata blob from SPS and PPS NAL
 * units for use as VideoDecoderConfig.description.
 *
 * Layout:
 *   [version(1)] [profile(1)] [compatibility(1)] [level(1)]
 *   [nalLengthSize-1(1)] [numSPS(1)] [spsLength(2)] [sps(v)]
 *   [numPPS(1)] [ppsLength(2)] [pps(v)]
 */
function makeAvccDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const len = 5 + 3 + sps.length + 1 + 2 + pps.length;
  const avcc = new Uint8Array(len);
  let off = 0;
  avcc[off++] = 0x01; // version
  avcc[off++] = sps[1] ?? 0; // profile (from SPS)
  avcc[off++] = sps[2] ?? 0; // compatibility (from SPS)
  avcc[off++] = sps[3] ?? 0; // level (from SPS)
  avcc[off++] = 0xff; // nal length size – 1 = 3 (4‑byte)
  avcc[off++] = 0xe1; // reserved(3) | numSPS(5) = 1
  avcc[off++] = (sps.length >> 8) & 0xff;
  avcc[off++] = sps.length & 0xff;
  avcc.set(sps, off);
  off += sps.length;
  avcc[off++] = 0x01; // numPPS = 1
  avcc[off++] = (pps.length >> 8) & 0xff;
  avcc[off++] = pps.length & 0xff;
  avcc.set(pps, off);
  return avcc;
}

/**
 * Convert Annex B data (start‑code delimited NAL units) to AVCC
 * format (4‑byte big‑endian length prefix per NAL unit).
 */
function annexBtoAvcc(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;

  while (i < data.length) {
    const sc = findNextStartCode(data, i);
    if (sc === -1) break;

    const startCodeLen = data[sc + 2] === 1 ? 3 : 4;
    const nalStart = sc + startCodeLen;
    if (nalStart >= data.length) break;

    const nextSc = findNextStartCode(data, nalStart);
    const nalEnd = nextSc === -1 ? data.length : nextSc;
    const nalLen = nalEnd - nalStart;

    // 4‑byte big‑endian length prefix
    const prefix = new Uint8Array(4);
    prefix[0] = (nalLen >> 24) & 0xff;
    prefix[1] = (nalLen >> 16) & 0xff;
    prefix[2] = (nalLen >> 8) & 0xff;
    prefix[3] = nalLen & 0xff;
    parts.push(prefix, data.slice(nalStart, nalEnd));

    i = nextSc !== -1 ? nalEnd : data.length;
  }

  if (parts.length === 0) return data; // no start codes – pass through

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

/**
 * Extract coded (macroblock-aligned) dimensions from SPS NAL unit
 * embedded in an AVCC description buffer.
 *
 * AVCC description layout:
 *   [version(1)] [profile(1)] [compat(1)] [level(1)]
 *   [nalLengthSize-1(1)] [numSPS(1)] [spsLen(2)] [sps(v)]
 *   [numPPS(1)] [ppsLen(2)] [pps(v)]
 *
 * SPS parsing (simplified — reads pic_width_in_mbs_minus1 and
 * pic_height_in_map_units_minus1 from the exp-golomb bitstream):
 *   codedWidth  = (pic_width_in_mbs_minus1 + 1) * 16
 *   codedHeight = (2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16
 */
function extractCodedDimensionsFromSps(
  description: Uint8Array,
): { width: number; height: number } | null {
  try {
    // Skip AVCC header: version(1)+profile(1)+compat(1)+level(1)+nalLenSize(1)+numSPS(1) = 6 bytes
    if (description.length < 8) return null;
    const numSps = (description[5] ?? 0) & 0x1f;
    if (numSps < 1) return null;

    const spsLen = ((description[6] ?? 0) << 8) | (description[7] ?? 0);
    const spsOffset = 8;
    if (spsOffset + spsLen > description.length) return null;

    const sps = description.slice(spsOffset, spsOffset + spsLen);

    // SPS NAL unit: first byte is nal_type, then profile_idc, etc.
    // We need to parse exp-golomb codes to find pic_width_in_mbs_minus1
    // and pic_height_in_map_units_minus1.
    // Simplified parser that handles the common Baseline profile case.

    let bitPos = 0;
    const bits = sps;

    function readBit(): number {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      bitPos++;
      if (byteIdx >= bits.length) return 0;
      return ((bits[byteIdx] as number) >> bitIdx) & 1;
    }

    function readBits(n: number): number {
      let val = 0;
      for (let i = 0; i < n; i++) {
        val = (val << 1) | readBit();
      }
      return val;
    }

    function readExpGolomb(): number {
      let leadingZeros = 0;
      while (readBit() === 0 && leadingZeros < 32) leadingZeros++;
      if (leadingZeros >= 32) return 0;
      return (1 << leadingZeros) - 1 + readBits(leadingZeros);
    }

    // Skip nal_unit_type (forbidden_zero_bit + nal_ref_idc + nal_unit_type)
    // First byte of SPS data (after start code in Annex B, or raw in AVCC)
    // nal_unit_type is in the first byte
    bitPos = 0;

    // Skip nal_unit_type byte (8 bits)
    readBits(8);

    // profile_idc (8 bits)
    const profileIdc = readBits(8);

    // constraint_set0_flag through constraint_set5_flag + reserved (8 bits)
    readBits(8);

    // level_idc (8 bits)
    readBits(8);

    // seq_parameter_set_id (exp-golomb)
    readExpGolomb();

    // For High profiles, there are additional fields
    if (
      profileIdc === 100 ||
      profileIdc === 110 ||
      profileIdc === 122 ||
      profileIdc === 244 ||
      profileIdc === 44 ||
      profileIdc === 83 ||
      profileIdc === 86 ||
      profileIdc === 118 ||
      profileIdc === 128 ||
      profileIdc === 138 ||
      profileIdc === 139 ||
      profileIdc === 134 ||
      profileIdc === 135
    ) {
      // chroma_format_idc
      const chromaFormat = readExpGolomb();
      if (chromaFormat === 3) {
        // separate_colour_plane_flag
        readBits(1);
      }
      // bit_depth_luma_minus8
      readExpGolomb();
      // bit_depth_chroma_minus8
      readExpGolomb();
      // qpprime_y_zero_transform_bypass_flag
      readBits(1);
      // seq_scaling_matrix_present_flag
      const scalingMatrixPresent = readBits(1);
      if (scalingMatrixPresent) {
        const count = chromaFormat === 3 ? 12 : 8;
        for (let i = 0; i < count; i++) {
          const seqScalingListPresent = readBits(1);
          if (seqScalingListPresent) {
            const size = i < 6 ? 16 : 64;
            let lastScale = 8;
            let nextScale = 8;
            for (let j = 0; j < size; j++) {
              if (nextScale !== 0) {
                const deltaScale = readExpGolomb();
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }

    // log2_max_frame_num_minus4 (exp-golomb)
    readExpGolomb();

    // pic_order_cnt_type (exp-golomb)
    const picOrderCntType = readExpGolomb();
    if (picOrderCntType === 0) {
      // log2_max_pic_order_cnt_lsb_minus4
      readExpGolomb();
    } else if (picOrderCntType === 1) {
      // delta_pic_order_always_zero_flag
      readBits(1);
      // offset_for_non_ref_pic
      readExpGolomb();
      // offset_for_top_to_bottom_field
      readExpGolomb();
      const numRefFramesInPicOrderCntCycle = readExpGolomb();
      for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        readExpGolomb();
      }
    }

    // max_num_ref_frames (exp-golomb)
    readExpGolomb();

    // gaps_in_frame_num_value_allowed_flag
    readBits(1);

    // pic_width_in_mbs_minus1 (exp-golomb)
    const picWidthInMbsMinus1 = readExpGolomb();

    // pic_height_in_map_units_minus1 (exp-golomb)
    const picHeightInMapUnitsMinus1 = readExpGolomb();

    // frame_mbs_only_flag (1 bit)
    const frameMbsOnlyFlag = readBits(1);

    const codedWidth = (picWidthInMbsMinus1 + 1) * 16;
    const codedHeight =
      (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16;

    return { width: codedWidth, height: codedHeight };
  } catch {
    return null;
  }
}

// ── Binary frame header parser ────────────────────────────

const H264_FRAME_TYPE = 0x01;

interface BinaryFrameHeader {
  isKeyframe: boolean;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  timestamp: number; // ms
  nalData: Uint8Array;
}

/**
 * Parse the mirror binary frame header.
 *
 * Layout (14+ bytes):
 *   [0]     frameType (0x01 = H.264)
 *   [1]     keyframe flag (0x01 = key, 0x00 = delta)
 *   [2-3]   width  (uint16 LE) — stream width (may be half resolution)
 *   [4-5]   height (uint16 LE) — stream height (may be half resolution)
 *   [6-7]   screenWidth  (uint16 LE) — full screen width for coordinate mapping
 *   [8-9]   screenHeight (uint16 LE) — full screen height for coordinate mapping
 *   [10-13] timestamp ms (uint32 LE)
 *   [14+]   NAL unit data (Annex B)
 */
function parseBinaryFrameHeader(buf: ArrayBuffer): BinaryFrameHeader | null {
  const view = new DataView(buf);
  if (view.byteLength < 14) return null;
  if (view.getUint8(0) !== H264_FRAME_TYPE) return null;

  return {
    isKeyframe: view.getUint8(1) === 0x01,
    width: view.getUint16(2, true),
    height: view.getUint16(4, true),
    screenWidth: view.getUint16(6, true),
    screenHeight: view.getUint16(8, true),
    timestamp: view.getUint32(10, true),
    nalData: new Uint8Array(buf, 14),
  };
}

// ── H.264 decoder (WebCodecs) ─────────────────────────────

const WEB_CODECS_AVAILABLE =
  typeof VideoDecoder !== "undefined" &&
  typeof EncodedVideoChunk !== "undefined";

class H264Decoder {
  private decoder: VideoDecoder | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private configured = false;
  private closed = false;
  private static readonly MAX_INIT_RETRIES = 3;
  private initRetryCount = 0;
  private pendingFrame: MirrorSnapshotFrame | null = null;
  private rafId: number | null = null;
  // Original screen dimensions (from binary frame header) for coordinate mapping.
  // These differ from codedWidth/codedHeight (which are 16-pixel aligned for H.264).
  private originalWidth = 0;
  private originalHeight = 0;
  // Stream dimensions (from binary frame header) — the actual content area without
  // macroblock padding. Used to crop the decoded frame and remove black bars.
  private streamWidth = 0;
  private streamHeight = 0;

  constructor(
    private readonly deviceId: string,
    private readonly onFrame: (f: MirrorSnapshotFrame) => void,
  ) {}

  // ── internal ──

  private init(width: number, height: number, description: Uint8Array): void {
    // Extract coded dimensions from SPS for accurate decoder configuration.
    // H.264 encodes in 16x16 macroblocks, so coded dimensions may be larger
    // than the display dimensions (e.g., 1080→1088). Using SPS dimensions
    // ensures the decoder interprets the bitstream correctly.
    const codedDims = extractCodedDimensionsFromSps(description);
    const codedWidth = codedDims?.width ?? width;
    const codedHeight = codedDims?.height ?? height;

    this.canvas = document.createElement("canvas");
    this.canvas.width = codedWidth;
    this.canvas.height = codedHeight;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    this.ctx = ctx;

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => this.handleDecodedFrame(frame),
      error: (e: Error) => {
        console.error("[H264Decoder] decode error:", e);
      },
    });

    this.decoder.configure({
      codec: "avc1.42001E",
      codedWidth: codedWidth,
      codedHeight: codedHeight,
      description: description as unknown as BufferSource,
      hardwareAcceleration: "prefer-hardware",
      optimizeForLatency: true,
    });

    this.configured = true;
  }

  private handleDecodedFrame(videoFrame: VideoFrame): void {
    if (this.closed) {
      videoFrame.close();
      return;
    }

    // If a WebGL renderer is registered for this device, use it for direct rendering
    const renderCallback = getMirrorRenderCallback(this.deviceId);
    if (renderCallback !== null) {
      // Read videoFrame dimensions BEFORE renderCallback, because
      // renderer.render() calls frame.close() which zeros displayWidth/displayHeight.
      const vfDisplayW = videoFrame.displayWidth;
      const vfDisplayH = videoFrame.displayHeight;

      renderCallback(videoFrame);

      // Still emit metadata for coordinate mapping and state updates
      const frameMeta: MirrorSnapshotFrame = {
        channel: "mirror",
        type: "realtime",
        deviceId: this.deviceId,
        screenshot: "", // No JPEG needed with WebGL renderer
        format: "jpeg",
        width: this.originalWidth || vfDisplayW,
        height: this.originalHeight || vfDisplayH,
        screenWidth: this.originalWidth || vfDisplayW,
        screenHeight: this.originalHeight || vfDisplayH,
        streamWidth: vfDisplayW || this.streamWidth,
        streamHeight: vfDisplayH || this.streamHeight,
        timestamp: Date.now(),
        deviceStatus: "busy",
      };

      this.pendingFrame = frameMeta;
      if (this.rafId === null) {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          if (this.pendingFrame !== null) {
            this.onFrame(this.pendingFrame);
            this.pendingFrame = null;
          }
        });
      }
      return;
    }

    // Legacy JPEG path (when no WebGL renderer)
    if (!this.ctx || !this.canvas) {
      videoFrame.close();
      return;
    }

    // Resize canvas if video frame dimensions differ from canvas dimensions.
    // This handles macroblock-aligned coded dimensions (e.g., 1088 vs 1080).
    if (
      videoFrame.codedWidth !== this.canvas.width ||
      videoFrame.codedHeight !== this.canvas.height
    ) {
      this.canvas.width = videoFrame.codedWidth;
      this.canvas.height = videoFrame.codedHeight;
    }

    // Draw the full coded frame (includes macroblock padding).
    this.ctx.drawImage(videoFrame, 0, 0);
    videoFrame.close();

    // Crop to stream dimensions to remove macroblock padding (e.g., 544→540).
    // This eliminates black bars on the right/bottom edges.
    const cropW = this.streamWidth || this.canvas.width;
    const cropH = this.streamHeight || this.canvas.height;

    // Only crop if the stream dimensions are smaller than coded dimensions.
    let dataUrl: string;
    if (cropW < this.canvas.width || cropH < this.canvas.height) {
      // Create a cropped canvas at stream dimensions.
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext("2d");
      if (cropCtx) {
        cropCtx.drawImage(
          this.canvas,
          0,
          0,
          cropW,
          cropH, // source rect (crop from coded canvas)
          0,
          0,
          cropW,
          cropH, // dest rect
        );
        dataUrl = cropCanvas.toDataURL("image/jpeg", 0.8);
      } else {
        dataUrl = this.canvas.toDataURL("image/jpeg", 0.8);
      }
    } else {
      dataUrl = this.canvas.toDataURL("image/jpeg", 0.8);
    }

    const screenshot = dataUrl.replace(/^data:image\/jpeg;base64,/, "");

    const frame: MirrorSnapshotFrame = {
      channel: "mirror",
      type: "realtime",
      deviceId: this.deviceId,
      screenshot,
      format: "jpeg",
      width: this.originalWidth || this.canvas.width,
      height: this.originalHeight || this.canvas.height,
      screenWidth: this.originalWidth || this.canvas.width,
      screenHeight: this.originalHeight || this.canvas.height,
      streamWidth: this.streamWidth || this.canvas.width,
      streamHeight: this.streamHeight || this.canvas.height,
      timestamp: Date.now(),
      deviceStatus: "busy",
    };

    this.pendingFrame = frame;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.pendingFrame !== null) {
          this.onFrame(this.pendingFrame);
          this.pendingFrame = null;
        }
      });
    }
  }

  // ── public API ──

  /** Feed an encoded H.264 frame. */
  decode(
    data: Uint8Array,
    isKeyframe: boolean,
    timestamp: number,
    width: number,
    height: number,
    screenWidth: number,
    screenHeight: number,
  ): void {
    if (this.closed) return;

    // Store original screen dimensions for coordinate mapping.
    // These come from the binary frame header (full screen size, not half-resolution stream size).
    this.originalWidth = screenWidth || width;
    this.originalHeight = screenHeight || height;
    this.streamWidth = width;
    this.streamHeight = height;

    if (!this.configured) {
      if (!isKeyframe) return; // need SPS/PPS from a keyframe first

      const spsPps = extractSpsPps(data);
      if (!spsPps) {
        console.warn("[H264Decoder] Keyframe but no SPS/PPS found");
        return;
      }

      const description = makeAvccDescription(spsPps.sps, spsPps.pps);

      try {
        this.init(width, height, description);
      } catch (e) {
        console.warn("[H264Decoder] init failed:", e);
        this.initRetryCount++;
        if (this.initRetryCount >= H264Decoder.MAX_INIT_RETRIES) {
          this.configured = true; // give up — skip all future frames
        }
        return;
      }
    }

    const avcc = annexBtoAvcc(data);
    const chunk = new EncodedVideoChunk({
      type: isKeyframe ? "key" : "delta",
      timestamp: timestamp * 1000, // ms → µs
      data: avcc,
    });
    if (!this.decoder) return;
    this.decoder.decode(chunk);
  }

  /** Tear down the decoder.  Safe to call multiple times. */
  close(): void {
    this.closed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

// ── WebSocket client ──────────────────────────────────────

// ── React hook ────────────────────────────────────────────

export function useMirrorSocket(
  deviceId: string | null,
  wsHost?: string,
  wsPort?: number,
) {
  const [frame, setFrame] = useState<MirrorSnapshotFrame | null>(null);
  const [status, setStatus] = useState<MirrorStatus>(
    deviceId === null ? "closed" : "connecting",
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const url =
    wsHost !== undefined || wsPort !== undefined
      ? `ws://${wsHost ?? window.location.hostname}:${wsPort ?? 18790}/mirror`
      : `ws://${window.location.host}/api/v1/devices/${deviceId === null ? "" : encodeURIComponent(deviceId)}/mirror`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectKey intentionally triggers reconnection
  useEffect(() => {
    if (deviceId === null) {
      setFrame(null);
      setStatus("closed");
      wsRef.current = null;
      return;
    }

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const decoder = WEB_CODECS_AVAILABLE
      ? new H264Decoder(deviceId, (f) => {
          setFrame(f);
        })
      : null;

    let pendingFrame: MirrorSnapshotFrame | null = null;
    let rafId: number | null = null;

    function flushFrame(): void {
      rafId = null;
      if (pendingFrame !== null) {
        setFrame(pendingFrame);
        pendingFrame = null;
      }
    }

    function cleanup(): void {
      decoder?.close();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setFrame(null);
    }

    ws.onopen = () => {
      // Direct mode: send subscription message; proxy mode: proxy handles upstream subscription
      if (wsHost !== undefined || wsPort !== undefined) {
        ws.send(JSON.stringify({ deviceId, fps: 30 }));
      }
    };

    ws.onclose = () => {
      cleanup();
      setStatus("closed");
    };

    ws.onerror = () => {
      cleanup();
      setStatus("closed");
    };

    ws.onmessage = (event: MessageEvent) => {
      // ── Binary (H.264) path ─────────────────────────────
      if (event.data instanceof ArrayBuffer) {
        console.log(
          "[mirror-ws] binary frame received, size:",
          event.data.byteLength,
          "firstByte:",
          new Uint8Array(event.data)[0],
        );
        if (!decoder) return;

        const header = parseBinaryFrameHeader(event.data);
        if (!header) return;

        decoder.decode(
          header.nalData,
          header.isKeyframe,
          header.timestamp,
          header.width,
          header.height,
          header.screenWidth,
          header.screenHeight,
        );
        setStatus("open");
        return;
      }

      // ── Text (JSON) path ────────────────────────────────
      try {
        const data = JSON.parse(event.data as string);

        // Handle phone disconnect notification from server
        if (data.channel === "mirror" && data.type === "device_disconnected") {
          cleanup();
          ws.close();
          setStatus("closed");
          return;
        }

        if (data.channel === "mirror" && data.screenshot) {
          const fmt = (data.format ?? "jpeg") as "jpeg" | "png";
          const frame: MirrorSnapshotFrame = {
            channel: "mirror",
            type: data.type ?? "realtime",
            deviceId,
            screenshot: data.screenshot,
            format: fmt,
            width: data.width,
            height: data.height,
            timestamp: data.timestamp ?? Date.now(),
            currentApp: data.currentApp,
            deviceStatus: data.deviceStatus ?? "idle",
          };
          // Render JPEG directly to the WebGL canvas (STABLE mode path)
          const jpegCallback = getMirrorJPEGCallback(deviceId);
          if (jpegCallback && data.width && data.height) {
            console.log(
              "[mirror-ws] STABLE JPEG render:",
              data.width,
              "x",
              data.height,
              "format:",
              fmt,
            );
            jpegCallback(data.screenshot, data.width, data.height, fmt);
          } else {
            console.log("[mirror-ws] JPEG callback missing?", {
              hasCallback: !!jpegCallback,
              w: data.width,
              h: data.height,
            });
          }
          pendingFrame = frame;
          if (rafId === null) rafId = requestAnimationFrame(flushFrame);
          setStatus("open");
        }
      } catch {
        // ignore malformed messages
      }
    };

    setStatus("connecting");

    const stop = () => {
      cleanup();
      ws.close();
    };

    return () => {
      stop();
      wsRef.current = null;
    };
  }, [deviceId, url, reconnectKey]);

  const reconnect = useCallback(() => {
    // Increment reconnectKey to trigger the useEffect re-run,
    // which cleans up the old WS and creates a new one.
    setFrame(null);
    setStatus("connecting");
    setReconnectKey((k) => k + 1);
  }, []);

  return { frame, status, reconnect };
}
