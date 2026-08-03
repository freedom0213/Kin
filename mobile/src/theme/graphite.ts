import { DarkTheme, type Theme } from "@react-navigation/native";

export const GRAPHITE_COLORS = {
  page: "#080A09",
  canvas: "#0F1210",
  surface: "#171B18",
  surfaceStrong: "#1D221E",
  surfacePressed: "#242A25",
  line: "rgba(235,242,237,0.11)",
  lineStrong: "rgba(235,242,237,0.20)",
  text: "#F1F4F1",
  textMuted: "#A3ACA6",
  textFaint: "#858F88",
  primary: "#69C8A4",
  primaryStrong: "#8EDABB",
  primaryDeep: "#1F493B",
  onPrimary: "#07120D",
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
    card: GRAPHITE_COLORS.surface,
    text: GRAPHITE_COLORS.text,
    border: GRAPHITE_COLORS.line,
    notification: GRAPHITE_COLORS.danger,
  },
};
