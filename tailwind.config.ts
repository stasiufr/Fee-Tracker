import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Base colors
        background: "var(--background)",
        foreground: "var(--foreground)",

        // Fire/flame palette
        fire: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316", // Primary orange
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
          950: "#431407",
        },

        // Badge tier colors
        badge: {
          fire: "#ef4444",      // Room on Fire - red
          coffee: "#f59e0b",    // Coffee Sipper - amber
          good: "#22c55e",      // Good Boy - green
          nervous: "#eab308",   // Nervous - yellow
          exiting: "#f97316",   // Exiting - orange
          arsonist: "#6b7280",  // Arsonist - gray/skull
        },

        // Burn/extract indicators
        burn: "#ef4444",
        extract: "#6b7280",
        hold: "#3b82f6",

        // Dark theme surface colors
        surface: {
          DEFAULT: "#18181b",
          secondary: "#27272a",
          tertiary: "#3f3f46",
        },
      },

      animation: {
        "fire-flicker": "flicker 1.5s ease-in-out infinite alternate",
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-in": "fadeIn 0.5s ease-out",
      },

      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },

      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
