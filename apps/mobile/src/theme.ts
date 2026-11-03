import { StyleSheet } from "react-native";

export const colors = {
  bg: "#0b0f17",
  card: "#151b26",
  border: "#263041",
  text: "#e8edf5",
  muted: "#8b97aa",
  accent: "#3b82f6",
  red: "#ef4444",
  amber: "#f59e0b",
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  h1: { color: colors.text, fontSize: 22, fontWeight: "600" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 8 },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text, backgroundColor: colors.card },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "white", fontWeight: "600", fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  secondaryText: { color: colors.text, fontSize: 14 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  card: { backgroundColor: colors.card, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 6 },
});
