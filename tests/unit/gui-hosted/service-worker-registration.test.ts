import { describe, expect, it, vi } from "vitest";
import { registerHostedServiceWorker } from "../../../gui/hosted/src/service-worker-registration.js";

type FakeWorker = EventTarget & { state: string; moveTo(next: string): void };

function fakeWorker(state = "installing"): FakeWorker {
  const worker = new EventTarget() as FakeWorker;
  worker.state = state;
  worker.moveTo = (next: string) => {
    worker.state = next;
    worker.dispatchEvent(new Event("statechange"));
  };
  return worker;
}

// Models the ServiceWorkerContainer/ServiceWorkerRegistration pair closely
// enough to walk the install lifecycle the way the browser does.
function fakeServiceWorkers({ controlled }: { controlled: boolean }) {
  const registration = Object.assign(new EventTarget(), {
    installing: null as FakeWorker | null,
    waiting: null as FakeWorker | null,
    active: controlled ? fakeWorker("activated") : null,
  });
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? registration.active : (null as FakeWorker | null),
    register: vi.fn(async () => registration),
  });
  return {
    registration,
    container,
    // updatefound → installing → installed (waiting) → activating → activated
    installNewWorker({ activate }: { activate: boolean }) {
      const worker = fakeWorker("installing");
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
      registration.installing = null;
      registration.waiting = worker;
      worker.moveTo("installed");
      if (!activate) return worker;
      registration.waiting = null;
      registration.active = worker;
      worker.moveTo("activating");
      worker.moveTo("activated");
      return worker;
    },
    takeControl(worker: FakeWorker) {
      container.controller = worker;
      container.dispatchEvent(new Event("controllerchange"));
    },
  };
}

describe("registerHostedServiceWorker", () => {
  it("does not announce an update for a first install (#219)", async () => {
    const workers = fakeServiceWorkers({ controlled: false });
    const dispatch = vi.fn();
    const reload = vi.fn();
    await registerHostedServiceWorker({ container: workers.container, dispatch, reload });

    // On a first install the spec parks the new worker in `waiting` before it
    // activates, because there is no active worker yet.
    const worker = workers.installNewWorker({ activate: true });
    workers.takeControl(worker);

    expect(dispatch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("announces a real update once the new worker is installed and waiting", async () => {
    const workers = fakeServiceWorkers({ controlled: true });
    const dispatch = vi.fn();
    const runtimeHost = {};
    await registerHostedServiceWorker({
      container: workers.container,
      runtimeHost,
      dispatch,
      reload: vi.fn(),
    });

    workers.installNewWorker({ activate: false });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("opencandle:update-ready");
    expect(event.detail.registration).toBe(workers.registration);
    expect(event.detail.runtimeHost).toBe(runtimeHost);
  });

  it("announces an update that was already waiting at registration", async () => {
    const workers = fakeServiceWorkers({ controlled: true });
    workers.registration.waiting = fakeWorker("installed");
    const dispatch = vi.fn();
    await registerHostedServiceWorker({ container: workers.container, dispatch, reload: vi.fn() });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("announces an update found later in a session that started uncontrolled", async () => {
    const workers = fakeServiceWorkers({ controlled: false });
    const dispatch = vi.fn();
    await registerHostedServiceWorker({ container: workers.container, dispatch, reload: vi.fn() });
    workers.takeControl(workers.installNewWorker({ activate: true }));
    expect(dispatch).not.toHaveBeenCalled();

    workers.installNewWorker({ activate: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("reloads when an installed update replaces the controlling worker", async () => {
    const workers = fakeServiceWorkers({ controlled: true });
    const reload = vi.fn();
    await registerHostedServiceWorker({ container: workers.container, dispatch: vi.fn(), reload });

    const worker = workers.installNewWorker({ activate: true });
    workers.takeControl(worker);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads onto an update even when the first install's claim was missed", async () => {
    // The first worker can claim the page before registration resolves. The
    // next controller change is still a real update and must reload.
    const workers = fakeServiceWorkers({ controlled: false });
    const reload = vi.fn();
    const first = fakeWorker("activated");
    workers.container.register.mockImplementationOnce(async () => {
      workers.takeControl(first);
      return workers.registration;
    });
    await registerHostedServiceWorker({ container: workers.container, dispatch: vi.fn(), reload });
    expect(reload).not.toHaveBeenCalled();

    workers.takeControl(workers.installNewWorker({ activate: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
