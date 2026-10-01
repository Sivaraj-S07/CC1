/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: "#04060B",
          soft: "#070A12",
          panel: "#0A0F1C",
        },
        navy: {
          900: "#0B1220",
          800: "#101A2E",
          700: "#162140",
        },
        electric: {
          DEFAULT: "#3E8BFF",
          light: "#63A6FF",
          glow: "#5AC8FA",
        },
        cyan: {
          glow: "#22D3EE",
        },
        violet: {
          DEFAULT: "#8B5CF6",
          soft: "#A78BFA",
        },
        ink: {
          100: "#EAF0FB",
          300: "#B7C3DA",
          500: "#7C89A6",
          700: "#4B566F",
        },
        mint: "#34E4B0",
        amber: "#FBBF6D",
        coral: "#FF6B81",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      backgroundImage: {
        "aurora": "radial-gradient(120% 120% at 15% -10%, rgba(62,139,255,0.18) 0%, rgba(4,6,11,0) 55%), radial-gradient(100% 100% at 85% 0%, rgba(139,92,246,0.16) 0%, rgba(4,6,11,0) 50%), radial-gradient(140% 140% at 50% 110%, rgba(34,211,238,0.10) 0%, rgba(4,6,11,0) 60%)",
        "glass-sheen": "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.01) 40%, rgba(255,255,255,0) 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(62,139,255,0.15), 0 0 24px rgba(62,139,255,0.25), 0 0 60px rgba(139,92,246,0.08)",
        "glow-cyan": "0 0 0 1px rgba(34,211,238,0.18), 0 0 24px rgba(34,211,238,0.25)",
        card: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      borderRadius: {
        xl2: "1.25rem",
        "3xl": "1.75rem",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        pulseGlow: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.55 } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        floaty: "floaty 4s ease-in-out infinite",
        pulseGlow: "pulseGlow 2.2s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
}
