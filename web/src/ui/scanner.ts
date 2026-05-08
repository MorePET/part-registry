// Shared QR-camera scan helper. Lookup, Bind, and any future tab
// that needs to scan share this — DRY.
//
// Returns a Promise that resolves to the decoded payload string, or
// rejects if the user cancels or the camera permission is denied.

import { el, button } from "./dom";
import { icon } from "./icons";

export async function openScanner(): Promise<string> {
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader();

  return new Promise<string>((resolve, reject) => {
    const overlay = el("div", { class: "scan-overlay" });
    const video = el("video", { class: "scan-overlay__video" }) as HTMLVideoElement;
    const cancel = button({ class: "scan-overlay__cancel" }, icon("x"), " Cancel");
    overlay.append(video, cancel);
    document.body.append(overlay);

    let controls: { stop(): void } | undefined;
    let resolved = false;
    const close = () => {
      controls?.stop();
      overlay.remove();
    };
    cancel.addEventListener("click", () => {
      if (resolved) return;
      resolved = true;
      close();
      reject(new Error("scan cancelled"));
    });

    void reader
      .decodeFromVideoDevice(undefined, video, (result) => {
        if (result && !resolved) {
          resolved = true;
          const text = result.getText().toUpperCase();
          close();
          resolve(text);
        }
      })
      .then((c) => {
        controls = c;
      })
      .catch((e) => {
        if (resolved) return;
        resolved = true;
        close();
        reject(e);
      });
  });
}
