import { safeStorage } from "electron";
import Store from "electron-store";
import { SECRET_NAMES, type SecretName, type Settings } from "../shared/ipc";
import { applySettingsPatch, loadSettings } from "./settingsSanitize";

const settingsStore = new Store<{ settings: Settings }>({ name: "settings" });
// Secrets are encrypted with the OS keychain (safeStorage) before they touch disk.
const secretStore = new Store<Record<string, string>>({ name: "secrets" });

export function getSettings(): Settings {
  return loadSettings(settingsStore.get("settings"));
}

export function updateSettings(patch: unknown): Settings {
  const next = applySettingsPatch(getSettings(), patch);
  settingsStore.set("settings", next);
  return next;
}

function assertSecretName(name: unknown): asserts name is SecretName {
  if (!SECRET_NAMES.includes(name as SecretName)) throw new Error(`Unknown secret: ${String(name)}`);
}

function assertEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption is not available, so secrets can't be stored safely.");
  }
  // On Linux without a keyring Electron falls back to a hard-coded key; treat that as unavailable.
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    throw new Error("No OS keyring found (install gnome-keyring or kwallet) to store secrets.");
  }
}

export function setSecret(name: unknown, value: unknown): void {
  assertSecretName(name);
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
    throw new Error("Secret value must be a non-empty string under 16 KB.");
  }
  assertEncryption();
  secretStore.set(name, safeStorage.encryptString(value).toString("base64"));
}

/** For the main process only (e.g. the backend token). Never exposed to renderers. */
export function getSecret(name: SecretName): string | null {
  const stored = secretStore.get(name);
  if (!stored) return null;
  return safeStorage.decryptString(Buffer.from(stored, "base64"));
}

export function hasSecret(name: unknown): boolean {
  assertSecretName(name);
  return secretStore.has(name);
}

export function deleteSecret(name: unknown): void {
  assertSecretName(name);
  secretStore.delete(name);
}
