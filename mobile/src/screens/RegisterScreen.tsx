/** Graphite Flow 注册页面 — 生成 E2E 密钥对并上传公钥 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { register } from "../api/client";
import GraphiteAuthLayout from "../components/GraphiteAuthLayout";
import { INPUT_COLORS, PasswordInput } from "../components/PasswordInput";
import { createAccountKeyPair, storeAccountKeyPair } from "../services/keys";
import { useAuth } from "../stores/AuthContext";
import {
  GRAPHITE_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

export default function RegisterScreen({ navigation }: any) {
  const { loginAction } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const usernameFormatValid = /^[A-Za-z][A-Za-z0-9_]{3,15}$/.test(username);

  const passwordRules = useMemo(() => ({
    length: password.length >= 8 && password.length <= 32,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password),
    match: password.length > 0 && password === confirmPassword,
  }), [confirmPassword, password]);

  const rulesComplete = Object.values(passwordRules).every(Boolean);

  const handleRegister = async () => {
    if (!usernameFormatValid) {
      setErrorMessage("用户名需以字母开头，使用 4–16 位字母、数字或下划线。");
      return;
    }
    if (!rulesComplete) {
      setErrorMessage("请完成全部密码规则，并确认两次输入一致。");
      return;
    }
    setErrorMessage("");
    setLoading(true);
    try {
      const keyPair = createAccountKeyPair();
      const result = await register(username.trim(), password, keyPair.publicKey);
      if (result.success) {
        await storeAccountKeyPair(result.user.id, keyPair);
        await loginAction(result.token, {
          id: result.user.id,
          username: result.user.username,
          nickname: result.user.nickname ?? null,
          avatar: result.user.avatar ?? null,
          profile_banner: result.user.profile_banner ?? null,
          status_msg: result.user.status_msg ?? null,
          public_key: result.user.public_key ?? keyPair.publicKey,
        });
      }
    } catch (error: any) {
      const message = error.message || "暂时无法注册，请稍后重试。";
      setErrorMessage(message);
      Alert.alert("注册失败", message);
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = (value: string) => {
    setPassword(value);
    setErrorMessage("");
  };

  return (
    <GraphiteAuthLayout
      mode="register"
      title="加入 Kin"
      subtitle="创建账号，开始只属于现实关系的聊天。"
      onModeChange={(mode) => {
        if (mode === "login") navigation.goBack();
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
            placeholder="字母开头，4–16 位"
            placeholderTextColor={INPUT_COLORS.placeholder}
            cursorColor={INPUT_COLORS.cursor}
            selectionColor={INPUT_COLORS.selection}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            maxLength={16}
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setErrorMessage("");
            }}
            onFocus={() => setUsernameFocused(true)}
            onBlur={() => setUsernameFocused(false)}
            accessibilityLabel="新用户名"
          />
        </View>
        <View style={styles.usernameRule}>
          <View style={[styles.ruleDot, usernameFormatValid && styles.ruleDotComplete]} />
          <Text style={[styles.ruleText, usernameFormatValid && styles.ruleTextComplete]}>
            字母开头，可使用字母、数字和下划线
          </Text>
        </View>
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={styles.fieldLabel}>密码</Text>
          <Text style={styles.fieldMeta}>{password.length} 位</Text>
        </View>
        <PasswordInput
          value={password}
          onChangeText={updatePassword}
          autoComplete="new-password"
        />
      </View>

      <View style={styles.rules} accessibilityLabel="密码规则完成状态">
        {([
          ["length", "8–32 位"],
          ["letter", "包含字母"],
          ["number", "包含数字"],
          ["match", "两次一致"],
        ] as const).map(([key, label]) => (
          <View key={key} style={styles.rule}>
            <View style={[styles.ruleDot, passwordRules[key] && styles.ruleDotComplete]} />
            <Text style={[styles.ruleText, passwordRules[key] && styles.ruleTextComplete]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={styles.fieldLabel}>确认密码</Text>
          <Text style={styles.fieldMeta}>再次输入</Text>
        </View>
        <PasswordInput
          value={confirmPassword}
          onChangeText={(value) => {
            setConfirmPassword(value);
            setErrorMessage("");
          }}
          autoComplete="new-password"
          placeholder="再次输入密码"
          accessibilityLabel="确认密码"
        />
      </View>

      <Text style={styles.errorLine} accessibilityLiveRegion="polite">
        {errorMessage}
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
        onPress={() => void handleRegister()}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={loading ? "正在创建 Kin 账号" : "创建 Kin 账号"}
      >
        {loading ? <ActivityIndicator size="small" color={GRAPHITE_COLORS.onPrimary} /> : null}
        <Text style={styles.primaryButtonText}>{loading ? "创建中…" : "创建 Kin 账号"}</Text>
      </TouchableOpacity>

      <Text style={styles.privacy}>注册即表示你理解：测试阶段暂不提供密码找回。</Text>
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
  usernameRule: {
    marginTop: 9,
    marginHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  rules: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 9,
  },
  rule: { width: "50%", flexDirection: "row", alignItems: "center", gap: 7 },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.textFaint,
  },
  ruleDotComplete: {
    borderColor: GRAPHITE_COLORS.primary,
    backgroundColor: GRAPHITE_COLORS.primary,
  },
  ruleText: { color: GRAPHITE_COLORS.textFaint, fontSize: 11 },
  ruleTextComplete: { color: GRAPHITE_COLORS.primary },
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
});
