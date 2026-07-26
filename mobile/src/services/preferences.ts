/** 设备级偏好设置：小体积、无需数据库迁移，并在页面间实时同步。 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface KinPreferences {
  messageSound: boolean;
  friendOnlineSound: boolean;
  hapticFeedback: boolean;
}

export const DEFAULT_PREFERENCES: KinPreferences = {
  messageSound: true,
  friendOnlineSound: true,
  hapticFeedback: true,
};

type PreferenceListener = (preferences: KinPreferences) => void;

const STORAGE_KEY = "kin_preferences_v1";
const listeners = new Set<PreferenceListener>();
let cachedPreferences: KinPreferences | null = null;
let readPromise: Promise<KinPreferences> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function normalizePreferences(value: unknown): KinPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const candidate = value as Partial<KinPreferences>;
  return {
    messageSound: typeof candidate.messageSound === "boolean"
      ? candidate.messageSound
      : DEFAULT_PREFERENCES.messageSound,
    friendOnlineSound: typeof candidate.friendOnlineSound === "boolean"
      ? candidate.friendOnlineSound
      : DEFAULT_PREFERENCES.friendOnlineSound,
    hapticFeedback: typeof candidate.hapticFeedback === "boolean"
      ? candidate.hapticFeedback
      : DEFAULT_PREFERENCES.hapticFeedback,
  };
}

async function readStoredValue(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeStoredValue(value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (!globalThis.localStorage) throw new Error("浏览器不支持本地设置存储");
    globalThis.localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

function emit(preferences: KinPreferences): void {
  listeners.forEach((listener) => listener({ ...preferences }));
}

export async function getPreferences(): Promise<KinPreferences> {
  if (cachedPreferences) return { ...cachedPreferences };
  if (!readPromise) {
    readPromise = readStoredValue()
      .then((stored) => {
        if (!stored) return { ...DEFAULT_PREFERENCES };
        try {
          return normalizePreferences(JSON.parse(stored));
        } catch {
          return { ...DEFAULT_PREFERENCES };
        }
      })
      .catch(() => ({ ...DEFAULT_PREFERENCES }))
      .then((preferences) => {
        cachedPreferences = preferences;
        return preferences;
      })
      .finally(() => { readPromise = null; });
  }
  return { ...(await readPromise) };
}

export function updatePreference<K extends keyof KinPreferences>(
  key: K,
  value: KinPreferences[K]
): Promise<KinPreferences> {
  const operation = mutationQueue.then(async () => {
    const current = await getPreferences();
    const next = { ...current, [key]: value };
    await writeStoredValue(JSON.stringify(next));
    cachedPreferences = next;
    emit(next);
    return { ...next };
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function subscribePreferences(listener: PreferenceListener): () => void {
  listeners.add(listener);
  if (cachedPreferences) listener({ ...cachedPreferences });
  return () => listeners.delete(listener);
}
