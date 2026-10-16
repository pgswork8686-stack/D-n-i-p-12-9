/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@nexus/config/tailwind-preset")],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
};