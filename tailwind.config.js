/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./App.tsx",
        "./*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'Courier New', 'monospace'],
            },
            colors: {
                echo: {
                    dark:    '#000810',
                    darker:  '#000408',
                    primary: '#00FF41',
                    cyan:    '#00E5FF',
                    blue:    '#0080FF',
                    amber:   '#FFB300',
                    red:     '#FF3040',
                    pink:    '#FF6B9D',
                },
            },
            boxShadow: {
                'hud':        '0 0 0 1px rgba(0,229,255,0.2), 0 0 20px rgba(0,229,255,0.05), inset 0 0 20px rgba(0,0,0,0.5)',
                'hud-hover':  '0 0 0 1px rgba(0,229,255,0.5), 0 0 30px rgba(0,229,255,0.15)',
                'glow-cyan':  '0 0 20px rgba(0,229,255,0.4),  0 0 60px rgba(0,229,255,0.15)',
                'glow-green': '0 0 20px rgba(0,255,65,0.4),   0 0 60px rgba(0,255,65,0.15)',
                'glow-pink':  '0 0 20px rgba(255,107,157,0.4),0 0 60px rgba(255,107,157,0.15)',
                'orb':        '0 0 40px rgba(0,229,255,0.5),  0 0 100px rgba(0,229,255,0.2), 0 0 200px rgba(0,100,255,0.1)',
                'orb-speak':  '0 0 60px rgba(0,255,65,0.6),   0 0 120px rgba(0,255,65,0.3)',
                'orb-think':  '0 0 40px rgba(160,100,255,0.5),0 0 100px rgba(160,100,255,0.2)',
            },
            animation: {
                'spin-slow':     'spin 12s linear infinite',
                'spin-medium':   'spin 7s linear infinite',
                'spin-fast':     'spin 3s linear infinite',
                'spin-reverse':  'spin-reverse 9s linear infinite',
                'spin-rev-fast': 'spin-reverse 4s linear infinite',
                'pulse-slow':    'pulse 3s ease-in-out infinite',
                'pulse-gentle':  'pulse-gentle 4s ease-in-out infinite',
                'pulse-glow':    'pulse-glow 2s ease-in-out infinite',
                'scan':          'scan 4s linear infinite',
                'scan-fast':     'scan 1.5s linear infinite',
                'hud-flicker':   'hud-flicker 8s ease-in-out infinite',
                'fade-in':       'fadeIn 0.4s ease-out forwards',
                'fade-up':       'fadeUp 0.4s ease-out forwards',
                'slide-up':      'slideUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
                'slide-in-right':'slideInRight 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
                'slide-in-down': 'slideInDown 0.3s ease-out',
                'hex-pulse':     'hex-pulse 3s ease-in-out infinite',
                'float':         'float 6s ease-in-out infinite',
                'float-slow':    'float 10s ease-in-out infinite',
                'type-cursor':   'type-cursor 1s step-end infinite',
            },
            keyframes: {
                'spin-reverse': {
                    from: { transform: 'rotate(360deg)' },
                    to:   { transform: 'rotate(0deg)' },
                },
                'pulse-gentle': {
                    '0%,100%': { opacity: '0.4', transform: 'scale(1)' },
                    '50%':     { opacity: '0.7', transform: 'scale(1.04)' },
                },
                'pulse-glow': {
                    '0%,100%': { opacity: '0.6' },
                    '50%':     { opacity: '1' },
                },
                'scan': {
                    '0%':   { transform: 'translateY(-100%)' },
                    '100%': { transform: 'translateY(200%)' },
                },
                'hud-flicker': {
                    '0%,89%,95%,100%': { opacity: '1' },
                    '90%':             { opacity: '0.6' },
                    '93%':             { opacity: '0.85' },
                },
                'fadeIn': {
                    from: { opacity: '0' },
                    to:   { opacity: '1' },
                },
                'fadeUp': {
                    from: { opacity: '0', transform: 'translateY(12px)' },
                    to:   { opacity: '1', transform: 'translateY(0)' },
                },
                'slideUp': {
                    from: { opacity: '0', transform: 'translateY(40px)' },
                    to:   { opacity: '1', transform: 'translateY(0)' },
                },
                'slideInRight': {
                    from: { opacity: '0', transform: 'translateX(30px)' },
                    to:   { opacity: '1', transform: 'translateX(0)' },
                },
                'slideInDown': {
                    '0%':   { transform: 'translateY(-100%)', opacity: '0' },
                    '100%': { transform: 'translateY(0)',     opacity: '1' },
                },
                'hex-pulse': {
                    '0%,100%': { opacity: '0.12' },
                    '50%':     { opacity: '0.35' },
                },
                'float': {
                    '0%,100%': { transform: 'translateY(0px)' },
                    '50%':     { transform: 'translateY(-8px)' },
                },
                'type-cursor': {
                    '0%,100%': { opacity: '1' },
                    '50%':     { opacity: '0' },
                },
            },
        },
    },
    plugins: [],
};
