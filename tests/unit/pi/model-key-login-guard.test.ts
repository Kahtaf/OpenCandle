import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guardModelRuntimeApiKeyLogins,
  previouslyValidatedModelKeyInteraction,
} from "../../../src/pi/model-key-login-guard.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

describe("terminal model-key login guard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects a first-class provider key before Pi persists it", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Forbidden", { status: 403 }),
    ) as unknown as typeof fetch;
    const { credentials, modelRuntime } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);

    await expect(
      modelRuntime.login("openai", "api_key", {
        prompt: vi.fn(async () => "bad-key"),
        notify: vi.fn(),
      }),
    ).rejects.toThrow("Key was rejected by OpenAI");

    expect(await credentials.read("openai")).toBeUndefined();
  });

  it("does not probe a key twice when an OpenCandle surface already validated it", async () => {
    const fetchMock = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { credentials, modelRuntime } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);

    await modelRuntime.login(
      "openai",
      "api_key",
      previouslyValidatedModelKeyInteraction({
        prompt: vi.fn(async () => "already-validated-key"),
        notify: vi.fn(),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.anything(),
    );
    expect(await credentials.read("openai")).toEqual({
      type: "api_key",
      key: "already-validated-key",
    });
  });

  it("persists the normalized form of the key accepted by the probe", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    const { credentials, modelRuntime } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);

    await modelRuntime.login("openai", "api_key", {
      prompt: vi.fn(async () => "  valid-key  "),
      notify: vi.fn(),
    });

    expect(await credentials.read("openai")).toEqual({ type: "api_key", key: "valid-key" });
  });

  it("does not persist a key when the provider probe cannot verify it", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { credentials, modelRuntime } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);

    await expect(
      modelRuntime.login("openai", "api_key", {
        prompt: vi.fn(async () => "unverified-key"),
        notify: vi.fn(),
      }),
    ).rejects.toThrow("Couldn't verify");

    expect(await credentials.read("openai")).toBeUndefined();
  });

  it("does not persist a key when the login interaction is cancelled during its probe", async () => {
    let finishProbe: ((response: Response) => void) | undefined;
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (finishProbe = resolve)))
      .mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const controller = new AbortController();
    const { credentials, modelRuntime } = await createTestModelRuntime();
    guardModelRuntimeApiKeyLogins(modelRuntime);

    const login = modelRuntime.login("openai", "api_key", {
      prompt: vi.fn(async () => "valid-key"),
      notify: vi.fn(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    controller.abort();
    finishProbe?.(new Response("{}", { status: 200 }));

    await expect(login).rejects.toMatchObject({ name: "AbortError" });
    expect(await credentials.read("openai")).toBeUndefined();
  });
});
