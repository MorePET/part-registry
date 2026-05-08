// Lookup tab — search by ID or scan QR, show registry row.

import { ID_REGEX } from "../config";
import { FIELDS } from "../registry/schema";
import type { RegistryRow } from "../registry/schema";
import type { AppContext, Tab } from "../core/types";
import { el, button, input, formRow } from "../ui/dom";

export const lookupTab: Tab = {
  id: "lookup",
  label: "Lookup",
  mount(container, ctx) {
    container.innerHTML = "";
    container.append(buildUI(ctx));
  },
};

function buildUI(ctx: AppContext): HTMLElement {
  const root = el("div", { class: "tab tab--lookup" });
  const header = el("h2", {}, "Lookup");

  const queryInput = input({
    type: "text",
    placeholder: "Scan QR or paste 12-char ID",
    autocomplete: "off",
    autocapitalize: "characters",
  });

  const goBtn = button({}, "Find");
  const scanBtn = button({}, "Scan with camera");

  const result = el("div", { class: "lookup__result" });

  const onSubmit = () => {
    result.innerHTML = "";
    const raw = queryInput.value.trim().toUpperCase().replace(/-/g, "");
    if (!raw) {
      result.append(el("p", { class: "muted" }, "Enter or scan an ID."));
      return;
    }
    if (!ID_REGEX.test(raw) && raw.length === 12) {
      result.append(el("p", { class: "error" }, "ID contains characters outside the canonical alphabet."));
      return;
    }
    const matches = raw.length === 12
      ? ([ctx.registry.findById(raw)].filter(Boolean) as RegistryRow[])
      : ctx.registry.find({ prefix: raw });
    if (matches.length === 0) {
      result.append(el("p", { class: "warn" }, `No match for "${raw}".`));
      return;
    }
    if (matches.length > 1) {
      result.append(
        el(
          "p",
          { class: "warn" },
          `${matches.length} matches for prefix "${raw}":`,
        ),
      );
      result.append(renderMatchList(matches));
      return;
    }
    result.append(renderRowDetail(matches[0]));
  };

  goBtn.addEventListener("click", onSubmit);
  queryInput.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") onSubmit();
  });

  scanBtn.addEventListener("click", () => {
    void startScan(queryInput, onSubmit);
  });

  root.append(
    header,
    formRow([queryInput, goBtn, scanBtn]),
    result,
  );
  return root;
}

function renderRowDetail(row: RegistryRow): HTMLElement {
  const wrap = el("div", { class: "row-detail" });
  const dl = el("dl");
  for (const f of FIELDS) {
    const value = row[f.key] || "";
    dl.append(el("dt", {}, f.label));
    dl.append(el("dd", {}, value || el("span", { class: "muted" }, "—")));
  }
  wrap.append(dl);
  return wrap;
}

function renderMatchList(rows: RegistryRow[]): HTMLElement {
  const ul = el("ul", { class: "match-list" });
  for (const row of rows) {
    const li = el("li", {});
    const id = el("strong", {}, row.id);
    const meta = el(
      "span",
      { class: "muted" },
      `  ${row.status}  ${row.type || "(unbound)"}  @ ${row.location || "—"}`,
    );
    li.append(id, meta);
    ul.append(li);
  }
  return ul;
}

// QR camera scan via @zxing/browser. Lazy-imported so the module isn't
// loaded for users who never scan.
async function startScan(
  target: HTMLInputElement,
  onResult: () => void,
): Promise<void> {
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader();
  const overlay = el("div", { class: "scan-overlay" });
  const video = el("video", { class: "scan-overlay__video" }) as HTMLVideoElement;
  const cancel = button({ class: "scan-overlay__cancel" }, "Cancel");
  overlay.append(video, cancel);
  document.body.append(overlay);

  let controls: { stop(): void } | undefined;
  const close = () => {
    controls?.stop();
    overlay.remove();
  };
  cancel.addEventListener("click", close);

  try {
    controls = await reader.decodeFromVideoDevice(
      undefined,
      video,
      (result) => {
        if (result) {
          target.value = result.getText().toUpperCase();
          close();
          onResult();
        }
      },
    );
  } catch (e) {
    close();
    alert(`Camera failed: ${(e as Error).message}`);
  }
}
