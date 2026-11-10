import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button, errorText } from "../components";
import { MIN_PASSWORD_LENGTH } from "../core/auth";
import { api, auth } from "../services";
import { colors, ui } from "../theme";

type Mode = "signin" | "signup" | "code" | "forgot";

const TITLE: Record<Mode, string> = { signin: "Welcome back", signup: "Create your account", code: "Sign in with a code", forgot: "Reset your password" };
const SUBTITLE: Record<Mode, string> = {
  signin: "Sign in to your meetings, captions and notes.",
  signup: "Live captions and notes in any meeting, no bot joins.",
  code: "No password needed: we email you a one-time code.",
  forgot: "We'll email you a code, then you choose a new password.",
};

function Field({ label, secure, ...rest }: React.ComponentProps<typeof TextInput> & { label: string; secure?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <View>
        <TextInput
          accessibilityLabel={label}
          style={[ui.input, secure && { paddingRight: 46 }]}
          placeholderTextColor={colors.muted}
          secureTextEntry={secure && !show}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
        />
        {secure && (
          <Pressable accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} onPress={() => setShow(!show)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 46, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={19} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Link({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} hitSlop={8}>
      <Text style={{ color: "#a5b4fc", fontWeight: "600", fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

/** Sign in or create an account: email and password, or a one-time email code. */
export function SignInScreen({ onSignedIn, openSettings }: { onSignedIn: () => void; openSettings: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dev, setDev] = useState(false);
  useEffect(() => {
    api.health().then((h) => setDev(h.dev_login), () => setDev(false));
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNote(null);
    setCode("");
    setCodeSent(false);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const sendCode = () =>
    run(async () => {
      await auth.sendCode(email);
      setCodeSent(true);
      setNote(`We emailed a 6-digit code to ${email.trim()}.`);
    });

  const submit = () => {
    if (mode === "signin") return void run(async () => (await auth.signIn(email, password), onSignedIn()));
    if (mode === "signup") {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      return void run(async () => {
        const r = await auth.signUp(email, password);
        if (!r.needsConfirmation) return onSignedIn();
        setMode("code");
        setCodeSent(true);
        setNote(`Almost there: we emailed a 6-digit code to ${email.trim()} to confirm it's you.`);
      });
    }
    if (!codeSent) return void sendCode();
    if (mode === "forgot") {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
      return void run(async () => {
        await auth.verifyCode(email, code);
        await auth.setPassword(password);
        onSignedIn();
      });
    }
    void run(async () => (await auth.verifyCode(email, code), onSignedIn()));
  };

  const primary = { signin: "Sign in", signup: "Create account", code: codeSent ? "Sign in" : "Email me a code", forgot: codeSent ? "Save password and sign in" : "Email me a code" }[mode];
  const disabled =
    busy || !validEmail || ((mode === "signin" || mode === "signup") && !password) || (codeSent && code.trim().length < 6);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[ui.pad, { paddingTop: 28, gap: 18 }]} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", shadowColor: colors.violet, shadowOpacity: 0.7, shadowRadius: 16, elevation: 6 }}>
            <Ionicons name="pulse" size={22} color="white" />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Meeting Copilot</Text>
            <Text style={{ color: colors.cyan, fontSize: 10, fontWeight: "700", letterSpacing: 2 }}>AI MEETING COPILOT</Text>
          </View>
        </View>

        <View style={{ gap: 4, marginTop: 6 }}>
          {(mode === "code" || mode === "forgot") && <Link title="‹ Back to sign in" onPress={() => go("signin")} />}
          <Text style={ui.h1}>{TITLE[mode]}</Text>
          <Text style={ui.muted}>{SUBTITLE[mode]}</Text>
        </View>

        <Field label="Email" placeholder="you@company.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" value={email} onChangeText={setEmail} editable={!(codeSent && (mode === "code" || mode === "forgot"))} />
        {(mode === "signin" || mode === "signup") && (
          <View style={{ gap: 8 }}>
            <Field label="Password" secure autoComplete={mode === "signup" ? "new-password" : "current-password"} textContentType={mode === "signup" ? "newPassword" : "password"} value={password} onChangeText={setPassword} />
            {mode === "signin" ? <Link title="Forgot password?" onPress={() => go("forgot")} /> : <Text style={ui.muted}>At least {MIN_PASSWORD_LENGTH} characters.</Text>}
          </View>
        )}
        {codeSent && (mode === "code" || mode === "forgot") && (
          <Field label="6-digit code" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} value={code} onChangeText={(t) => setCode(t.replace(/\s/g, ""))} />
        )}
        {codeSent && mode === "forgot" && <Field label="New password" secure autoComplete="new-password" textContentType="newPassword" value={password} onChangeText={setPassword} />}

        {note && <Text style={{ color: colors.accentText, backgroundColor: colors.accentSoft, borderRadius: 12, padding: 12, fontSize: 13 }}>{note}</Text>}
        {error && <Text accessibilityRole="alert" style={{ color: "#fca5a5", backgroundColor: colors.redSoft, borderRadius: 12, padding: 12, fontSize: 13 }}>{error}</Text>}

        <Button title={busy ? "Please wait…" : primary} disabled={disabled} onPress={submit} />
        {codeSent && (mode === "code" || mode === "forgot") && <Button kind="secondary" title="Send a new code" disabled={busy} onPress={() => void sendCode()} />}
        {mode === "signin" && <Button kind="secondary" icon="mail-outline" title="Email me a sign-in code instead" onPress={() => go("code")} />}

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          <Text style={ui.muted}>{mode === "signup" ? "Already have an account?" : "New here?"}</Text>
          <Link title={mode === "signup" ? "Sign in" : "Create an account"} onPress={() => go(mode === "signup" ? "signin" : "signup")} />
        </View>

        {dev && <Button kind="secondary" title="Use the local dev login" onPress={() => void run(async () => (await auth.devSignIn(), onSignedIn()))} />}
        <View style={{ alignItems: "center" }}>
          <Link title="Server settings" onPress={openSettings} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
