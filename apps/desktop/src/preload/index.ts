// The only bridge between renderers and the main process. Exposes a small typed API;
// renderers get no Node, no ipcRenderer and no secret values.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { IPC, type AppState, type AudioLevels, type CaptureCommand, type CopilotApi } from "../shared/ipc";

const api: CopilotApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (listener) => {
    const wrapped = (_e: IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on(IPC.state, wrapped);
    return () => ipcRenderer.removeListener(IPC.state, wrapped);
  },
  toggleCapture: () => ipcRenderer.invoke(IPC.toggleCapture),
  startMeeting: (opts) => ipcRenderer.invoke(IPC.startMeeting, opts),
  onLive: (listener) => {
    const wrapped = (_e: IpcRendererEvent, event: MeetingEvent) => listener(event);
    ipcRenderer.on(IPC.liveEvent, wrapped);
    return () => ipcRenderer.removeListener(IPC.liveEvent, wrapped);
  },
  auth: {
    sendCode: (email) => ipcRenderer.invoke(IPC.authSendCode, email),
    verifyCode: (email, code) => ipcRenderer.invoke(IPC.authVerifyCode, email, code),
    devAvailable: () => ipcRenderer.invoke(IPC.authDevAvailable),
    devSignIn: () => ipcRenderer.invoke(IPC.authDevSignIn),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut),
  },
  voice: {
    enroll: (name, consent) => ipcRenderer.invoke(IPC.voiceEnroll, name, consent),
    list: () => ipcRenderer.invoke(IPC.voiceList),
    delete: (id) => ipcRenderer.invoke(IPC.voiceDelete, id),
    onProgress: (listener) => {
      const wrapped = (_e: IpcRendererEvent, p: { elapsed: number; level: number; total: number }) => listener(p);
      ipcRenderer.on(IPC.voiceProgress, wrapped);
      return () => ipcRenderer.removeListener(IPC.voiceProgress, wrapped);
    },
  },
  profile: {
    get: () => ipcRenderer.invoke(IPC.profileGet),
    put: (p) => ipcRenderer.invoke(IPC.profilePut, p),
    presets: () => ipcRenderer.invoke(IPC.profilePresets),
  },
  cardFeedback: (cardId, useful) => ipcRenderer.invoke(IPC.cardFeedback, cardId, useful),
  standup: {
    generate: (notes) => ipcRenderer.invoke(IPC.standupGenerate, notes),
    today: () => ipcRenderer.invoke(IPC.standupToday),
    save: (edit) => ipcRenderer.invoke(IPC.standupSave, edit),
  },
  brief: (title, type, agenda) => ipcRenderer.invoke(IPC.brief, title, type, agenda),
  integrations: (call) => ipcRenderer.invoke(IPC.integrations, call),
  privacy: {
    get: () => ipcRenderer.invoke(IPC.privacyGet),
    save: (settings) => ipcRenderer.invoke(IPC.privacySave, settings),
    announce: (message) => ipcRenderer.invoke(IPC.announce, message),
    pause: () => ipcRenderer.invoke(IPC.pause),
    resume: () => ipcRenderer.invoke(IPC.resume),
    deleteMeeting: (id) => ipcRenderer.invoke(IPC.meetingDelete, id),
    exportAccount: () => ipcRenderer.invoke(IPC.accountExport),
    deleteAccount: (phrase) => ipcRenderer.invoke(IPC.accountDelete, phrase),
  },
  projects: (call) => ipcRenderer.invoke(IPC.projects, call),
  editMeeting: (id, patch) => ipcRenderer.invoke(IPC.meetingEdit, id, patch),
  watch: {
    start: (meetingId) => ipcRenderer.invoke(IPC.watchStart, meetingId),
    stop: () => ipcRenderer.invoke(IPC.watchStop),
    onEvent: (listener) => {
      const wrapped = (_e: IpcRendererEvent, event: MeetingEvent) => listener(event);
      ipcRenderer.on(IPC.watchEvent, wrapped);
      return () => ipcRenderer.removeListener(IPC.watchEvent, wrapped);
    },
  },
  search: (query) => ipcRenderer.invoke(IPC.search, query),
  ask: (question) => ipcRenderer.invoke(IPC.ask, question),
  meetings: {
    list: () => ipcRenderer.invoke(IPC.meetingsList),
    get: (id) => ipcRenderer.invoke(IPC.meetingsGet, id),
    sync: () => ipcRenderer.invoke(IPC.meetingsSync),
    regenerate: (id, template) => ipcRenderer.invoke(IPC.meetingsRegenerate, id, template),
    saveSummary: (id, data) => ipcRenderer.invoke(IPC.meetingsSaveSummary, id, data),
    renameSpeaker: (id, label, name) => ipcRenderer.invoke(IPC.meetingsRenameSpeaker, id, label, name),
    markdown: (id, withTranscript) => ipcRenderer.invoke(IPC.meetingsMarkdown, id, withTranscript),
    exportMarkdown: (id) => ipcRenderer.invoke(IPC.meetingsExport, id),
  },
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  overlay: {
    setExpanded: (expanded) => ipcRenderer.invoke(IPC.overlaySetExpanded, expanded),
    action: (action, minutes) => ipcRenderer.invoke(IPC.overlayAction, action, minutes),
  },
  onLevels: (listener) => {
    const wrapped = (_e: IpcRendererEvent, levels: AudioLevels) => listener(levels);
    ipcRenderer.on(IPC.levels, wrapped);
    return () => ipcRenderer.removeListener(IPC.levels, wrapped);
  },
  openMain: (route) => ipcRenderer.invoke(IPC.openMain, route),
  secrets: {
    set: (name, value) => ipcRenderer.invoke(IPC.secretSet, name, value),
    has: (name) => ipcRenderer.invoke(IPC.secretHas, name),
    delete: (name) => ipcRenderer.invoke(IPC.secretDelete, name),
  },
  capture: {
    onCommand: (listener) => {
      const wrapped = (_e: IpcRendererEvent, cmd: CaptureCommand) => listener(cmd);
      ipcRenderer.on(IPC.captureCommand, wrapped);
      return () => ipcRenderer.removeListener(IPC.captureCommand, wrapped);
    },
    chunk: (channel, samples, sampleRate) => ipcRenderer.send(IPC.captureChunk, channel, samples, sampleRate),
    report: (report) => ipcRenderer.send(IPC.captureStatus, report),
  },
};

contextBridge.exposeInMainWorld("copilot", api);
