export const emailTheme = {
  colors: {
    canvas: "#edece6",
    surface: "#f5f4ee",
    surfaceDark: "#151513",
    ink: "#11110f",
    muted: "#6b6961",
    subtle: "#929087",
    border: "#cbc8bd",
    borderStrong: "#aaa79c",
    accent: "#d7ff3f",
    success: "#315f43",
    danger: "#a33b32",
    logoTact: "#808080",
  },
  fonts: {
    // Satoshi primary with modern web-safe fallbacks (Apple, Windows Segoe UI, Android Roboto)
    display: "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sans: "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    medium: "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  radius: {
    sm: "4px",
    md: "8px",
    lg: "12px",
  },
} as const;

export type EmailTheme = typeof emailTheme;
