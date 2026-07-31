/** Graphite Flow 登录页面 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { login } from "../api/client";
import GraphiteAuthLayout from "../components/GraphiteAuthLayout";
import { INPUT_COLORS, PasswordInput } from "../components/PasswordInput";
import { useAuth } from "../stores/AuthContext";
import {
  GRAPHITE_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

const DEV_TEST_ACCOUNTS = __DEV__ ? [
  { username: "kin_test_01", password: "KinTest01!" },
  { username: "kin_test_02", password: "KinTest02!" },
  { username: "kin_test_03", password: "KinTest03!" },
] : [];

export default function LoginScreen({ navigation }: any) {
  const { loginAction } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setErrorMessage("请输入用户名和密码后再登录。");
      return;
    }
    setErrorMessage("");
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
    } catch (error: any) {
      const message = error.message || "暂时无法登录，请稍后重试。";
      setErrorMessage(message);
      Alert.alert("登录失败", message);
    } finally {
      setLoading(false);
    }
  };

  const fillTestAccount = (account: (typeof DEV_TEST_ACCOUNTS)[number]) => {
    setUsername(account.username);
    setPassword(account.password);
    setErrorMessage("");
  };

  return (
    <GraphiteAuthLayout
      mode="login"
      title="回到 Kin"
      subtitle="登录后，只与你在现实中见过的人继续聊天。"
      onModeChange={(mode) => {
        if (mode === "register") navigation.navigate("Register");
      }}
    >
      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={styles.fieldLabel}>用户名</Text>
          <Text style={styles.fieldMeta}>{username.length} / 16</Text>
        </View>
        <View style={[styles.inputShell, usernameFocused && styles.inputShellFocused]}>
          <Text style={styles.fieldIcon} accessibilityElementsHidden>@</Text>
          <TextInput
            style={styles.input}
            placeholder="输入用户名"
            placeholderTextColor={INPUT_COLORS.placeholder}
            cursorColor={INPUT_COLORS.cursor}
            selectionColor={INPUT_COLORS.selection}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={16}
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setErrorMessage("");
            }}
            onFocus={() => setUsernameFocused(true)}
            onBlur={() => setUsernameFocused(false)}
            accessibilityLabel="用户名"
          />
        </View>
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={styles.fieldLabel}>密码</Text>
          <Text style={styles.fieldMeta}>{password.length} 位</Text>
        </View>
        <PasswordInput
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrorMessage("");
          }}
          autoComplete="current-password"
        />
      </View>

      <Text style={styles.errorLine} accessibilityLiveRegion="polite">
        {errorMessage}
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
        onPress={() => void handleLogin()}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={loading ? "正在登录 Kin" : "登录 Kin"}
      >
        {loading ? <ActivityIndicator size="small" color={GRAPHITE_COLORS.onPrimary} /> : null}
        <Text style={styles.primaryButtonText}>{loading ? "登录中…" : "登录 Kin"}</Text>
      </TouchableOpacity>

      <Text style={styles.privacy}>测试阶段暂不提供密码找回，请使用开发测试账号。</Text>

      {__DEV__ && DEV_TEST_ACCOUNTS.length > 0 ? (
        <View style={styles.testAccounts}>
          <Text style={styles.testAccountLabel}>快速填入开发测试账号</Text>
          <View style={styles.testAccountList}>
            {DEV_TEST_ACCOUNTS.map((account) => (
              <TouchableOpacity
                key={account.username}
                style={styles.testAccountChip}
                onPress={() => fillTestAccount(account)}
                accessibilityRole="button"
                accessibilityLabel={`填入测试账号 ${account.username}`}
              >
                <Text style={styles.testAccountText}>{account.username}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </GraphiteAuthLayout>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: 15 },
  fieldHead: {
    minHeight: 20,
    marginHorizontal: 3,
    marginBottom: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldLabel: { color: GRAPHITE_COLORS.text, fontSize: 12, fontWeight: "700" },
  fieldMeta: { color: GRAPHITE_COLORS.textFaint, fontSize: 11 },
  inputShell: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.line,
    borderRadius: GRAPHITE_RADII.control,
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  inputShellFocused: {
    borderColor: "rgba(105,200,164,0.62)",
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
  },
  fieldIcon: {
    width: 46,
    color: GRAPHITE_COLORS.textFaint,
    fontSize: 18,
    textAlign: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingRight: 14,
    color: GRAPHITE_COLORS.text,
    fontSize: 14,
  },
  errorLine: {
    minHeight: 24,
    marginTop: 8,
    marginHorizontal: 3,
    color: GRAPHITE_COLORS.danger,
    fontSize: 11,
    lineHeight: 17,
  },
  primaryButton: {
    minHeight: 54,
    marginTop: 5,
    borderRadius: GRAPHITE_RADII.button,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GRAPHITE_COLORS.primary,
    shadowColor: GRAPHITE_COLORS.shadow,
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 13 },
    elevation: 8,
  },
  primaryButtonDisabled: { opacity: 0.5, shadowOpacity: 0 },
  primaryButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 14, fontWeight: "800" },
  privacy: {
    marginTop: 14,
    marginHorizontal: 10,
    color: GRAPHITE_COLORS.textFaint,
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
  },
  testAccounts: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GRAPHITE_COLORS.line,
  },
  testAccountLabel: { color: GRAPHITE_COLORS.textFaint, fontSize: 11 },
  testAccountList: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  testAccountChip: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.line,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  testAccountText: { color: GRAPHITE_COLORS.textMuted, fontSize: 11, fontWeight: "600" },
});
