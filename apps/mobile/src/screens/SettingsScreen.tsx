import { useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { Button } from "../components";
import { saveSettings, type MobileSettings } from "../services";
import { ui } from "../theme";

export function SettingsScreen({ settings, onSaved, signedIn, onSignOut }: { settings: MobileSettings; onSaved: (s: MobileSettings) => void; signedIn: boolean; onSignOut: () => void }) {
  const [s, setS] = useState(settings);
  const field = (label: string, key: keyof MobileSettings, secure = false) => (
    <>
      <Text style={ui.muted}>{label}</Text>
      <TextInput style={ui.input} autoCapitalize="none" autoCorrect={false} secureTextEntry={secure} value={s[key]} onChangeText={(v) => setS({ ...s, [key]: v })} />
    </>
  );
  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Text style={ui.h1}>Settings</Text>
      {field("Backend URL", "backendUrl")}
      {field("Supabase URL", "supabaseUrl")}
      {field("Supabase anon key", "supabaseAnonKey", true)}
      <Text style={ui.muted}>AI provider keys stay on the backend; the phone only gets a short-lived token.</Text>
      <Button title="Save" onPress={() => void saveSettings(s).then(onSaved)} />
      {signedIn && <Button kind="secondary" title="Sign out" onPress={onSignOut} />}
    </ScrollView>
  );
}
