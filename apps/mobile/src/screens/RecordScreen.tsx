import { MEETING_TYPES, sourceLabel, speakerLabel, visibleCards, visibleLines } from "@meeting-copilot/shared";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Chip, ErrorText, errorText, RecordButton } from "../components";
import type { Project } from "../core/api";
import type { MeetingView, PhoneMeeting } from "../core/meeting";
import { api } from "../services";
import { colors, ui } from "../theme";

const STATUS: Record<string, string> = {
  off: "Not connected",
  connecting: "Connecting… (audio is kept meanwhile)",
  live: "Live",
  reconnecting: "Reconnecting… (audio is kept meanwhile)",
  "local-only": "Not connected",
};

export function RecordScreen({ meeting, view }: { meeting: PhoneMeeting; view: MeetingView }) {
  return view.recording ? <LiveView meeting={meeting} view={view} /> : <StartForm meeting={meeting} error={view.error} />;
}

function StartForm({ meeting, error }: { meeting: PhoneMeeting; error: string | null }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("standup");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.projects().then((p) => setProjects(p.filter((x) => x.role !== "viewer")), (e) => setNote(errorText(e)));
  }, []);
  const start = () =>
    void meeting.start({
      title: title.trim() || `Meeting · ${new Date().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
      type,
      mode: liveOnly ? "live-only" : "cloud",
      visibility: projectId && share ? "project" : "private",
      project_id: projectId,
    });
  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Text style={ui.eyebrow}>Meeting Copilot</Text>
      <Text style={ui.h1}>Start a meeting</Text>
      <Text style={ui.muted}>Put the phone near the speaker or the people talking. Tell everyone you're recording.</Text>
      <TextInput style={ui.input} placeholder="Meeting name (optional)" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
      <View style={{ paddingVertical: 18 }}>
        <RecordButton onPress={start} />
      </View>
      <Text style={ui.eyebrow}>Options</Text>
      <Text style={ui.h2}>Project</Text>
      <View style={ui.row}>
        <Chip label="Personal" on={projectId === null} onPress={() => setProjectId(null)} />
        {projects.map((p) => (
          <Chip key={p.id} label={p.name} on={projectId === p.id} onPress={() => setProjectId(p.id)} />
        ))}
      </View>
      {projectId && <Chip label={share ? "Shared with the project" : "Only me"} on={share} onPress={() => setShare(!share)} />}
      <Text style={ui.h2}>Meeting type</Text>
      <View style={ui.row}>
        {MEETING_TYPES.map((t) => (
          <Chip key={t.id} label={t.label} on={type === t.id} onPress={() => setType(t.id)} />
        ))}
      </View>
      <Chip label={liveOnly ? "Live-only: nothing is saved" : "Save transcript and summary"} on={liveOnly} onPress={() => setLiveOnly(!liveOnly)} />
      <ErrorText>{error ?? note}</ErrorText>
    </ScrollView>
  );
}

function LiveView({ meeting, view }: { meeting: PhoneMeeting; view: MeetingView }) {
  const [note, setNote] = useState<string | null>(null);
  const lines = visibleLines(view.captions);
  const { shown } = visibleCards(view.cards, Date.now());
  const act = (a: "catch_up" | "clarify" | "follow_up", minutes?: number) => setNote(meeting.control(a, minutes) ? null : "Not connected yet; try again in a moment.");
  return (
    <View style={[ui.screen, { padding: 16, gap: 10 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: view.live.status === "live" ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)" }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: view.live.status === "live" ? colors.green : colors.amber }} />
          <Text style={{ color: view.live.status === "live" ? colors.green : colors.amber, fontSize: 12, fontWeight: "600" }}>{STATUS[view.live.status]}</Text>
        </View>
        {view.live.message && view.live.status !== "live" ? <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>{view.live.message}</Text> : null}
      </View>
      {shown.map((c) => (
        <View key={c.id} style={[ui.card, { borderColor: "rgba(129,140,248,0.45)", backgroundColor: colors.cardRaised }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="sparkles" size={14} color={colors.accentText} />
            <Text style={{ color: colors.accentText, fontWeight: "700", fontSize: 13 }}>{c.kind === "catch_up" ? "Catch up" : c.kind === "clarify" ? "Clarify" : c.kind === "standup" ? "Your standup" : "Answer"}</Text>
          </View>
          <Text style={ui.text}>{c.text}</Text>
          {c.sources.length > 0 && <Text style={ui.muted}>{c.sources.map((s) => sourceLabel(s, view.captions.meetingId)).join(" · ")}</Text>}
          <View style={ui.row}>
            <Chip label="Used" on={c.feedback === true} onPress={() => meeting.feedback(c.id, true)} />
            <Chip label="Not useful" on={c.feedback === false} onPress={() => meeting.feedback(c.id, false)} />
            <Chip label="Dismiss" on={false} onPress={() => meeting.dismiss(c.id)} />
          </View>
        </View>
      ))}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
        {lines.length === 0 && <Text style={ui.muted}>Listening…</Text>}
        {lines.slice(-80).map((l) => (
          <Text key={l.key} style={[ui.text, !l.final && { color: colors.muted, fontStyle: "italic" }]}>
            <Text style={{ fontWeight: "700", color: l.speakerId === "me" ? "#a5b4fc" : "#fcd34d" }}>{speakerLabel(l.speakerId, view.captions.names)}: </Text>
            {l.text}
          </Text>
        ))}
      </ScrollView>
      <View style={ui.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Catch me up" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("catch_up")} onLongPress={() => act("catch_up", 5)}>
          <Ionicons name="time-outline" size={16} color={colors.accentText} />
          <Text style={ui.secondaryText} numberOfLines={1}>Catch up</Text>
        </Pressable>
        <Button kind="secondary" icon="help-circle-outline" title="Clarify" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("clarify")} />
        <Button kind="secondary" icon="return-up-forward-outline" title="Follow up" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("follow_up")} />
      </View>
      <ErrorText>{note}</ErrorText>
      <Button kind="danger" icon="stop" title="Stop recording" onPress={() => void meeting.stop()} />
    </View>
  );
}
