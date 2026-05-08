# web/ — part-registry SPA

Static site that scans QRs, looks up parts, prints labels via the OS
print dialog, and queues binds for batched PR submission. Deployed to
GitHub Pages (`https://morepet.github.io/part-registry/`) by the
[`pages.yml`](../.github/workflows/pages.yml) workflow on every push
to `main` that touches `web/**` or `registry.csv`.

## Architecture

Three extension points, each with a small interface in
[`src/core/types.ts`](src/core/types.ts):

| Interface | Add a new… by | Examples |
|---|---|---|
| `Tab` | dropping a file in `src/tabs/` and registering | Lookup, Print, Bind |
| `Layout` | dropping a file in `src/layouts/` and registering | vert, horz, flag |
| `Plugin` | dropping a file in `src/plugins/` and registering | error report (more later) |

Single sources of truth:

- [`src/config.ts`](src/config.ts) — repo slug, registry URL, ID
  alphabet/length/regex, QR border, tape sizes, default size.
- [`src/registry/schema.ts`](src/registry/schema.ts) — registry row
  shape + field metadata. Imported by lookup detail view, bind form,
  validators (when added).
- [`src/registry/registry.ts`](src/registry/registry.ts) — sole entry
  point for reading registry data. Tabs depend on the `Registry`
  interface, never on `fetch` or CSV parsing details (Dependency
  Inversion).

## Scripts

```bash
npm install
npm run dev          # local dev with HMR
npm run build        # type-check + production bundle to dist/
npm run preview      # serve the built bundle
```

## Drift risk: TS port of label.py

The SVG layout renderers in [`src/layouts/`](src/layouts/) are a
TypeScript port of the Python `label.py` in the repo root. Two
implementations of the same logic mean drift is possible — and the
test suite (`test_labels.py`) only validates the Python side.

The intended long-term fix per [ADR-013](../decisions/ADR-013-parts-registry-web-app.md):
load `label.py` via Pyodide so the FE and CLI run literally the same
code. Until that lands, any edit to a layout in either language must
be mirrored in the other and verified by re-running the Python
roundtrip suite. The ADR-014 status section tracks this debt.

## Deployment

The repo's GitHub Pages settings need to be set to **Source: GitHub
Actions** (not "deploy from a branch") for the `pages.yml` workflow to
publish. After the first push to `main`, set this once at:
`https://github.com/MorePET/part-registry/settings/pages`.
