// Lookup tab — searchable data-grid over the registry (issue #10).
//
// Per ADR-013 + ADR-014 §Consequences: the Lookup tab is the operator's
// primary view. This implementation:
//
//   - top toolbar with fuzzy search + status filter + scan button
//   - table view (sticky header) with every part, status-coloured
//   - dashboard view with aggregate stats by batch/location/vendor/status (#98)
//   - row click expands a detail card inline (with Reprint action +
//     a deep-link via `ctx.showPart`)
//   - works for the 0-row case (empty registry → friendly empty state)
//
// Inline edit ships in PR-D (#6) via the bind queue.

import Fuse from "fuse.js";

import { ID_LENGTH, ID_REGEX } from "../config";
import { FIELDS, STATUSES, type RegistryRow, type Status } from "../registry/schema";
import { appendEdit } from "../registry/queue";
import type { AppContext, Tab } from "../core/types";
import { normalizeCanonicalId } from "../routing/route";
import {
  events,
  EVENT_REPRINT_REQUEST,
  type ReprintRequest,
} from "../core/events";
import { el, button, input, formRow } from "../ui/dom";
import { icon } from "../ui/icons";
import { openScanner, type ScanStatus } from "../ui/scanner";

type StatusFilter = "all" | Status;
type ViewMode = "table" | "dashboard";

// Columns surfaced in the table view. Subset of `FIELDS` chosen for
// at-a-glance density: id + status + the discriminating metadata
// fields. Edit / Reprint live in the row action cell.
const COLUMNS: { key: keyof RegistryRow; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
  { key: "vendor", label: "Vendor" },
  { key: "batch", label: "Batch" },
  { key: "location", label: "Location" },
];

function fmtId(id: string): string {
  // 4-4-4 grouping for display; underlying value stays canonical.
  if (id.length < 12) return id;
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}${
    id.length > 12 ? "-" + id.slice(12) : ""
  }`;
}

export const lookupTab: Tab = {
  id: "lookup",
  label: "Lookup",
  mount(container, ctx) {
    container.innerHTML = "";
    container.append(buildUI(ctx));
  },
};

// ---------- Aggregation helpers (#98) ----------

interface StatusCounts {
  unbound: number;
  bound: number;
  void: number;
}

function countStatuses(rows: RegistryRow[]): StatusCounts {
  const c: StatusCounts = { unbound: 0, bound: 0, void: 0 };
  for (const r of rows) {
    if (r.status === "unbound") c.unbound++;
    else if (r.status === "bound") c.bound++;
    else if (r.status === "void") c.void++;
  }
  return c;
}

interface BatchGroup {
  name: string;
  rows: RegistryRow[];
  counts: StatusCounts;
  oldestMinted: string;
}

function groupByBatch(rows: RegistryRow[]): BatchGroup[] {
  const map = new Map<string, RegistryRow[]>();
  for (const r of rows) {
    const key = r.batch || "(no batch)";
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()].map(([name, group]) => {
    const minted = group
      .map((r) => r.minted_at)
      .filter(Boolean)
      .sort();
    return {
      name,
      rows: group,
      counts: countStatuses(group),
      oldestMinted: minted[0] || "—",
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

interface LocationGroup {
  name: string;
  count: number;
  types: string[];
}

function groupByLocation(rows: RegistryRow[]): LocationGroup[] {
  const map = new Map<string, { count: number; types: Set<string> }>();
  for (const r of rows) {
    const key = r.location || "(no location)";
    let entry = map.get(key);
    if (!entry) { entry = { count: 0, types: new Set() }; map.set(key, entry); }
    entry.count++;
    if (r.type) entry.types.add(r.type);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, count: v.count, types: [...v.types].sort() }))
    .sort((a, b) => b.count - a.count);
}

interface VendorGroup {
  name: string;
  count: number;
  types: string[];
  counts: StatusCounts;
}

function groupByVendor(rows: RegistryRow[]): VendorGroup[] {
  const map = new Map<string, { rows: RegistryRow[]; types: Set<string> }>();
  for (const r of rows) {
    const key = r.vendor || "(no vendor)";
    let entry = map.get(key);
    if (!entry) { entry = { rows: [], types: new Set() }; map.set(key, entry); }
    entry.rows.push(r);
    if (r.type) entry.types.add(r.type);
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      count: v.rows.length,
      types: [...v.types].sort(),
      counts: countStatuses(v.rows),
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------- Dashboard rendering (#98) ----------

function statusBadge(status: Status, count: number): HTMLElement {
  return el("span", { class: `chip chip--status chip--${status}` }, `${count} ${status}`);
}

function progressBar(counts: StatusCounts, total: number): HTMLElement {
  const bar = el("div", { class: "dash__progress" });
  if (total === 0) return bar;
  for (const s of ["unbound", "bound", "void"] as const) {
    const pct = (counts[s] / total) * 100;
    if (pct > 0) {
      bar.append(el("div", {
        class: `dash__progress-seg dash__progress--${s}`,
        style: `width:${pct}%`,
        title: `${counts[s]} ${s} (${pct.toFixed(1)}%)`,
      }));
    }
  }
  return bar;
}

function collapsibleSection(
  title: string,
  content: HTMLElement,
  startOpen = true,
): HTMLElement {
  const section = el("article", { class: "dash__section" });
  const header = el("header", { class: "dash__section-header" });
  const toggle = el("span", { class: "dash__toggle" }, startOpen ? "\u25BC" : "\u25B6");
  header.append(toggle, el("strong", {}, ` ${title}`));
  header.style.cursor = "pointer";
  content.style.display = startOpen ? "" : "none";
  header.addEventListener("click", () => {
    const open = content.style.display !== "none";
    content.style.display = open ? "none" : "";
    toggle.textContent = open ? "\u25B6" : "\u25BC";
  });
  section.append(header, content);
  return section;
}

function renderDashboard(
  rows: RegistryRow[],
  switchToTableWithFilter: (key: string, value: string) => void,
): HTMLElement {
  const wrap = el("div", { class: "dash" });
  const total = rows.length;
  const counts = countStatuses(rows);
  const batches = new Set(rows.map((r) => r.batch).filter(Boolean));

  // ---- Summary cards ----
  const cards = el("div", { class: "dash__cards" });
  cards.append(
    el("article", { class: "dash__card" },
      el("div", { class: "dash__card-value" }, String(total)),
      el("div", { class: "dash__card-label" }, "Total parts"),
    ),
    el("article", { class: "dash__card" },
      el("div", { class: "dash__card-badges" },
        statusBadge("unbound", counts.unbound),
        statusBadge("bound", counts.bound),
        statusBadge("void", counts.void),
      ),
      el("div", { class: "dash__card-label" }, "By status"),
    ),
    el("article", { class: "dash__card" },
      el("div", { class: "dash__card-value" }, String(batches.size)),
      el("div", { class: "dash__card-label" }, "Batches"),
    ),
  );
  wrap.append(cards);

  // ---- By Batch ----
  const batchGroups = groupByBatch(rows);
  const batchContent = el("div", { class: "dash__group-list" });
  for (const g of batchGroups) {
    const row = el("div", { class: "dash__group-row dash__group-row--clickable" });
    row.append(
      el("div", { class: "dash__group-name" }, g.name),
      el("div", { class: "dash__group-count" }, `${g.rows.length} parts`),
      el("div", { class: "dash__group-meta" },
        statusBadge("unbound", g.counts.unbound),
        statusBadge("bound", g.counts.bound),
        statusBadge("void", g.counts.void),
      ),
      el("div", { class: "dash__group-detail muted small" }, `oldest: ${g.oldestMinted}`),
    );
    row.addEventListener("click", () => switchToTableWithFilter("batch", g.name));
    batchContent.append(row);
  }
  wrap.append(collapsibleSection(`By Batch (${batchGroups.length})`, batchContent));

  // ---- By Location ----
  const locGroups = groupByLocation(rows);
  const locContent = el("div", { class: "dash__group-list" });
  for (const g of locGroups) {
    const row = el("div", { class: "dash__group-row dash__group-row--clickable" });
    row.append(
      el("div", { class: "dash__group-name" }, g.name),
      el("div", { class: "dash__group-count" }, `${g.count} parts`),
      el("div", { class: "dash__group-detail muted small" },
        g.types.length > 0 ? g.types.join(", ") : "—",
      ),
    );
    row.addEventListener("click", () => switchToTableWithFilter("location", g.name));
    locContent.append(row);
  }
  wrap.append(collapsibleSection(`By Location (${locGroups.length})`, locContent));

  // ---- By Vendor ----
  const vendorGroups = groupByVendor(rows);
  const vendorContent = el("div", { class: "dash__group-list" });
  for (const g of vendorGroups) {
    const row = el("div", { class: "dash__group-row dash__group-row--clickable" });
    row.append(
      el("div", { class: "dash__group-name" }, g.name),
      el("div", { class: "dash__group-count" }, `${g.count} parts`),
      el("div", { class: "dash__group-meta" },
        statusBadge("unbound", g.counts.unbound),
        statusBadge("bound", g.counts.bound),
        statusBadge("void", g.counts.void),
      ),
      el("div", { class: "dash__group-detail muted small" },
        g.types.length > 0 ? g.types.join(", ") : "—",
      ),
    );
    row.addEventListener("click", () => switchToTableWithFilter("vendor", g.name));
    vendorContent.append(row);
  }
  wrap.append(collapsibleSection(`By Vendor (${vendorGroups.length})`, vendorContent));

  // ---- By Status (progress bar visualization) ----
  const statusContent = el("div", { class: "dash__group-list" });
  statusContent.append(progressBar(counts, total));
  for (const s of ["unbound", "bound", "void"] as const) {
    const pct = total > 0 ? ((counts[s] / total) * 100).toFixed(1) : "0";
    const row = el("div", { class: "dash__group-row dash__group-row--clickable" });
    row.append(
      statusBadge(s, counts[s]),
      el("div", { class: "dash__group-detail muted small" }, `${pct}%`),
    );
    row.addEventListener("click", () => switchToTableWithFilter("status", s));
    statusContent.append(row);
  }
  wrap.append(collapsibleSection("By Status", statusContent));

  return wrap;
}

// ---------- Main UI builder ----------

function buildUI(ctx: AppContext): HTMLElement {
  const root = el("div", { class: "tab tab--lookup" });
  const header = el("h2", {}, "Lookup");
  root.append(header);

  // ---------- view toggle ----------
  let viewMode: ViewMode = "table";
  const viewToggle = el("div", { class: "lookup__view-toggle" });
  const tableBtn = button({ class: "chip chip--filter active" }, "Table");
  const dashBtn = button({ class: "chip chip--filter" }, "Dashboard");
  viewToggle.append(tableBtn, dashBtn);

  function setViewMode(mode: ViewMode) {
    viewMode = mode;
    tableBtn.classList.toggle("active", mode === "table");
    dashBtn.classList.toggle("active", mode === "dashboard");
    render();
  }
  tableBtn.addEventListener("click", () => setViewMode("table"));
  dashBtn.addEventListener("click", () => setViewMode("dashboard"));

  // ---------- toolbar ----------
  const searchInput = input({
    type: "search",
    placeholder: "Fuzzy search (id, type, vendor, batch, notes…)",
    autocomplete: "off",
    class: "lookup__search",
  });

  const statusBtns = new Map<StatusFilter, HTMLButtonElement>();
  let statusFilter: StatusFilter = "all";
  const statusBar = el("div", { class: "lookup__status-filter" });
  for (const s of ["all", "unbound", "bound", "void"] as const) {
    const btn = button({ class: `chip chip--filter ${s === "all" ? "active" : ""}` }, s);
    btn.addEventListener("click", () => {
      statusFilter = s;
      for (const [k, b] of statusBtns) {
        b.classList.toggle("active", k === s);
      }
      render();
    });
    statusBtns.set(s, btn);
    statusBar.append(btn);
  }

  const scanBtn = button(
    { class: "icon-only", title: "Scan QR with camera" },
    icon("camera"),
  );
  scanBtn.addEventListener("click", async () => {
    try {
      const text = await openScanner({
        multi: true,
        resolveStatus: (canonical): ScanStatus => {
          const row = ctx.registry.findById(canonical);
          if (!row) return "unknown";
          if (row.status === "unbound") return "unbound";
          return "bound";
        },
      });
      searchInput.value = text;
      render();
    } catch {
      /* cancelled */
    }
  });

  root.append(
    formRow([searchInput, scanBtn]),
    statusBar,
    viewToggle,
  );

  // ---------- content area (table or dashboard) ----------
  const contentArea = el("div", { class: "lookup__content" });
  root.append(contentArea);

  const detailCell = el("div", { class: "lookup__detail" });
  root.append(detailCell);

  // Fuse index is rebuilt whenever the registry slice we're showing
  // changes — but the registry itself doesn't mutate during a session
  // (writes go through PR submission), so building once is enough.
  const all = ctx.registry.all();
  const fuse = new Fuse(all, {
    keys: ["id", "type", "vendor", "batch", "location", "notes", "description", "part_number"],
    threshold: 0.4,
    ignoreLocation: true,
  });

  /** Resolve the current filtered row set (shared by table + dashboard). */
  function filteredRows(): RegistryRow[] {
    const q = searchInput.value.trim();
    let rows: RegistryRow[];
    if (!q) {
      rows = all;
    } else {
      const norm = normalizeCanonicalId(q);
      const looksLikeId = ID_REGEX.test(norm) && norm.length === ID_LENGTH;
      if (looksLikeId) {
        const exact = ctx.registry.findById(norm);
        rows = exact ? [exact] : [];
      } else {
        rows = fuse.search(q).map((r) => r.item);
      }
    }
    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    return rows;
  }

  /** Render the active view (table or dashboard) into contentArea. */
  function render() {
    contentArea.innerHTML = "";
    detailCell.innerHTML = "";

    if (viewMode === "dashboard") {
      renderDashboardView();
    } else {
      renderTableView();
    }
  }

  function renderDashboardView() {
    const rows = filteredRows();
    const dash = renderDashboard(rows, (key, value) => {
      // Switch back to table view with the clicked group as a search filter
      if (key === "status") {
        const s = value as StatusFilter;
        statusFilter = s;
        for (const [k, b] of statusBtns) {
          b.classList.toggle("active", k === s);
        }
        searchInput.value = "";
      } else {
        statusFilter = "all";
        for (const [k, b] of statusBtns) {
          b.classList.toggle("active", k === "all");
        }
        // Use the raw value for filtering — strip "(no ...)" sentinel
        const filterVal = value.startsWith("(no ") ? "" : value;
        searchInput.value = filterVal;
      }
      setViewMode("table");
    });
    contentArea.append(dash);
  }

  function renderTableView() {
    const tableWrap = el("div", { class: "lookup__table-wrap" });
    const table = el("table", { class: "data lookup__table" });
    const thead = el("thead");
    const headRow = el("tr");
    for (const col of COLUMNS) headRow.append(el("th", {}, col.label));
    headRow.append(el("th", { class: "lookup__th-actions" }, ""));
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    table.append(tbody);
    tableWrap.append(table);
    contentArea.append(tableWrap);

    const rows = filteredRows();

    if (rows.length === 0) {
      const td = el("td", { colspan: String(COLUMNS.length + 1), class: "muted" });
      td.append(
        all.length === 0
          ? "Registry is empty. Mint some IDs via the CLI first."
          : "No matches.",
      );
      tbody.append(el("tr", {}, td));
      return;
    }

    for (const row of rows) {
      const tr = el("tr", { "data-id": row.id, class: `status-${row.status}` });
      for (const col of COLUMNS) {
        const value = row[col.key] ?? "";
        let cell: HTMLElement;
        if (col.key === "id") {
          cell = el("td", { class: "id-cell" });
          cell.append(fmtId(row.id));
        } else if (col.key === "status") {
          cell = el("td");
          cell.append(el("span", { class: `chip chip--status chip--${row.status}` }, row.status));
        } else {
          cell = el("td", {}, value || el("span", { class: "muted" }, "—"));
        }
        tr.append(cell);
      }
      const reprintBtn = button(
        { class: "icon-only", title: "Reprint label" },
        icon("reprint"),
      );
      reprintBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        events.emit<ReprintRequest>(EVENT_REPRINT_REQUEST, { ids: [row.id] });
        ctx.showTab("print");
      });
      tr.append(el("td", { class: "row-actions" }, reprintBtn));
      tr.addEventListener("click", () => {
        ctx.showPart(row.id);
        detailCell.innerHTML = "";
        detailCell.append(renderDetailView(row, ctx));
      });
      tbody.append(tr);
    }
  }

  searchInput.addEventListener("input", () => render());

  // Deep-link: if URL is /<ID>, open the detail card directly.
  const route = ctx.getRoute();
  if (route.kind === "part") {
    searchInput.value = route.id;
  }
  render();
  if (route.kind === "part") {
    const row = ctx.registry.findById(route.id);
    if (row) detailCell.append(renderDetailView(row, ctx));
  }

  return root;
}

// Fields the operator can edit from the Lookup detail card.
// `status` is editable here (not in the bind form) because mid-life
// status changes ("mark void") are an edit-only operation per #6.
const EDIT_FIELD_KEYS: (keyof RegistryRow)[] = [
  "status",
  "type",
  "description",
  "vendor",
  "part_number",
  "location",
  "notes",
];

function renderDetailView(row: RegistryRow, ctx: AppContext): HTMLElement {
  const wrap = el("div", { class: "row-detail" });
  wrap.append(el("h3", { class: "row-detail__id" }, fmtId(row.id)));
  const dl = el("dl");
  for (const f of FIELDS) {
    const value = (row as unknown as Record<string, string>)[f.key] ?? "";
    dl.append(el("dt", {}, f.label));
    dl.append(
      el(
        "dd",
        {},
        value || el("span", { class: "muted" }, "—"),
      ),
    );
  }
  wrap.append(dl);

  const editBtn = button(
    { class: "secondary row-detail__edit" },
    icon("plus"),
    " Edit",
  );
  editBtn.addEventListener("click", () => {
    const replacement = renderDetailEdit(row, ctx);
    wrap.replaceWith(replacement);
  });

  const reprintBtn = button(
    { class: "primary" },
    icon("reprint"),
    " Reprint label",
  );
  reprintBtn.addEventListener("click", () => {
    events.emit<ReprintRequest>(EVENT_REPRINT_REQUEST, { ids: [row.id] });
  });
  wrap.append(formRow([editBtn, reprintBtn]));
  return wrap;
}

function renderDetailEdit(row: RegistryRow, ctx: AppContext): HTMLElement {
  const wrap = el("div", { class: "row-detail row-detail--edit" });
  wrap.append(el("h3", { class: "row-detail__id" }, fmtId(row.id)));

  const form = el("form", { class: "row-detail__form" });
  const inputs = new Map<keyof RegistryRow, HTMLInputElement | HTMLSelectElement>();

  for (const key of EDIT_FIELD_KEYS) {
    const fieldDef = FIELDS.find((f) => f.key === key);
    const label = fieldDef?.label ?? key;
    const value = (row as unknown as Record<string, string>)[key] ?? "";

    const labelEl = el("label", { class: "row-detail__field" });
    labelEl.append(el("span", { class: "row-detail__label" }, label));

    let field: HTMLInputElement | HTMLSelectElement;
    if (key === "status") {
      const select = document.createElement("select");
      for (const s of STATUSES) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        if (s === row.status) opt.selected = true;
        select.append(opt);
      }
      field = select;
    } else {
      field = input({ type: "text", value });
    }
    field.classList.add("row-detail__input");
    field.dataset.key = key;
    inputs.set(key, field);
    labelEl.append(field);
    form.append(labelEl);
  }
  wrap.append(form);

  const errMsg = el("p", { class: "row-detail__error muted small" });
  wrap.append(errMsg);

  const saveBtn = button({ class: "primary", type: "button" }, icon("plus"), " Queue edit");
  saveBtn.addEventListener("click", () => {
    const changes: Partial<RegistryRow> = {};
    const before: Partial<RegistryRow> = {};
    for (const key of EDIT_FIELD_KEYS) {
      const field = inputs.get(key);
      if (!field) continue;
      const newVal = field.value;
      const oldVal = (row as unknown as Record<string, string>)[key] ?? "";
      if (newVal !== oldVal) {
        (changes as Record<string, string>)[key] = newVal;
        (before as Record<string, string>)[key] = oldVal;
      }
    }
    if (Object.keys(changes).length === 0) {
      errMsg.textContent = "No changes to queue.";
      return;
    }
    // Guardrail per #6: void → bound is a privileged transition.
    if (row.status === "void" && changes.status && changes.status !== "void") {
      if (!confirm(
        `${row.id} is voided. Re-binding a voided ID requires the back-office --force ` +
          `equivalent (not implemented in the FE). Queue anyway?`,
      )) {
        return;
      }
    }
    appendEdit(row.id, before, changes);
    ctx.showTab("bind");
  });

  const cancelBtn = button({ type: "button" }, "Cancel");
  cancelBtn.addEventListener("click", () => {
    wrap.replaceWith(renderDetailView(row, ctx));
  });

  wrap.append(formRow([saveBtn, cancelBtn]));
  return wrap;
}
