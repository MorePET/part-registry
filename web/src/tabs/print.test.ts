import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../core/types";
import type { Registry, RegistryQuery } from "../registry/registry";
import type { RegistryRow } from "../registry/schema";
import { printTab } from "./print";

const PLAN_KEY = "part-registry.print-plan";

const boundRow: RegistryRow = {
  id: "K7M3PQ9RT5VAXY",
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
      if (query.batch) return rows.filter((row) => row.batch === query.batch);
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

function makeContext(): AppContext {
  return {
    registry: makeRegistry([boundRow]),
    showTab: vi.fn(),
    showPart: vi.fn(),
    getRoute: () => ({ kind: "home" }),
  };
}

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe("printTab", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders saved plan rows using the same 4/4 visible ID format as printed labels", () => {
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify([
        {
          id: boundRow.id,
          layoutId: "horz",
          size: 11,
          copies: 2,
          extras: {},
        },
      ]),
    );

    const container = document.createElement("div");
    printTab.mount(container, makeContext());

    expect(container.textContent).toContain("K7M3-PQ9R");
    expect(container.textContent).not.toContain("K7M3-PQ9R-T5VA-XY");
    expect(container.textContent).toContain("1 item(s) · 2 label(s) total.");
  });
});
