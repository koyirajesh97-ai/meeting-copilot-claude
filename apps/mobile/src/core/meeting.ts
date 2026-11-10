// One live meeting on the phone: recorder chunks -> wire frames -> the shared live connection,
// and events -> captions and cards (the same reducers as the desktop overlay).

import {
  EMPTY_CAPTIONS,
  EMPTY_CARDS,
  Emitter,
  LiveConnection,
  OutboundAudio,
  reduceCaptions,
  reduceCards,
  type CaptionState,
  type CardState,
  type LiveState,
  type MeetingEvent,
  type SessionTools,
} from "@meeting-copilot/shared";
import type { Api, StartOptions } from "./api";
import { PhoneFramer } from "./pcm";

/** The phone sends one channel, so the replay buffer holds 60 s of it. */
const PHONE_REPLAY_FRAMES = 60 * 50;

export interface MeetingView {
  recording: boolean;
  live: LiveState;
  captions: CaptionState;
  cards: CardState;
  error: string | null;
}

export const IDLE: MeetingView = {
  recording: false,
  live: { status: "off", meetingId: null },
  captions: EMPTY_CAPTIONS,
  cards: EMPTY_CARDS,
  error: null,
};

/** The recorder, behind an interface so tests can feed audio without a phone. */
export interface Recorder {
  start(onChunk: (data: string | Int16Array | Float32Array) => void): Promise<void>;
  stop(): Promise<void>;
}

export class PhoneMeeting extends Emitter<{ change: [MeetingView] }> {
  private view: MeetingView = IDLE;
  private readonly outbound = new OutboundAudio(PHONE_REPLAY_FRAMES);
  private readonly live: LiveConnection<StartOptions>;
  private framer = new PhoneFramer();
  private tools: SessionTools | undefined;

  constructor(
    api: Api,
    private readonly recorder: Recorder,
    WebSocketImpl?: new (url: string) => WebSocket,
  ) {
    super();
    this.live = new LiveConnection<StartOptions>({ backend: api, outbound: this.outbound, WebSocketImpl });
    this.live.on("state", (live) => {
      this.set({ live });
      // The session's tool switches, again after every reconnect.
      if (live.status === "live" && this.tools) this.live.send({ type: "control", action: "tools", tools: this.tools });
    });
    this.live.on("event", (e) => this.onEvent(e));
  }

  get state(): MeetingView {
    return this.view;
  }

  private set(patch: Partial<MeetingView>): void {
    this.view = { ...this.view, ...patch };
    this.emit("change", this.view);
  }

  private onEvent(e: MeetingEvent): void {
    this.set({ captions: reduceCaptions(this.view.captions, e), cards: reduceCards(this.view.cards, { type: "event", event: e, now: Date.now() }) });
  }

  /** The indicator turns on before the microphone opens and off only after it closed. */
  async start(options: StartOptions): Promise<void> {
    if (this.view.recording) return;
    this.framer = new PhoneFramer();
    this.tools = options.tools;
    this.set({ ...IDLE, recording: true });
    try {
      await this.recorder.start((chunk) => {
        for (const f of this.framer.pushChunk(chunk)) this.outbound.push(f);
      });
    } catch (err) {
      this.set({ recording: false, error: `Couldn't open the microphone: ${(err as Error).message}` });
      return;
    }
    void this.live.start(options);
  }

  async stop(): Promise<string | null> {
    if (!this.view.recording) return null;
    await this.recorder.stop();
    const id = await this.live.stop();
    this.set({ recording: false });
    return id;
  }

  /** Catch me up, Clarify, I'll follow up, card feedback. False when not connected. */
  control(action: "catch_up" | "clarify" | "follow_up", minutes?: number): boolean {
    return this.live.send({ type: "control", action, ...(action === "catch_up" ? { minutes: minutes === 5 ? 5 : 2 } : {}) });
  }

  /** "Ask the copilot": a typed question, answered as a card. False when not connected. */
  ask(question: string): boolean {
    const text = question.trim().slice(0, 500);
    return text.length > 0 && this.live.send({ type: "control", action: "ask", text });
  }

  feedback(cardId: string, useful: boolean): void {
    this.live.send({ type: "control", action: "card_feedback", card_id: cardId, useful });
    this.set({ cards: reduceCards(this.view.cards, { type: "feedback", id: cardId, useful }) });
  }

  dismiss(cardId: string): void {
    this.set({ cards: reduceCards(this.view.cards, { type: "dismiss", id: cardId }) });
  }
}
