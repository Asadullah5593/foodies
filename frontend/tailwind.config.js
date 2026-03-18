/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        foodies: {
          primary: '#B91C1C',
          surface: '#FFFFFF',
          surfaceMuted: '#F8FAFC',
          textPrimary: '#0F172A',
          textSecondary: '#64748B',
          border: '#E2E8F0',
          // Logo-driven CTA (red)
          cta: '#DC2626',      // red-600
          ctaHover: '#B91C1C', // red-700
          // dark (use with dark: prefix)
          dark: {
            surface: '#1F2937',
            surfaceMuted: '#111827',
            textPrimary: '#F8FAFC',
            textSecondary: '#94A3B8',
            border: '#374151',
          },
        },
      },
    },
  },
  plugins: [],
}
