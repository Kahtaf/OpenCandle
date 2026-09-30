// Registers the hosted shell's service worker and announces an update only
// when a new worker is genuinely waiting to replace the one in control.
//
// A first install also passes through `registration.waiting`: with no active
// worker yet, the browser parks the new worker there briefly before it
// activates. Offering "Install update?" at that moment is wrong (#219), so an
// announcement needs a controlling worker to replace and a waiting worker
// still in the `installed` state.
export async function registerHostedServiceWorker({
  container = globalThis.navigator?.serviceWorker,
  runtimeHost,
  dispatch = (event) => globalThis.dispatchEvent(event),
  reload = () => globalThis.location.reload(),
  scriptUrl = "/sw.js",
} = {}) {
  if (!container) return null;

  // Listen before registering: the first worker can claim this page before
  // `register` resolves. Only a change that replaces an existing controller is
  // an installed update, and the page reloads onto it.
  let controller = container.controller;
  container.addEventListener("controllerchange", () => {
    const replaced = controller;
    controller = container.controller;
    if (replaced) reload();
  });

  const registration = await container.register(scriptUrl, { scope: "/" });
  const announce = () => {
    const waiting = registration.waiting;
    if (!waiting || waiting.state !== "installed" || !container.controller) return;
    dispatch(new CustomEvent("opencandle:update-ready", { detail: { registration, runtimeHost } }));
  };
  announce();
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", announce);
  });
  return registration;
}
