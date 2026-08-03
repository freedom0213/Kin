/** 我的名片 — 以好友视角只读预览当前身份展示。 */

import React from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveMediaUrl } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { GRAPHITE_COLORS, GRAPHITE_RADII } from "../theme/graphite";

function initials(value: string): string {
  return Array.from(value).slice(0, 2).join("").toUpperCase();
}

export default function MyProfileCardScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { state } = useAuth();
  const user = state.user;
  const displayName = user?.nickname || user?.username || "Kin 用户";
  const avatarUrl = resolveMediaUrl(user?.avatar);
  const bannerUrl = resolveMediaUrl(user?.profile_banner);

  return (
    <View style={styles.container}>
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回我的"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>我的名片</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}>
        <Text style={styles.previewLabel}>好友视角预览</Text>
        <Text style={styles.previewHint}>下面是成为好友后，对方看到的身份信息。</Text>

        <View style={styles.card}>
          <View style={styles.bannerFrame}>
            {bannerUrl ? (
              <Image
                source={{ uri: bannerUrl }}
                style={styles.bannerImage}
                resizeMode="contain"
                accessibilityLabel={`${displayName}的背景名片`}
              />
            ) : (
              <View style={styles.bannerFallback}>
                <View style={styles.bannerOrbLarge} />
                <View style={styles.bannerOrbSmall} />
              </View>
            )}
          </View>

          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} accessibilityLabel={`${displayName}的头像`} />
            ) : (
              <Text style={styles.avatarInitials}>{initials(displayName)}</Text>
            )}
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.username}>@{user?.username || "unknown"}</Text>
          <Text style={styles.status}>{user?.status_msg || "还没有留下个性签名"}</Text>
        </View>

        <View style={styles.visibilityNote}>
          <Text style={styles.visibilityTitle}>谁能看到？</Text>
          <Text style={styles.visibilityCopy}>只有已经与你成为好友的人，才能在好友资料和碰一碰确认过程中看到这张名片。</Text>
        </View>

        <TouchableOpacity
          style={styles.editButton}
          onPress={() => navigation.navigate("ProfileEdit")}
          accessibilityRole="button"
          accessibilityLabel="编辑名片"
        >
          <Text style={styles.editButtonText}>编辑名片</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  header: {
    minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAPHITE_COLORS.line, backgroundColor: GRAPHITE_COLORS.canvas,
  },
  headerAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  backMark: { color: GRAPHITE_COLORS.text, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: GRAPHITE_COLORS.text, fontSize: 17, fontWeight: "700" },
  content: { paddingHorizontal: 16, paddingTop: 22 },
  previewLabel: { color: GRAPHITE_COLORS.primary, fontSize: 12, fontWeight: "800" },
  previewHint: { marginTop: 6, color: GRAPHITE_COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  card: {
    marginTop: 18, paddingBottom: 26, overflow: "hidden", alignItems: "center",
    borderRadius: GRAPHITE_RADII.brand, borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong, backgroundColor: GRAPHITE_COLORS.surface,
  },
  bannerFrame: {
    width: "100%", height: 176, overflow: "hidden", backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  bannerImage: { width: "100%", height: "100%" },
  bannerFallback: { flex: 1, overflow: "hidden", backgroundColor: GRAPHITE_COLORS.surfaceStrong },
  bannerOrbLarge: {
    position: "absolute", width: 230, height: 230, borderRadius: 115,
    right: -42, top: -96, backgroundColor: "rgba(105,200,164,0.12)",
  },
  bannerOrbSmall: {
    position: "absolute", width: 130, height: 130, borderRadius: 65,
    left: -28, bottom: -69, backgroundColor: "rgba(52,92,76,0.26)",
  },
  avatar: {
    width: 88, height: 88, marginTop: -44, borderRadius: 44, overflow: "hidden",
    borderWidth: 4, borderColor: GRAPHITE_COLORS.surface, alignItems: "center", justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitials: { color: GRAPHITE_COLORS.text, fontSize: 24, fontWeight: "800" },
  name: { marginTop: 12, color: GRAPHITE_COLORS.text, fontSize: 22, fontWeight: "800" },
  username: { marginTop: 4, color: GRAPHITE_COLORS.textMuted, fontSize: 13 },
  status: {
    marginTop: 18, marginHorizontal: 22, color: GRAPHITE_COLORS.textMuted,
    fontSize: 14, lineHeight: 21, textAlign: "center",
  },
  visibilityNote: {
    marginTop: 14, paddingHorizontal: 18, paddingVertical: 16, borderRadius: GRAPHITE_RADII.control,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
  },
  visibilityTitle: { color: GRAPHITE_COLORS.text, fontSize: 13, fontWeight: "700" },
  visibilityCopy: { marginTop: 6, color: GRAPHITE_COLORS.textMuted, fontSize: 12, lineHeight: 19 },
  editButton: {
    minHeight: 52, marginTop: 18, borderRadius: GRAPHITE_RADII.control,
    alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.primary,
  },
  editButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 15, fontWeight: "800" },
});
