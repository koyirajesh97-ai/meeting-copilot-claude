import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View, type PressableProps } from "react-native";
import { colors, ui } from "./theme";

export type IconName = keyof typeof Ionicons.glyphMap;

export function Button({ title, kind = "primary", icon, ...rest }: PressableProps & { title: string; kind?: "primary" | "secondary" | "danger"; icon?: IconName }) {
  const style = kind === "secondary" ? ui.secondary : [ui.button, kind === "danger" && { backgroundColor: colors.red, shadowColor: colors.red }];
  const fg = kind === "secondary" ? colors.text : "white";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [style, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }, rest.disabled && { opacity: 0.45 }]} {...rest}>
      {icon && <Ionicons name={icon} size={kind === "secondary" ? 15 : 17} color={kind === "secondary" ? colors.accentText : "white"} />}
      <Text numberOfLines={1} style={[kind === "secondary" ? ui.secondaryText : ui.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

/** The big round record button on the Record tab. */
export function RecordButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start recording"
      onPress={onPress}
      style={({ pressed }) => ({ alignSelf: "center", alignItems: "center", gap: 10, transform: [{ scale: pressed ? 0.96 : 1 }] })}
    >
      <View style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
          <Ionicons name="mic" size={42} color="white" />
        </View>
      </View>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>Start recording</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[ui.chip, on && ui.chipOn]}>
      <Text style={{ color: on ? colors.accentText : colors.text, fontSize: 13, fontWeight: on ? "600" : "400" }}>{label}</Text>
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
    <View accessibilityRole="alert" accessibilityLabel="Recording" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.redSoft, borderColor: "rgba(239,68,68,0.35)", borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red }} />
        <Text style={{ color: "#fca5a5", fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: 0.5 }}>REC {clock}</Text>
        <Text style={{ color: "#fca5a5", fontSize: 12, opacity: 0.8 }}>· microphone on</Text>
      </View>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  return children ? <Text style={{ color: colors.amber, fontSize: 13 }}>{children}</Text> : null;
}

export const errorText = (e: unknown) => (e as Error).message;
