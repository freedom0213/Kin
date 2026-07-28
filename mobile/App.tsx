/** Kin — 只和见过的人聊天 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, AppState, Easing, Platform,
  StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { BlurView } from "expo-blur";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import type { Friend } from "./src/api/client";
import { kinWS } from "./src/api/ws";
import { kinFeedback } from "./src/services/feedback";
import { webrtcService } from "./src/services/webrtc";
import { AuthProvider, useAuth } from "./src/stores/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import RegisterScreen from "./src/screens/RegisterScreen";
import FriendListScreen from "./src/screens/FriendListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import AddFriendScreen from "./src/screens/AddFriendScreen";
import VoiceCallScreen from "./src/screens/VoiceCallScreen";
import ConversationDetailsScreen from "./src/screens/ConversationDetailsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ProfileEditScreen from "./src/screens/ProfileEditScreen";

type RootStackParamList = {
  FriendList: undefined;
  Chat: { friend: Friend; historyClearedAt?: number };
  ConversationDetails: { friend: Friend };
  AddFriend: undefined;
  Settings: undefined;
  ProfileEdit: undefined;
  VoiceCall: {
    direction: "incoming" | "outgoing";
    targetId: string;
    targetName: string;
    callId?: string;
    autoAccept?: boolean;
  };
  Login: undefined;
  Register: undefined;
};

interface IncomingCallPayload {
  from: string;
  callId: string;
  callerName: string;
  receivedAt: number;
}

const INCOMING_CALL_TIMEOUT_MS = 35_000;
const CALL_CONNECTION_TIMEOUT_MS = 18_000;
type GlobalCallPhase = "ringing" | "connecting" | "connected" | "failed";
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
    receivedAt: Date.now(),
  };
}

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function IncomingCallCoordinator({ navigationReady }: { navigationReady: boolean }) {
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [actingCallId, setActingCallId] = useState<string | null>(null);
  const [callPhase, setCallPhase] = useState<GlobalCallPhase>("ringing");
  const [callSeconds, setCallSeconds] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
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
    if (!call || actingCallIdRef.current === call.callId || !navigationRef.isReady()) return;
    actingCallIdRef.current = call.callId;
    setActingCallId(call.callId);
    hideIncomingCall(call.callId);
    navigationRef.navigate("VoiceCall", {
      direction: "incoming",
      targetId: call.from,
      targetName: call.callerName,
      callId: call.callId,
      autoAccept: false,
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
          callPhaseRef.current = "connected";
          setCallPhase("connected");
          connectedAtRef.current = Date.now();
          setCallSeconds(0);
          if (durationTimerRef.current) clearInterval(durationTimerRef.current);
          durationTimerRef.current = setInterval(() => {
            setCallSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000));
          }, 1000);
        } else if (["failed", "disconnected", "closed"].includes(connectionState)) {
          finishGlobalCall(call.callId, connectionState === "failed");
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
    if ((callPhaseRef.current as GlobalCallPhase) === "connected") return;

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
      if (!navigationReady || !navigationRef.isReady() || !appIsActiveRef.current) {
        pendingCallRef.current = call;
        return;
      }
      presentIncomingCall(call);
    };
    kinWS.on("incoming_call", onIncomingCall);
    return () => kinWS.off("incoming_call", onIncomingCall);
  }, [navigationReady, presentIncomingCall]);

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
  const busy = actingCallId === incomingCall.callId;
  const ringing = callPhase === "ringing";
  const statusText = callPhase === "connected"
    ? `通话中 · ${formatCallDuration(callSeconds)}`
    : callPhase === "connecting"
      ? "正在建立连接"
      : callPhase === "failed"
        ? "暂时无法接通"
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
          tint="systemMaterialLight"
          blurMethod="dimezisBlurView"
          blurReductionFactor={3}
        >
          <TouchableOpacity
            style={styles.incomingMain}
            onPress={openIncomingCall}
            disabled={busy || !ringing}
            accessibilityRole="button"
            accessibilityLabel={`${incomingCall.callerName}，${statusText}`}
            accessibilityHint={ringing ? "进入等待接听页面" : undefined}
          >
            <View style={styles.incomingAvatar}>
              <Text style={styles.incomingAvatarText}>{initials}</Text>
            </View>
            <View style={styles.incomingTextGroup}>
              <Text style={styles.incomingName} numberOfLines={1}>{incomingCall.callerName}</Text>
              <View style={styles.incomingStatusRow}>
                {callPhase === "connected" ? <View style={styles.connectedDot} /> : null}
                {callPhase === "connecting" ? <ActivityIndicator size="small" color="#2D8769" /> : null}
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

function AppNavigator() {
  const { state } = useAuth();
  const [navigationReady, setNavigationReady] = useState(false);

  if (state.isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={() => setNavigationReady(true)}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {state.isLoggedIn ? (
          <>
            <Stack.Screen name="FriendList" component={FriendListScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="ConversationDetails" component={ConversationDetailsScreen} />
            <Stack.Screen name="AddFriend" component={AddFriendScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
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
        <IncomingCallCoordinator navigationReady={navigationReady} />
      ) : null}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
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
    borderColor: "rgba(255,255,255,0.78)",
    shadowColor: "#0C1712", shadowOpacity: 0.18,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  incomingBlur: {
    minHeight: 64, paddingHorizontal: 10,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(247,250,248,0.24)",
  },
  incomingMain: {
    flex: 1, minWidth: 0, minHeight: 62,
    flexDirection: "row", alignItems: "center",
  },
  incomingAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#26322D",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.35)",
  },
  incomingAvatarText: { color: "#F7FAF8", fontSize: 12, fontWeight: "700" },
  incomingTextGroup: { flex: 1, minWidth: 0, marginLeft: 10 },
  incomingName: { color: "#171D1A", fontSize: 15, fontWeight: "700" },
  incomingStatusRow: { minHeight: 18, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 5 },
  incomingStatus: { color: "#537067", fontSize: 10, fontVariant: ["tabular-nums"] },
  failedStatus: { color: "#A63C36" },
  connectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#2DAD82" },
  incomingActions: {
    marginLeft: 8, flexDirection: "row", alignItems: "center", gap: 7,
  },
  incomingAction: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  rejectAction: { backgroundColor: "rgba(180, 58, 51, 0.12)" },
  acceptAction: { backgroundColor: "#2DAD82" },
  incomingActionText: { fontSize: 13, fontWeight: "700" },
  rejectActionText: { color: "#A63C36", fontSize: 24, fontWeight: "300", lineHeight: 25 },
  acceptActionText: { color: "#FFFFFF" },
});

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
