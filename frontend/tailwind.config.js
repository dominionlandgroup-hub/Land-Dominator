/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#050c1a",
          900: "#080f22",
          800: "#0d1630",
          700: "#111e3c",
          600: "#162347",
        },
      },
    },
  },
  plugins: [],
}
