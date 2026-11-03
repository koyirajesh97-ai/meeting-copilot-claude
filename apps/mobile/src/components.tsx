import { useEffect, useState } from "react";
import { Pressable, Text, View, type PressableProps } from "react-native";
import { colors, ui } from "./theme";

export function Button({ title, kind = "primary", ...rest }: PressableProps & { title: string; kind?: "primary" | "secondary" | "danger" }) {
  const style = kind === "secondary" ? ui.secondary : [ui.button, kind === "danger" && { backgroundColor: colors.red }];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [style, pressed && { opacity: 0.7 }, rest.disabled && { opacity: 0.5 }]} {...rest}>
      <Text style={kind === "secondary" ? ui.secondaryText : ui.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[ui.chip, on && ui.chipOn]}>
      <Text style={{ color: on ? "white" : colors.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** Red dot and timer whenever the microphone is on. Always rendered at the top; never hidden. */
export function RecordingIndicator({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [startedAt]);
  if (startedAt === null) return null;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <View accessibilityRole="alert" accessibilityLabel="Recording" style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#3b0d0d", paddingVertical: 6, paddingHorizontal: 16 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red }} />
      <Text style={{ color: "#fecaca", fontWeight: "700" }}>REC {clock}</Text>
      <Text style={{ color: "#fca5a5", fontSize: 12 }}>The microphone is on</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  return children ? <Text style={{ color: colors.amber, fontSize: 13 }}>{children}</Text> : null;
}

export const errorText = (e: unknown) => (e as Error).message;
