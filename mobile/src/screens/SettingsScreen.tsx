/** 设置页面 — 身份、通知状态、安全、本地聊天数据与账号操作。 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Switch,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../stores/AuthContext";
import { getLocalMessageStats } from "../services/db";
import { exportMessagesToFile } from "../services/export";
import { getStoredKeyPair } from "../services/keys";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreference,
  type KinPreferences,
} from "../services/preferences";

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
  danger: "#B43A33",
};

type BusyAction = "export" | "logout" | null;
type PreferenceKey = keyof KinPreferences;

function getInitials(name: string): string {
  return Array.from(name).slice(0, 2).join("").toUpperCase();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PreferenceRow({
  title,
  hint,
  value,
  disabled = false,
  loading = false,
  onValueChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  loading?: boolean;
  onValueChange?: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.accent} />
      ) : (
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ false: "#D8DBD7", true: "#A9DEC9" }}
          thumbColor={value ? COLORS.accent : "#FFFFFF"}
          accessibilityLabel={title}
          accessibilityState={{ disabled, checked: value }}
        />
      )}
    </View>
  );
}

function ActionRow({
  title,
  hint,
  value,
  onPress,
  destructive = false,
  loading = false,
  disabled = false,
}: {
  title: string;
  hint: string;
  value?: string;
  onPress: () => void;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: loading || disabled }}
    >
      <View style={styles.rowCopy}>
        <Text style={[
          styles.rowTitle,
          destructive && styles.dangerText,
          disabled && styles.disabledText,
        ]}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={destructive ? COLORS.danger : COLORS.accent} />
      ) : (
        <View style={styles.rowValueWrap}>
          {value ? <Text style={styles.rowValue}>{value}</Text> : null}
          {disabled ? null : (
            <Text style={[styles.chevron, destructive && styles.dangerText]}>›</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { state, logoutAction } = useAuth();
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [hasKeyPair, setHasKeyPair] = useState<boolean | null>(null);
  const [preferences, setPreferences] = useState<KinPreferences>(DEFAULT_PREFERENCES);
  const [busyPreference, setBusyPreference] = useState<PreferenceKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const user = state.user;
  const displayName = user?.nickname || user?.username || "Kin 用户";

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getLocalMessageStats(),
      getStoredKeyPair(),
      getPreferences(),
    ]).then(([statsResult, keyResult, preferencesResult]) => {
      if (!active) return;
      if (statsResult.status === "fulfilled") {
        setMessageCount(statsResult.value.messageCount);
        setConversationCount(statsResult.value.conversationCount);
      }
      if (keyResult.status === "fulfilled") {
        setHasKeyPair(!!keyResult.value);
      }
      if (preferencesResult.status === "fulfilled") {
        setPreferences(preferencesResult.value);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const handlePreferenceChange = async (key: PreferenceKey, value: boolean) => {
    if (busyPreference) return;
    const previous = preferences[key];
    setBusyPreference(key);
    setPreferences((current) => ({ ...current, [key]: value }));
    try {
      const saved = await updatePreference(key, value);
      setPreferences(saved);
    } catch {
      setPreferences((current) => ({ ...current, [key]: previous }));
      Alert.alert("设置未保存", "无法写入这台设备，请检查存储权限后重试。");
    } finally {
      setBusyPreference(null);
    }
  };

  const showEncryptionStatus = () => {
    if (hasKeyPair === null) {
      Alert.alert("暂时无法读取", "本机密钥状态读取失败，请重新进入设置页后再试。");
      return;
    }
    Alert.alert(
      hasKeyPair ? "本机密钥正常" : "本机密钥未建立",
      hasKeyPair
        ? "本机已保存端到端加密密钥。消息在发送设备上加密，在对方设备上解密。"
        : "当前设备没有完整密钥对。重新登录不会自动恢复其他设备上的私钥。"
    );
  };

  const handleExport = async () => {
    if (busyAction) return;
    setBusyAction("export");
    try {
      await exportMessagesToFile();
    } catch (error: any) {
      Alert.alert("导出失败", error.message || "请稍后重试");
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = () => {
    if (busyAction) return;
    Alert.alert(
      "退出 Kin",
      "本机聊天记录不会被删除。下次登录仍可读取这台设备上的历史消息。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出",
          style: "destructive",
          onPress: async () => {
            setBusyAction("logout");
            try {
              await logoutAction();
            } catch {
              setBusyAction(null);
              Alert.alert("退出失败", "请稍后重试。");
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={COLORS.accent} />
        <Text style={styles.loadingText}>正在读取本机设置</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>设置</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
      >
        <View style={styles.identity}>
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
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{displayName}</Text>
            <Text style={styles.identityUsername}>@{user?.username}</Text>
            <Text style={styles.identityStatus} numberOfLines={2}>
              {user?.status_msg || "还没有留下个性签名"}
            </Text>
          </View>
        </View>

        <Section title="通知与状态">
          <PreferenceRow
            title="消息提示音"
            hint="收到新消息时播放一声轻提示"
            value={preferences.messageSound}
            disabled={busyPreference !== null}
            loading={busyPreference === "messageSound"}
            onValueChange={(value) => { void handlePreferenceChange("messageSound", value); }}
          />
          <PreferenceRow
            title="好友上线提示音"
            hint="好友稳定上线后播放提示，短暂掉线不会打扰"
            value={preferences.friendOnlineSound}
            disabled={busyPreference !== null}
            loading={busyPreference === "friendOnlineSound"}
            onValueChange={(value) => { void handlePreferenceChange("friendOnlineSound", value); }}
          />
          <PreferenceRow
            title="触觉反馈"
            hint="Android 收到消息时提供一次短触觉"
            value={preferences.hapticFeedback}
            disabled={busyPreference !== null}
            loading={busyPreference === "hapticFeedback"}
            onValueChange={(value) => { void handlePreferenceChange("hapticFeedback", value); }}
          />
          <PreferenceRow
            title="展示在线状态"
            hint="等待服务端在线隐私控制接入"
            value={false}
            disabled
          />
        </Section>

        <Section title="安全">
          <ActionRow
            title="端到端加密"
            hint="查看本机密钥与消息保护范围"
            value={hasKeyPair === null ? "不可用" : hasKeyPair ? "正常" : "未建立"}
            onPress={showEncryptionStatus}
          />
          <ActionRow
            title="本地数据保护"
            hint="聊天正文保存在这台设备的 SQLite 中"
            onPress={() => Alert.alert(
              "本地数据保护",
              "Kin 的完整聊天记录主要保存在当前设备。请使用系统锁屏，并谨慎导出聊天备份。"
            )}
          />
        </Section>

        <Section title="聊天数据">
          <ActionRow
            title="导出全部消息"
            hint="导出当前设备数据库中的全部 Kin 消息"
            value={messageCount === null ? "未知" : `${messageCount} 条`}
            onPress={handleExport}
            loading={busyAction === "export"}
          />
          <ActionRow
            title="导入聊天备份"
            hint="等待系统文件选择器接入"
            value="暂不可用"
            onPress={() => {}}
            disabled
          />
          <ActionRow
            title="本地存储"
            hint={conversationCount === null
              ? "暂时无法读取本机消息统计"
              : `当前设备共 ${conversationCount} 个会话`}
            value={messageCount === null ? "未知" : `${messageCount} 条`}
            onPress={() => Alert.alert(
              "本地存储",
              "当前版本按设备保存聊天记录。清理单个会话请进入对应的会话详情页。"
            )}
          />
        </Section>

        <Section title="Kin">
          <ActionRow
            title="隐私说明"
            hint="了解服务器与本机分别保存什么"
            onPress={() => Alert.alert(
              "隐私说明",
              "聊天历史主要保存在你的设备。服务器只临时保存尚未送达的加密消息，并在接收设备确认保存后清除密文正文。"
            )}
          />
          <ActionRow
            title="关于 Kin"
            hint="只和现实中见过的人聊天"
            value="0.1.0"
            onPress={() => Alert.alert("Kin 0.1.0", "通过近距离碰一碰建立关系，以聊天为核心。")}
          />
          <ActionRow
            title="退出账号"
            hint="保留这台设备上的聊天记录"
            onPress={handleLogout}
            destructive
            loading={busyAction === "logout"}
          />
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: { marginTop: 12, color: COLORS.muted, fontSize: 13 },
  header: {
    minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
    backgroundColor: COLORS.background,
  },
  headerAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  content: { paddingBottom: 40 },
  identity: {
    minHeight: 128, paddingHorizontal: 20, paddingVertical: 24,
    flexDirection: "row", alignItems: "center",
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: "#28313A",
  },
  avatarImage: { width: 72, height: 72 },
  avatarInitials: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" },
  identityCopy: { flex: 1, marginLeft: 16 },
  identityName: { color: COLORS.ink, fontSize: 21, fontWeight: "700" },
  identityUsername: { marginTop: 2, color: COLORS.muted, fontSize: 13 },
  identityStatus: { marginTop: 9, color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  section: {
    marginTop: 12, backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
  },
  sectionTitle: {
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8,
    color: COLORS.faint, fontSize: 12, fontWeight: "700",
  },
  row: {
    minHeight: 68, marginLeft: 20, paddingRight: 17,
    flexDirection: "row", alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  rowCopy: { flex: 1, paddingVertical: 11, paddingRight: 12 },
  rowTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "500" },
  rowHint: { marginTop: 4, color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  rowValueWrap: { flexDirection: "row", alignItems: "center" },
  rowValue: { maxWidth: 90, color: COLORS.muted, fontSize: 13, textAlign: "right" },
  chevron: { marginLeft: 10, color: COLORS.faint, fontSize: 26, fontWeight: "300" },
  dangerText: { color: COLORS.danger },
  disabledText: { color: COLORS.faint },
});
