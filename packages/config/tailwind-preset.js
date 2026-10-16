/**
 * NexusTheme design tokens — shared by apps/web, apps/portal and apps/admin.
 * Source: docs/frontend/design-system.md (inherits the ST01 Stitch design).
 *
 * Colours are RGB channels in CSS variables so Tailwind alpha modifiers work
 * (`bg-brand/10`). Contrast (WCAG, computed): ink/canvas 16.8:1, body/surface
 * 10.4:1, muted/canvas 5.1:1, muted/brand-soft 4.8:1, white/brand 6.1:1,
 * white/navy 16.8:1. `warm` is 3.2:1 against white — use it for icons, borders
 * and large text only, never as the background of small text.
 */
const tokens = {
  "--brand": "49 85 217", // #3155D9
  "--brand-hover": "39 69 184", // #2745B8
  "--brand-soft": "234 240 255", // #EAF0FF
  "--ink": "15 23 42", // #0F172A — headings, primary text
  "--body": "51 65 85", // #334155 — paragraphs
  // Spec #64748B is 4.48:1 on canvas (fails AA); darkened just enough to pass.
  "--muted": "91 107 130", // #5B6B82 — metadata
  "--canvas": "247 248 252", // #F7F8FC — app background
  "--surface": "255 255 255", // cards, forms, tables
  "--line": "221 227 238", // #DDE3EE
  "--warm": "217 119 55", // #D97737 — restrained accent, never a second CTA
  "--navy": "16 28 58", // #101C3A — CTA strip, footer, ST01 consult form
  "--success": "21 128 61", // #15803D
  "--warning": "180 83 9", // #B45309
  "--danger": "220 38 38", // #DC2626
};

const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: rgb("--brand"), hover: rgb("--brand-hover"), soft: rgb("--brand-soft") },
        // The primary CTA is the brand colour (spec §2.1); `cta` is kept as an
        // alias so existing storefront markup keeps working.
        cta: { DEFAULT: rgb("--brand"), hover: rgb("--brand-hover") },
        ink: rgb("--ink"),
        body: rgb("--body"),
        muted: rgb("--muted"),
        canvas: rgb("--canvas"),
        surface: rgb("--surface"),
        line: rgb("--line"),
        warm: rgb("--warm"),
        navy: rgb("--navy"),
        success: rgb("--success"),
        warning: rgb("--warning"),
        danger: rgb("--danger"),
        primary: rgb("--brand"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.05), 0 4px 16px rgb(15 23 42 / 0.05)",
        lift: "0 10px 30px rgb(49 85 217 / 0.14)",
      },
      maxWidth: {
        site: "80rem", // 1280px storefront container
      },
    },
  },
  plugins: [
    // Plain-function plugin: avoids requiring tailwindcss from this package.
    ({ addBase, addComponents }) => {
      addBase({
        ":root": tokens,
        html: { "-webkit-text-size-adjust": "100%" },
        body: {
          backgroundColor: "rgb(var(--canvas))",
          color: "rgb(var(--ink))",
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          lineHeight: "1.6",
        },
        ":focus-visible": {
          outline: "2px solid rgb(var(--brand))",
          outlineOffset: "2px",
          borderRadius: "6px",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      });
      addComponents({
        ".container-site": { "@apply mx-auto w-full max-w-site px-4 sm:px-6 lg:px-8": {} },
        ".btn": {
          "@apply inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60":
            {},
        },
        ".btn-primary": { "@apply btn bg-brand text-white hover:bg-brand-hover": {} },
        ".btn-buy": { "@apply btn bg-brand text-white hover:bg-brand-hover": {} },
        ".btn-ghost": {
          "@apply btn border border-line bg-surface text-ink hover:border-brand/40 hover:bg-brand-soft": {},
        },
        ".btn-danger": { "@apply btn bg-danger text-white hover:bg-danger/90": {} },
        ".btn-sm": { "@apply min-h-[36px] px-3 text-[13px]": {} },
        ".card": { "@apply rounded-2xl border border-line bg-surface shadow-card": {} },
        ".field-label": { "@apply mb-1.5 block text-sm font-medium text-ink": {} },
        ".field-input": {
          "@apply min-h-[44px] w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink placeholder:text-muted/80 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas aria-[invalid=true]:border-danger":
            {},
        },
        ".field-error": { "@apply mt-1.5 text-sm text-danger": {} },
        ".field-hint": { "@apply mt-1.5 text-sm text-muted": {} },
        ".eyebrow": { "@apply text-xs font-semibold uppercase tracking-[0.08em] text-brand": {} },
        ".h1": { "@apply text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl": {} },
        ".h2": { "@apply text-2xl font-bold tracking-tight text-ink sm:text-[30px]": {} },
        ".link": { "@apply font-semibold text-brand underline-offset-4 hover:underline": {} },
      });
    },
  ],
};
