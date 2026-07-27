/** 认证状态管理 — Context + useReducer */

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { setToken, getProfile as apiGetProfile, type UserProfile } from "../api/client";
import { kinWS } from "../api/ws";
import { messageInbox } from "../services/messageInbox";
import { kinFeedback } from "../services/feedback";

type User = UserProfile;

const PROFILE_STORAGE_KEY = "kin_profile";

function parseCachedUser(value: string | null): User | null {
  if (!value) return null;
  try {
    const user = JSON.parse(value) as Partial<User>;
    if (typeof user.id !== "string" || typeof user.username !== "string") return null;
    return {
      id: user.id,
      username: user.username,
      nickname: typeof user.nickname === "string" ? user.nickname : null,
      avatar: typeof user.avatar === "string" ? user.avatar : null,
      status_msg: typeof user.status_msg === "string" ? user.status_msg : null,
    };
  } catch {
    return null;
  }
}

interface AuthState {
  isLoading: boolean;
  isLoggedIn: boolean;
  user: User | null;
  token: string | null;
}

type AuthAction =
  | { type: "RESTORE_TOKEN"; token: string; user: User }
  | { type: "LOGIN"; token: string; user: User }
  | { type: "UPDATE_PROFILE"; user: User }
  | { type: "LOGOUT" }
  | { type: "LOADING_DONE" };

const AuthContext = createContext<{
  state: AuthState;
  loginAction: (token: string, user: User) => Promise<void>;
  updateProfileAction: (user: User) => Promise<void>;
  logoutAction: () => Promise<void>;
} | null>(null);

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE_TOKEN":
      return { ...state, token: action.token, user: action.user, isLoggedIn: true, isLoading: false };
    case "LOGIN":
      return { ...state, token: action.token, user: action.user, isLoggedIn: true, isLoading: false };
    case "UPDATE_PROFILE":
      return { ...state, user: action.user };
    case "LOGOUT":
      return { ...state, token: null, user: null, isLoggedIn: false, isLoading: false };
    case "LOADING_DONE":
      return { ...state, isLoading: false };
    default:
      return state;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    isLoading: true,
    isLoggedIn: false,
    user: null,
    token: null,
  });

  // 启动时从安全存储恢复令牌
  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedProfile] = await Promise.all([
          SecureStore.getItemAsync("kin_token"),
          SecureStore.getItemAsync(PROFILE_STORAGE_KEY),
        ]);
        if (savedToken) {
          setToken(savedToken);
          try {
            const profile = await apiGetProfile() as User;
            await SecureStore.setItemAsync(PROFILE_STORAGE_KEY, JSON.stringify(profile));
            await messageInbox.start(profile.id);
            kinWS.connect(savedToken);
            dispatch({ type: "RESTORE_TOKEN", token: savedToken, user: profile });
          } catch (error: any) {
            if ([401, 403, 404].includes(error?.status)) {
              await Promise.all([
                SecureStore.deleteItemAsync("kin_token"),
                SecureStore.deleteItemAsync(PROFILE_STORAGE_KEY),
              ]);
              setToken(null);
              dispatch({ type: "LOADING_DONE" });
              return;
            }

            const cachedUser = parseCachedUser(savedProfile);
            if (cachedUser) {
              await messageInbox.start(cachedUser.id);
              kinWS.connect(savedToken);
              dispatch({ type: "RESTORE_TOKEN", token: savedToken, user: cachedUser });
            } else {
              setToken(null);
              dispatch({ type: "LOADING_DONE" });
            }
          }
        } else {
          dispatch({ type: "LOADING_DONE" });
        }
      } catch {
        setToken(null);
        dispatch({ type: "LOADING_DONE" });
      }
    })();
  }, []);

  useEffect(() => {
    const onInboxMessage = () => { void kinFeedback.notifyIncomingMessage(); };
    kinWS.on("inbox_message", onInboxMessage);
    return () => kinWS.off("inbox_message", onInboxMessage);
  }, []);

  const loginAction = async (token: string, user: User) => {
    await Promise.all([
      SecureStore.setItemAsync("kin_token", token),
      SecureStore.setItemAsync(PROFILE_STORAGE_KEY, JSON.stringify(user)),
    ]);
    setToken(token);
    await messageInbox.start(user.id);
    kinWS.connect(token);
    dispatch({ type: "LOGIN", token, user });
  };

  const logoutAction = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync("kin_token"),
      SecureStore.deleteItemAsync(PROFILE_STORAGE_KEY),
    ]);
    setToken(null);
    kinWS.disconnect();
    messageInbox.stop();
    kinFeedback.reset();
    dispatch({ type: "LOGOUT" });
  };

  const updateProfileAction = async (user: User) => {
    await SecureStore.setItemAsync(PROFILE_STORAGE_KEY, JSON.stringify(user));
    dispatch({ type: "UPDATE_PROFILE", user });
  };

  return (
    <AuthContext.Provider value={{ state, loginAction, updateProfileAction, logoutAction }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
