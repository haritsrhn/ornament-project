import type { Config } from "tailwindcss";

/**
 * Organic — design system for Ornament Sourcing Agent ("GOOD VALUE").
 * Every value here is lifted from design_handoff_ornament/organic-styles.css.
 * The CSS custom properties stay the single source of truth (see app/globals.css);
 * this config only exposes them to Tailwind so utilities and tokens never drift.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        ink: "var(--color-text)",
        divider: "var(--color-divider)",
        accent: {
          DEFAULT: "var(--color-accent)",
          100: "var(--color-accent-100)",
          200: "var(--color-accent-200)",
          300: "var(--color-accent-300)",
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
          700: "var(--color-accent-700)",
          800: "var(--color-accent-800)",
          900: "var(--color-accent-900)",
        },
        sage: {
          DEFAULT: "var(--color-accent-2)",
          100: "var(--color-accent-2-100)",
          200: "var(--color-accent-2-200)",
          300: "var(--color-accent-2-300)",
          400: "var(--color-accent-2-400)",
          500: "var(--color-accent-2-500)",
          600: "var(--color-accent-2-600)",
          700: "var(--color-accent-2-700)",
          800: "var(--color-accent-2-800)",
          900: "var(--color-accent-2-900)",
        },
        neutral: {
          100: "var(--color-neutral-100)",
          200: "var(--color-neutral-200)",
          300: "var(--color-neutral-300)",
          400: "var(--color-neutral-400)",
          500: "var(--color-neutral-500)",
          600: "var(--color-neutral-600)",
          700: "var(--color-neutral-700)",
          800: "var(--color-neutral-800)",
          900: "var(--color-neutral-900)",
        },
        /* ink at partial alpha — the prototype's color-mix(...) text colors */
        muted: {
          45: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          50: "color-mix(in srgb, var(--color-text) 50%, transparent)",
          55: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          60: "color-mix(in srgb, var(--color-text) 60%, transparent)",
          65: "color-mix(in srgb, var(--color-text) 65%, transparent)",
          70: "color-mix(in srgb, var(--color-text) 70%, transparent)",
          72: "color-mix(in srgb, var(--color-text) 72%, transparent)",
          75: "color-mix(in srgb, var(--color-text) 75%, transparent)",
          78: "color-mix(in srgb, var(--color-text) 78%, transparent)",
          80: "color-mix(in srgb, var(--color-text) 80%, transparent)",
          82: "color-mix(in srgb, var(--color-text) 82%, transparent)",
          85: "color-mix(in srgb, var(--color-text) 85%, transparent)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
      },
      fontSize: {
        /* admin + landing scale from the handoff readme */
        kicker: ["11px", { lineHeight: "1.4", letterSpacing: "0.14em" }],
        meta: ["11.5px", { lineHeight: "1.5" }],
        "admin-sm": ["12.5px", { lineHeight: "1.5" }],
        admin: ["13.5px", { lineHeight: "1.6" }],
        "body-sm": ["15.5px", { lineHeight: "1.7" }],
        "body-lg": ["18px", { lineHeight: "1.7" }],
      },
      spacing: {
        1.1: "4.4px",
        2.2: "8.8px",
        3.3: "13.2px",
        4.4: "17.6px",
        6.6: "26.4px",
        8.8: "35.2px",
      },
      borderRadius: {
        sm: "8px",
        md: "16px",
        lg: "28px",
        xl: "32px",
        "2xl": "40px",
        pill: "999px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      maxWidth: {
        shell: "1240px",
      },
      screens: {
        /* the prototype's breakpoints, kept mobile-first (min-width) */
        sm: "640px",
        md: "681px",
        lg: "881px",
        xl: "981px",
        "2xl": "1151px",
        "3xl": "1281px",
      },
    },
  },
  plugins: [],
};

export default config;
