// Presentation-only refinements for schema-derived catalog forms. Keyed by
// tool name → field name → partial field descriptor (label, helper,
// placeholder, default — never kind-defining structure). Every tool key must
// match a registered tool name; tests/unit/gui-web/schema-form.test.ts guards
// against drift.

export const FIELD_OVERRIDES = {};

// Tool name → primary domain label, matching gui/server/tool-metadata.ts
// inferDomain(); kept here for quick access without round-tripping.
export const DOMAIN_LABELS = {
  market: "Market",
  fundamentals: "Fundamentals",
  options: "Options",
  portfolio: "Portfolio",
  technical: "Technical",
  sentiment: "Sentiment",
  macro: "Macro",
  interaction: "Interaction",
};
