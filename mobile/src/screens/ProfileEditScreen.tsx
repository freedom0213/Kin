/** 个人资料编辑 — 昵称与个性签名 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { updateProfile } from "../api/client";
import { useAuth } from "../stores/AuthContext";

const COLORS = {
  background: "#F4F5F2",
  surface: "#FFFFFF",
  ink: "#171A1F",
  muted: "#70757D",
  faint: "#9CA19F",
  line: "#E2E5E1",
  accent: "#2DAD82",
  accentDark: "#176B52",
  accentSoft: "#E2F2EC",
};

function normalizeField(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getInitials(name: string): string {
  return Array.from(name).slice(0, 2).join("").toUpperCase();
}

export default function ProfileEditScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { state, updateProfileAction } = useAuth();
  const user = state.user;
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [statusMessage, setStatusMessage] = useState(user?.status_msg || "");
  const [saving, setSaving] = useState(false);

  const normalizedNickname = normalizeField(nickname);
  const normalizedStatus = normalizeField(statusMessage);
  const hasChanges = useMemo(() => (
    normalizedNickname !== normalizeField(user?.nickname || "")
    || normalizedStatus !== normalizeField(user?.status_msg || "")
  ), [normalizedNickname, normalizedStatus, user?.nickname, user?.status_msg]);
  const canSave = !!user && hasChanges && !saving;
  const displayName = normalizedNickname || user?.username || "Kin";

  const handleSave = async () => {
    if (!user || !canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const updated = await updateProfile(
        normalizedNickname || null,
        normalizedStatus || null
      );
      await updateProfileAction(updated);
      navigation.goBack();
    } catch (error: any) {
      Alert.alert(
        "资料未保存",
        error?.message || "无法连接 Kin 服务器，请检查网络后重试。"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回设置"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>编辑资料</Text>
        <TouchableOpacity
          onPress={() => { void handleSave(); }}
          disabled={!canSave}
          style={styles.saveAction}
          accessibilityRole="button"
          accessibilityLabel="保存个人资料"
          accessibilityState={{ disabled: !canSave, busy: saving }}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.accent} />
          ) : (
            <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>保存</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
      >
        <View style={styles.identityPreview}>
          <View style={styles.avatar}>
            {user?.avatar ? (
              <Image
                source={{ uri: user.avatar }}
                style={styles.avatarImage}
                accessibilityLabel={`${displayName}的头像`}
              />
            ) : (
              <Text style={styles.avatarInitials}>{getInitials(displayName)}</Text>
            )}
          </View>
          <Text style={styles.username}>@{user?.username}</Text>
          <Text style={styles.avatarHint}>头像编辑将在后续版本接入</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.fieldHeader}>
            <Text style={styles.label}>昵称</Text>
            <Text style={styles.counter}>{nickname.length}/24</Text>
          </View>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder={user?.username || "输入昵称"}
            placeholderTextColor={COLORS.faint}
            maxLength={24}
            autoCapitalize="words"
            returnKeyType="next"
            accessibilityLabel="昵称"
            accessibilityHint="清空后将使用用户名作为显示名称"
          />
          <Text style={styles.fieldHint}>清空后，Kin 将使用用户名作为显示名称。</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.fieldHeader}>
            <Text style={styles.label}>个性签名</Text>
            <Text style={styles.counter}>{statusMessage.length}/80</Text>
          </View>
          <TextInput
            style={[styles.input, styles.statusInput]}
            value={statusMessage}
            onChangeText={setStatusMessage}
            placeholder="留下一句现在的心情"
            placeholderTextColor={COLORS.faint}
            maxLength={80}
            multiline
            textAlignVertical="top"
            accessibilityLabel="个性签名"
          />
        </View>

        <View style={styles.privacyNote}>
          <Text style={styles.privacyTitle}>谁能看到？</Text>
          <Text style={styles.privacyText}>昵称和个性签名会展示给已经与你成为好友的人。</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    minHeight: 58, paddingHorizontal: 12, paddingBottom: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  headerAction: { width: 52, height: 44, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  saveAction: { width: 52, height: 44, alignItems: "center", justifyContent: "center" },
  saveText: { color: COLORS.accentDark, fontSize: 15, fontWeight: "700" },
  saveTextDisabled: { color: COLORS.faint },
  content: { paddingBottom: 40 },
  identityPreview: { paddingVertical: 28, alignItems: "center" },
  avatar: {
    width: 78, height: 78, borderRadius: 39,
    alignItems: "center", justifyContent: "center", backgroundColor: "#28313A",
  },
  avatarInitials: { color: "#FFFFFF", fontSize: 23, fontWeight: "700" },
  avatarImage: { width: 78, height: 78 },
  username: { marginTop: 12, color: COLORS.ink, fontSize: 14, fontWeight: "600" },
  avatarHint: { marginTop: 5, color: COLORS.faint, fontSize: 12 },
  formSection: {
    marginTop: 12, paddingHorizontal: 20, paddingVertical: 17,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
  },
  fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  counter: { color: COLORS.faint, fontSize: 12 },
  input: {
    minHeight: 48, marginTop: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: COLORS.line, borderRadius: 15,
    backgroundColor: "#FAFBF9", color: COLORS.ink, fontSize: 15,
  },
  statusInput: { minHeight: 108, paddingTop: 13, paddingBottom: 13 },
  fieldHint: { marginTop: 8, color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  privacyNote: {
    marginHorizontal: 20, marginTop: 22, padding: 16,
    borderWidth: 1, borderColor: "#CEE4DC", borderRadius: 16,
    backgroundColor: COLORS.accentSoft,
  },
  privacyTitle: { color: COLORS.accentDark, fontSize: 13, fontWeight: "700" },
  privacyText: { marginTop: 5, color: "#3F6F60", fontSize: 12, lineHeight: 18 },
});
