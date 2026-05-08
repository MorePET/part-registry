// Print tab — pick layout/size/multiplicity, render labels, hand off
// to OS print dialog. Page-per-label so the printer auto-cuts between.

import { DEFAULT_SIZE_MM, TAPE_SIZES } from "../config";
import type { AppContext, Layout, LayoutOptions, Tab } from "../core/types";
import { allLayouts, getLayout } from "../layouts";
import type { RegistryRow } from "../registry/schema";
import {
  el,
  button,
  input,
  select,
  formRow,
  number as numberInput,
} from "../ui/dom";

export const printTab: Tab = {
  id: "print",
  label: "Print",
  mount(container, ctx) {
    container.innerHTML = "";
    container.append(buildUI(ctx));
  },
};

interface PrintConfig {
  layoutId: string;
  size: number;
  multiplicity: number;
  selection:
    | { kind: "ids"; ids: string[] }
    | { kind: "batch"; batch: string }
    | { kind: "status"; status: "unbound" | "bound" | "void" }
    | { kind: "all" };
  layoutExtras: Record<string, number>;
}

function buildUI(ctx: AppContext): HTMLElement {
  const root = el("div", { class: "tab tab--print" });
  root.append(el("h2", {}, "Print labels"));

  const layoutSel = select(
    allLayouts().map((l) => ({ value: l.id, label: l.label })),
  );
  layoutSel.value = "horz";

  const tapeSel = select([
    { value: "", label: "— custom mm —" },
    ...Object.keys(TAPE_SIZES).map((k) => ({ value: k, label: k })),
  ]);

  const sizeIn = numberInput({
    value: DEFAULT_SIZE_MM,
    min: 4,
    max: 100,
    step: 0.5,
  });
  tapeSel.addEventListener("change", () => {
    if (tapeSel.value) sizeIn.value = String(TAPE_SIZES[tapeSel.value]);
  });

  const multIn = numberInput({ value: 1, min: 1, max: 100, step: 1 });

  const idsIn = input({
    type: "text",
    placeholder: "Comma-separated IDs",
  });
  const batchSel = select([
    { value: "", label: "— pick a batch —" },
    ...ctx.registry.batches().map((b) => ({ value: b, label: b })),
  ]);
  const statusSel = select([
    { value: "", label: "— any status —" },
    { value: "unbound", label: "unbound" },
    { value: "bound", label: "bound" },
    { value: "void", label: "void" },
  ]);

  const layoutExtrasContainer = el("div", { class: "layout-extras" });
  const updateLayoutExtras = () => {
    layoutExtrasContainer.innerHTML = "";
    const layout = getLayout(layoutSel.value);
    for (const f of layout?.optionFields?.() ?? []) {
      const inp = numberInput({
        value: f.default,
        min: f.min,
        max: f.max,
        step: f.step,
      });
      inp.dataset.fieldKey = f.key;
      layoutExtrasContainer.append(formRow([el("label", {}, f.label), inp]));
    }
  };
  layoutSel.addEventListener("change", updateLayoutExtras);
  updateLayoutExtras();

  const previewBtn = button({}, "Preview");
  const printBtn = button({ class: "primary" }, "Print");

  const status = el("p", { class: "muted" }, "Pick selection above. Preview shows the rendered labels; Print opens the OS print dialog.");
  const preview = el("div", { class: "label-preview" });

  const collectExtras = (): Record<string, number> => {
    const result: Record<string, number> = {};
    layoutExtrasContainer
      .querySelectorAll<HTMLInputElement>("input[data-field-key]")
      .forEach((inp) => {
        result[inp.dataset.fieldKey!] = parseFloat(inp.value);
      });
    return result;
  };

  const collectConfig = (): PrintConfig | string => {
    const layoutId = layoutSel.value;
    const size = parseFloat(sizeIn.value);
    if (!size || size <= 0) return "Size must be > 0.";
    const multiplicity = parseInt(multIn.value, 10);
    if (!multiplicity || multiplicity < 1) return "Multiplicity must be >= 1.";

    const ids = idsIn.value
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase().replace(/-/g, ""))
      .filter(Boolean);
    let selection: PrintConfig["selection"];
    if (ids.length > 0) {
      selection = { kind: "ids", ids };
    } else if (batchSel.value) {
      selection = { kind: "batch", batch: batchSel.value };
    } else if (statusSel.value) {
      selection = { kind: "status", status: statusSel.value as "unbound" | "bound" | "void" };
    } else {
      return "Specify IDs, a batch, or a status.";
    }
    return {
      layoutId,
      size,
      multiplicity,
      selection,
      layoutExtras: collectExtras(),
    };
  };

  previewBtn.addEventListener("click", () => {
    const config = collectConfig();
    if (typeof config === "string") {
      status.textContent = config;
      preview.innerHTML = "";
      return;
    }
    const rows = resolveSelection(ctx, config.selection);
    if (rows.length === 0) {
      status.textContent = "No matching IDs.";
      preview.innerHTML = "";
      return;
    }
    status.textContent = `${rows.length} ID(s) × ${config.multiplicity} copies = ${rows.length * config.multiplicity} labels.`;
    renderPreview(preview, rows, config);
  });

  printBtn.addEventListener("click", () => {
    const config = collectConfig();
    if (typeof config === "string") {
      status.textContent = config;
      return;
    }
    const rows = resolveSelection(ctx, config.selection);
    if (rows.length === 0) {
      status.textContent = "No matching IDs to print.";
      return;
    }
    openPrintWindow(rows, config);
  });

  root.append(
    formRow([el("label", {}, "Layout"), layoutSel]),
    formRow([el("label", {}, "Tape"), tapeSel, el("label", {}, "Size (mm)"), sizeIn]),
    layoutExtrasContainer,
    formRow([el("label", {}, "Copies per ID"), multIn]),
    el("h3", {}, "Selection"),
    formRow([el("label", {}, "IDs"), idsIn]),
    el("p", { class: "muted small" }, "or pick a batch / status:"),
    formRow([el("label", {}, "Batch"), batchSel]),
    formRow([el("label", {}, "Status"), statusSel]),
    formRow([previewBtn, printBtn]),
    status,
    preview,
  );
  return root;
}

function resolveSelection(
  ctx: AppContext,
  selection: PrintConfig["selection"],
): RegistryRow[] {
  switch (selection.kind) {
    case "ids":
      return selection.ids
        .map((id) => ctx.registry.findById(id))
        .filter((r): r is RegistryRow => Boolean(r));
    case "batch":
      return ctx.registry.find({ batch: selection.batch });
    case "status":
      return ctx.registry.find({ status: selection.status });
    case "all":
      return ctx.registry.all();
  }
}

function renderPreview(
  container: HTMLElement,
  rows: RegistryRow[],
  config: PrintConfig,
): void {
  const layout = getLayout(config.layoutId);
  if (!layout) return;
  container.innerHTML = "";
  // Show first 6 unique IDs, full list inline-only via Print.
  const sample = rows.slice(0, 6);
  for (const row of sample) {
    const svg = layout.renderSvg(row.id, layoutOptionsFor(layout, config));
    const wrap = el("div", { class: "label-preview__item" });
    wrap.innerHTML = svg;
    wrap.append(el("div", { class: "muted small" }, row.id));
    container.append(wrap);
  }
  if (rows.length > sample.length) {
    container.append(
      el(
        "div",
        { class: "muted small" },
        `… and ${rows.length - sample.length} more (printed in full).`,
      ),
    );
  }
}

function layoutOptionsFor(layout: Layout, config: PrintConfig): LayoutOptions {
  return {
    size: config.size,
    extra: { ...config.layoutExtras },
  };
  void layout;
}

// Open a print-only window with one @page per label so the printer
// auto-cuts between. Uses the same layout renderer the preview uses.
function openPrintWindow(rows: RegistryRow[], config: PrintConfig): void {
  const layout = getLayout(config.layoutId);
  if (!layout) return;
  const opts = layoutOptionsFor(layout, config);
  const dim = layout.measure(opts);

  const labels: string[] = [];
  for (const row of rows) {
    const svg = layout.renderSvg(row.id, opts);
    for (let i = 0; i < config.multiplicity; i++) {
      labels.push(svg);
    }
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Print labels</title>
<style>
  @page { size: ${dim.widthMm.toFixed(3)}mm ${dim.heightMm.toFixed(3)}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .label { width: ${dim.widthMm.toFixed(3)}mm; height: ${dim.heightMm.toFixed(3)}mm; page-break-after: always; break-after: page; overflow: hidden; }
  .label:last-child { page-break-after: auto; break-after: auto; }
  svg { display: block; }
</style></head>
<body onload="window.print(); setTimeout(() => window.close(), 500);">
${labels.map((s) => `<div class="label">${s}</div>`).join("\n")}
</body></html>`;

  const w = window.open("", "_blank", "width=400,height=600");
  if (!w) {
    alert("Pop-up blocked — allow pop-ups for this site to print.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
