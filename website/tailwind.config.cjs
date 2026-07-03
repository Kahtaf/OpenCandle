const guiConfig = require("../gui/web/tailwind.config.cjs");

module.exports = {
  ...guiConfig,
  // Tailwind v4 auto-detects sources and ignores this legacy list, but keep it
  // matching reality (prerendered pages live in scripts/) for anyone reading it.
  content: ["./src/**/*.{js,jsx}", "./scripts/**/*.{js,jsx}", "../packages/ui/src/**/*.{js,jsx}"],
};
