/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        m3: {
          primary: "var(--color-primary)",
          "on-primary": "var(--color-on-primary)",
          "primary-container": "var(--color-primary-container)",
          "on-primary-container": "var(--color-on-primary-container)",
          secondary: "var(--color-secondary)",
          "secondary-container": "var(--color-secondary-container)",
          "on-secondary-container": "var(--color-on-secondary-container)",
          tertiary: "var(--color-tertiary)",
          "tertiary-container": "var(--color-tertiary-container)",
          "on-tertiary-container": "var(--color-on-tertiary-container)",
          surface: "var(--color-surface)",
          "surface-dim": "var(--color-surface-dim)",
          "surface-bright": "var(--color-surface-bright)",
          "surface-container-lowest": "var(--color-surface-container-lowest)",
          "surface-container-low": "var(--color-surface-container-low)",
          "surface-container": "var(--color-surface-container)",
          "surface-container-high": "var(--color-surface-container-high)",
          "surface-container-highest": "var(--color-surface-container-highest)",
          "on-surface": "var(--color-on-surface)",
          "on-surface-variant": "var(--color-on-surface-variant)",
          outline: "var(--color-outline)",
          "outline-variant": "var(--color-outline-variant)",
          error: "var(--color-error)",
          "error-container": "var(--color-error-container)",
        }
      },
      borderRadius: {
        '3xl': '24px',
        '4xl': '28px',
      },
      fontFamily: {
        sans: ['Google Sans', 'Roboto Flex', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
