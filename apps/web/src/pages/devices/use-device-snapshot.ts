import { useEffect, useRef, useState } from "react";

/**
 * Subscribe to the latest device screenshot via WebSocket.
 * Connects to the mirror WS endpoint and extracts the most recent
 * frame for the device card preview.
 *
 * Supports both JSON (JPEG base64) and binary (H.264) frames.
 * For H.264 frames, uses WebCodecs VideoDecoder to decode and
 * renders to an offscreen canvas to extract a JPEG thumbnail.
 */
export function useDeviceSnapshot(
  deviceId: string | null,
  wsPort?: number,
): string | null {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<H264ThumbnailDecoder | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setSnapshot(null);
      return;
    }

    // When wsPort is provided, use direct mode (for remote/external access).
    // Otherwise, proxy through the controller's DeviceMirrorProxy.
    // fps=3 marks this as a passive thumbnail preview (as opposed to
    // useMirrorSocket's fps=30 live view) — the phone side uses this to decide
    // whether opening this connection alone should prompt for MediaProjection.
    const url =
      wsPort !== undefined
        ? `ws://${window.location.hostname}:${wsPort}/mirror`
        : `ws://${window.location.host}/api/v1/devices/${encodeURIComponent(deviceId)}/mirror?fps=3`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const decoder =
      typeof VideoDecoder !== "undefined" &&
      typeof EncodedVideoChunk !== "undefined"
        ? new H264ThumbnailDecoder((base64) => setSnapshot(base64))
        : null;
    decoderRef.current = decoder;

    ws.onopen = () => {
      // In direct mode, send subscribe message with low fps for thumbnail.
      // In proxy mode, the proxy handles the subscribe message upstream.
      if (wsPort !== undefined) {
        ws.send(JSON.stringify({ deviceId, fps: 1 }));
      }
    };

    ws.onmessage = (event) => {
      // ── Binary (H.264) path ─────────────────────────────
      if (event.data instanceof ArrayBuffer) {
        if (!decoder) return; // WebCodecs unavailable – skip
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
        return;
      }

      // ── Text (JSON) path ────────────────────────────────
      try {
        const data = JSON.parse(event.data as string);
        if (data.channel === "mirror" && data.screenshot) {
          setSnapshot(data.screenshot);
        }
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      decoder?.close();
      ws.close();
      wsRef.current = null;
      decoderRef.current = null;
    };
  }, [deviceId, wsPort]);

  return snapshot;
}

// ── Binary frame header parser (same format as use-mirror-ws.ts) ──

const H264_FRAME_TYPE = 0x01;

interface BinaryFrameHeader {
  isKeyframe: boolean;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  timestamp: number;
  nalData: Uint8Array;
}

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

// ── H.264 thumbnail decoder (lightweight version for snapshots) ──

function findNextStartCode(data: Uint8Array, from: number): number {
  for (let i = from; i < data.length - 2; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) return i;
    if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) return i;
  }
  return -1;
}

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

function makeAvccDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const len = 5 + 3 + sps.length + 1 + 2 + pps.length;
  const avcc = new Uint8Array(len);
  let off = 0;
  avcc[off++] = 0x01;
  avcc[off++] = sps[1] ?? 0;
  avcc[off++] = sps[2] ?? 0;
  avcc[off++] = sps[3] ?? 0;
  avcc[off++] = 0xff;
  avcc[off++] = 0xe1;
  avcc[off++] = (sps.length >> 8) & 0xff;
  avcc[off++] = sps.length & 0xff;
  avcc.set(sps, off);
  off += sps.length;
  avcc[off++] = 0x01;
  avcc[off++] = (pps.length >> 8) & 0xff;
  avcc[off++] = pps.length & 0xff;
  avcc.set(pps, off);
  return avcc;
}

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

    const prefix = new Uint8Array(4);
    prefix[0] = (nalLen >> 24) & 0xff;
    prefix[1] = (nalLen >> 16) & 0xff;
    prefix[2] = (nalLen >> 8) & 0xff;
    prefix[3] = nalLen & 0xff;
    parts.push(prefix, data.slice(nalStart, nalEnd));

    i = nextSc !== -1 ? nalEnd : data.length;
  }

  if (parts.length === 0) return data;

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
 * Extract coded dimensions (macroblock-aligned) from SPS data in an AVCC description.
 * Returns null if parsing fails.
 */
function extractCodedDimensionsFromSps(
  description: Uint8Array,
): { width: number; height: number } | null {
  try {
    if (description.length < 8) return null;
    const numSps = (description[5] ?? 0) & 0x1f;
    if (numSps < 1) return null;

    const spsLen = ((description[6] ?? 0) << 8) | (description[7] ?? 0);
    const spsOffset = 8;
    if (spsOffset + spsLen > description.length) return null;

    const sps = description.slice(spsOffset, spsOffset + spsLen);

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

    bitPos = 0;
    readBits(8); // nal_unit_type
    const profileIdc = readBits(8); // profile_idc
    readBits(8); // constraint flags
    readBits(8); // level_idc
    readExpGolomb(); // seq_parameter_set_id

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
      const chromaFormat = readExpGolomb();
      if (chromaFormat === 3) readBits(1);
      readExpGolomb(); // bit_depth_luma_minus8
      readExpGolomb(); // bit_depth_chroma_minus8
      readBits(1); // qpprime_y_zero_transform_bypass_flag
      const scalingMatrixPresent = readBits(1);
      if (scalingMatrixPresent) {
        const count = chromaFormat === 3 ? 12 : 8;
        for (let i = 0; i < count; i++) {
          if (readBits(1)) {
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

    readExpGolomb(); // log2_max_frame_num_minus4
    const picOrderCntType = readExpGolomb();
    if (picOrderCntType === 0) {
      readExpGolomb();
    } else if (picOrderCntType === 1) {
      readBits(1);
      readExpGolomb();
      readExpGolomb();
      const numRefFrames = readExpGolomb();
      for (let i = 0; i < numRefFrames; i++) readExpGolomb();
    }

    readExpGolomb(); // max_num_ref_frames
    readBits(1); // gaps_in_frame_num_value_allowed_flag

    const picWidthInMbsMinus1 = readExpGolomb();
    const picHeightInMapUnitsMinus1 = readExpGolomb();
    const frameMbsOnlyFlag = readBits(1);

    const codedWidth = (picWidthInMbsMinus1 + 1) * 16;
    const codedHeight =
      (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16;

    return { width: codedWidth, height: codedHeight };
  } catch {
    return null;
  }
}

/**
 * Lightweight H.264 decoder for snapshot thumbnails.
 * Decodes keyframes and renders to an offscreen canvas,
 * then extracts a base64 JPEG for the device card preview.
 */
class H264ThumbnailDecoder {
  private decoder: VideoDecoder | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private configured = false;
  private closed = false;
  private initRetryCount = 0;
  private static readonly MAX_INIT_RETRIES = 3;
  // Stream dimensions for cropping macroblock padding.
  private streamWidth = 0;
  private streamHeight = 0;

  constructor(private readonly onSnapshot: (base64: string) => void) {}

  decode(
    data: Uint8Array,
    isKeyframe: boolean,
    timestamp: number,
    width: number,
    height: number,
    _screenWidth: number,
    _screenHeight: number,
  ): void {
    if (this.closed) return;

    // Store stream dimensions for cropping.
    this.streamWidth = width;
    this.streamHeight = height;

    if (!this.configured) {
      if (!isKeyframe) return; // need SPS/PPS from a keyframe first

      const spsPps = extractSpsPps(data);
      if (!spsPps) return;

      try {
        // Extract coded dimensions from SPS for accurate decoder configuration.
        const codedDims = extractCodedDimensionsFromSps(
          makeAvccDescription(spsPps.sps, spsPps.pps),
        );
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
          error: (e: Error) =>
            console.warn("[H264ThumbnailDecoder] decode error:", e),
        });

        this.decoder.configure({
          codec: "avc1.42001E",
          codedWidth,
          codedHeight,
          description: makeAvccDescription(
            spsPps.sps,
            spsPps.pps,
          ) as unknown as BufferSource,
          hardwareAcceleration: "prefer-hardware",
          optimizeForLatency: true,
        });

        this.configured = true;
        this.initRetryCount = 0;
      } catch (e) {
        this.initRetryCount++;
        if (this.initRetryCount >= H264ThumbnailDecoder.MAX_INIT_RETRIES) {
          // Give up after max retries — stay unconfigured, skip all future frames
          this.closed = true;
          console.warn(
            `[H264ThumbnailDecoder] init failed ${this.initRetryCount} times, giving up:`,
            e,
          );
        } else {
          console.warn(
            `[H264ThumbnailDecoder] init failed (attempt ${this.initRetryCount}/${H264ThumbnailDecoder.MAX_INIT_RETRIES}), will retry on next keyframe:`,
            e,
          );
        }
        return;
      }
    }

    const avcc = annexBtoAvcc(data);
    const chunk = new EncodedVideoChunk({
      type: isKeyframe ? "key" : "delta",
      timestamp: timestamp * 1000,
      data: avcc,
    });
    this.decoder?.decode(chunk);
  }

  private handleDecodedFrame(videoFrame: VideoFrame): void {
    if (this.closed || !this.ctx || !this.canvas) {
      videoFrame.close();
      return;
    }

    // Resize canvas if video frame dimensions differ.
    if (
      videoFrame.codedWidth !== this.canvas.width ||
      videoFrame.codedHeight !== this.canvas.height
    ) {
      this.canvas.width = videoFrame.codedWidth;
      this.canvas.height = videoFrame.codedHeight;
    }

    this.ctx.drawImage(videoFrame, 0, 0);
    videoFrame.close();

    // Crop to stream dimensions to remove macroblock padding.
    const cropW = this.streamWidth || this.canvas.width;
    const cropH = this.streamHeight || this.canvas.height;

    let dataUrl: string;
    if (cropW < this.canvas.width || cropH < this.canvas.height) {
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext("2d");
      if (cropCtx) {
        cropCtx.drawImage(this.canvas, 0, 0, cropW, cropH, 0, 0, cropW, cropH);
        dataUrl = cropCanvas.toDataURL("image/jpeg", 0.6);
      } else {
        dataUrl = this.canvas.toDataURL("image/jpeg", 0.6);
      }
    } else {
      dataUrl = this.canvas.toDataURL("image/jpeg", 0.6);
    }

    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    this.onSnapshot(base64);
  }

  close(): void {
    this.closed = true;
    this.decoder?.close();
    this.decoder = null;
  }
}
