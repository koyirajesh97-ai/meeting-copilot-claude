import { MEETING_TYPES, MODE_INFO, sourceLabel, speakerLabel, talkShare, visibleCards, visibleLines } from "@meeting-copilot/shared";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Chip, ErrorText, errorText, RecordButton, type IconName } from "../components";
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

const MODE_ICON: Record<string, IconName> = {
  standup: "people-outline",
  review: "git-pull-request-outline",
  planning: "calendar-outline",
  incident: "warning-outline",
  client: "briefcase-outline",
  one_on_one: "chatbubbles-outline",
  research: "book-outline",
  custom: "pulse-outline",
};

const TOOLS: { key: "answers" | "topics"; label: string; hint: string }[] = [
  {
    key: "answers",
    label: "Answer questions asked to you",
    hint: "What to say, from your notes and past meetings.",
  },
  {
    key: "topics",
    label: "Topic briefings",
    hint: "Quick facts when a system or ticket you own comes up.",
  },
];

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: colors.accentSoft,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: colors.accentText,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {n}
          </Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function StartForm({ meeting, error }: { meeting: PhoneMeeting; error: string | null }) {
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [type, setType] = useState<string>("standup");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [tools, setTools] = useState({ answers: true, topics: true });
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.projects().then(
      (p) => setProjects(p.filter((x) => x.role !== "viewer")),
      (e) => setNote(errorText(e)),
    );
  }, []);
  const start = () =>
    void meeting.start({
      title: title.trim() || `Meeting · ${new Date().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
      type,
      mode: liveOnly ? "live-only" : "cloud",
      visibility: projectId && share ? "project" : "private",
      project_id: projectId,
      agenda: agenda.trim(),
      tools,
    });
  const info = MODE_INFO[type] ?? MODE_INFO.custom;
  return (
    <ScrollView contentContainerStyle={[ui.pad, { gap: 22, paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: colors.cyan,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 2,
          }}
        >
          NEW SESSION
        </Text>
        <Text style={ui.h1}>Launch your copilot</Text>
        <Text style={ui.muted}>Put the phone near the speaker or the people talking, and tell everyone you're recording.</Text>
      </View>

      <Section n={1} title="What kind of meeting?">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {MEETING_TYPES.map((t) => {
            const m = MODE_INFO[t.id] ?? MODE_INFO.custom;
            const on = type === t.id;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={m.name}
                onPress={() => setType(t.id)}
                style={{
                  width: "48%",
                  flexGrow: 1,
                  borderRadius: 16,
                  padding: 12,
                  gap: 6,
                  borderWidth: 1,
                  backgroundColor: on ? colors.accentSoft : colors.card,
                  borderColor: on ? "rgba(129,140,248,0.6)" : colors.border,
                }}
              >
                <Ionicons name={MODE_ICON[t.id] ?? "pulse-outline"} size={20} color={on ? colors.accentText : colors.muted} />
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "700",
                    fontSize: 14,
                  }}
                >
                  {m.name}
                </Text>
                <Text style={[ui.muted, { fontSize: 12, lineHeight: 16 }]} numberOfLines={2}>
                  {m.blurb}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[ui.card, { backgroundColor: colors.cardRaised, gap: 6 }]}>
          {info.perks.map((p) => (
            <View key={p} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name="checkmark-circle" size={16} color={colors.green} />
              <Text style={[ui.text, { fontSize: 14 }]}>{p}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section n={2} title="Give your copilot context">
        <TextInput style={ui.input} accessibilityLabel="Title" placeholder="Meeting name (optional)" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
        <TextInput
          style={[ui.input, { minHeight: 76, textAlignVertical: "top" }]}
          accessibilityLabel="Agenda"
          multiline
          placeholder="Agenda, goals or notes for the copilot"
          placeholderTextColor={colors.muted}
          value={agenda}
          onChangeText={setAgenda}
        />
        <View style={ui.row}>
          <Chip label="Personal" on={projectId === null} onPress={() => setProjectId(null)} />
          {projects.map((p) => (
            <Chip key={p.id} label={p.name} on={projectId === p.id} onPress={() => setProjectId(p.id)} />
          ))}
        </View>
        {projectId && <Chip label={share ? "Shared with the project" : "Only me"} on={share} onPress={() => setShare(!share)} />}
      </Section>

      <Section n={3} title="Adaptive tools">
        <View style={[ui.card, { paddingVertical: 4, gap: 0 }]}>
          {TOOLS.map((t, i) => (
            <View
              key={t.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 12,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{t.label}</Text>
                <Text style={ui.muted}>{t.hint}</Text>
              </View>
              <Switch accessibilityLabel={t.label} value={tools[t.key]} onValueChange={(v) => setTools({ ...tools, [t.key]: v })} trackColor={{ true: colors.accent, false: "#2a3152" }} thumbColor="white" />
            </View>
          ))}
          <Text
            style={[
              ui.muted,
              {
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              },
            ]}
          >
            Always on: live captions, Ask the copilot, Catch up, Clarify and Follow up.
          </Text>
        </View>
      </Section>

      <Section n={4} title="Privacy">
        <View style={ui.row}>
          <Chip label="Cloud: transcript and summary saved" on={!liveOnly} onPress={() => setLiveOnly(false)} />
          <Chip label="Live-only: nothing is saved" on={liveOnly} onPress={() => setLiveOnly(true)} />
        </View>
      </Section>

      <View style={{ paddingTop: 6 }}>
        <RecordButton onPress={start} />
      </View>
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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            paddingVertical: 4,
            paddingHorizontal: 10,
            backgroundColor: view.live.status === "live" ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: view.live.status === "live" ? colors.green : colors.amber,
            }}
          />
          <Text
            style={{
              color: view.live.status === "live" ? colors.green : colors.amber,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            {STATUS[view.live.status]}
          </Text>
        </View>
        {view.live.message && view.live.status !== "live" ? (
          <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>
            {view.live.message}
          </Text>
        ) : null}
      </View>
      {shown.length > 0 && (
        <ScrollView style={{ maxHeight: "42%", flexGrow: 0 }} contentContainerStyle={{ gap: 10 }} accessibilityLabel="Copilot cards">
          {shown.map((c) => (
            <View
              key={c.id}
              style={[
                ui.card,
                {
                  borderColor: "rgba(129,140,248,0.45)",
                  backgroundColor: colors.cardRaised,
                },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="sparkles" size={14} color={colors.accentText} />
                <Text
                  style={{
                    color: colors.accentText,
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  {c.kind === "catch_up" ? "Catch up" : c.kind === "clarify" ? "Clarify" : c.kind === "standup" ? "Your standup" : "Answer"}
                </Text>
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
        </ScrollView>
      )}
      <TalkBar view={view} />
      <ScrollView style={{ flex: 1, minHeight: 80 }} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
        {lines.length === 0 && <Text style={ui.muted}>Listening…</Text>}
        {lines.slice(-80).map((l) => (
          <Text key={l.key} style={[ui.text, !l.final && { color: colors.muted, fontStyle: "italic" }]}>
            <Text
              style={{
                fontWeight: "700",
                color: l.speakerId === "me" ? "#a5b4fc" : "#fcd34d",
              }}
            >
              {speakerLabel(l.speakerId, view.captions.names)}:{" "}
            </Text>
            {l.text}
          </Text>
        ))}
      </ScrollView>
      <AskBox meeting={meeting} />
      <View style={ui.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Catch me up" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("catch_up")} onLongPress={() => act("catch_up", 5)}>
          <Ionicons name="time-outline" size={16} color={colors.accentText} />
          <Text style={ui.secondaryText} numberOfLines={1}>
            Catch up
          </Text>
        </Pressable>
        <Button kind="secondary" icon="help-circle-outline" title="Clarify" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("clarify")} />
        <Button kind="secondary" icon="return-up-forward-outline" title="Follow up" style={[ui.secondary, { flex: 1, paddingHorizontal: 6 }]} onPress={() => act("follow_up")} />
      </View>
      <ErrorText>{note}</ErrorText>
      <Button kind="danger" icon="stop" title="Stop recording" onPress={() => void meeting.stop()} />
    </View>
  );
}

const BAR_COLORS = [colors.cyan, colors.violet, "#f472b6", colors.amber, colors.green];

/** Who's been talking, by share of words (the phone hears the whole room). */
function TalkBar({ view }: { view: MeetingView }) {
  const t = talkShare(view.captions);
  const total = t.speakers.reduce((n, sp) => n + sp.words, 0);
  if (!total) return null;
  const top = t.speakers.slice(0, 4);
  return (
    <View style={{ gap: 6 }} accessibilityLabel="Talk time">
      <View
        style={{
          flexDirection: "row",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      >
        {top.map((sp, i) => (
          <View
            key={sp.speaker}
            style={{
              flex: sp.words,
              backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
            }}
          />
        ))}
        {total > top.reduce((n, sp) => n + sp.words, 0) && <View style={{ flex: total - top.reduce((n, sp) => n + sp.words, 0) }} />}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {top.map((sp, i) => (
          <Text key={sp.speaker} style={{ color: colors.muted, fontSize: 11 }}>
            <Text
              style={{
                color: BAR_COLORS[i % BAR_COLORS.length],
                fontWeight: "700",
              }}
            >
              ●{" "}
            </Text>
            {sp.speaker} {Math.round((sp.words / total) * 100)}%
          </Text>
        ))}
      </View>
    </View>
  );
}

/** "Ask the copilot": a typed question mid-meeting; the answer arrives as a card above. */
function AskBox({ meeting }: { meeting: PhoneMeeting }) {
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const send = () => {
    if (!q.trim()) return;
    if (meeting.ask(q)) {
      setQ("");
      setNote("Asked. The answer appears as a card.");
    } else setNote("Not connected yet; try again in a moment.");
    setTimeout(() => setNote(null), 4000);
  };
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "rgba(34,211,238,0.35)",
          backgroundColor: colors.cyanSoft,
          paddingLeft: 12,
        }}
      >
        <Ionicons name="sparkles" size={15} color={colors.cyan} />
        <TextInput
          accessibilityLabel="Ask the copilot"
          style={{
            flex: 1,
            color: colors.text,
            paddingVertical: 11,
            fontSize: 14,
          }}
          placeholder="Ask the copilot about this meeting…"
          placeholderTextColor={colors.muted}
          value={q}
          maxLength={500}
          onChangeText={setQ}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" onPress={send} disabled={!q.trim()} style={{ padding: 11, opacity: q.trim() ? 1 : 0.4 }}>
          <Ionicons name="send" size={17} color={colors.cyan} />
        </Pressable>
      </View>
      {note && <Text style={[ui.muted, { fontSize: 12 }]}>{note}</Text>}
    </View>
  );
}
