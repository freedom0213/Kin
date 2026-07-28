/** Kin — 只和见过的人聊天 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, AppState, Easing, Platform,
  StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
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

function IncomingCallCoordinator({ navigationReady }: { navigationReady: boolean }) {
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [actingCallId, setActingCallId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const handledCallIdRef = useRef<string | null>(null);
  const pendingCallRef = useRef<IncomingCallPayload | null>(null);
  const incomingCallRef = useRef<IncomingCallPayload | null>(null);
  const actingCallIdRef = useRef<string | null>(null);
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardProgress = useRef(new Animated.Value(0)).current;

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, []);

  const hideIncomingCall = useCallback((callId: string) => {
    if (incomingCallRef.current?.callId !== callId) return;
    clearExpiryTimer();
    kinFeedback.stopIncomingCallFeedback(callId);
    const finish = () => {
      if (incomingCallRef.current?.callId !== callId) return;
      incomingCallRef.current = null;
      actingCallIdRef.current = null;
      setIncomingCall(null);
      setActingCallId(null);
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
  }, [cardProgress, clearExpiryTimer, reduceMotion]);

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
    clearExpiryTimer();
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
  }, [cardProgress, clearExpiryTimer, hideIncomingCall, reduceMotion]);

  const openIncomingCall = useCallback((autoAccept: boolean) => {
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
      autoAccept,
    });
  }, [hideIncomingCall]);

  const rejectIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call || actingCallIdRef.current === call.callId) return;
    actingCallIdRef.current = call.callId;
    setActingCallId(call.callId);
    webrtcService.reject(call.from);
    AccessibilityInfo.announceForAccessibility("已拒绝语音通话");
    hideIncomingCall(call.callId);
  }, [hideIncomingCall]);

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
    clearExpiryTimer();
    cardProgress.stopAnimation();
  }, [cardProgress, clearExpiryTimer]);

  if (!incomingCall) return null;
  const initials = Array.from(incomingCall.callerName).slice(0, 2).join("").toUpperCase();
  const busy = actingCallId === incomingCall.callId;
  const cardStyle = {
    opacity: cardProgress,
    transform: [{
      translateY: cardProgress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }),
    }],
  };

  return (
    <View style={styles.incomingOverlay} pointerEvents="box-none">
      <Animated.View style={[styles.incomingCard, cardStyle]}>
        <TouchableOpacity
          style={styles.incomingMain}
          onPress={() => openIncomingCall(false)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${incomingCall.callerName}的语音来电`}
          accessibilityHint="进入等待接听页面"
        >
          <View style={styles.incomingAvatar}>
            <Text style={styles.incomingAvatarText}>{initials}</Text>
          </View>
          <View style={styles.incomingTextGroup}>
            <Text style={styles.incomingEyebrow}>语音来电</Text>
            <Text style={styles.incomingName} numberOfLines={1}>{incomingCall.callerName}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.incomingActions}>
          <TouchableOpacity
            style={[styles.incomingAction, styles.rejectAction]}
            onPress={rejectIncomingCall}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="拒绝语音通话"
          >
            <Text style={[styles.incomingActionText, styles.rejectActionText]}>拒绝</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.incomingAction, styles.acceptAction]}
            onPress={() => openIncomingCall(true)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="接听语音通话"
          >
            <Text style={[styles.incomingActionText, styles.acceptActionText]}>接听</Text>
          </TouchableOpacity>
        </View>
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
    borderRadius: 24,
    backgroundColor: "rgba(247, 250, 248, 0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: "#0C1712", shadowOpacity: 0.18,
    shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
  },
  incomingMain: {
    minHeight: 72, paddingHorizontal: 15,
    flexDirection: "row", alignItems: "center",
  },
  incomingAvatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#26322D",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.35)",
  },
  incomingAvatarText: { color: "#F7FAF8", fontSize: 14, fontWeight: "700" },
  incomingTextGroup: { flex: 1, marginLeft: 12 },
  incomingEyebrow: {
    color: "#2D8769", fontSize: 11, fontWeight: "700", letterSpacing: 0.5,
  },
  incomingName: { marginTop: 3, color: "#171D1A", fontSize: 16, fontWeight: "700" },
  incomingActions: {
    padding: 8, paddingTop: 0,
    flexDirection: "row", gap: 8,
  },
  incomingAction: {
    flex: 1, minHeight: 42, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  rejectAction: { backgroundColor: "rgba(180, 58, 51, 0.09)" },
  acceptAction: { backgroundColor: "#2DAD82" },
  incomingActionText: { fontSize: 14, fontWeight: "700" },
  rejectActionText: { color: "#A63C36" },
  acceptActionText: { color: "#FFFFFF" },
});

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
