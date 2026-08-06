import {
  BellRing,
  ClipboardCheck,
  Database,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { SETTINGS_SECTIONS } from "../../route-resolution.js";
import { AutomationSection } from "./sections/AutomationSection.jsx";
import { DataSection } from "./sections/DataSection.jsx";
import { DiagnosticsSection } from "./sections/DiagnosticsSection.jsx";
import { ModelSection } from "./sections/ModelSection.jsx";
import { PreferencesSection } from "./sections/PreferencesSection.jsx";
import { ProvidersSection } from "./sections/ProvidersSection.jsx";

const SECTION_DEFINITIONS = {
  model: {
    label: "Model",
    icon: Sparkles,
    description: "Choose the model OpenCandle answers with and manage its API key.",
    Component: ModelSection,
  },
  providers: {
    label: "Data providers",
    icon: Database,
    description: "Connect the sources OpenCandle pulls market evidence from.",
    Component: ProvidersSection,
  },
  preferences: {
    label: "Preferences",
    icon: SlidersHorizontal,
    description: "What OpenCandle has saved about how you invest, and tool defaults.",
    Component: PreferencesSection,
  },
  automation: {
    label: "Notifications & automation",
    icon: BellRing,
    description: "Daily report schedule, alert checks, and notification delivery.",
    Component: AutomationSection,
  },
  diagnostics: {
    label: "Diagnostics",
    icon: ClipboardCheck,
    description: "Health checks for the runtime, model, providers, and local state.",
    Component: DiagnosticsSection,
  },
  data: {
    label: "Data & privacy",
    icon: ShieldCheck,
    description: "Where your OpenCandle data lives and how to move or remove it.",
    Component: DataSection,
  },
};

export const settingsSectionRegistry = Object.fromEntries(
  SETTINGS_SECTIONS.map((slug) => [slug, { slug, ...SECTION_DEFINITIONS[slug] }]),
);

export const settingsSectionList = SETTINGS_SECTIONS.map((slug) => settingsSectionRegistry[slug]);
