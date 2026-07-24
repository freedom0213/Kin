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
    throw new Error(data.detail || "请求失败");
  }

  return data;
}

// -- 认证 --

export interface AuthResult {
  success: boolean;
  message: string;
  user: { id: string; username: string };
  token: string;
}

export function register(username: string, password: string, publicKey?: string) {
  return request<AuthResult>("POST", "/api/auth/register", { username, password, public_key: publicKey });
}

export function login(username: string, password: string) {
  return request<AuthResult>("POST", "/api/auth/login", { username, password });
}

export function getProfile() {
  return request("GET", "/api/auth/me");
}

// -- 好友 --

export interface Friend {
  user_id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
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

export function getFriendList() {
  return request<{ friends: Friend[]; total: number }>("GET", "/api/friends/list");
}

export function deleteFriend(friendId: string) {
  return request("DELETE", `/api/friends/${friendId}`);
}
