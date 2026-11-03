import { speakerLabel } from "@meeting-copilot/shared";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Button, ErrorText, errorText } from "../components";
import type { MeetingDetail, MeetingSummary } from "../core/api";
import { api } from "../services";
import { ui } from "../theme";

const when = (t: number) => new Date(t * 1000).toLocaleString();

/** Your meetings and their summaries, read-only (edit them on the desktop). */
export function MeetingsScreen({ openId }: { openId: string | null }) {
  const [list, setList] = useState<MeetingSummary[]>([]);
  const [open, setOpen] = useState<string | null>(openId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api.meetings().then(setList, (e) => setError(errorText(e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => setOpen(openId), [openId]);
  if (open) return <Detail id={open} back={() => setOpen(null)} />;
  return (
    <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={ui.h1}>Meetings</Text>
      <ErrorText>{error}</ErrorText>
      {list.length === 0 && !error && <Text style={ui.muted}>No meetings yet.</Text>}
      {list.map((m) => (
        <Pressable key={m.id} accessibilityRole="button" style={ui.card} onPress={() => setOpen(m.id)}>
          <Text style={ui.text}>{m.title}</Text>
          <Text style={ui.muted}>
            {when(m.started_at)}
            {m.ended_at === null ? " · in progress" : ""}
            {m.is_mine === false ? " · shared" : ""}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Detail({ id, back }: { id: string; back: () => void }) {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.meeting(id).then(setM, (e) => setError(errorText(e)));
  }, [id]);
  const data = m?.summary.data as
    | { overview?: string; sections?: { title: string; items: string[] }[]; decisions?: { text: string }[]; per_person?: { person: string; done: string[]; doing: string[]; blockers: string[] }[] }
    | null
    | undefined;
  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Button kind="secondary" title="Back" onPress={back} />
      <ErrorText>{error}</ErrorText>
      {m && (
        <>
          <Text style={ui.h1}>{m.title}</Text>
          <Text style={ui.muted}>{when(m.started_at)}</Text>
          <Text style={ui.h2}>Summary</Text>
          {m.summary.status !== "ready" && <Text style={ui.muted}>{m.summary.status === "pending" ? "Being written…" : "No summary yet."}</Text>}
          {data?.overview && <Text style={ui.text}>{data.overview}</Text>}
          {data?.sections?.map((s) => (
            <View key={s.title} style={{ gap: 4 }}>
              <Text style={ui.h2}>{s.title}</Text>
              {s.items.map((it, i) => (
                <Text key={i} style={ui.text}>• {it}</Text>
              ))}
            </View>
          ))}
          {data?.per_person?.map((p) => (
            <Text key={p.person} style={ui.text}>
              <Text style={{ fontWeight: "700" }}>{p.person}: </Text>
              {[...p.done.map((x) => `done: ${x}`), ...p.doing.map((x) => `doing: ${x}`), ...p.blockers.map((x) => `blocked: ${x}`)].join("; ")}
            </Text>
          ))}
          {!!data?.decisions?.length && <Text style={ui.h2}>Decisions</Text>}
          {data?.decisions?.map((d, i) => (
            <Text key={i} style={ui.text}>• {d.text}</Text>
          ))}
          {m.action_items.length > 0 && <Text style={ui.h2}>Action items</Text>}
          {m.action_items.map((a) => (
            <Text key={a.id} style={ui.text}>
              {a.status === "done" ? "☑" : "☐"} {a.text}
              {a.owner ? ` — ${a.owner}` : ""}
              {a.due ? `, ${a.due}` : ""}
            </Text>
          ))}
          <Text style={ui.h2}>Transcript</Text>
          {m.transcript.map((s) => (
            <Text key={s.segment_id} style={ui.text}>
              <Text style={{ fontWeight: "700" }}>{speakerLabel(s.speaker_id, m.speaker_names)}: </Text>
              {s.text}
            </Text>
          ))}
        </>
      )}
    </ScrollView>
  );
}
