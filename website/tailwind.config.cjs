const guiConfig = require("../gui/web/tailwind.config.cjs");

module.exports = {
  ...guiConfig,
  content: ["./src/**/*.{js,jsx}", "../packages/ui/src/**/*.{js,jsx}"],
};
