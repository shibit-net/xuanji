/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        primary: '#7C8CF5',
        success: '#34D399',
        warning: '#FBBF24',
        error: '#F87171',
        bg: {
          primary: '#1E1E1E',
          secondary: '#2D2D2D',
          tertiary: '#3A3A3A',
        },
        text: {
          primary: '#E4E4E4',
          secondary: '#8A8A8A',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Monaco', 'Courier New', 'monospace'],
        sans: ['SF Pro Text', 'system-ui', 'sans-serif'],
        display: ['SF Pro Display', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
