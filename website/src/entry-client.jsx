import "./site.css";

// Static-site behavior for the shared shell: the mobile bottom-drawer
// navigation available from the navbar hamburger on every page. Mirrors the
// GUI drawer (gui/web SessionDrawer) without shipping the React runtime.

const root = document.documentElement;
const drawer = document.querySelector("[data-docs-drawer]");
const openButton = document.querySelector("[data-drawer-open]");
let closeTimer = null;

function openDrawer() {
  if (!drawer) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  delete drawer.dataset.closing;
  drawer.hidden = false;
  root.dataset.drawerOpen = "true";
  drawer.querySelector("a")?.focus();
}

function closeDrawer() {
  if (!drawer || drawer.hidden) return;
  delete root.dataset.drawerOpen;
  drawer.dataset.closing = "";
  closeTimer = setTimeout(() => {
    drawer.hidden = true;
    delete drawer.dataset.closing;
    closeTimer = null;
  }, 200);
  openButton?.focus();
}

openButton?.addEventListener("click", openDrawer);
drawer?.querySelector("[data-drawer-overlay]")?.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

const surfaceDemo = document.querySelector("[data-surface-demo]");

if (surfaceDemo) {
  const surfaceTabs = [...surfaceDemo.querySelectorAll("[data-surface-tab]")];
  const surfacePanels = [...surfaceDemo.querySelectorAll("[data-surface-panel]")];
  const surfaceVideos = [...surfaceDemo.querySelectorAll("[data-surface-video]")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function activateSurface(name, focus = false) {
    for (const tab of surfaceTabs) {
      const active = tab.dataset.surfaceTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }

    for (const panel of surfacePanels) {
      panel.hidden = panel.dataset.surfacePanel !== name;
    }

    for (const video of surfaceVideos) {
      const active = video.dataset.surfaceVideo === name;
      if (!active) {
        video.pause();
        continue;
      }

      if (!video.getAttribute("src") && video.dataset.src) {
        video.setAttribute("src", video.dataset.src);
        video.load();
      }

      if (!reducedMotion.matches && !document.hidden) {
        video.play().catch(() => {});
      }
    }
  }

  for (const tab of surfaceTabs) {
    tab.addEventListener("click", () => activateSurface(tab.dataset.surfaceTab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = surfaceTabs.indexOf(tab);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = (current + offset + surfaceTabs.length) % surfaceTabs.length;
      activateSurface(surfaceTabs[next].dataset.surfaceTab, true);
    });
  }

  reducedMotion.addEventListener("change", () => {
    const active = surfaceTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    if (reducedMotion.matches) {
      for (const video of surfaceVideos) video.pause();
    } else if (active) {
      activateSurface(active.dataset.surfaceTab);
    }
  });

  document.addEventListener("visibilitychange", () => {
    const active = surfaceTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    if (document.hidden) {
      for (const video of surfaceVideos) video.pause();
    } else if (active) {
      activateSurface(active.dataset.surfaceTab);
    }
  });

  activateSurface("gui");
}
