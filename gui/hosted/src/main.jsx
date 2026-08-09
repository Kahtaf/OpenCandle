import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import { createRoot } from "react-dom/client";
import "../../web/src/styles.css";
import { TooltipProvider } from "../../web/src/components/ui/tooltip.jsx";
import { router } from "../../web/src/router.jsx";
import { AppStatusSlotProvider } from "../../web/src/runtime/app-status-slot.jsx";
import { createHostedRuntimeTransport } from "../../web/src/runtime/hosted-runtime-transport.js";
import { RuntimeTransportProvider } from "../../web/src/runtime/runtime-transport-provider.jsx";
import { createBrowserRuntimeHost } from "./runtime/browser-runtime-host.js";
import { createBrowserRuntimeCoordinator } from "./runtime/browser-runtime-coordinator.js";
import { createHostedDataActions } from "./hosted-data-actions.js";
import { HostedStatusPill } from "./hosted-status-pill.jsx";

const host = createBrowserRuntimeCoordinator({ createHost: createBrowserRuntimeHost });
const hostedData = createHostedDataActions(host);
const transport = createHostedRuntimeTransport({ host, hostedData });
addEventListener("pagehide", (event) => {
  if (!event.persisted) void host.dispose();
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RuntimeTransportProvider transport={transport}>
      <TooltipProvider>
        <AppStatusSlotProvider slot={<HostedStatusPill host={host} actions={hostedData} />}>
          <RouterProvider router={router} />
        </AppStatusSlotProvider>
      </TooltipProvider>
    </RuntimeTransportProvider>
  </React.StrictMode>,
);

void registerHostedServiceWorker(host);

async function registerHostedServiceWorker(runtimeHost) {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const announce = () => {
    if (!registration.waiting) return;
    dispatchEvent(
      new CustomEvent("opencandle:update-ready", { detail: { registration, runtimeHost } }),
    );
  };
  announce();
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", announce);
  });
  let reloadForUpdate = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadForUpdate) {
      reloadForUpdate = true;
      return;
    }
    location.reload();
  });
}
