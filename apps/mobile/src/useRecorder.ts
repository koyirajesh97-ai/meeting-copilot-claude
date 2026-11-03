// The phone microphone: 16 kHz mono PCM16 in 100 ms chunks, kept running with the screen
// locked where the OS allows (iOS background audio, an Android foreground service) and shown
// in a persistent notification while it records.

import { AudioStudioModule, useAudioRecorder } from "@siteed/audio-studio";
import { useMemo } from "react";
import type { Recorder } from "./core/meeting";

export function useRecorder(): Recorder {
  const { startRecording, stopRecording } = useAudioRecorder();
  return useMemo<Recorder>(
    () => ({
      async start(onChunk) {
        const p = await AudioStudioModule.requestPermissionsAsync();
        if (!p.granted) throw new Error("Microphone permission was denied");
        await startRecording({
          sampleRate: 16000,
          channels: 1,
          encoding: "pcm_16bit",
          interval: 100,
          keepAwake: true,
          showNotification: true,
          notification: { title: "Meeting Copilot is recording", text: "Tap to open the meeting. Stop it from the app." },
          output: { primary: { enabled: false } },
          onAudioStream: async (e) => {
            if (typeof e.data === "string" || e.data instanceof Int16Array || e.data instanceof Float32Array) onChunk(e.data);
          },
        });
      },
      async stop() {
        await stopRecording();
      },
    }),
    [startRecording, stopRecording],
  );
}
