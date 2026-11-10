import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Button, errorText } from "../components";
import { MIN_PASSWORD_LENGTH } from "../core/auth";
import { auth, saveSettings, type MobileSettings } from "../services";
import { colors, ui } from "../theme";

/** Set or change the password (accounts made with a code may not have one yet). */
function PasswordSection() {
  const [pw, setPw] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await auth.setPassword(pw);
      setPw("");
      setNote({ ok: true, text: "Password saved." });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[ui.card, { gap: 10 }]}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>Password</Text>
      <TextInput
        style={ui.input}
        accessibilityLabel="New password"
        placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        value={pw}
        onChangeText={setPw}
      />
      <Button kind="secondary" title="Set or change password" disabled={busy || pw.length < MIN_PASSWORD_LENGTH} onPress={() => void save()} />
      {note && <Text style={{ color: note.ok ? colors.green : colors.amber, fontSize: 13 }}>{note.text}</Text>}
    </View>
  );
}

export function SettingsScreen({ settings, onSaved, signedIn, onSignOut }: { settings: MobileSettings; onSaved: (s: MobileSettings) => void; signedIn: boolean; onSignOut: () => void }) {
  const [s, setS] = useState(settings);
  const field = (label: string, key: keyof MobileSettings, secure = false) => (
    <>
      <Text style={ui.muted}>{label}</Text>
      <TextInput style={ui.input} autoCapitalize="none" autoCorrect={false} secureTextEntry={secure} value={s[key]} onChangeText={(v) => setS({ ...s, [key]: v })} />
    </>
  );
  return (
    <ScrollView contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
      <Text style={ui.h1}>Settings</Text>
      {signedIn && auth.current?.kind === "supabase" && <PasswordSection />}
      <Text style={ui.h2}>Server</Text>
      {field("Backend URL", "backendUrl")}
      {field("Supabase URL", "supabaseUrl")}
      {field("Supabase anon key", "supabaseAnonKey", true)}
      <Text style={ui.muted}>AI provider keys stay on the backend; the phone only gets a short-lived token.</Text>
      <Button title="Save" onPress={() => void saveSettings(s).then(onSaved)} />
      {signedIn && <Button kind="secondary" title="Sign out" onPress={onSignOut} />}
    </ScrollView>
  );
}
