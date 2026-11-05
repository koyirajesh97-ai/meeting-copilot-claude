// Meeting Copilot on the phone: record a meeting with the phone mic, see live captions and
// cards, and read summaries and search. Summaries and transcripts are read-only here.

import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { RecordingIndicator, type IconName } from "./src/components";
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
const TABS: { id: Tab; label: string; icon: IconName; iconOn: IconName }[] = [
  { id: "record", label: "Record", icon: "mic-outline", iconOn: "mic" },
  { id: "meetings", label: "Meetings", icon: "albums-outline", iconOn: "albums" },
  { id: "search", label: "Search", icon: "search-outline", iconOn: "search" },
  { id: "settings", label: "Settings", icon: "settings-outline", iconOn: "settings" },
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
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#0e1426" }}>
          {TABS.map((t) => (
            <Pressable key={t.id} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: tab === t.id }} style={{ flex: 1, paddingVertical: 9, alignItems: "center", gap: 3 }} onPress={() => (setOpenMeeting(null), setTab(t.id))}>
              <Ionicons name={tab === t.id ? t.iconOn : t.icon} size={22} color={tab === t.id ? "#a5b4fc" : colors.muted} />
              <Text style={{ color: tab === t.id ? "#a5b4fc" : colors.muted, fontSize: 11, fontWeight: "600" }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
