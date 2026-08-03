/** 会话详情 — 关系补充信息、隐私说明与本地聊天数据操作 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Friend } from "../api/client";
import { deleteFriend, resolveMediaUrl } from "../api/client";
import { kinWS } from "../api/ws";
import KinDialog, { type KinDialogAction } from "../components/KinDialog";
import { clearMessages } from "../services/db";
import { exportConversationToFile } from "../services/export";
import { getSecretKey } from "../services/keys";
import { mergeFriendProfile, parseFriendProfileEvent } from "../services/friendProfile";
import { useAuth } from "../stores/AuthContext";
import { GRAPHITE_COLORS } from "../theme/graphite";

const COLORS = {
  background: GRAPHITE_COLORS.canvas,
  surface: GRAPHITE_COLORS.surface,
  ink: GRAPHITE_COLORS.text,
  muted: GRAPHITE_COLORS.textMuted,
  faint: GRAPHITE_COLORS.textFaint,
  line: GRAPHITE_COLORS.line,
  accent: GRAPHITE_COLORS.primary,
  accentDark: GRAPHITE_COLORS.primaryStrong,
  accentSoft: GRAPHITE_COLORS.primarySoft,
  danger: GRAPHITE_COLORS.danger,
};

type DialogState = { title: string; message: string; actions?: KinDialogAction[] } | null;

function displayName(friend: Friend): string {
  return friend.nickname || friend.username;
}

function initials(friend: Friend): string {
  return Array.from(displayName(friend)).slice(0, 2).join("").toUpperCase();
}

function formatMeetTime(value?: string): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
  }).format(date);
}

function LockMark({ protectedChat }: { protectedChat: boolean }) {
  return (
    <View style={styles.lockIcon}>
      <View style={[styles.lockLoop, !protectedChat && styles.lockMuted]} />
      <View style={[styles.lockBody, !protectedChat && styles.lockBodyMuted]} />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  title,
  hint,
  onPress,
  destructive = false,
  loading = false,
}: {
  title: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, loading && styles.rowDisabled]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: loading }}
    >
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, destructive && styles.dangerText]}>{title}</Text>
        <Text style={styles.actionHint}>{hint}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.accent} />
      ) : (
        <Text style={[styles.chevron, destructive && styles.dangerText]}>›</Text>
      )}
    </TouchableOpacity>
  );
}

export default function ConversationDetailsScreen({ route, navigation }: any) {
  const { state } = useAuth();
  const [friend, setFriend] = useState<Friend>((route.params as { friend: Friend }).friend);
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [busyAction, setBusyAction] = useState<"export" | "clear" | "delete" | null>(null);
  const [localKeyState, setLocalKeyState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [dialog, setDialog] = useState<DialogState>(null);
  const name = displayName(friend);
  const isProtected = !!friend.public_key && localKeyState === "ready";
  const securityTitle = isProtected
    ? "仅你和对方可读取"
    : localKeyState === "loading"
      ? "正在验证加密保护"
      : "尚未建立加密保护";
  const securityHint = !friend.public_key
    ? "好友资料中暂无可用的加密公钥"
    : localKeyState === "missing"
      ? "当前设备缺少加密密钥"
      : localKeyState === "error"
        ? "无法读取当前设备的加密密钥"
        : localKeyState === "loading"
          ? "正在读取当前设备的安全存储"
          : "查看这段会话如何受到保护";
  const showDialog = (title: string, message: string, actions?: KinDialogAction[]) => {
    setDialog({ title, message, actions });
  };

  useEffect(() => {
    const ownerId = state.user?.id;
    if (!ownerId) {
      setLocalKeyState("missing");
      return;
    }
    let active = true;
    getSecretKey(ownerId)
      .then((secretKey) => {
        if (active) setLocalKeyState(secretKey ? "ready" : "missing");
      })
      .catch(() => {
        if (active) setLocalKeyState("error");
      });
    return () => { active = false; };
  }, [state.user?.id]);

  useEffect(() => {
    const onFriendProfile = (data: any) => {
      const update = parseFriendProfileEvent(data);
      if (update?.user_id === friend.user_id) {
        setFriend((current) => mergeFriendProfile(current, update));
      }
    };
    kinWS.on("friend_profile", onFriendProfile);
    return () => kinWS.off("friend_profile", onFriendProfile);
  }, [friend.user_id]);

  const showEncryptionDetails = () => {
    showDialog(
      securityTitle,
      isProtected
        ? "新消息会在发送设备上加密，并在对方设备上解密。Kin 服务器只负责转发加密后的内容。"
        : securityHint
    );
  };

  const handleExport = async () => {
    if (busyAction) return;
    const ownerId = state.user?.id;
    if (!ownerId) {
      showDialog("导出失败", "当前账号状态不可用，请重新登录后再试。");
      return;
    }
    setBusyAction("export");
    try {
      const count = await exportConversationToFile(ownerId, friend.user_id, name);
      if (count === 0) showDialog("暂无聊天记录", "当前会话还没有可导出的本地消息。");
    } catch (error: any) {
      showDialog("导出失败", error.message || "请稍后重试");
    } finally {
      setBusyAction(null);
    }
  };

  const handleClear = () => {
    if (busyAction) return;
    showDialog(
      "清空本地聊天记录",
      `将从这台设备删除与${name}的全部聊天记录。该操作无法撤销。`,
      [
        { text: "取消", tone: "cancel" },
        {
          text: "清空",
          tone: "destructive",
          onPress: async () => {
            const ownerId = state.user?.id;
            if (!ownerId) {
              showDialog("清空失败", "当前账号状态不可用，请重新登录后再试。");
              return;
            }
            setBusyAction("clear");
            try {
              await clearMessages(ownerId, friend.user_id);
              navigation.popTo("Chat", {
                friend,
                historyClearedAt: Date.now(),
              });
            } catch (error: any) {
              showDialog("清空失败", error.message || "请稍后重试");
              setBusyAction(null);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (busyAction) return;
    showDialog(
      "删除好友",
      `删除${name}后，你们将不能继续聊天。此操作不会自动清空本机已有记录。`,
      [
        { text: "取消", tone: "cancel" },
        {
          text: "删除",
          tone: "destructive",
          onPress: async () => {
            setBusyAction("delete");
            try {
              await deleteFriend(friend.user_id);
              navigation.popToTop();
            } catch (error: any) {
              showDialog("删除失败", error.message || "请稍后重试");
              setBusyAction(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回聊天"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>好友资料</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
      >
        <View style={styles.identity}>
          <View style={styles.profileBanner}>
            {friend.profile_banner ? (
              <Image
                source={{ uri: resolveMediaUrl(friend.profile_banner) || friend.profile_banner }}
                style={styles.profileBannerImage}
                resizeMode="contain"
                accessibilityLabel={`${name}的背景名片`}
              />
            ) : (
              <View style={styles.profileBannerFallback}>
                <View style={styles.bannerOrbLarge} />
                <View style={styles.bannerOrbSmall} />
              </View>
            )}
          </View>
          <View style={styles.avatarFrame}>
            {friend.avatar ? (
              <Image
                source={{ uri: resolveMediaUrl(friend.avatar) || friend.avatar }}
                style={styles.avatarImage}
                accessibilityLabel={`${name}的头像`}
              />
            ) : (
              <Text style={styles.avatarInitials}>{initials(friend)}</Text>
            )}
            <View style={[styles.presenceDot, friend.is_online ? styles.onlineDot : styles.offlineDot]} />
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.username}>@{friend.username}</Text>
          <Text style={styles.statusMessage}>{friend.status_msg || "还没有留下个性签名"}</Text>
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => navigation.navigate("Chat", { friend })}
            accessibilityRole="button"
            accessibilityLabel={`给${name}发消息`}
          >
            <Text style={styles.messageButtonText}>发消息</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关系</Text>
          <DetailRow label="好友备注" value={friend.nickname || "未设置"} />
          <DetailRow label="相识时间" value={formatMeetTime(friend.meet_at)} />
          <DetailRow label="相识备注" value="暂无记录" />
        </View>

        <TouchableOpacity
          style={[styles.securityBand, !isProtected && styles.securityBandMuted]}
          onPress={showEncryptionDetails}
          accessibilityRole="button"
          accessibilityLabel={isProtected ? "查看会话加密说明" : "查看当前加密状态"}
        >
          <LockMark protectedChat={isProtected} />
          <View style={styles.securityCopy}>
            <Text style={[styles.securityTitle, !isProtected && styles.securityTitleMuted]}>
              {securityTitle}
            </Text>
            <Text style={styles.securityHint}>
              {securityHint}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>聊天数据</Text>
          <ActionRow
            title="导出当前会话"
            hint="生成只包含这段会话的 JSON 文件"
            onPress={handleExport}
            loading={busyAction === "export"}
          />
          <ActionRow
            title="清空本地聊天记录"
            hint="仅删除这台设备上的消息"
            onPress={handleClear}
            loading={busyAction === "clear"}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>好友关系</Text>
          <ActionRow
            title="删除好友"
            hint="删除后将无法继续发送消息"
            onPress={handleDelete}
            destructive
            loading={busyAction === "delete"}
          />
        </View>
      </ScrollView>
      <KinDialog
        visible={!!dialog}
        title={dialog?.title || ""}
        message={dialog?.message || ""}
        actions={dialog?.actions}
        onClose={() => setDialog(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
    backgroundColor: COLORS.background,
  },
  headerAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  content: { paddingBottom: 40 },
  identity: {
    marginHorizontal: 14, overflow: "hidden", alignItems: "center", paddingBottom: 24,
    borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  profileBanner: {
    width: "100%", height: 168, overflow: "hidden",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  profileBannerImage: { width: "100%", height: "100%" },
  profileBannerFallback: { flex: 1, backgroundColor: GRAPHITE_COLORS.surfaceStrong, overflow: "hidden" },
  bannerOrbLarge: {
    position: "absolute", width: 230, height: 230, borderRadius: 115,
    right: -42, top: -96, backgroundColor: "rgba(105,200,164,0.12)",
  },
  bannerOrbSmall: {
    position: "absolute", width: 130, height: 130, borderRadius: 65,
    left: -28, bottom: -69, backgroundColor: "rgba(52,92,76,0.26)",
  },
  avatarFrame: {
    width: 82, height: 82, marginTop: -41, borderRadius: 41,
    borderWidth: 4, borderColor: COLORS.surface, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitials: { color: GRAPHITE_COLORS.text, fontSize: 24, fontWeight: "800" },
  presenceDot: {
    position: "absolute", right: 1, bottom: 4,
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 3, borderColor: COLORS.surface,
  },
  onlineDot: { backgroundColor: COLORS.accent },
  offlineDot: { backgroundColor: COLORS.faint },
  name: { marginTop: 15, color: COLORS.ink, fontSize: 22, fontWeight: "700" },
  username: { marginTop: 3, color: COLORS.muted, fontSize: 14 },
  statusMessage: {
    marginTop: 12, paddingHorizontal: 24, color: COLORS.muted, fontSize: 14, lineHeight: 20,
    textAlign: "center",
  },
  messageButton: {
    minWidth: 132, minHeight: 48, marginTop: 18, paddingHorizontal: 24,
    borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.primary,
  },
  messageButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 14, fontWeight: "800" },
  section: {
    marginTop: 14, marginHorizontal: 14, overflow: "hidden",
    borderRadius: 18, backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
  },
  sectionTitle: {
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 9,
    color: COLORS.faint, fontSize: 12, fontWeight: "700",
  },
  detailRow: {
    minHeight: 52, marginLeft: 20, paddingRight: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  detailLabel: { color: COLORS.ink, fontSize: 15 },
  detailValue: { maxWidth: "62%", color: COLORS.muted, fontSize: 14, textAlign: "right" },
  securityBand: {
    minHeight: 76, marginTop: 16, marginHorizontal: 14, paddingHorizontal: 18,
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.accentSoft,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 18,
    borderColor: GRAPHITE_COLORS.primaryLine,
  },
  securityBandMuted: { backgroundColor: GRAPHITE_COLORS.surface, borderColor: GRAPHITE_COLORS.lineStrong },
  lockIcon: { width: 30, height: 32, marginRight: 12, alignItems: "center", justifyContent: "flex-end" },
  lockLoop: {
    position: "absolute", top: 2, width: 15, height: 15,
    borderWidth: 2, borderBottomWidth: 0, borderColor: COLORS.accentDark,
    borderTopLeftRadius: 8, borderTopRightRadius: 8,
  },
  lockMuted: { borderColor: COLORS.muted },
  lockBody: { width: 22, height: 17, borderRadius: 5, backgroundColor: COLORS.accentDark },
  lockBodyMuted: { backgroundColor: COLORS.muted },
  securityCopy: { flex: 1 },
  securityTitle: { color: COLORS.accentDark, fontSize: 15, fontWeight: "700" },
  securityTitleMuted: { color: COLORS.ink },
  securityHint: { marginTop: 3, color: COLORS.muted, fontSize: 12 },
  actionRow: {
    minHeight: 70, marginLeft: 20, paddingRight: 17,
    flexDirection: "row", alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  actionCopy: { flex: 1, paddingVertical: 11 },
  actionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "500" },
  actionHint: { marginTop: 4, color: COLORS.muted, fontSize: 12 },
  chevron: { marginLeft: 12, color: COLORS.faint, fontSize: 26, fontWeight: "300" },
  dangerText: { color: COLORS.danger },
  rowDisabled: { opacity: 0.48 },
});
