/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0037b0",
        "royal-deep": "#1e40af",
        "cyan-accent": "#06b6d4",
        surface: "#faf8ff",
      },
    },
  },
  plugins: [],
};
