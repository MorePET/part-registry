import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../core/types";
import type { Registry, RegistryQuery } from "../registry/registry";
import type { RegistryRow } from "../registry/schema";
import { lookupTab } from "./lookup";

const boundRow: RegistryRow = {
  id: "ABCDEFGHJKMNPQ",
  status: "bound",
  minted_at: "2026-05-08T12:00:00+00:00",
  batch: "B-2026-05-08",
  bound_at: "2026-05-08T12:30:00+00:00",
  type: "PT100",
  description: "Supply temperature sensor",
  vendor: "TC Direct",
  part_number: "402-141",
  location: "cooling loop / supply-T",
  notes: "bench fixture",
};

function makeRegistry(rows: RegistryRow[]): Registry {
  return {
    async load() {},
    all: () => rows,
    find(query: RegistryQuery) {
      if (query.id) return rows.filter((row) => row.id === query.id);
      if (query.prefix) return rows.filter((row) => row.id.startsWith(query.prefix!));
      return rows;
    },
    findById(id: string) {
      return rows.find((row) => row.id === id);
    },
    batches() {
      return [...new Set(rows.map((row) => row.batch))];
    },
  };
}

function makeContext(route: AppContext["getRoute"]): AppContext {
  return {
    registry: makeRegistry([boundRow]),
    showTab: vi.fn(),
    showPart: vi.fn(),
    getRoute: route,
  };
}

describe("lookupTab route-driven mount", () => {
  it("renders the routed part detail on mount", () => {
    const container = document.createElement("div");
    lookupTab.mount(container, makeContext(() => ({ kind: "part", id: boundRow.id })));

    expect(container.textContent).toContain(boundRow.type);
    expect(container.textContent).toContain(boundRow.location);
  });

  it("renders an invalid-id error for a bad routed segment", () => {
    const container = document.createElement("div");
    lookupTab.mount(container, makeContext(() => ({
      kind: "invalid-part-id",
      rawSegment: "ABCD-0FGH-JKMN-PQ",
      normalized: "ABCD0FGHJKMNPQ",
    })));

    expect(container.textContent).toContain("outside the canonical alphabet");
  });

  it("renders a not-found state for a valid but missing routed part", () => {
    const container = document.createElement("div");
    lookupTab.mount(container, makeContext(() => ({
      kind: "part",
      id: "23456789ABCDXY",
    })));

    expect(container.textContent).toContain('No match for "23456789ABCDXY"');
  });

  it("promotes a unique prefix hit into the exact part route", () => {
    const container = document.createElement("div");
    const ctx = makeContext(() => ({ kind: "home" }));
    lookupTab.mount(container, ctx);

    const query = container.querySelector('input[type="text"]') as HTMLInputElement;
    query.value = boundRow.id.slice(0, 8);
    const findBtn = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Find"));
    findBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ctx.showPart).toHaveBeenCalledWith(boundRow.id);
    expect(container.textContent).toContain(boundRow.type);
  });
});
