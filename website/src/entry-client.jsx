import "./site.css";

// Static-site behavior for the docs app shell: desktop sidebar collapse
// (persisted) and the mobile bottom-drawer navigation. Mirrors the GUI shell
// in gui/web (SessionSidebar / SessionDrawer / MobileHeader) without shipping
// the React runtime.

const COLLAPSED_KEY = "opencandle-docs-sidebar-collapsed";
const root = document.documentElement;

function setCollapsed(collapsed) {
  if (collapsed) {
    root.dataset.sidebarCollapsed = "true";
  } else {
    delete root.dataset.sidebarCollapsed;
  }
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private-mode storage failures only lose persistence, not the toggle.
  }
}

document.querySelector("[data-sidebar-collapse]")?.addEventListener("click", () => {
  setCollapsed(true);
});
document.querySelector("[data-sidebar-expand]")?.addEventListener("click", () => {
  setCollapsed(false);
});

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
