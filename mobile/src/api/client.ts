/** HTTP API 请求封装 */

import { API_BASE } from "../config";

let _token: string | null = null;

export function setToken(token: string | null) {
  _token = token;
}

export function getToken(): string | null {
  return _token;
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : detail?.message;
    const error = new Error(message || "请求失败");
    (error as any).code = typeof detail === "object" ? detail?.code : undefined;
    (error as any).status = res.status;
    throw error;
  }

  return data;
}

// -- 认证 --

export interface AuthResult {
  success: boolean;
  message: string;
  user: {
    id: string;
    username: string;
    nickname?: string | null;
    avatar?: string | null;
    profile_banner?: string | null;
    status_msg?: string | null;
    public_key?: string | null;
  };
  token: string;
}

export interface UserProfile {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  profile_banner: string | null;
  status_msg: string | null;
  public_key: string | null;
}

export function resolveMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("file:") || value.startsWith("data:")) {
    return value;
  }
  return `${API_BASE}${value.startsWith("/") ? value : `/${value}`}`;
}

export function register(username: string, password: string, publicKey?: string) {
  return request<AuthResult>("POST", "/api/auth/register", { username, password, public_key: publicKey });
}

export function login(username: string, password: string) {
  return request<AuthResult>("POST", "/api/auth/login", { username, password });
}

export function getProfile() {
  return request<UserProfile>("GET", "/api/auth/me");
}

export function updateProfile(nickname: string | null, statusMsg: string | null) {
  return request<UserProfile>("PUT", "/api/auth/me", {
    nickname,
    status_msg: statusMsg,
  });
}

export function updatePublicKey(publicKey: string) {
  return request<UserProfile>("PUT", "/api/auth/me/public-key", {
    public_key: publicKey,
  });
}

async function parseProfileResponse(res: Response): Promise<UserProfile> {
  const data = await res.json();
  if (!res.ok) {
    const detail = data.detail;
    const error = new Error(typeof detail === "string" ? detail : "请求失败");
    (error as any).status = res.status;
    throw error;
  }
  return data as UserProfile;
}

export async function uploadProfileBanner(uri: string, mimeType: string): Promise<UserProfile> {
  if (!_token) throw new Error("登录状态已失效，请重新登录");
  const fileResponse = await fetch(uri);
  const blob = await fileResponse.blob();
  const res = await fetch(`${API_BASE}/api/auth/me/profile-banner`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${_token}`,
      "Content-Type": mimeType,
    },
    body: blob as any,
  });
  return parseProfileResponse(res);
}

export async function removeProfileBanner(): Promise<UserProfile> {
  if (!_token) throw new Error("登录状态已失效，请重新登录");
  const res = await fetch(`${API_BASE}/api/auth/me/profile-banner`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${_token}` },
  });
  return parseProfileResponse(res);
}

// -- 系统推送 --

export function registerPushDevice(token: string, platform: "android" | "ios") {
  return request<{ registered: boolean; token: string; platform: string; unregister_secret: string }>(
    "POST", "/api/push/devices", { token, platform }
  );
}

export function unregisterPushDevice(token: string, unregisterSecret: string) {
  return request<{ registered: boolean; removed: boolean }>(
    "DELETE", "/api/push/devices", { token, unregister_secret: unregisterSecret }
  );
}

export function getPushDeviceStatus() {
  return request<{ registered_devices: number }>("GET", "/api/push/status");
}

// -- 好友 --

export interface Friend {
  user_id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  profile_banner: string | null;
  status_msg: string | null;
  meet_at: string;
  is_online: boolean;
  last_seen: number | null;
  public_key: string | null;  // E2E 加密公钥
}

export function generateNfcToken() {
  return request<{ token: string; expires_at: number; ttl: number }>("POST", "/api/friends/nfc-token");
}

export function addFriendByToken(token: string) {
  return request<{ success: boolean; message: string; meet_at: string }>("POST", "/api/friends/request", { token });
}

export type PairingStatus =
  | "awaiting_peer"
  | "awaiting_confirmation"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export interface PairingPeer {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  profile_banner: string | null;
}

export interface PairingSession {
  id: string;
  token: string | null;
  role: "initiator" | "receiver";
  status: PairingStatus;
  initiator_id: string;
  receiver_id: string | null;
  initiator_confirmed: boolean;
  receiver_confirmed: boolean;
  viewer_confirmed: boolean;
  peer_confirmed: boolean;
  peer: PairingPeer | null;
  failure_reason: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export function createPairing() {
  return request<PairingSession>("POST", "/api/friends/pairings");
}

export function joinPairing(token: string) {
  return request<PairingSession>("POST", "/api/friends/pairings/join", { token });
}

export function getPairing(sessionId: string) {
  return request<PairingSession>("GET", `/api/friends/pairings/${sessionId}`);
}

export function confirmPairing(sessionId: string) {
  return request<PairingSession>("POST", `/api/friends/pairings/${sessionId}/confirm`);
}

export function cancelPairing(sessionId: string) {
  return request<PairingSession>("POST", `/api/friends/pairings/${sessionId}/cancel`);
}

export function getFriendList() {
  return request<{ friends: Friend[]; total: number }>("GET", "/api/friends/list");
}

export function deleteFriend(friendId: string) {
  return request("DELETE", `/api/friends/${friendId}`);
}
