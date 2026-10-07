/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Design tokens: design-system/nexustheme/MASTER.md
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          hover: "rgb(var(--brand-hover) / <alpha-value>)",
          soft: "rgb(var(--brand-soft) / <alpha-value>)",
        },
        cta: {
          DEFAULT: "rgb(var(--cta) / <alpha-value>)",
          hover: "rgb(var(--cta-hover) / <alpha-value>)",
        },
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        // Legacy aliases kept for @nexus/ui components
        primary: "rgb(var(--brand) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(30 27 75 / 0.06), 0 4px 16px rgb(30 27 75 / 0.06)",
        lift: "0 8px 30px rgb(79 70 229 / 0.16)",
      },
      maxWidth: {
        site: "76rem",
      },
    },
  },
  plugins: [],
};
