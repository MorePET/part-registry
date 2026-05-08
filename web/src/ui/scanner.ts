// Shared QR-camera scan helper. Lookup, Bind, Print all use this.
//
// Decoder: native `BarcodeDetector` only.
//
// We deliberately do NOT ship a fallback decoder for unsupported
// browsers. The labels we generate are Micro QR; @zxing/browser doesn't
// decode Micro QR, so falling back to it would silently produce
// "scan failed" on every Micro QR label — worse than failing loud.
//
// If the user lands on a browser that doesn't expose BarcodeDetector
// or doesn't support a QR-variant format, the overlay shows an
// explicit message naming what's missing and which browsers work.
// A subagent (issue: "always-on Micro QR decoder via WASM") is
// surveying open-source decoders we can bundle so this fallback
// becomes a non-issue cross-browser.

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

interface ScanResult {
  payload: string;
  format: string;
}

class ScanUnsupportedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ScanUnsupportedError";
  }
}

/** Open the scanner UI; resolve with the decoded payload string.
 *
 * Throws `ScanUnsupportedError` if the platform can't decode QR codes
 * via the native BarcodeDetector API. Callers should catch and present
 * the error message to the operator. */
export async function openScanner(): Promise<string> {
  const result = await openScannerWithDetail();
  return result.payload;
}

export async function openScannerWithDetail(): Promise<ScanResult> {
  if (typeof window === "undefined" || !window.BarcodeDetector) {
    showUnsupported(
      "This browser doesn't expose the BarcodeDetector API.",
      "Use Chrome on Android, or iOS 16+ Safari. Desktop Safari and Firefox don't have it yet.",
    );
    throw new ScanUnsupportedError("BarcodeDetector unavailable");
  }

  let supported: string[];
  try {
    supported = await window.BarcodeDetector.getSupportedFormats();
  } catch {
    showUnsupported(
      "BarcodeDetector exists but failed to enumerate formats.",
      "Try a different browser or device.",
    );
    throw new ScanUnsupportedError("getSupportedFormats failed");
  }

  // The platform may report `micro_qr_code` explicitly, or only `qr_code`.
  // On iOS 16+ Safari, even when only `qr_code` is listed, the underlying
  // VNDetectBarcodesRequest decodes Micro QR transparently. So we accept
  // either, and only fail if there's no QR variant at all.
  const formats = supported.filter(
    (f) => f === "qr_code" || f === "micro_qr_code",
  );
  if (formats.length === 0) {
    showUnsupported(
      "BarcodeDetector is available but does not advertise QR support on this device.",
      `Reported formats: ${supported.join(", ") || "(none)"}.`,
    );
    throw new ScanUnsupportedError("no qr formats");
  }

  return openScannerNative(formats);
}

// ---------- Camera + decoder loop ----------

async function openScannerNative(formats: string[]): Promise<ScanResult> {
  const ui = makeOverlay(
    formats.includes("micro_qr_code")
      ? "QR + Micro QR (native)"
      : "QR (native — Micro QR if platform supports it transparently)",
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

// ---------- Overlay UI ----------

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

function showUnsupported(headline: string, hint: string): void {
  const overlay = el("div", { class: "scan-overlay scan-overlay--error" });
  const card = el("div", { class: "scan-overlay__card" });
  card.append(
    el("h3", { class: "scan-overlay__headline" }, "Scanner unavailable"),
    el("p", {}, headline),
    el("p", { class: "muted small" }, hint),
  );
  const ok = button({ class: "primary" }, icon("x"), " Close");
  ok.addEventListener("click", () => overlay.remove());
  card.append(ok);
  overlay.append(card);
  document.body.append(overlay);
}
