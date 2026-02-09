/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecf5f8',
          100: '#d8e9ef',
          200: '#b8d5df',
          300: '#8ab9c9',
          400: '#5f9db2',
          500: '#3f8198',
          600: '#0f5e72',
          700: '#0d5062',
          800: '#0c4353',
          900: '#0a3644',
        },
      },
      boxShadow: {
        panel: '0 12px 30px -18px rgba(8, 31, 45, 0.5)',
      },
    },
  },
  plugins: [],
}
