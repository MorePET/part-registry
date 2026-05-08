// Bind tab — UI scaffold for queueing binds. The submit step (open a
// PR via the GitHub API) is stubbed for the spike; the queue persists
// to localStorage so it survives reloads. Phase 2 fills in the API
// flow per ADR-013.

import { ID_REGEX } from "../config";
import { FIELDS } from "../registry/schema";
import type { AppContext, Tab } from "../core/types";
import { el, button, input, formRow } from "../ui/dom";

const QUEUE_KEY = "part-registry.bind-queue";

interface QueuedBind {
  id: string;
  type: string;
  description: string;
  vendor: string;
  part_number: string;
  location: string;
  notes: string;
  queued_at: string;
}

function loadQueue(): QueuedBind[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedBind[];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedBind[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export const bindTab: Tab = {
  id: "bind",
  label: "Bind",
  mount(container, ctx) {
    container.innerHTML = "";
    container.append(buildUI(ctx));
  },
};

function buildUI(ctx: AppContext): HTMLElement {
  const root = el("div", { class: "tab tab--bind" });
  root.append(el("h2", {}, "Bind"));
  root.append(
    el(
      "p",
      { class: "muted" },
      "Queue binds locally; submit as a single PR when you're done. (Submit-as-PR is stubbed in this spike — the queue is real and persists across reloads.)",
    ),
  );

  const idIn = input({
    type: "text",
    placeholder: "12-char canonical ID",
    autocapitalize: "characters",
  });

  const editableFields = FIELDS.filter((f) => f.editable);
  const fieldInputs = new Map<string, HTMLInputElement>();
  const fieldRows: HTMLElement[] = [];
  for (const f of editableFields) {
    const inp = input({ type: "text", placeholder: f.label });
    fieldInputs.set(f.key, inp);
    fieldRows.push(formRow([el("label", {}, f.label), inp]));
  }

  const addBtn = button({ class: "primary" }, "Queue bind");
  const submitBtn = button({}, "Submit batch (stub)");
  const clearBtn = button({}, "Clear queue");

  const queueList = el("ul", { class: "queue" });

  const renderQueue = () => {
    queueList.innerHTML = "";
    const q = loadQueue();
    if (q.length === 0) {
      queueList.append(el("li", { class: "muted" }, "Queue is empty."));
      return;
    }
    for (const item of q) {
      queueList.append(
        el(
          "li",
          {},
          el("strong", {}, item.id),
          ` — ${item.type || "(no type)"} @ ${item.location || "—"}`,
        ),
      );
    }
  };
  renderQueue();

  addBtn.addEventListener("click", () => {
    const id = idIn.value.trim().toUpperCase().replace(/-/g, "");
    if (!ID_REGEX.test(id)) {
      alert("ID must be 12 chars from the canonical alphabet.");
      return;
    }
    const existing = ctx.registry.findById(id);
    if (!existing) {
      if (!confirm(`${id} is not in the loaded registry. Queue anyway?`)) return;
    } else if (existing.status === "void") {
      alert(`${id} is voided. Cannot bind.`);
      return;
    }
    const entry: QueuedBind = {
      id,
      queued_at: new Date().toISOString(),
      type: fieldInputs.get("type")?.value ?? "",
      description: fieldInputs.get("description")?.value ?? "",
      vendor: fieldInputs.get("vendor")?.value ?? "",
      part_number: fieldInputs.get("part_number")?.value ?? "",
      location: fieldInputs.get("location")?.value ?? "",
      notes: fieldInputs.get("notes")?.value ?? "",
    };
    const q = loadQueue();
    q.push(entry);
    saveQueue(q);
    idIn.value = "";
    fieldInputs.forEach((i) => (i.value = ""));
    renderQueue();
  });

  submitBtn.addEventListener("click", () => {
    const q = loadQueue();
    if (q.length === 0) {
      alert("Queue is empty.");
      return;
    }
    // STUB — phase 2 work item: GitHub OAuth device flow + REST API
    // batch PR creation. See part-registry#1.
    console.log("Pending binds (would be POSTed as a single PR):", q);
    alert(
      `${q.length} bind(s) would be submitted as one PR.\n\nGitHub API integration is the phase-2 work tracked in issue #1; for now the queue stays in localStorage.`,
    );
  });

  clearBtn.addEventListener("click", () => {
    if (loadQueue().length === 0) return;
    if (!confirm("Clear the bind queue without submitting?")) return;
    saveQueue([]);
    renderQueue();
  });

  root.append(
    formRow([el("label", {}, "ID"), idIn]),
    ...fieldRows,
    formRow([addBtn, submitBtn, clearBtn]),
    el("h3", {}, "Queue"),
    queueList,
  );
  return root;
}
