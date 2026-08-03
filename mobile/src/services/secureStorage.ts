/** 跨平台敏感数据存储：原生使用 SecureStore，Web 预览使用 localStorage 降级。 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

function webStorage(): Storage {
  const storage = globalThis.localStorage;
  if (!storage) throw new Error("浏览器不支持本地存储");
  return storage;
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return webStorage().getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
