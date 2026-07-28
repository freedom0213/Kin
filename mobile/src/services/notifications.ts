/** 系统通知权限、Expo Push Token 与通知点击事件。 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registerPushDevice, unregisterPushDevice } from "../api/client";

const PUSH_TOKEN_STORAGE_KEY = "kin_expo_push_token";
const MESSAGE_CHANNEL_ID = "kin-messages";
const CALL_CHANNEL_ID = "kin-calls";

export type PushNotificationStatus =
  | "enabled"
  | "not_requested"
  | "denied"
  | "simulator"
  | "unconfigured"
  | "unsupported"
  | "error";

export interface KinNotificationResponse {
  data: Record<string, any>;
  receivedAt: number;
}

interface StoredPushRegistration {
  token: string;
  unregisterSecret: string;
  pendingUnregister: boolean;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? null;
}

async function configureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Promise.all([
    Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
      name: "聊天消息",
      description: "好友发来的文字和语音消息",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
      vibrationPattern: [0, 120],
    }),
    Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
      name: "语音来电",
      description: "Kin 好友发起的语音通话",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 300, 180, 300],
    }),
  ]);
}

async function persistAndRegister(token: string): Promise<void> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  const registered = await registerPushDevice(token, Platform.OS);
  await SecureStore.setItemAsync(PUSH_TOKEN_STORAGE_KEY, JSON.stringify({
    token,
    unregisterSecret: registered.unregister_secret,
    pendingUnregister: false,
  } satisfies StoredPushRegistration));
}

async function getStoredRegistration(): Promise<StoredPushRegistration | null> {
  const stored = await SecureStore.getItemAsync(PUSH_TOKEN_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredPushRegistration>;
    if (typeof parsed.token !== "string" || typeof parsed.unregisterSecret !== "string") return null;
    return {
      token: parsed.token,
      unregisterSecret: parsed.unregisterSecret,
      pendingUnregister: parsed.pendingUnregister === true,
    };
  } catch {
    return null;
  }
}

export async function getPushNotificationStatus(): Promise<PushNotificationStatus> {
  if (Platform.OS === "web") return "unsupported";
  if (!Device.isDevice) return "simulator";
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === Notifications.PermissionStatus.DENIED) return "denied";
    if (permission.status !== Notifications.PermissionStatus.GRANTED) return "not_requested";
    if (!getProjectId()) return "unconfigured";
    const storedRegistration = await getStoredRegistration();
    return storedRegistration ? "enabled" : "error";
  } catch {
    return "error";
  }
}

export async function enablePushNotifications(): Promise<PushNotificationStatus> {
  if (Platform.OS === "web") return "unsupported";
  if (!Device.isDevice) return "simulator";
  try {
    await configureAndroidChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== Notifications.PermissionStatus.GRANTED) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== Notifications.PermissionStatus.GRANTED) return "denied";
    const projectId = getProjectId();
    if (!projectId) return "unconfigured";
    const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await persistAndRegister(expoToken);
    return "enabled";
  } catch {
    return "error";
  }
}

/** 登录恢复时只同步已经授权的设备，不主动弹出权限请求。 */
export async function syncExistingPushRegistration(): Promise<PushNotificationStatus> {
  if (Platform.OS === "web" || !Device.isDevice) return getPushNotificationStatus();
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== Notifications.PermissionStatus.GRANTED) {
      return permission.status === Notifications.PermissionStatus.DENIED ? "denied" : "not_requested";
    }
    await configureAndroidChannels();
    const projectId = getProjectId();
    if (!projectId) return "unconfigured";
    const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await persistAndRegister(expoToken);
    return "enabled";
  } catch {
    return "error";
  }
}

export function subscribePushTokenRefresh(): () => void {
  if (Platform.OS === "web") return () => {};
  const subscription = Notifications.addPushTokenListener(() => {
    const projectId = getProjectId();
    if (!projectId) return;
    void Notifications.getExpoPushTokenAsync({ projectId })
      .then((token) => persistAndRegister(token.data))
      .catch(() => {});
  });
  return () => subscription.remove();
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  if (Platform.OS === "web") return;
  const registration = await getStoredRegistration();
  if (!registration) return;
  await SecureStore.setItemAsync(PUSH_TOKEN_STORAGE_KEY, JSON.stringify({
    ...registration,
    pendingUnregister: true,
  } satisfies StoredPushRegistration));
  await unregisterPushDevice(registration.token, registration.unregisterSecret);
  await SecureStore.deleteItemAsync(PUSH_TOKEN_STORAGE_KEY);
}

/** 上次退出时网络不可用，启动后无需登录即可再次尝试注销旧设备。 */
export async function retryPendingPushUnregistration(): Promise<void> {
  try {
    const registration = await getStoredRegistration();
    if (registration?.pendingUnregister) await unregisterCurrentPushDevice();
  } catch {
    // 保留注销密钥，等待下次启动或退出时再次尝试。
  }
}

function normalizeResponse(response: Notifications.NotificationResponse): KinNotificationResponse {
  return {
    data: response.notification.request.content.data as Record<string, any>,
    receivedAt: response.notification.date,
  };
}

export function subscribeNotificationResponses(
  listener: (response: KinNotificationResponse) => void
): () => void {
  if (Platform.OS === "web") return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    listener(normalizeResponse(response));
  });
  return () => subscription.remove();
}

export async function getInitialNotificationResponse(): Promise<KinNotificationResponse | null> {
  if (Platform.OS === "web") return null;
  const response = await Notifications.getLastNotificationResponseAsync();
  return response ? normalizeResponse(response) : null;
}

export async function clearInitialNotificationResponse(): Promise<void> {
  if (Platform.OS !== "web") await Notifications.clearLastNotificationResponseAsync();
}
