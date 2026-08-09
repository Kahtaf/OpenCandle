import { describe, expect, it } from "vitest";
import {
  appPageFromPath,
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  settingsSectionFromPath,
  settingsSectionHref,
} from "../../../gui/web/src/route-resolution.js";
import { router } from "../../../gui/web/src/router.jsx";

describe("settings section slugs", () => {
  it("lists the sections in rail order and opens on the first one", () => {
    expect(SETTINGS_SECTIONS).toEqual([
      "model",
      "providers",
      "preferences",
      "automation",
      "diagnostics",
      "data",
    ]);
    expect(DEFAULT_SETTINGS_SECTION).toBe("model");
  });

  it("builds a section href for every slug and falls back for an unknown one", () => {
    expect(settingsSectionHref("providers")).toBe("/settings/providers");
    expect(settingsSectionHref("bogus")).toBe("/settings/model");
  });
});

describe("settingsSectionFromPath", () => {
  it.each([
    ["/settings", "model"],
    ["/settings/", "model"],
    ["/settings/model", "model"],
    ["/settings/providers", "providers"],
    ["/settings/preferences", "preferences"],
    ["/settings/automation", "automation"],
    ["/settings/diagnostics", "diagnostics"],
    ["/settings/data", "data"],
    ["/settings/bogus", "model"],
    ["/settings/%2E%2E", "model"],
    ["/diagnostics", "diagnostics"],
  ])("resolves %s to the %s section", (pathname, expected) => {
    expect(settingsSectionFromPath(pathname)).toBe(expected);
  });

  it.each(["/", "/settings-old", "/watchlists", "/sessions/abc", "/symbol/AAPL"])(
    "does not read %s as a settings path",
    (pathname) => {
      expect(settingsSectionFromPath(pathname)).toBe("");
    },
  );
});

describe("appPageFromPath settings pages", () => {
  it("resolves settings paths to the settings page with a section", () => {
    expect([
      appPageFromPath("/settings"),
      appPageFromPath("/settings/providers"),
      appPageFromPath("/settings/bogus"),
      appPageFromPath("/diagnostics"),
    ]).toEqual([
      { page: "settings", section: "model" },
      { page: "settings", section: "providers" },
      { page: "settings", section: "model" },
      { page: "settings", section: "diagnostics" },
    ]);
  });

  it("keeps every settings path off the chat fallback", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(appPageFromPath(`/settings/${section}`).page).toBe("settings");
    }
    expect(appPageFromPath("/settings").page).not.toBe("chat");
  });
});

describe("settings routes", () => {
  it("registers /settings and /settings/$section with the GUI search validator", () => {
    for (const path of ["/settings", "/settings/$section"]) {
      const route = router.routesByPath[path];

      expect(route).toBeDefined();
      expect(route.options.validateSearch({ provider: "alpha_vantage" })).toMatchObject({
        provider: "alpha_vantage",
      });
    }
  });
});
