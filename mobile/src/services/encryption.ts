/** E2E 加密/解密 — NaCl crypto_box (Curve25519 + XSalsa20-Poly1305) */

import nacl from "tweetnacl";
import { getRandomValues } from "expo-crypto";

// React Native 不保证提供浏览器的 crypto.getRandomValues。
// 显式使用 Expo 原生安全随机源，避免 TweetNaCl 在生成密钥或 nonce 时抛出 no PRNG。
nacl.setPRNG((target, length) => {
  getRandomValues(target.subarray(0, length));
});

// -- 内联编码工具，避免 tweetnacl-util 的类型兼容问题 --

/** Uint8Array → Base64 字符串 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 字符串 → Uint8Array */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** JS 字符串 → UTF-8 Uint8Array */
function toUTF8(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/** UTF-8 Uint8Array → JS 字符串 */
function fromUTF8(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

// -- 公开 API --

/** 生成 Ed25519 密钥对，返回 Base64 编码的公钥和私钥 */
export function generateKeyPair(): { publicKey: string; secretKey: string } {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: toBase64(keyPair.publicKey),
    secretKey: toBase64(keyPair.secretKey),
  };
}

/** 加密消息 → 返回 "base64(nonce).base64(ciphertext)" */
export function encrypt(
  plaintext: string,
  recipientPublicKeyBase64: string,
  senderSecretKeyBase64: string
): string {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    toUTF8(plaintext),
    nonce,
    fromBase64(recipientPublicKeyBase64),
    fromBase64(senderSecretKeyBase64)
  );
  if (!ciphertext) throw new Error("加密失败");
  return toBase64(nonce) + "." + toBase64(ciphertext);
}

/** 解密消息 → 返回明文 */
export function decrypt(
  encryptedPayload: string,
  senderPublicKeyBase64: string,
  recipientSecretKeyBase64: string
): string {
  const parts = encryptedPayload.split(".");
  if (parts.length !== 2) throw new Error("消息格式无效");

  const [nonceBase64, ciphertextBase64] = parts;
  const plaintext = nacl.box.open(
    fromBase64(ciphertextBase64),
    fromBase64(nonceBase64),
    fromBase64(senderPublicKeyBase64),
    fromBase64(recipientSecretKeyBase64)
  );
  if (!plaintext) throw new Error("解密失败 — 密钥不匹配或消息损坏");
  return fromUTF8(plaintext);
}
