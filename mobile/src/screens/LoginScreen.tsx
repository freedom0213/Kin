/** 登录页面 */

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { login } from "../api/client";
import { useAuth } from "../stores/AuthContext";

export default function LoginScreen({ navigation }: any) {
  const { loginAction } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("提示", "请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (result.success) {
        await loginAction(result.token, {
          id: result.user.id,
          username: result.user.username,
          nickname: result.user.nickname ?? null,
          avatar: result.user.avatar ?? null,
          profile_banner: result.user.profile_banner ?? null,
          status_msg: result.user.status_msg ?? null,
          public_key: result.user.public_key ?? null,
        });
      }
    } catch (e: any) {
      Alert.alert("登录失败", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Kin</Text>
        <Text style={styles.subtitle}>只和见过的人聊天</Text>

        <TextInput
          style={styles.input}
          placeholder="用户名"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="密码"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? "登录中..." : "登录"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("Register")}>
          <Text style={styles.link}>没有账号？去注册</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  title: { fontSize: 36, fontWeight: "700", textAlign: "center", color: "#1a1a2e" },
  subtitle: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 4, marginBottom: 40 },
  input: {
    borderWidth: 1, borderColor: "#ddd", borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    marginBottom: 14, backgroundColor: "#fafafa",
  },
  button: {
    backgroundColor: "#1a1a2e", borderRadius: 10,
    paddingVertical: 15, alignItems: "center", marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  link: { color: "#666", textAlign: "center", marginTop: 20, fontSize: 14 },
});
