import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563EB", // blue-600
          dark: "#1D4ED8", // blue-700
          light: "#3B82F6", // blue-500
        },
        accent: {
          DEFAULT: "#14B8A6", // teal-500
          light: "#2DD4BF", // teal-400
        },
        ink: {
          DEFAULT: "#05070D",
          900: "#070B16",
          800: "#0B1220",
          700: "#111A2E",
          600: "#1B263F",
        },
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(120deg, #1E3A8A 0%, #2563EB 35%, #14B8A6 75%, #22D3EE 100%)",
        "brand-gradient-soft": "linear-gradient(120deg, rgba(37,99,235,0.18) 0%, rgba(20,184,166,0.18) 100%)",
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(45, 212, 191, 0.45)",
        "glow-blue": "0 0 40px -8px rgba(37, 99, 235, 0.55)",
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
