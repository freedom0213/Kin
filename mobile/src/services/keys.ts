/** 按账号隔离的密钥持久化。 */

import { generateKeyPair } from "./encryption";
import { getSecureItem, setSecureItem } from "./secureStorage";

export interface AccountKeyPair {
  publicKey: string;
  secretKey: string;
}

function accountKey(ownerId: string, kind: "secret" | "public"): string {
  const safeOwnerId = ownerId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `kin_${kind}_key_${safeOwnerId}`;
}

/** 生成尚未绑定账号的密钥材料。注册成功后再按返回的账号 ID 保存。 */
export function createAccountKeyPair(): AccountKeyPair {
  return generateKeyPair();
}

/** 将密钥对保存到指定账号自己的 SecureStore 命名空间。 */
export async function storeAccountKeyPair(
  ownerId: string,
  keyPair: AccountKeyPair
): Promise<void> {
  await Promise.all([
    setSecureItem(accountKey(ownerId, "secret"), keyPair.secretKey),
    setSecureItem(accountKey(ownerId, "public"), keyPair.publicKey),
  ]);
}

/** 读取指定账号已有的密钥对。 */
export async function getStoredKeyPair(ownerId: string): Promise<AccountKeyPair | null> {
  const [secretKey, publicKey] = await Promise.all([
    getSecureItem(accountKey(ownerId, "secret")),
    getSecureItem(accountKey(ownerId, "public")),
  ]);
  if (secretKey && publicKey) return { publicKey, secretKey };
  return null;
}

/** 确保指定账号在当前设备拥有独立密钥。 */
export async function ensureAccountKeyPair(ownerId: string): Promise<AccountKeyPair> {
  const existing = await getStoredKeyPair(ownerId);
  if (existing) return existing;
  const keyPair = createAccountKeyPair();
  await storeAccountKeyPair(ownerId, keyPair);
  return keyPair;
}

/** 读取指定账号的私钥。 */
export function getSecretKey(ownerId: string): Promise<string | null> {
  return getSecureItem(accountKey(ownerId, "secret"));
}

/** 读取指定账号的公钥。 */
export function getPublicKey(ownerId: string): Promise<string | null> {
  return getSecureItem(accountKey(ownerId, "public"));
}
