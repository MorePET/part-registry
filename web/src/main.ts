// Bootstrap — wire registry, tabs, plugins. Everything else is plug-in.

import "./style.css";

import { REPO_SLUG } from "./config";
import { createRegistry } from "./registry/registry";
import type {
  AppContext,
  Plugin,
  PluginHost,
  ToolbarButtonSpec,
} from "./core/types";
import { TABS } from "./tabs";
import { PLUGINS } from "./plugins";
import { el, button } from "./ui/dom";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app");

  const registry = createRegistry();

  // showTab is set after the tab system is wired below — but tabs
  // and plugins receive `ctx` early, so we reference a mutable holder.
  const ctxHolder: { showTab: (id: string) => void } = {
    showTab: () => {
      throw new Error("showTab called before tabs were wired");
    },
  };
  const ctx: AppContext = {
    registry,
    showTab: (id) => ctxHolder.showTab(id),
  };

  const layout = renderLayout();
  root.append(layout.shell);

  installPlugins(layout.toolbar, ctx, PLUGINS);

  layout.statusBar.textContent = "Loading registry…";
  try {
    await registry.load();
    layout.statusBar.textContent = `${registry.all().length} parts loaded.`;
  } catch (e) {
    layout.statusBar.textContent = `Registry load failed: ${(e as Error).message}`;
    layout.statusBar.classList.add("error");
    return;
  }

  const tabBar = el("nav", { class: "tabs" });
  const panel = el("section", { class: "tab-panel" });
  layout.main.append(tabBar, panel);

  const tabButtons = new Map<string, HTMLButtonElement>();
  let activeTabId = TABS[0]?.id;

  const showTab = async (id: string) => {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    activeTabId = id;
    for (const [k, btn] of tabButtons) {
      btn.classList.toggle("active", k === id);
    }
    await tab.mount(panel, ctx);
  };
  ctxHolder.showTab = (id) => void showTab(id);

  for (const tab of TABS) {
    const btn = button({ class: "tab-btn" }, tab.label);
    btn.addEventListener("click", () => void showTab(tab.id));
    tabButtons.set(tab.id, btn);
    tabBar.append(btn);
  }
  if (activeTabId) await showTab(activeTabId);
}

function renderLayout() {
  const shell = el("div", { class: "shell" });
  const header = el("header", { class: "shell__header" });
  const title = el("h1", { class: "shell__title" }, "part-registry");
  const repoLink = el("a", {
    class: "shell__repo",
    href: `https://github.com/${REPO_SLUG}`,
    target: "_blank",
    rel: "noopener",
  }, REPO_SLUG);
  const toolbar = el("div", { class: "shell__toolbar" });
  header.append(title, repoLink, toolbar);

  const main = el("main", { class: "shell__main" });
  const statusBar = el("div", { class: "shell__status muted" });

  shell.append(header, main, statusBar);
  return { shell, toolbar, main, statusBar };
}

function installPlugins(toolbar: HTMLElement, ctx: AppContext, plugins: Plugin[]): void {
  let pendingId = "";
  const host: PluginHost = {
    addToolbarButton(spec: ToolbarButtonSpec) {
      const btn = button(
        {
          class: "toolbar-btn",
          title: spec.title ?? spec.label,
          "data-plugin-button": pendingId,
        },
        spec.label,
      );
      btn.addEventListener("click", () => void spec.onClick());
      toolbar.append(btn);
      return () => btn.remove();
    },
    toast(message: string, kind: "info" | "error" = "info") {
      const t = el("div", { class: `toast toast--${kind}` }, message);
      document.body.append(t);
      setTimeout(() => t.remove(), 4000);
    },
  };
  for (const p of plugins) {
    pendingId = p.id;
    p.install(host, ctx);
  }
}

void main();
