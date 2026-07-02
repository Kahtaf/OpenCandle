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
