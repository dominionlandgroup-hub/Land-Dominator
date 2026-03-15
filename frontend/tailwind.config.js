/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#F8F6FB",
          100: "#F0EBF8",
          200: "#E0D0F0",
          300: "#D4B8E8",
          400: "#C4A8D8",
          500: "#8B4DB8",
          600: "#5C2977",
          700: "#3D1A5C",
          800: "#2A0F42",
          900: "#1A0A2E",
        },
        gold: {
          50:  "#FDF9EE",
          100: "#F8EED0",
          200: "#E8D08A",
          300: "#D5A940",
          400: "#C09030",
          500: "#A07828",
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
