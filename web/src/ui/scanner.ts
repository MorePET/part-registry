// Shared QR-camera scan helper. Lookup, Bind, Print all use this.
//
// Decoder strategy:
//   1. Native BarcodeDetector if the platform exposes it AND advertises
//      either `qr_code` or `micro_qr_code`. Modern Chrome on Android
//      and iOS 16+ Safari both qualify; both decode Micro QR via the
//      OS image-recognition stack (Google Vision / VNDetectBarcodes).
//   2. Fallback: @zxing/browser. Standard QR only — does NOT decode
//      Micro QR. Lazy-imported so users on the native path don't pay
//      for it.
//
// Returns a Promise that resolves to the decoded payload string, or
// rejects on user cancel / camera permission denied.

import { el, button } from "./dom";
import { icon } from "./icons";

interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

export type DecoderName = "native" | "zxing";

interface ScanResult {
  payload: string;
  decoder: DecoderName;
  format?: string;
}

async function nativeFormats(): Promise<string[] | null> {
  if (typeof window === "undefined" || !window.BarcodeDetector) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const wanted = supported.filter(
      (f) => f === "qr_code" || f === "micro_qr_code",
    );
    return wanted.length > 0 ? wanted : null;
  } catch {
    return null;
  }
}

/** Open the scanner UI; resolve with the decoded payload string. */
export async function openScanner(): Promise<string> {
  const result = await openScannerWithDetail();
  return result.payload;
}

/** Same as openScanner() but exposes which decoder won. Useful for diagnostics. */
export async function openScannerWithDetail(): Promise<ScanResult> {
  const formats = await nativeFormats();
  if (formats) return openScannerNative(formats);
  return openScannerZxing();
}

// ---------- Shared overlay UI ----------

interface OverlayHandle {
  video: HTMLVideoElement;
  badge: HTMLElement;
  cancel: HTMLButtonElement;
  close: () => void;
}

function makeOverlay(badgeText: string): OverlayHandle {
  const overlay = el("div", { class: "scan-overlay" });
  const video = el("video", {
    class: "scan-overlay__video",
    playsinline: "",
    autoplay: "",
    muted: "",
  }) as HTMLVideoElement;
  const badge = el("div", { class: "scan-overlay__badge" }, badgeText);
  const cancel = button({ class: "scan-overlay__cancel" }, icon("x"), " Cancel");
  overlay.append(video, badge, cancel);
  document.body.append(overlay);
  return {
    video,
    badge,
    cancel,
    close: () => overlay.remove(),
  };
}

// ---------- Native (BarcodeDetector) path ----------

async function openScannerNative(formats: string[]): Promise<ScanResult> {
  const ui = makeOverlay(
    `Scanner: native (${formats.includes("micro_qr_code") ? "QR + Micro QR" : "QR"})`,
  );

  const Ctor = window.BarcodeDetector!;
  const detector = new Ctor({ formats });

  let stream: MediaStream | undefined;
  return new Promise<ScanResult>((resolve, reject) => {
    let resolved = false;
    let raf = 0;
    const finish = (err: Error | null, value?: ScanResult) => {
      if (resolved) return;
      resolved = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ui.close();
      if (err) reject(err);
      else if (value) resolve(value);
    };
    ui.cancel.addEventListener("click", () => finish(new Error("scan cancelled")));

    const tick = async () => {
      if (resolved) return;
      try {
        const matches = await detector.detect(ui.video);
        const hit = matches.find((m) => m.rawValue);
        if (hit) {
          finish(null, {
            payload: hit.rawValue.toUpperCase(),
            decoder: "native",
            format: hit.format,
          });
          return;
        }
      } catch {
        // Detector occasionally throws on un-decodable frames; keep polling.
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        ui.video.srcObject = s;
        ui.video.onloadedmetadata = () => {
          void ui.video.play();
          raf = requestAnimationFrame(tick);
        };
      })
      .catch((e) => finish(e as Error));
  });
}

// ---------- @zxing/browser fallback path (Standard QR only) ----------

async function openScannerZxing(): Promise<ScanResult> {
  const ui = makeOverlay("Scanner: zxing fallback (Standard QR only)");
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader();

  return new Promise<ScanResult>((resolve, reject) => {
    let resolved = false;
    let controls: { stop(): void } | undefined;
    const finish = (err: Error | null, value?: ScanResult) => {
      if (resolved) return;
      resolved = true;
      controls?.stop();
      ui.close();
      if (err) reject(err);
      else if (value) resolve(value);
    };
    ui.cancel.addEventListener("click", () => finish(new Error("scan cancelled")));

    void reader
      .decodeFromVideoDevice(undefined, ui.video, (result) => {
        if (result && !resolved) {
          finish(null, {
            payload: result.getText().toUpperCase(),
            decoder: "zxing",
            format: "qr_code",
          });
        }
      })
      .then((c) => {
        controls = c;
      })
      .catch((e) => finish(e as Error));
  });
}
