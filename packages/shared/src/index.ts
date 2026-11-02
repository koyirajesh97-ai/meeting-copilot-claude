// Event types are generated here from schema/events.json (Prompt 1).

/** Audio channel byte on the wire: 0 = mic, 1 = system. */
export const AudioChannel = { Mic: 0, System: 1 } as const;
export type AudioChannel = (typeof AudioChannel)[keyof typeof AudioChannel];

/** 20 ms of 16 kHz mono PCM16. */
export const FRAME_BYTES = 640;
