import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        bg: {
          DEFAULT: "#0b0b0c",
          subtle: "#111113",
          panel: "#141416",
        },
        ink: {
          DEFAULT: "#ededf0",
          muted: "#9a9aa3",
          faint: "#5a5a63",
        },
        line: {
          DEFAULT: "#242428",
          strong: "#35353b",
        },
        accent: {
          DEFAULT: "#d97706",
          hi: "#f59e0b",
        },
        signal: {
          t1: "#d97706",
          t2: "#6b7280",
          t3: "#4b5563",
        },
      },
      letterSpacing: {
        tightish: "-0.01em",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
