/** "spk_1" -> "Speaker 2", "me" -> "You", or the name given for this meeting. */
export function speakerLabel(id: string, names: Record<string, string> = {}): string {
  if (names[id]) return names[id];
  if (id === "me") return "You";
  const m = /^spk_(\d+)$/.exec(id);
  return m ? `Speaker ${Number(m[1]) + 1}` : id;
}
