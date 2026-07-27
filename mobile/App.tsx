/** Kin — 只和见过的人聊天 */

import React from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

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

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { state } = useAuth();

  if (state.isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
