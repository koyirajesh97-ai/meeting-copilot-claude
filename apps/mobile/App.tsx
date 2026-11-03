// Meeting Copilot on the phone: record a meeting with the phone mic, see live captions and
// cards, and read summaries and search. Summaries and transcripts are read-only here.

import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { RecordingIndicator } from "./src/components";
import { IDLE, PhoneMeeting, type MeetingView } from "./src/core/meeting";
import { MeetingsScreen } from "./src/screens/MeetingsScreen";
import { RecordScreen } from "./src/screens/RecordScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SignInScreen } from "./src/screens/SignInScreen";
import { api, auth, DEFAULT_SETTINGS, loadSettings, type MobileSettings } from "./src/services";
import { colors, ui } from "./src/theme";
import { useRecorder } from "./src/useRecorder";

type Tab = "record" | "meetings" | "search" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "record", label: "Record" },
  { id: "meetings", label: "Meetings" },
  { id: "search", label: "Search" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const recorder = useRecorder();
  const meeting = useMemo(() => new PhoneMeeting(api, recorder), [recorder]);
  const [view, setView] = useState<MeetingView>(IDLE);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [settings, setSettings] = useState<MobileSettings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>("record");
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings());
      setSignedIn(!!(await auth.load()));
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const onChange = (v: MeetingView) => {
      setView(v);
      setStartedAt((s) => (v.recording ? (s ?? Date.now()) : null));
    };
    meeting.on("change", onChange);
    return () => void meeting.off("change", onChange);
  }, [meeting]);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
        <StatusBar style="light" />
        <RecordingIndicator startedAt={startedAt} />
        <View style={{ flex: 1 }}>
          {!signedIn && tab !== "settings" ? (
            <SignInScreen onSignedIn={() => setSignedIn(true)} openSettings={() => setTab("settings")} />
          ) : tab === "record" ? (
            <RecordScreen meeting={meeting} view={view} />
          ) : tab === "meetings" ? (
            <MeetingsScreen openId={openMeeting} />
          ) : tab === "search" ? (
            <SearchScreen openMeeting={(id) => (setOpenMeeting(id), setTab("meetings"))} />
          ) : (
            <SettingsScreen
              settings={settings}
              onSaved={setSettings}
              signedIn={signedIn}
              onSignOut={() => void (view.recording ? meeting.stop() : Promise.resolve()).then(() => auth.signOut()).then(() => setSignedIn(false))}
            />
          )}
        </View>
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
          {TABS.map((t) => (
            <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} style={{ flex: 1, paddingVertical: 12, alignItems: "center" }} onPress={() => (setOpenMeeting(null), setTab(t.id))}>
              <Text style={{ color: tab === t.id ? colors.accent : colors.muted, fontWeight: "600" }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
