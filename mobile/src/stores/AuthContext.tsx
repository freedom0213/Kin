/** 认证状态管理 — Context + useReducer */

import React, { createContext, useContext, useReducer, useEffect, useRef, ReactNode } from "react";
import { AppState } from "react-native";
import {
  setToken,
  getProfile as apiGetProfile,
  updatePublicKey,
  type UserProfile,
} from "../api/client";
import { kinWS } from "../api/ws";
import { messageInbox } from "../services/messageInbox";
import { kinFeedback } from "../services/feedback";
import { updateCachedFriendProfile } from "../services/db";
import { parseFriendProfileEvent } from "../services/friendProfile";
import { ensureAccountKeyPair, type AccountKeyPair } from "../services/keys";
import { deleteSecureItem, getSecureItem, setSecureItem } from "../services/secureStorage";
import {
  syncExistingPushRegistration,
  retryPendingPushUnregistration,
  subscribePushTokenRefresh,
  unregisterCurrentPushDevice,
} from "../services/notifications";

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
      profile_banner: typeof user.profile_banner === "string" ? user.profile_banner : null,
      status_msg: typeof user.status_msg === "string" ? user.status_msg : null,
      public_key: typeof user.public_key === "string" ? user.public_key : null,
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

async function activateAccountEncryption(userId: string): Promise<AccountKeyPair> {
  const keyPair = await ensureAccountKeyPair(userId);
  await updatePublicKey(keyPair.publicKey);
  return keyPair;
}

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
  const backgroundedAtRef = useRef<number | null>(null);

  // 启动时从安全存储恢复令牌
  useEffect(() => {
    (async () => {
      await retryPendingPushUnregistration();
      try {
        const [savedToken, savedProfile] = await Promise.all([
          getSecureItem("kin_token"),
          getSecureItem(PROFILE_STORAGE_KEY),
        ]);
        if (savedToken) {
          setToken(savedToken);
          try {
            const profile = await apiGetProfile() as User;
            let restoredProfile = profile;
            try {
              const keyPair = await activateAccountEncryption(profile.id);
              restoredProfile = { ...profile, public_key: keyPair.publicKey };
            } catch {
              // 已有登录恢复不应因短暂网络问题被强制退出；下次显式登录会再次上传。
            }
            await setSecureItem(PROFILE_STORAGE_KEY, JSON.stringify(restoredProfile));
            await messageInbox.start(restoredProfile.id);
            kinWS.connect(savedToken);
            dispatch({ type: "RESTORE_TOKEN", token: savedToken, user: restoredProfile });
          } catch (error: any) {
            if ([401, 403, 404].includes(error?.status)) {
              await Promise.all([
                deleteSecureItem("kin_token"),
                deleteSecureItem(PROFILE_STORAGE_KEY),
              ]);
              setToken(null);
              dispatch({ type: "LOADING_DONE" });
              return;
            }

            const cachedUser = parseCachedUser(savedProfile);
            if (cachedUser) {
              await ensureAccountKeyPair(cachedUser.id);
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

  useEffect(() => {
    if (!state.isLoggedIn) return;
    void syncExistingPushRegistration();
    return subscribePushTokenRefresh();
  }, [state.isLoggedIn]);

  useEffect(() => {
    const onFriendProfile = (data: any) => {
      const update = parseFriendProfileEvent(data);
      const ownerId = state.user?.id;
      if (!update || !ownerId) return;
      void updateCachedFriendProfile(ownerId, update.user_id, update).catch(() => {});
    };
    kinWS.on("friend_profile", onFriendProfile);
    return () => kinWS.off("friend_profile", onFriendProfile);
  }, [state.user?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        backgroundedAtRef.current = Date.now();
        if (state.isLoggedIn) kinWS.sendAppState("background");
        return;
      }

      const wasBackgrounded = backgroundedAtRef.current !== null;
      backgroundedAtRef.current = null;
      if (state.isLoggedIn) kinWS.sendAppState("foreground");
      if (wasBackgrounded && state.isLoggedIn && state.token) {
        kinWS.resume(state.token);
      }
    });
    return () => subscription.remove();
  }, [state.isLoggedIn, state.token]);

  const loginAction = async (token: string, user: User) => {
    setToken(token);
    try {
      const keyPair = await activateAccountEncryption(user.id);
      const activatedUser = { ...user, public_key: keyPair.publicKey };
      await Promise.all([
        setSecureItem("kin_token", token),
        setSecureItem(PROFILE_STORAGE_KEY, JSON.stringify(activatedUser)),
      ]);
      await messageInbox.start(user.id);
      kinWS.connect(token);
      dispatch({ type: "LOGIN", token, user: activatedUser });
    } catch (error) {
      setToken(null);
      throw error;
    }
  };

  const logoutAction = async () => {
    try {
      await unregisterCurrentPushDevice();
    } catch {
      // 注销设备通知失败不应阻止退出账号。
    }
    await Promise.all([
      deleteSecureItem("kin_token"),
      deleteSecureItem(PROFILE_STORAGE_KEY),
    ]);
    setToken(null);
    kinWS.disconnect();
    messageInbox.stop();
    kinFeedback.reset();
    dispatch({ type: "LOGOUT" });
  };

  const updateProfileAction = async (user: User) => {
    await setSecureItem(PROFILE_STORAGE_KEY, JSON.stringify(user));
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
