/** Kin — 只和见过的人聊天 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import type { Friend } from "./src/api/client";
import { kinWS } from "./src/api/ws";
import { kinFeedback } from "./src/services/feedback";
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
  };
  Login: undefined;
  Register: undefined;
};

interface IncomingCallPayload {
  from: string;
  callId: string;
  callerName: string;
}

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
  };
}

function IncomingCallCoordinator({ navigationReady }: { navigationReady: boolean }) {
  const handledCallIdRef = useRef<string | null>(null);
  const pendingCallRef = useRef<IncomingCallPayload | null>(null);

  const presentIncomingCall = useCallback((call: IncomingCallPayload) => {
    if (!navigationRef.isReady() || handledCallIdRef.current === call.callId) return;

    const currentRoute = navigationRef.getCurrentRoute();
    if (currentRoute?.name === "VoiceCall") {
      const currentCallId = (currentRoute.params as RootStackParamList["VoiceCall"] | undefined)?.callId;
      if (currentCallId === call.callId) handledCallIdRef.current = call.callId;
      return;
    }

    handledCallIdRef.current = call.callId;
    void kinFeedback.notifyIncomingCall(call.callId);
    navigationRef.navigate("VoiceCall", {
      direction: "incoming",
      targetId: call.from,
      targetName: call.callerName,
      callId: call.callId,
    });
  }, []);

  useEffect(() => {
    const onIncomingCall = (data: any) => {
      const call = parseIncomingCall(data);
      if (!call) return;
      if (!navigationReady || !navigationRef.isReady()) {
        pendingCallRef.current = call;
        return;
      }
      presentIncomingCall(call);
    };
    kinWS.on("incoming_call", onIncomingCall);
    return () => kinWS.off("incoming_call", onIncomingCall);
  }, [navigationReady, presentIncomingCall]);

  useEffect(() => {
    if (!navigationReady || !pendingCallRef.current) return;
    const pendingCall = pendingCallRef.current;
    pendingCallRef.current = null;
    presentIncomingCall(pendingCall);
  }, [navigationReady, presentIncomingCall]);

  return null;
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
      {state.isLoggedIn ? (
        <IncomingCallCoordinator navigationReady={navigationReady} />
      ) : null}
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
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
