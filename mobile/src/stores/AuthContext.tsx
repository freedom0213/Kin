/** 认证状态管理 — Context + useReducer */

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { setToken, getProfile as apiGetProfile } from "../api/client";
import { kinWS } from "../api/ws";
import { messageInbox } from "../services/messageInbox";

interface User {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  status_msg: string | null;
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
  | { type: "LOGOUT" }
  | { type: "LOADING_DONE" };

const AuthContext = createContext<{
  state: AuthState;
  loginAction: (token: string, user: User) => Promise<void>;
  logoutAction: () => Promise<void>;
} | null>(null);

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE_TOKEN":
      return { ...state, token: action.token, user: action.user, isLoggedIn: true, isLoading: false };
    case "LOGIN":
      return { ...state, token: action.token, user: action.user, isLoggedIn: true, isLoading: false };
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
        const savedToken = await SecureStore.getItemAsync("kin_token");
        if (savedToken) {
          setToken(savedToken);
          const profile = await apiGetProfile();
          await messageInbox.start((profile as User).id);
          kinWS.connect(savedToken);
          dispatch({ type: "RESTORE_TOKEN", token: savedToken, user: profile as User });
        } else {
          dispatch({ type: "LOADING_DONE" });
        }
      } catch {
        // 令牌过期或网络错误
        await SecureStore.deleteItemAsync("kin_token");
        setToken(null);
        dispatch({ type: "LOADING_DONE" });
      }
    })();
  }, []);

  const loginAction = async (token: string, user: User) => {
    await SecureStore.setItemAsync("kin_token", token);
    setToken(token);
    await messageInbox.start(user.id);
    kinWS.connect(token);
    dispatch({ type: "LOGIN", token, user });
  };

  const logoutAction = async () => {
    await SecureStore.deleteItemAsync("kin_token");
    setToken(null);
    kinWS.disconnect();
    messageInbox.stop();
    dispatch({ type: "LOGOUT" });
  };

  return (
    <AuthContext.Provider value={{ state, loginAction, logoutAction }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
