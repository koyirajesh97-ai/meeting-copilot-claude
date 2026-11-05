import { StyleSheet } from "react-native";

// Same look as the desktop overlay: deep slate, an indigo accent, soft rounded surfaces.
export const colors = {
  bg: "#0b1020",
  card: "#131a2c",
  cardRaised: "#182036",
  border: "#222c45",
  text: "#e7ebf3",
  muted: "#8a94a8",
  accent: "#6366f1",
  accentSoft: "rgba(99,102,241,0.16)",
  accentText: "#c7d2fe",
  red: "#ef4444",
  redSoft: "rgba(239,68,68,0.14)",
  amber: "#f59e0b",
  green: "#34d399",
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 20, gap: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.6 },
  h2: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 10, letterSpacing: -0.2 },
  eyebrow: { color: colors.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, backgroundColor: colors.card, fontSize: 15 },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  buttonText: { color: "white", fontWeight: "600", fontSize: 15 },
  secondary: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: "500" },
  chip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: "rgba(129,140,248,0.55)" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
});
