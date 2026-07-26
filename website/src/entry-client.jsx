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
const surfaceCommandText = document.querySelector("[data-surface-command-text]");
const commandCopyButton = document.querySelector("[data-command-copy]");

if (surfaceDemo) {
  const surfaceTabs = [...surfaceDemo.querySelectorAll("[data-surface-tab]")];
  const surfacePanels = [...surfaceDemo.querySelectorAll("[data-surface-panel]")];
  const surfaceVideos = [...surfaceDemo.querySelectorAll("[data-surface-video]")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function activateSurface(name, focus = false) {
    surfaceDemo.dataset.surfaceActive = name;

    if (surfaceCommandText) {
      surfaceCommandText.textContent =
        name === "tui" ? "npx opencandle@latest" : "npx opencandle@latest gui";
    }

    for (const tab of surfaceTabs) {
      const active = tab.dataset.surfaceTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }

    for (const panel of surfacePanels) {
      const active = panel.dataset.surfacePanel === name;
      panel.setAttribute("aria-hidden", String(!active));
      if (active) {
        panel.removeAttribute("inert");
      } else {
        panel.setAttribute("inert", "");
      }
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

const answerTabsRoot = document.querySelector("[data-answer-tabs]");

if (answerTabsRoot) {
  const answerTabs = [...answerTabsRoot.querySelectorAll("[data-answer-tab]")];
  const answerPanels = [...answerTabsRoot.querySelectorAll("[data-answer-panel]")];

  function activateAnswer(name, focus = false) {
    for (const tab of answerTabs) {
      const active = tab.dataset.answerTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }

    for (const panel of answerPanels) {
      panel.hidden = panel.dataset.answerPanel !== name;
    }
  }

  for (const tab of answerTabs) {
    tab.addEventListener("click", () => activateAnswer(tab.dataset.answerTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = answerTabs.indexOf(tab);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? answerTabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + answerTabs.length) %
              answerTabs.length;
      activateAnswer(answerTabs[next].dataset.answerTab, true);
    });
  }

  const initialAnswer =
    answerTabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.answerTab ??
    answerTabs[0]?.dataset.answerTab;
  if (initialAnswer) activateAnswer(initialAnswer);
}

commandCopyButton?.addEventListener("click", async () => {
  const command = surfaceCommandText?.textContent?.trim();
  if (!command || !navigator.clipboard?.writeText) return;

  await navigator.clipboard.writeText(command);
  commandCopyButton.setAttribute("aria-label", "Copied");
  setTimeout(() => {
    commandCopyButton.setAttribute("aria-label", "Copy install command");
  }, 1500);
});
