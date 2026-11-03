import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { Button, ErrorText, errorText } from "../components";
import { api, auth } from "../services";
import { ui } from "../theme";

export function SignInScreen({ onSignedIn, openSettings }: { onSignedIn: () => void; openSettings: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.health().then((h) => setDev(h.dev_login), () => setDev(false));
  }, []);
  const run = (fn: () => Promise<unknown>) => () => void fn().then(() => setError(null), (e) => setError(errorText(e)));
  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Text style={ui.h1}>Meeting Copilot</Text>
      <Text style={ui.muted}>Sign in with the same account as your desktop app.</Text>
      <TextInput style={ui.input} placeholder="you@example.com" placeholderTextColor="#667" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      {sent && <TextInput style={ui.input} placeholder="6-digit code from the email" placeholderTextColor="#667" keyboardType="number-pad" value={code} onChangeText={setCode} />}
      {!sent ? (
        <Button title="Email me a code" disabled={!email.includes("@")} onPress={run(async () => (await auth.sendCode(email), setSent(true)))} />
      ) : (
        <Button title="Sign in" disabled={code.trim().length < 6} onPress={run(async () => (await auth.verifyCode(email, code), onSignedIn()))} />
      )}
      {dev && <Button kind="secondary" title="Use the local dev login" onPress={run(async () => (await auth.devSignIn(), onSignedIn()))} />}
      <Button kind="secondary" title="Settings" onPress={openSettings} />
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
