import {
  BellRing,
  ClipboardCheck,
  Database,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { SETTINGS_SECTIONS } from "../../route-resolution.js";

// Placeholder body. Each lane replaces its own `Component` below with the real
// section; nothing else in the shell has to change.
function SettingsSectionPlaceholder({ section }) {
  return (
    <p className="m-0 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
      {section?.label} settings are not available yet.
    </p>
  );
}

const SECTION_DEFINITIONS = {
  model: {
    label: "Model",
    icon: Sparkles,
    description: "Choose the model OpenCandle answers with and manage its API key.",
    Component: SettingsSectionPlaceholder,
  },
  providers: {
    label: "Data providers",
    icon: Database,
    description: "Connect the sources OpenCandle pulls market evidence from.",
    Component: SettingsSectionPlaceholder,
  },
  preferences: {
    label: "Preferences",
    icon: SlidersHorizontal,
    description: "What OpenCandle has saved about how you invest, and tool defaults.",
    Component: SettingsSectionPlaceholder,
  },
  automation: {
    label: "Notifications & automation",
    icon: BellRing,
    description: "Daily report schedule, alert checks, and notification delivery.",
    Component: SettingsSectionPlaceholder,
  },
  diagnostics: {
    label: "Diagnostics",
    icon: ClipboardCheck,
    description: "Health checks for the runtime, model, providers, and local state.",
    Component: SettingsSectionPlaceholder,
  },
  data: {
    label: "Data & privacy",
    icon: ShieldCheck,
    description: "Where your OpenCandle data lives and how to move or remove it.",
    Component: SettingsSectionPlaceholder,
  },
};

export const settingsSectionRegistry = Object.fromEntries(
  SETTINGS_SECTIONS.map((slug) => [slug, { slug, ...SECTION_DEFINITIONS[slug] }]),
);

export const settingsSectionList = SETTINGS_SECTIONS.map((slug) => settingsSectionRegistry[slug]);
