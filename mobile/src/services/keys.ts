/** 密钥持久化 — expo-secure-store */

import * as SecureStore from "expo-secure-store";
import { generateKeyPair } from "./encryption";

const SECRET_KEY_KEY = "kin_secret_key";
const PUBLIC_KEY_KEY = "kin_public_key";

/** 生成新密钥对并存到安全存储，返回公钥（用于上传服务器） */
export async function generateAndStoreKeyPair(): Promise<{ publicKey: string; secretKey: string }> {
  const { publicKey, secretKey } = generateKeyPair();
  await SecureStore.setItemAsync(SECRET_KEY_KEY, secretKey);
  await SecureStore.setItemAsync(PUBLIC_KEY_KEY, publicKey);
  return { publicKey, secretKey };
}

/** 读取已有的密钥对 */
export async function getStoredKeyPair(): Promise<{ publicKey: string; secretKey: string } | null> {
  const [secretKey, publicKey] = await Promise.all([
    SecureStore.getItemAsync(SECRET_KEY_KEY),
    SecureStore.getItemAsync(PUBLIC_KEY_KEY),
  ]);
  if (secretKey && publicKey) return { publicKey, secretKey };
  return null;
}

/** 读取私钥 */
export function getSecretKey(): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEY_KEY);
}

/** 读取公钥 */
export function getPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PUBLIC_KEY_KEY);
}
