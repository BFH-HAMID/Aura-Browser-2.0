/**
 * Aura Browser 2.0 — Tailwind configuration.
 * Dark mode is class-based (toggled on <html>), content scanned from
 * public/index.html and public/js/app.js.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./public/index.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        // RGB-triplet var so opacity modifiers (bg-accent/10 …) work —
        // the triplet is set from JS alongside the hex --accent.
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-2': 'var(--accent-2, var(--accent))',
      },
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI',
          'Roboto', 'Noto Sans Bengali', 'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
