/** Kin — 只和见过的人聊天 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, AppState, Easing, Platform,
  Image, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { BlurView } from "expo-blur";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import {
  createNavigationContainerRef, NavigationContainer,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { resolveMediaUrl, type Friend } from "./src/api/client";
import { kinWS } from "./src/api/ws";
import { kinFeedback } from "./src/services/feedback";
import { webrtcService } from "./src/services/webrtc";
import { getCachedFriends } from "./src/services/db";
import {
  clearInitialNotificationResponse,
  getInitialNotificationResponse,
  subscribeNotificationResponses,
  type KinNotificationResponse,
} from "./src/services/notifications";
import { AuthProvider, useAuth } from "./src/stores/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import RegisterScreen from "./src/screens/RegisterScreen";
import MainShellScreen, { type MainTab } from "./src/screens/MainShellScreen";
import ChatScreen from "./src/screens/ChatScreen";
import AddFriendScreen from "./src/screens/AddFriendScreen";
import VoiceCallScreen from "./src/screens/VoiceCallScreen";
import ConversationDetailsScreen from "./src/screens/ConversationDetailsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ProfileEditScreen from "./src/screens/ProfileEditScreen";
import MyProfileCardScreen from "./src/screens/MyProfileCardScreen";
import { GRAPHITE_COLORS, GRAPHITE_NAVIGATION_THEME } from "./src/theme/graphite";

type RootStackParamList = {
  FriendList: { tab?: MainTab } | undefined;
  Chat: { friend: Friend; historyClearedAt?: number };
  ConversationDetails: { friend: Friend };
  AddFriend: undefined;
  Settings: undefined;
  MyProfileCard: undefined;
  ProfileEdit: undefined;
  NotificationSettings: undefined;
  AccountSecurity: undefined;
  ChatDataSettings: undefined;
  HelpLegal: undefined;
  VoiceCall: {
    direction: "incoming" | "outgoing";
    targetId: string;
    targetName: string;
    targetAvatar?: string | null;
    callId?: string;
    autoAccept?: boolean;
    sessionMode?: "pending" | "active";
  };
  Login: undefined;
  Register: undefined;
};

interface IncomingCallPayload {
  from: string;
  callId: string;
  callerName: string;
  callerAvatar: string | null;
  receivedAt: number;
}

const INCOMING_CALL_TIMEOUT_MS = 35_000;
const CALL_CONNECTION_TIMEOUT_MS = 18_000;
const CALL_RECOVERY_GRACE_MS = 8_000;
type GlobalCallPhase = "ringing" | "connecting" | "connected" | "recovering" | "failed";
const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function parseIncomingCall(data: any): IncomingCallPayload | null {
  if (typeof data?.from !== "string" || !data.from.trim()) return null;
  if (typeof data?.call_id !== "string" || !data.call_id.trim()) return null;
  return {
    from: data.from,
    callId: data.call_id,
    callerName: typeof data.caller_name === "string" && data.caller_name.trim()
      ? data.caller_name
      : "未知用户",
    callerAvatar: typeof data.caller_avatar === "string" && data.caller_avatar.trim()
      ? data.caller_avatar
      : null,
    receivedAt: Date.now(),
  };
}

async function withCachedCallerAvatar(
  call: IncomingCallPayload,
  ownerId: string | null | undefined
): Promise<IncomingCallPayload> {
  if (call.callerAvatar || !ownerId) return call;
  try {
    const friends = await getCachedFriends(ownerId);
    const friend = friends.find((item) => item.user_id === call.from);
    return friend?.avatar ? { ...call, callerAvatar: friend.avatar } : call;
  } catch {
    return call;
  }
}

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

type ConnectionNoticeState = "restoring" | "synced" | "offline";

function ConnectionStatusCoordinator() {
  const [notice, setNotice] = useState<ConnectionNoticeState | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const recoveryReasonRef = useRef<"probe" | "offline" | null>(null);
  const restoringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedAtRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const clearRestoringTimer = useCallback(() => {
    if (restoringTimerRef.current) clearTimeout(restoringTimerRef.current);
    restoringTimerRef.current = null;
  }, []);

  const showNotice = useCallback((nextNotice: ConnectionNoticeState) => {
    clearHideTimer();
    setNotice(nextNotice);
    progress.stopAnimation();
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [clearHideTimer, progress, reduceMotion]);

  const hideNotice = useCallback(() => {
    clearHideTimer();
    const finish = () => setNotice(null);
    if (reduceMotion) {
      progress.setValue(0);
      finish();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(finish);
  }, [clearHideTimer, progress, reduceMotion]);

  const showSynced = useCallback((force = false) => {
    const recoveryReason = recoveryReasonRef.current;
    recoveryReasonRef.current = null;
    clearRestoringTimer();
    if (!force && recoveryReason !== "offline") {
      hideNotice();
      return;
    }
    const now = Date.now();
    if (now - lastSyncedAtRef.current < 8_000) {
      return;
    }
    lastSyncedAtRef.current = now;
    showNotice("synced");
    AccessibilityInfo.announceForAccessibility("消息与在线状态已同步");
    hideTimerRef.current = setTimeout(hideNotice, 1100);
  }, [clearRestoringTimer, hideNotice, showNotice]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const onConnectionState = (data: any) => {
      if (data?.state === "restoring") {
        if (recoveryReasonRef.current !== "offline") recoveryReasonRef.current = "probe";
        clearRestoringTimer();
        restoringTimerRef.current = setTimeout(() => {
          if (recoveryReasonRef.current) showNotice("restoring");
        }, 650);
      } else if (data?.state === "offline") {
        recoveryReasonRef.current = "offline";
        clearRestoringTimer();
        showNotice("offline");
      }
    };
    const onConnected = () => showSynced();
    const onResumed = (data: any) => showSynced(data?.reconnected === true);
    kinWS.on("connection_state", onConnectionState);
    kinWS.on("connected", onConnected);
    kinWS.on("resumed", onResumed);
    return () => {
      kinWS.off("connection_state", onConnectionState);
      kinWS.off("connected", onConnected);
      kinWS.off("resumed", onResumed);
    };
  }, [clearRestoringTimer, showNotice, showSynced]);

  useEffect(() => () => {
    clearHideTimer();
    clearRestoringTimer();
    progress.stopAnimation();
  }, [clearHideTimer, clearRestoringTimer, progress]);

  if (!notice) return null;
  const copy = notice === "restoring"
    ? "正在同步消息与在线状态…"
    : notice === "synced"
      ? "消息与在线状态已同步"
      : "当前离线，正在使用本地缓存";
  const mark = notice === "restoring" ? "·" : notice === "synced" ? "✓" : "!";
  const animatedStyle = {
    opacity: progress,
    transform: [{
      translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }),
    }],
  };

  return (
    <View style={styles.connectionOverlay} pointerEvents="none">
      <Animated.View style={[styles.connectionNotice, animatedStyle]}>
        <BlurView
          style={styles.connectionBlur}
          intensity={64}
          tint="systemMaterialDark"
          blurMethod="dimezisBlurView"
          blurReductionFactor={3}
        >
          <Text style={[
            styles.connectionMark,
            notice === "synced" && styles.connectionMarkSynced,
            notice === "offline" && styles.connectionMarkOffline,
          ]}>
            {mark}
          </Text>
          <Text style={styles.connectionText}>{copy}</Text>
        </BlurView>
      </Animated.View>
    </View>
  );
}

function IncomingCallCoordinator({
  navigationReady,
  notificationCallId,
}: {
  navigationReady: boolean;
  notificationCallId: string | null;
}) {
  const { state } = useAuth();
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [actingCallId, setActingCallId] = useState<string | null>(null);
  const [callPhase, setCallPhase] = useState<GlobalCallPhase>("ringing");
  const [callSeconds, setCallSeconds] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const handledCallIdRef = useRef<string | null>(null);
  const pendingCallRef = useRef<IncomingCallPayload | null>(null);
  const incomingCallRef = useRef<IncomingCallPayload | null>(null);
  const actingCallIdRef = useRef<string | null>(null);
  const callPhaseRef = useRef<GlobalCallPhase>("ringing");
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedAtRef = useRef(0);
  const cardProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setAvatarFailed(false);
  }, [incomingCall?.callerAvatar]);

  const clearCallTimers = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = null;
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    durationTimerRef.current = null;
  }, []);

  const hideIncomingCall = useCallback((callId: string) => {
    if (incomingCallRef.current?.callId !== callId) return;
    clearCallTimers();
    kinFeedback.stopIncomingCallFeedback(callId);
    const finish = () => {
      if (incomingCallRef.current?.callId !== callId) return;
      incomingCallRef.current = null;
      actingCallIdRef.current = null;
      setIncomingCall(null);
      setActingCallId(null);
      callPhaseRef.current = "ringing";
      setCallPhase("ringing");
      setCallSeconds(0);
    };
    if (reduceMotion) {
      cardProgress.setValue(0);
      finish();
      return;
    }
    Animated.timing(cardProgress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(finish);
  }, [cardProgress, clearCallTimers, reduceMotion]);

  const presentIncomingCall = useCallback((call: IncomingCallPayload) => {
    if (!navigationRef.isReady() || handledCallIdRef.current === call.callId) return;
    if (Date.now() - call.receivedAt >= INCOMING_CALL_TIMEOUT_MS) {
      webrtcService.reject(call.from);
      return;
    }

    const currentRoute = navigationRef.getCurrentRoute();
    if (currentRoute?.name === "VoiceCall") {
      const currentCallId = (currentRoute.params as RootStackParamList["VoiceCall"] | undefined)?.callId;
      if (currentCallId === call.callId) handledCallIdRef.current = call.callId;
      return;
    }

    handledCallIdRef.current = call.callId;
    incomingCallRef.current = call;
    actingCallIdRef.current = null;
    setIncomingCall(call);
    setActingCallId(null);
    callPhaseRef.current = "ringing";
    setCallPhase("ringing");
    setCallSeconds(0);
    clearCallTimers();
    cardProgress.stopAnimation();
    cardProgress.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(cardProgress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    void kinFeedback.notifyIncomingCall(call.callId);
    AccessibilityInfo.announceForAccessibility(`${call.callerName}邀请你进行语音通话`);
    const remainingTime = Math.max(
      0,
      INCOMING_CALL_TIMEOUT_MS - (Date.now() - call.receivedAt)
    );
    expiryTimerRef.current = setTimeout(() => {
      if (incomingCallRef.current?.callId !== call.callId) return;
      webrtcService.reject(call.from);
      hideIncomingCall(call.callId);
    }, remainingTime);
  }, [cardProgress, clearCallTimers, hideIncomingCall, reduceMotion]);

  const openIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call || callPhaseRef.current === "failed" || !navigationRef.isReady()) return;
    const sessionMode = callPhaseRef.current === "ringing" ? "pending" : "active";
    actingCallIdRef.current = call.callId;
    setActingCallId(call.callId);
    hideIncomingCall(call.callId);
    navigationRef.navigate("VoiceCall", {
      direction: "incoming",
      targetId: call.from,
      targetName: call.callerName,
      targetAvatar: call.callerAvatar,
      callId: call.callId,
      autoAccept: false,
      sessionMode,
    });
  }, [hideIncomingCall]);

  const finishGlobalCall = useCallback((callId: string, failed = false) => {
    if (incomingCallRef.current?.callId !== callId) return;
    clearCallTimers();
    webrtcService.setHandlers({
      onIncomingCall: () => {},
      onCallAccepted: () => {},
      onCallRejected: () => {},
      onCallEnded: () => {},
      onRemoteStream: () => {},
      onConnectionStateChange: () => {},
    });
    if (failed && webrtcService.hasActiveCall()) {
      webrtcService.hangup(incomingCallRef.current.from);
    }
    actingCallIdRef.current = null;
    setActingCallId(null);
    if (!failed) {
      hideIncomingCall(callId);
      return;
    }
    callPhaseRef.current = "failed";
    setCallPhase("failed");
    connectionTimerRef.current = setTimeout(() => hideIncomingCall(callId), 1400);
  }, [clearCallTimers, hideIncomingCall]);

  const acceptIncomingCall = useCallback(async () => {
    const call = incomingCallRef.current;
    if (!call || actingCallIdRef.current === call.callId || callPhase !== "ringing") return;

    const pendingOffer = webrtcService.getPendingOffer();
    if (!pendingOffer || pendingOffer.callId !== call.callId) {
      webrtcService.reject(call.from);
      finishGlobalCall(call.callId, true);
      return;
    }

    actingCallIdRef.current = call.callId;
    setActingCallId(call.callId);
    clearCallTimers();
    kinFeedback.stopIncomingCallFeedback(call.callId);
    callPhaseRef.current = "connecting";
    setCallPhase("connecting");

    webrtcService.setHandlers({
      onIncomingCall: () => {},
      onCallAccepted: () => {},
      onCallRejected: () => finishGlobalCall(call.callId),
      onCallEnded: () => finishGlobalCall(call.callId),
      onRemoteStream: () => {},
      onConnectionStateChange: (connectionState) => {
        if (incomingCallRef.current?.callId !== call.callId) return;
        if (connectionState === "connected") {
          if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
          connectionTimerRef.current = null;
          actingCallIdRef.current = null;
          setActingCallId(null);
          const isRecovered = callPhaseRef.current === "recovering";
          callPhaseRef.current = "connected";
          setCallPhase("connected");
          if (!isRecovered) {
            connectedAtRef.current = Date.now();
            setCallSeconds(0);
            if (durationTimerRef.current) clearInterval(durationTimerRef.current);
            durationTimerRef.current = setInterval(() => {
              setCallSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000));
            }, 1000);
          }
        } else if (["disconnected", "failed"].includes(connectionState) && ["connected", "recovering"].includes(callPhaseRef.current)) {
          if (callPhaseRef.current === "recovering") return;
          callPhaseRef.current = "recovering";
          setCallPhase("recovering");
          AccessibilityInfo.announceForAccessibility("通话网络不稳定，正在恢复通话");
          void webrtcService.beginIceRecovery(call.from);
          if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
          connectionTimerRef.current = setTimeout(() => {
            if (incomingCallRef.current?.callId !== call.callId || callPhaseRef.current !== "recovering") return;
            webrtcService.hangup(call.from);
            finishGlobalCall(call.callId, true);
          }, CALL_RECOVERY_GRACE_MS);
        } else if (["failed", "disconnected", "closed"].includes(connectionState)) {
          finishGlobalCall(call.callId, true);
        }
      },
    });

    const result = await webrtcService.answerCall(call.from, pendingOffer.sdp);
    if (incomingCallRef.current?.callId !== call.callId) return;
    if (!result.ok) {
      if (result.reason !== "cancelled") webrtcService.reject(call.from);
      finishGlobalCall(call.callId, true);
      return;
    }
    if (["connected", "recovering"].includes(callPhaseRef.current as GlobalCallPhase)) return;

    connectionTimerRef.current = setTimeout(() => {
      if (incomingCallRef.current?.callId !== call.callId || callPhaseRef.current === "connected") return;
      webrtcService.hangup(call.from);
      finishGlobalCall(call.callId, true);
    }, CALL_CONNECTION_TIMEOUT_MS);
  }, [callPhase, clearCallTimers, finishGlobalCall]);

  const rejectIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call || actingCallIdRef.current === call.callId) return;
    actingCallIdRef.current = call.callId;
    setActingCallId(call.callId);
    webrtcService.reject(call.from);
    AccessibilityInfo.announceForAccessibility("已拒绝语音通话");
    hideIncomingCall(call.callId);
  }, [hideIncomingCall]);

  const hangupGlobalCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    webrtcService.setHandlers({
      onIncomingCall: () => {},
      onCallAccepted: () => {},
      onCallRejected: () => {},
      onCallEnded: () => {},
      onRemoteStream: () => {},
      onConnectionStateChange: () => {},
    });
    webrtcService.hangup(call.from);
    AccessibilityInfo.announceForAccessibility("语音通话已结束");
    finishGlobalCall(call.callId);
  }, [finishGlobalCall]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const onIncomingCall = (data: any) => {
      const call = parseIncomingCall(data);
      if (!call) return;
      if (call.callId === notificationCallId) return;
      if (!navigationReady || !navigationRef.isReady() || !appIsActiveRef.current) {
        pendingCallRef.current = call;
        return;
      }
      void withCachedCallerAvatar(call, state.user?.id).then(presentIncomingCall);
    };
    kinWS.on("incoming_call", onIncomingCall);
    return () => kinWS.off("incoming_call", onIncomingCall);
  }, [navigationReady, notificationCallId, presentIncomingCall, state.user?.id]);

  useEffect(() => {
    if (!notificationCallId) return;
    if (pendingCallRef.current?.callId === notificationCallId) pendingCallRef.current = null;
    if (incomingCallRef.current?.callId === notificationCallId) hideIncomingCall(notificationCallId);
  }, [hideIncomingCall, notificationCallId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appIsActiveRef.current = nextState === "active";
      if (nextState !== "active" || !navigationReady || !pendingCallRef.current) return;
      const pendingCall = pendingCallRef.current;
      pendingCallRef.current = null;
      presentIncomingCall(pendingCall);
    });
    return () => subscription.remove();
  }, [navigationReady, presentIncomingCall]);

  useEffect(() => {
    if (!navigationReady || !appIsActiveRef.current || !pendingCallRef.current) return;
    const pendingCall = pendingCallRef.current;
    pendingCallRef.current = null;
    presentIncomingCall(pendingCall);
  }, [navigationReady, presentIncomingCall]);

  useEffect(() => {
    const clearMatchingCall = (data: any) => {
      if (typeof data?.call_id !== "string") return;
      if (pendingCallRef.current?.callId === data.call_id) pendingCallRef.current = null;
      if (incomingCallRef.current?.callId === data.call_id) hideIncomingCall(data.call_id);
    };
    kinWS.on("call_end", clearMatchingCall);
    kinWS.on("call_rejected", clearMatchingCall);
    return () => {
      kinWS.off("call_end", clearMatchingCall);
      kinWS.off("call_rejected", clearMatchingCall);
    };
  }, [hideIncomingCall]);

  useEffect(() => () => {
    const call = incomingCallRef.current;
    clearCallTimers();
    if (call && webrtcService.hasActiveCall()) webrtcService.hangup(call.from);
    cardProgress.stopAnimation();
  }, [cardProgress, clearCallTimers]);

  if (!incomingCall) return null;
  const initials = Array.from(incomingCall.callerName).slice(0, 2).join("").toUpperCase();
  const avatarUrl = avatarFailed ? null : resolveMediaUrl(incomingCall.callerAvatar);
  const busy = actingCallId === incomingCall.callId;
  const ringing = callPhase === "ringing";
  const statusText = callPhase === "connected"
    ? `通话中 · ${formatCallDuration(callSeconds)}`
    : callPhase === "recovering"
      ? "通话网络不稳定，正在恢复通话…"
    : callPhase === "connecting"
      ? "正在建立通话连接"
      : callPhase === "failed"
        ? "通话连接已中断"
        : "语音来电";
  const cardStyle = {
    opacity: cardProgress,
    transform: [{
      translateY: cardProgress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }),
    }],
  };

  return (
    <View style={styles.incomingOverlay} pointerEvents="box-none">
      <Animated.View style={[styles.incomingCard, cardStyle]}>
        <BlurView
          style={styles.incomingBlur}
          intensity={72}
          tint="systemMaterialDark"
          blurMethod="dimezisBlurView"
          blurReductionFactor={3}
        >
          <TouchableOpacity
            style={styles.incomingMain}
            onPress={openIncomingCall}
            disabled={callPhase === "failed"}
            accessibilityRole="button"
            accessibilityLabel={`${incomingCall.callerName}，${statusText}`}
            accessibilityHint={ringing ? "进入等待接听页面" : undefined}
          >
            <View style={styles.incomingAvatar}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.incomingAvatarImage}
                  onError={() => setAvatarFailed(true)}
                  accessibilityLabel={`${incomingCall.callerName}的头像`}
                />
              ) : (
                <Text style={styles.incomingAvatarText}>{initials}</Text>
              )}
            </View>
            <View style={styles.incomingTextGroup}>
              <Text style={styles.incomingName} numberOfLines={1}>{incomingCall.callerName}</Text>
              <View style={styles.incomingStatusRow}>
                {callPhase === "connected" ? <View style={styles.connectedDot} /> : null}
                {["connecting", "recovering"].includes(callPhase) ? <ActivityIndicator size="small" color={GRAPHITE_COLORS.primary} /> : null}
                <Text style={[styles.incomingStatus, callPhase === "failed" && styles.failedStatus]}>
                  {statusText}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.incomingActions}>
            {ringing ? (
              <>
                <TouchableOpacity
                  style={[styles.incomingAction, styles.rejectAction]}
                  onPress={rejectIncomingCall}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="拒绝语音通话"
                >
                  <Text style={[styles.incomingActionText, styles.rejectActionText]}>×</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.incomingAction, styles.acceptAction]}
                  onPress={() => { void acceptIncomingCall(); }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="接听语音通话"
                >
                  <Text style={[styles.incomingActionText, styles.acceptActionText]}>接</Text>
                </TouchableOpacity>
              </>
            ) : callPhase !== "failed" ? (
              <TouchableOpacity
                style={[styles.incomingAction, styles.rejectAction]}
                onPress={hangupGlobalCall}
                accessibilityRole="button"
                accessibilityLabel="挂断语音通话"
              >
                <Text style={[styles.incomingActionText, styles.rejectActionText]}>×</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}

function NotificationResponseCoordinator({
  navigationReady,
  onCallIntentChange,
}: {
  navigationReady: boolean;
  onCallIntentChange: (callId: string | null) => void;
}) {
  const { state } = useAuth();
  const [pendingResponse, setPendingResponse] = useState<KinNotificationResponse | null>(null);
  const [connectionTick, setConnectionTick] = useState(0);
  const processingRef = useRef(false);

  const captureResponse = useCallback((response: KinNotificationResponse) => {
    const callId = response.data?.notification_type === "incoming_call"
      && typeof response.data.call_id === "string"
      ? response.data.call_id
      : null;
    onCallIntentChange(callId);
    setPendingResponse(response);
  }, [onCallIntentChange]);

  useEffect(() => {
    let active = true;
    void getInitialNotificationResponse().then((response) => {
      if (active && response) captureResponse(response);
    });
    const unsubscribe = subscribeNotificationResponses(captureResponse);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [captureResponse]);

  useEffect(() => {
    const onConnected = () => setConnectionTick((value) => value + 1);
    const onIncomingCall = () => setConnectionTick((value) => value + 1);
    kinWS.on("connected", onConnected);
    kinWS.on("resumed", onConnected);
    kinWS.on("incoming_call", onIncomingCall);
    return () => {
      kinWS.off("connected", onConnected);
      kinWS.off("resumed", onConnected);
      kinWS.off("incoming_call", onIncomingCall);
    };
  }, []);

  useEffect(() => {
    if (
      !pendingResponse
      || !navigationReady
      || !navigationRef.isReady()
      || !state.isLoggedIn
      || !state.user
      || processingRef.current
    ) return;

    const { data, receivedAt } = pendingResponse;
    const notificationType = data?.notification_type;
    processingRef.current = true;
    const finish = () => {
      if (notificationType === "incoming_call") onCallIntentChange(null);
      setPendingResponse(null);
      processingRef.current = false;
      void clearInitialNotificationResponse().catch(() => {});
    };
    if (typeof data?.recipient_id === "string" && data.recipient_id !== state.user.id) {
      finish();
      return;
    }
    if (notificationType === "incoming_call" && !kinWS.isConnected()) {
      processingRef.current = false;
      return;
    }

    if (notificationType === "incoming_call") {
      const from = typeof data.from === "string" ? data.from : "";
      const callId = typeof data.call_id === "string" ? data.call_id : "";
      const callerName = typeof data.caller_name === "string" && data.caller_name.trim()
        ? data.caller_name
        : "未知用户";
      const callerAvatar = typeof data.caller_avatar === "string" && data.caller_avatar.trim()
        ? data.caller_avatar
        : null;
      if (!from || !callId || Date.now() - receivedAt > INCOMING_CALL_TIMEOUT_MS) {
        finish();
        return;
      }
      const pendingOffer = webrtcService.peekPendingOffer();
      if (!pendingOffer || pendingOffer.callId !== callId) {
        processingRef.current = false;
        return;
      }
      void withCachedCallerAvatar({
        from,
        callId,
        callerName,
        callerAvatar,
        receivedAt,
      }, state.user.id).then((call) => {
        const currentRoute = navigationRef.getCurrentRoute();
        const currentCallId = (currentRoute?.params as RootStackParamList["VoiceCall"] | undefined)?.callId;
        if (currentRoute?.name !== "VoiceCall" || currentCallId !== callId) {
          navigationRef.navigate("VoiceCall", {
            direction: "incoming",
            targetId: from,
            targetName: callerName,
            targetAvatar: call.callerAvatar,
            callId,
            autoAccept: false,
            sessionMode: "pending",
          });
        }
        finish();
      });
      return;
    }

    if (notificationType === "message" && typeof data.sender_id === "string") {
      void getCachedFriends(state.user.id)
        .then((friends) => {
          const friend = friends.find((item) => item.user_id === data.sender_id);
          if (friend && navigationRef.isReady()) {
            navigationRef.navigate("Chat", { friend });
          } else if (navigationRef.isReady()) {
            navigationRef.navigate("FriendList", { tab: "conversations" });
          }
        })
        .catch(() => {
          if (navigationRef.isReady()) {
            navigationRef.navigate("FriendList", { tab: "conversations" });
          }
        })
        .finally(finish);
      return;
    }

    finish();
  }, [connectionTick, navigationReady, onCallIntentChange, pendingResponse, state.isLoggedIn, state.user]);

  return null;
}

function AppNavigator() {
  const { state } = useAuth();
  const [navigationReady, setNavigationReady] = useState(false);
  const [notificationCallId, setNotificationCallId] = useState<string | null>(null);

  if (state.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: GRAPHITE_COLORS.canvas }}>
        <ExpoStatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <ExpoStatusBar style="light" />
      <NavigationContainer
        ref={navigationRef}
        theme={GRAPHITE_NAVIGATION_THEME}
        onReady={() => setNavigationReady(true)}
      >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {state.isLoggedIn ? (
          <>
            <Stack.Screen name="FriendList" component={MainShellScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="ConversationDetails" component={ConversationDetailsScreen} />
            <Stack.Screen name="AddFriend" component={AddFriendScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="MyProfileCard" component={MyProfileCardScreen} />
            <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
            <Stack.Screen name="NotificationSettings" component={SettingsScreen} />
            <Stack.Screen name="AccountSecurity" component={SettingsScreen} />
            <Stack.Screen name="ChatDataSettings" component={SettingsScreen} />
            <Stack.Screen name="HelpLegal" component={SettingsScreen} />
            <Stack.Screen
              name="VoiceCall"
              component={VoiceCallScreen}
              options={{
                animation: "slide_from_bottom",
                gestureEnabled: false,
              }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
      {state.isLoggedIn ? (
        <>
          <ConnectionStatusCoordinator />
          <NotificationResponseCoordinator
            navigationReady={navigationReady}
            onCallIntentChange={setNotificationCallId}
          />
          <IncomingCallCoordinator
            navigationReady={navigationReady}
            notificationCallId={notificationCallId}
          />
        </>
      ) : null}
      </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  connectionOverlay: {
    position: "absolute", left: 0, right: 0,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 54 : 98,
    zIndex: 90, elevation: 18,
    alignItems: "center",
  },
  connectionNotice: {
    overflow: "hidden", maxWidth: "76%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong, borderRadius: 13,
    shadowColor: GRAPHITE_COLORS.shadow, shadowOpacity: 0.36,
    shadowRadius: 13, shadowOffset: { width: 0, height: 6 },
  },
  connectionBlur: {
    minHeight: 27, paddingHorizontal: 8,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(23,27,24,0.92)",
  },
  connectionMark: {
    width: 14, height: 14, borderRadius: 7,
    textAlign: "center", lineHeight: 14,
    color: GRAPHITE_COLORS.textMuted, fontSize: 9, fontWeight: "800",
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  connectionMarkSynced: { color: GRAPHITE_COLORS.primaryStrong, borderColor: GRAPHITE_COLORS.primaryLine },
  connectionMarkOffline: { color: GRAPHITE_COLORS.warningStrong, borderColor: GRAPHITE_COLORS.warningLine },
  connectionText: { flexShrink: 1, color: GRAPHITE_COLORS.textMuted, fontSize: 9, fontWeight: "600" },
  incomingOverlay: {
    position: "absolute", left: 0, right: 0,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 8 : 54,
    zIndex: 100, elevation: 24,
    paddingHorizontal: 12,
  },
  incomingCard: {
    overflow: "hidden",
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong,
    shadowColor: GRAPHITE_COLORS.shadow, shadowOpacity: 0.46,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  incomingBlur: {
    minHeight: 64, paddingHorizontal: 10,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(23,27,24,0.94)",
  },
  incomingMain: {
    flex: 1, minWidth: 0, minHeight: 62,
    flexDirection: "row", alignItems: "center",
  },
  incomingAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong,
  },
  incomingAvatarImage: { width: "100%", height: "100%" },
  incomingAvatarText: { color: GRAPHITE_COLORS.text, fontSize: 12, fontWeight: "700" },
  incomingTextGroup: { flex: 1, minWidth: 0, marginLeft: 10 },
  incomingName: { color: GRAPHITE_COLORS.text, fontSize: 15, fontWeight: "700" },
  incomingStatusRow: { minHeight: 18, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 5 },
  incomingStatus: { color: GRAPHITE_COLORS.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  failedStatus: { color: GRAPHITE_COLORS.danger },
  connectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GRAPHITE_COLORS.primary },
  incomingActions: {
    marginLeft: 8, flexDirection: "row", alignItems: "center", gap: 7,
  },
  incomingAction: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
  },
  rejectAction: {
    borderWidth: 1, borderColor: GRAPHITE_COLORS.dangerLine,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
  },
  acceptAction: { backgroundColor: GRAPHITE_COLORS.primary },
  incomingActionText: { fontSize: 13, fontWeight: "700" },
  rejectActionText: { color: GRAPHITE_COLORS.danger, fontSize: 24, fontWeight: "300", lineHeight: 25 },
  acceptActionText: { color: GRAPHITE_COLORS.onPrimary },
});

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
