import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { ErrorText, errorText } from "../components";
import type { SearchHit } from "../core/api";
import { api } from "../services";
import { ui } from "../theme";

export function SearchScreen({ openMeeting }: { openMeeting: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = () => q.trim().length >= 2 && void api.search(q.trim()).then((h) => (setHits(h), setError(null)), (e) => setError(errorText(e)));
  return (
    <ScrollView contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
      <Text style={ui.h1}>Search</Text>
      <TextInput style={ui.input} placeholder="Everything that was said" placeholderTextColor="#667" value={q} onChangeText={setQ} onSubmitEditing={search} returnKeyType="search" />
      <ErrorText>{error}</ErrorText>
      {hits?.length === 0 && <Text style={ui.muted}>Nothing found.</Text>}
      {hits?.map((h, i) => (
        <Pressable key={i} style={ui.card} disabled={!h.meeting_id} onPress={() => openMeeting(h.meeting_id)}>
          <Text style={ui.text}>{h.title}</Text>
          <Text style={ui.muted} numberOfLines={3}>{h.text}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
