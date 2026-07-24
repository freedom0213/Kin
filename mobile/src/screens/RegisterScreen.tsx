/** 注册页面 */

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { register } from "../api/client";
import { useAuth } from "../stores/AuthContext";

export default function RegisterScreen({ navigation }: any) {
  const { loginAction } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("提示", "请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const result = await register(username.trim(), password);
      if (result.success) {
        // 注册成功直接登录
        await loginAction(result.token, {
          id: result.user.id,
          username: result.user.username,
          nickname: null,
          avatar: null,
          status_msg: null,
        });
      }
    } catch (e: any) {
      Alert.alert("注册失败", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>加入 Kin</Text>
        <Text style={styles.subtitle}>创建账号，开始真正的亲密社交</Text>

        <Text style={styles.hint}>用户名：字母开头，4-16位，字母/数字/下划线</Text>
        <TextInput
          style={styles.input}
          placeholder="用户名"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />

        <Text style={styles.hint}>密码：8-32位，必须含字母和数字</Text>
        <TextInput
          style={styles.input}
          placeholder="密码"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? "注册中..." : "注册"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>已有账号？去登录</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { paddingHorizontal: 32, paddingTop: 80, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#1a1a2e" },
  subtitle: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 4, marginBottom: 40 },
  hint: { fontSize: 12, color: "#aaa", marginBottom: 6, marginLeft: 4 },
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
