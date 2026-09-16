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
          DEFAULT: "#1E88E5",
          dark: "#1565C0",
        },
        accent: "#FF5252",
      },
    },
  },
  plugins: [],
};

export default config;
