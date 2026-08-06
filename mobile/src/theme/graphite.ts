import { DarkTheme, type Theme } from "@react-navigation/native";

export const GRAPHITE_COLORS = {
  page: "#000000",
  canvas: "#000000",
  surface: "#0A0A0A",
  surfaceStrong: "#141414",
  surfacePressed: "#1D1D1D",
  line: "rgba(255,255,255,0.11)",
  lineStrong: "rgba(255,255,255,0.20)",
  text: "#F3F3F3",
  textMuted: "#A7A7A7",
  textFaint: "#7F7F7F",
  primary: "#69C8A4",
  primaryStrong: "#8EDABB",
  primaryDeep: "#1F493B",
  onPrimary: "#000000",
  primarySoft: "rgba(105,200,164,0.13)",
  primaryLine: "rgba(105,200,164,0.38)",
  danger: "#E59087",
  dangerLine: "rgba(229,144,135,0.55)",
  warning: "#E7B06A",
  warningStrong: "#F1C783",
  warningSoft: "rgba(231,176,106,0.13)",
  warningLine: "rgba(231,176,106,0.42)",
  shadow: "#000000",
} as const;

export const GRAPHITE_RADII = {
  control: 15,
  button: 16,
  brand: 18,
} as const;

// Keep profile-banner selection and every rendered card on the same canvas.
export const PROFILE_BANNER_ASPECT_RATIO = 16 / 7;

export const GRAPHITE_INPUT_COLORS = {
  text: GRAPHITE_COLORS.text,
  placeholder: GRAPHITE_COLORS.textFaint,
  cursor: GRAPHITE_COLORS.primary,
  selection: GRAPHITE_COLORS.primaryStrong,
} as const;

export const GRAPHITE_NAVIGATION_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: GRAPHITE_COLORS.primary,
    background: GRAPHITE_COLORS.canvas,
    card: GRAPHITE_COLORS.canvas,
    text: GRAPHITE_COLORS.text,
    border: GRAPHITE_COLORS.line,
    notification: GRAPHITE_COLORS.danger,
  },
};
