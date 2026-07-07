/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f7f9fa',
        surface: '#ffffff',
        'border-c': '#e4eaec',
        subtle: '#eef3f4',
        'text-primary': '#152229',
        'text-secondary': '#48606c',
        'text-muted': '#7d919a',
        'text-faint': '#93a5ad',
        teal: '#0fa3b1',
        'teal-deep': '#0b7f8a',
        'teal-tint': '#e5f6f7',
        primary: '#0fa3b1',
        yes: '#2f7d5c',
        no: '#c0504f',
        'yes-bg': '#e5f6f7',
        'no-bg': '#fdeeee',
        rules: '#fdf3d8',
        'rules-text': '#6e5410',
      },
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
      },
    },
  },
  plugins: [],
}
