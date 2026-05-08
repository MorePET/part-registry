// Registry data layer — single access point for reading registry.csv.
//
// SOLID — Dependency Inversion: tabs depend on the `Registry` interface,
// never on `fetch` or CSV parsing details. To swap the storage (e.g.
// later: read from DuckDB-WASM, or an HTTP API), implement the same
// interface.

import Papa from "papaparse";
import { REGISTRY_URL } from "../config";
import type { RegistryRow, Status } from "./schema";

export interface RegistryQuery {
  id?: string;
  prefix?: string;
  batch?: string;
  status?: Status;
}

export interface Registry {
  load(): Promise<void>;
  all(): RegistryRow[];
  find(query: RegistryQuery): RegistryRow[];
  findById(id: string): RegistryRow | undefined;
  batches(): string[];
}

class CSVRegistry implements Registry {
  private rows: RegistryRow[] = [];
  private byId = new Map<string, RegistryRow>();

  async load(): Promise<void> {
    const res = await fetch(REGISTRY_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        `Failed to load registry from ${REGISTRY_URL}: ${res.status} ${res.statusText}`,
      );
    }
    const text = await res.text();
    const parsed = Papa.parse<RegistryRow>(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      console.warn("Registry CSV parse warnings:", parsed.errors);
    }
    this.rows = parsed.data.filter((r) => r.id);
    this.byId = new Map(this.rows.map((r) => [r.id, r]));
  }

  all(): RegistryRow[] {
    return this.rows;
  }

  find(query: RegistryQuery): RegistryRow[] {
    let out = this.rows;
    if (query.id) {
      const hit = this.byId.get(query.id);
      out = hit ? [hit] : [];
    }
    if (query.prefix) {
      const p = query.prefix.toUpperCase().replace(/-/g, "");
      out = out.filter((r) => r.id.startsWith(p));
    }
    if (query.batch) {
      out = out.filter((r) => r.batch === query.batch);
    }
    if (query.status) {
      out = out.filter((r) => r.status === query.status);
    }
    return out;
  }

  findById(id: string): RegistryRow | undefined {
    return this.byId.get(id);
  }

  batches(): string[] {
    return [...new Set(this.rows.map((r) => r.batch).filter(Boolean))].sort();
  }
}

// Singleton — one registry per page load. Tabs receive it via AppContext.
export function createRegistry(): Registry {
  return new CSVRegistry();
}
