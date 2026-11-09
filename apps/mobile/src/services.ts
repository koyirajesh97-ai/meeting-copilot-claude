// App-wide singletons: settings, the API client, sign-in and the meeting.

import { HOSTED_BACKEND_URL, HOSTED_SUPABASE } from "@meeting-copilot/shared/hosted";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Api } from "./core/api";
import { Auth, type KeyStore } from "./core/auth";

export interface MobileSettings {
  backendUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<MobileSettings>;
export const DEFAULT_SETTINGS: MobileSettings = {
  backendUrl: extra.backendUrl || HOSTED_BACKEND_URL || "http://127.0.0.1:8000",
  supabaseUrl: extra.supabaseUrl || HOSTED_SUPABASE.url,
  supabaseAnonKey: extra.supabaseAnonKey || HOSTED_SUPABASE.publishableKey,
};

/** Secrets in the iOS Keychain / Android Keystore. SecureStore keys allow [A-Za-z0-9._-]. */
export const keyStore: KeyStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  delete: (k) => SecureStore.deleteItemAsync(k),
};

let settings: MobileSettings = DEFAULT_SETTINGS;

export async function loadSettings(): Promise<MobileSettings> {
  const raw = await keyStore.get("settings");
  settings = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<MobileSettings>) } : DEFAULT_SETTINGS;
  return settings;
}

export async function saveSettings(patch: Partial<MobileSettings>): Promise<MobileSettings> {
  settings = { ...settings, ...patch };
  await keyStore.set("settings", JSON.stringify(settings));
  return settings;
}

const publicApi = new Api(() => settings.backendUrl, async () => null);
export const auth = new Auth(publicApi, keyStore, () => ({ url: settings.supabaseUrl, anonKey: settings.supabaseAnonKey }));
export const api = new Api(() => settings.backendUrl, () => auth.token());
