import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveMediaUrl } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { GRAPHITE_COLORS, GRAPHITE_RADII } from "../theme/graphite";

function initials(value: string): string {
  return Array.from(value).slice(0, 2).join("").toUpperCase();
}

const PROFILE_ACTIONS = [
  { key: "card", title: "我的名片", hint: "查看和调整身份展示", target: "ProfileEdit" },
  { key: "profile", title: "个人资料", hint: "昵称、状态和背景", target: "ProfileEdit" },
  { key: "notifications", title: "通知与状态", hint: "消息提醒与在线感知", target: "Settings" },
  { key: "security", title: "账户与安全", hint: "密钥和登录状态", target: "Settings" },
  { key: "data", title: "聊天数据", hint: "本地记录与导出", target: "Settings" },
  { key: "help", title: "帮助与法律", hint: "版本、帮助和隐私", target: "Settings" },
] as const;

export default function ProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const user = state.user;
  const displayName = user?.nickname || user?.username || "Kin 用户";
  const avatarUrl = resolveMediaUrl(user?.avatar);
  const bannerUrl = resolveMediaUrl(user?.profile_banner);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={[styles.banner, { paddingTop: Math.max(insets.top, 20) }]}>
            {bannerUrl ? (
              <Image
                source={{ uri: bannerUrl }}
                style={styles.bannerImage}
                resizeMode="cover"
                accessibilityLabel="我的背景名片"
              />
            ) : (
              <>
                <View style={styles.bannerFieldOne} />
                <View style={styles.bannerFieldTwo} />
              </>
            )}
            <View style={styles.bannerShade} />
            <View style={styles.profileHeader}>
              <View>
                <Text style={styles.kicker}>PROFILE CARD</Text>
                <Text style={styles.headerTitle}>我的</Text>
              </View>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => navigation.navigate("Settings")}
                accessibilityRole="button"
                accessibilityLabel="打开设置"
              >
                <View style={styles.settingsRing}>
                  <View style={styles.settingsCore} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.identityBody}>
            <View style={styles.avatarFrame}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatarImage}
                  accessibilityLabel={`${displayName}的头像`}
                />
              ) : (
                <Text style={styles.avatarInitials}>{initials(displayName)}</Text>
              )}
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.username}>@{user?.username || "unknown"}</Text>
              <View style={styles.onlineLine}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>当前在线</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => navigation.navigate("ProfileEdit")}
              accessibilityRole="button"
              accessibilityLabel="编辑个人资料"
            >
              <Text style={styles.editButtonText}>编辑</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.statusMessage}>
            {user?.status_msg || "写一句只属于此刻的状态。"}
          </Text>
        </View>

        <View style={styles.actionGrid}>
          {PROFILE_ACTIONS.map((action, index) => (
            <TouchableOpacity
              key={action.key}
              style={[
                styles.actionTile,
                index === 0 && styles.actionTilePrimary,
              ]}
              onPress={() => navigation.navigate(action.target)}
              accessibilityRole="button"
              accessibilityLabel={action.title}
              accessibilityHint={action.hint}
            >
              <View style={[styles.actionMark, index === 0 && styles.actionMarkPrimary]}>
                <Text style={[styles.actionMarkText, index === 0 && styles.actionMarkTextPrimary]}>
                  {index + 1}
                </Text>
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.actionHint}>{action.hint}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  scrollContent: { paddingBottom: 118 },
  profileCard: {
    marginHorizontal: 14,
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  banner: { minHeight: 210, overflow: "hidden", backgroundColor: GRAPHITE_COLORS.surfaceStrong },
  bannerImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  bannerFieldOne: { position: "absolute", width: 230, height: 230, top: -90, right: -60, borderRadius: 115, backgroundColor: "rgba(105,200,164,0.12)" },
  bannerFieldTwo: { position: "absolute", width: 180, height: 180, left: -65, bottom: -85, borderRadius: 90, backgroundColor: "rgba(52,92,76,0.20)" },
  bannerShade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(4,7,5,0.34)",
  },
  profileHeader: { paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { color: GRAPHITE_COLORS.primaryStrong, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  headerTitle: { marginTop: 4, color: GRAPHITE_COLORS.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  settingsButton: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,18,16,0.66)", borderWidth: 1, borderColor: GRAPHITE_COLORS.lineStrong },
  settingsRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: GRAPHITE_COLORS.textMuted, alignItems: "center", justifyContent: "center" },
  settingsCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: GRAPHITE_COLORS.textMuted },
  identityBody: { minHeight: 96, paddingHorizontal: 18, flexDirection: "row", alignItems: "center" },
  avatarFrame: { width: 78, height: 78, marginTop: -38, borderRadius: 39, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed, borderWidth: 4, borderColor: GRAPHITE_COLORS.surface },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitials: { color: GRAPHITE_COLORS.text, fontSize: 22, fontWeight: "800" },
  identityCopy: { flex: 1, minWidth: 0, marginLeft: 12 },
  name: { color: GRAPHITE_COLORS.text, fontSize: 19, fontWeight: "800" },
  username: { marginTop: 2, color: GRAPHITE_COLORS.textMuted, fontSize: 12 },
  onlineLine: { marginTop: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GRAPHITE_COLORS.primary },
  onlineText: { color: GRAPHITE_COLORS.primary, fontSize: 11, fontWeight: "700" },
  editButton: { minWidth: 54, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: GRAPHITE_COLORS.lineStrong },
  editButtonText: { color: GRAPHITE_COLORS.textMuted, fontSize: 12, fontWeight: "700" },
  statusMessage: { marginHorizontal: 18, marginBottom: 20, color: GRAPHITE_COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  actionGrid: { margin: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionTile: { width: "48%", minHeight: 132, flexGrow: 1, padding: 16, borderRadius: GRAPHITE_RADII.control, borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.line, backgroundColor: GRAPHITE_COLORS.surface },
  actionTilePrimary: { borderColor: GRAPHITE_COLORS.primaryLine, backgroundColor: GRAPHITE_COLORS.primarySoft },
  actionMark: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed },
  actionMarkPrimary: { backgroundColor: GRAPHITE_COLORS.primary },
  actionMarkText: { color: GRAPHITE_COLORS.textMuted, fontSize: 11, fontWeight: "800" },
  actionMarkTextPrimary: { color: GRAPHITE_COLORS.onPrimary },
  actionTitle: { marginTop: 14, color: GRAPHITE_COLORS.text, fontSize: 14, fontWeight: "800" },
  actionHint: { marginTop: 5, color: GRAPHITE_COLORS.textMuted, fontSize: 11, lineHeight: 17 },
});
