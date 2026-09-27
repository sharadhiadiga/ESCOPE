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
          50: '#f0f6ff',
          100: '#e0edff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        dark: {
          bg: '#0B0F17',
          card: '#151C2C',
          border: '#232D42',
          text: '#F3F4F6',
          muted: '#9CA3AF',
        }
      }
    },
  },
  plugins: [],
}
