const defaultTheme = require("tailwindcss/defaultTheme");

const withAlpha = (token) => `hsl(var(${token}) / <alpha-value>)`;

const sansStack = ["Inter", "system-ui", "-apple-system", ...defaultTheme.fontFamily.sans];
const monoStack = [
  "JetBrains Mono",
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  ...defaultTheme.fontFamily.mono,
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}", "../../packages/ui/src/**/*.{js,jsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    screens: {
      sm: "520px",
      md: "820px",
      lg: "1100px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        border: withAlpha("--tw-border"),
        soft: withAlpha("--tw-soft"),
        hard: withAlpha("--tw-hard"),
        input: withAlpha("--tw-input"),
        ring: withAlpha("--tw-ring"),
        background: withAlpha("--tw-background"),
        foreground: withAlpha("--tw-foreground"),
        secondary: {
          DEFAULT: withAlpha("--tw-secondary"),
          foreground: withAlpha("--tw-secondary-foreground"),
        },
        brand: {
          DEFAULT: withAlpha("--tw-brand"),
          foreground: withAlpha("--tw-brand-foreground"),
        },
        tertiary: {
          DEFAULT: withAlpha("--tw-tertiary"),
          foreground: withAlpha("--tw-tertiary-foreground"),
        },
        muted: {
          DEFAULT: withAlpha("--tw-muted"),
          foreground: withAlpha("--tw-muted-foreground"),
        },
        accent: {
          DEFAULT: withAlpha("--tw-accent"),
          foreground: withAlpha("--tw-accent-foreground"),
        },
        primary: {
          DEFAULT: withAlpha("--tw-primary"),
          foreground: withAlpha("--tw-primary-foreground"),
        },
        popover: {
          DEFAULT: withAlpha("--tw-popover"),
          foreground: withAlpha("--tw-popover-foreground"),
        },
        card: {
          DEFAULT: withAlpha("--tw-card"),
          foreground: withAlpha("--tw-card-foreground"),
        },
        destructive: {
          DEFAULT: withAlpha("--tw-destructive"),
          foreground: withAlpha("--tw-destructive-foreground"),
        },
        success: withAlpha("--tw-success"),
        warning: withAlpha("--tw-warning"),
        info: withAlpha("--tw-info"),
      },
      borderWidth: {
        DEFAULT: "1px",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
        "3xl": "calc(var(--radius) + 16px)",
      },
      fontFamily: {
        sans: sansStack,
        mono: monoStack,
        display: sansStack,
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0em" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "0em" }],
        base: ["0.875rem", { lineHeight: "1.5rem", letterSpacing: "0em" }],
        lg: ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.005em" }],
        xl: ["1.125rem", { lineHeight: "1.5rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "5xl": ["3.5rem", { lineHeight: "1", letterSpacing: "-0.03em" }],
      },
      fontWeight: {
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "600",
        black: "700",
      },
      boxShadow: {
        "subtle-xs": "var(--shadow-subtle-xs)",
        "subtle-sm": "var(--shadow-subtle-sm)",
        "subtle-md": "var(--shadow-subtle-md)",
      },
      keyframes: {
        "fade-in-once": {
          "0%": { opacity: 0, transform: "translateY(5px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "reveal-pop": {
          "0%": { opacity: 0, transform: "scale(0.96) translateY(10px)" },
          "70%": { opacity: 1, transform: "scale(1.01) translateY(-2px)" },
          "100%": { opacity: 1, transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        "fade-in-once": "fade-in-once 0.28s ease-out forwards",
        "reveal-pop": "reveal-pop 0.42s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("tailwindcss-animate")],
};
