// SSOT for the registry row shape.
//
// This file is the single declaration of what a registry row looks like.
// Validators, table renderers, and bind-form generators all import from
// here — they never assume column names or set their own.
//
// Mirror any field-set change in:
//   - registry.csv header
//   - mint.py / bind.py REGISTRY_FIELDS
//   - validators (when added)
//   - test_labels.py (if it touches columns)
// SSOT here means: the *shape* lives in one place; the persistence
// layer (CSV) is one consumer of that shape, the FE is another.

export type Status = "unbound" | "bound" | "void";
export const STATUSES: readonly Status[] = ["unbound", "bound", "void"] as const;

export interface RegistryRow {
  id: string;
  status: Status;
  minted_at: string;
  batch: string;
  bound_at: string;
  type: string;
  description: string;
  vendor: string;
  part_number: string;
  location: string;
  notes: string;
}

// Field display metadata — shared by table view and bind form, so
// adding a column adds it to both views with one edit.
export interface FieldDef {
  key: keyof RegistryRow;
  label: string;
  // Editable on bind form? (id/minted_at/batch are immutable post-mint.)
  editable: boolean;
  // Status that this field becomes meaningful at.
  meaningfulFrom?: Status;
}

export const FIELDS: readonly FieldDef[] = [
  { key: "id", label: "ID", editable: false },
  { key: "status", label: "Status", editable: false },
  { key: "minted_at", label: "Minted at", editable: false },
  { key: "batch", label: "Batch", editable: false },
  { key: "bound_at", label: "Bound at", editable: false, meaningfulFrom: "bound" },
  { key: "type", label: "Type", editable: true, meaningfulFrom: "bound" },
  { key: "description", label: "Description", editable: true, meaningfulFrom: "bound" },
  { key: "vendor", label: "Vendor", editable: true, meaningfulFrom: "bound" },
  { key: "part_number", label: "Part number", editable: true, meaningfulFrom: "bound" },
  { key: "location", label: "Location", editable: true, meaningfulFrom: "bound" },
  { key: "notes", label: "Notes", editable: true },
] as const;

export const REGISTRY_FIELD_KEYS = FIELDS.map((f) => f.key);
