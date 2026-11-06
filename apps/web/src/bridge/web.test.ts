import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@desktop/shared/ipc";
import { wavFromFloat } from "./recorder";
import { loadSettings, localSecrets, saveSettings, toCached, toCachedDetail } from "./web";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
const store = () => new MemoryStorage() as unknown as Storage;

describe("web settings", () => {
  it("starts from the desktop defaults with no server (the site asks for one)", () => {
    const s = loadSettings(store());
    expect(s.backendUrl).toBe("");
    expect(s.captionFontSize).toBe(DEFAULT_SETTINGS.captionFontSize);
    expect(s.setupDone).toBe(false);
  });

  it("keeps changes and survives broken saved data", () => {
    const st = store();
    saveSettings({ backendUrl: "https://api.example.com", theme: "dark" }, st);
    expect(loadSettings(st)).toMatchObject({ backendUrl: "https://api.example.com", theme: "dark" });
    st.setItem("meeting-copilot.settings", "{not json");
    expect(loadSettings(st).backendUrl).toBe("");
  });

  it("stores the session token under its own key and forgets it on delete", () => {
    const st = store();
    const box = localSecrets(st);
    box.set("backendToken", "t1");
    expect(box.get("backendToken")).toBe("t1");
    box.delete("backendToken");
    expect(box.get("backendToken")).toBeNull();
  });
});

describe("meeting mapping", () => {
  const out = { id: "m1", type: "standup", title: "Daily", mode: "cloud", visibility: "project", project_id: "p1", started_at: 10, ended_at: 20, is_mine: false, is_live: true };

  it("fills the fields the screens expect", () => {
    expect(toCached(out)).toEqual({ ...out, segment_count: 0 });
    expect(toCached({ ...out, is_mine: undefined, is_live: undefined, project_id: undefined })).toMatchObject({ is_mine: true, is_live: false, project_id: null });
  });

  it("counts transcript segments in the detail view", () => {
    const seg = { segment_id: "s", channel: "mic" as const, speaker_id: "me", text: "hi", start_ms: 0, end_ms: 1 };
    const d = toCachedDetail({
      ...out,
      transcript: [seg, seg],
      summary: { status: "none", error: null, id: null, template: null, data: null },
      action_items: [],
      decisions: [],
      speaker_names: { spk_0: "Priya" },
    });
    expect(d.segment_count).toBe(2);
    expect(d.speaker_names).toEqual({ spk_0: "Priya" });
  });
});

describe("voice sample", () => {
  it("is a 16 kHz mono PCM16 WAV", async () => {
    const wav = wavFromFloat(new Float32Array(48_000).fill(0.5), 48_000);
    const v = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(wav.size - 44);
    expect(Math.abs(v.getUint32(40, true) / 2 - 16_000)).toBeLessThan(200);
  });
});
