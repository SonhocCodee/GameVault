/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        amd: {
          dark: '#0e1015',
          card: '#161821',
          cardHover: '#1f2230',
          red: '#ff2a44',
          redHover: '#e02424',
          accent: '#ff4d61',
          border: '#2a2e3d',
          muted: '#8e95a5',
          text: '#f1f3f7'
        }
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
