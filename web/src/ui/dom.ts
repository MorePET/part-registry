// Tiny DOM helpers — DRY: tabs and plugins use these instead of
// manually constructing elements. Keeps form/row/button styling
// consistent and centralizes any future a11y/i18n hooks.

type Children = (Node | string)[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === undefined) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function input(attrs: Record<string, string | number>): HTMLInputElement {
  const node = document.createElement("input");
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function number(attrs: { value: number; min?: number; max?: number; step?: number }): HTMLInputElement {
  const inp = input({
    type: "number",
    value: String(attrs.value),
    ...(attrs.min !== undefined ? { min: String(attrs.min) } : {}),
    ...(attrs.max !== undefined ? { max: String(attrs.max) } : {}),
    ...(attrs.step !== undefined ? { step: String(attrs.step) } : {}),
  });
  return inp;
}

export function button(
  attrs: Record<string, string> = {},
  ...children: Children
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function select(
  options: { value: string; label: string }[],
): HTMLSelectElement {
  const node = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    node.append(o);
  }
  return node;
}

export function formRow(children: (Node | string)[]): HTMLElement {
  const row = el("div", { class: "form-row" });
  for (const c of children) {
    row.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return row;
}
