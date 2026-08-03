/** 设置页面 — 身份、通知状态、安全、本地聊天数据与账号操作。 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Switch,
  Linking, Text, TouchableOpacity, View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveMediaUrl } from "../api/client";
import KinDialog, { type KinDialogAction } from "../components/KinDialog";
import { useAuth } from "../stores/AuthContext";
import { clearAllMessages, getLocalMessageStats } from "../services/db";
import { exportMessagesToFile } from "../services/export";
import { getStoredKeyPair } from "../services/keys";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreference,
  type KinPreferences,
} from "../services/preferences";
import {
  enablePushNotifications,
  getPushNotificationStatus,
  type PushNotificationStatus,
} from "../services/notifications";
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

type BusyAction = "export" | "clear-all" | "logout" | null;
type PreferenceKey = keyof KinPreferences;
type DialogState = { title: string; message: string; actions?: KinDialogAction[] } | null;
type SettingsPageKind = "overview" | "notifications" | "security" | "data" | "help";

const PAGE_BY_ROUTE: Record<string, { title: string; kind: SettingsPageKind }> = {
  Settings: { title: "设置", kind: "overview" },
  NotificationSettings: { title: "通知与状态", kind: "notifications" },
  AccountSecurity: { title: "账户与安全", kind: "security" },
  ChatDataSettings: { title: "聊天数据", kind: "data" },
  HelpLegal: { title: "帮助与法律", kind: "help" },
};

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
          trackColor={{ false: GRAPHITE_COLORS.surfacePressed, true: GRAPHITE_COLORS.primaryDeep }}
          thumbColor={value ? COLORS.accent : GRAPHITE_COLORS.textMuted}
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
      style={[styles.row, (loading || disabled) && styles.rowDisabled]}
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

export default function SettingsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { state, logoutAction } = useAuth();
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [hasKeyPair, setHasKeyPair] = useState<boolean | null>(null);
  const [preferences, setPreferences] = useState<KinPreferences>(DEFAULT_PREFERENCES);
  const [busyPreference, setBusyPreference] = useState<PreferenceKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [pushStatus, setPushStatus] = useState<PushNotificationStatus>("error");
  const [pushBusy, setPushBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const user = state.user;
  const displayName = user?.nickname || user?.username || "Kin 用户";
  const avatarUrl = resolveMediaUrl(user?.avatar);
  const currentPage = PAGE_BY_ROUTE[route?.name] || PAGE_BY_ROUTE.Settings;
  const showDialog = (title: string, message: string, actions?: KinDialogAction[]) => {
    setDialog({ title, message, actions });
  };

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let active = true;
    Promise.allSettled([
      getLocalMessageStats(user.id),
      getStoredKeyPair(user.id),
      getPreferences(),
      getPushNotificationStatus(),
    ]).then(([statsResult, keyResult, preferencesResult, pushResult]) => {
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
      if (pushResult.status === "fulfilled") setPushStatus(pushResult.value);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id]);

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
      showDialog("设置未保存", "无法写入这台设备，请检查存储权限后重试。");
    } finally {
      setBusyPreference(null);
    }
  };

  const showEncryptionStatus = () => {
    if (hasKeyPair === null) {
      showDialog("暂时无法读取", "本机密钥状态读取失败，请重新进入设置页后再试。");
      return;
    }
    showDialog(
      hasKeyPair ? "本机密钥正常" : "本机密钥未建立",
      hasKeyPair
        ? "本机已保存端到端加密密钥。消息在发送设备上加密，在对方设备上解密。"
        : "当前设备没有完整密钥对。重新登录不会自动恢复其他设备上的私钥。"
    );
  };

  const handleSystemNotifications = async () => {
    if (pushBusy) return;
    if (pushStatus === "enabled") {
      showDialog("系统通知已开启", "Kin 可以在后台通过系统通知提醒你收到的新消息和语音来电。", [
        { text: "知道了", tone: "cancel" },
        { text: "系统设置", onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    if (pushStatus === "denied") {
      showDialog("系统通知已关闭", "请前往系统设置允许 Kin 发送通知。", [
        { text: "取消", tone: "cancel" },
        { text: "打开设置", onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    if (pushStatus === "simulator") {
      showDialog("需要真机", "远程系统推送不能在模拟器中注册，请使用安装了 Kin 开发版本的真实手机测试。");
      return;
    }
    if (pushStatus === "unsupported") {
      showDialog("当前平台不支持", "Kin Web 演示页不会注册手机系统通知。");
      return;
    }
    setPushBusy(true);
    const nextStatus = await enablePushNotifications();
    setPushStatus(nextStatus);
    setPushBusy(false);
    if (nextStatus === "enabled") {
      showDialog("系统通知已开启", "新消息和语音来电现在可以通过系统通知提醒你。");
    } else if (nextStatus === "unconfigured") {
      showDialog("等待推送服务配置", "通知权限已经准备好，但当前开发版本还没有配置 Expo EAS projectId。配置后重新进入 Kin 即可注册。");
    } else if (nextStatus === "denied") {
      showDialog("未获得通知权限", "你可以稍后在系统设置中允许 Kin 发送通知。");
    } else {
      showDialog("暂时无法开启", "请检查网络和项目推送配置后重试。");
    }
  };

  const pushStatusCopy: Record<PushNotificationStatus, { value: string; hint: string }> = {
    enabled: { value: "已开启", hint: "后台接收新消息和语音来电提醒" },
    not_requested: { value: "未开启", hint: "点击后由系统询问通知权限" },
    denied: { value: "已关闭", hint: "需要前往系统设置重新允许" },
    simulator: { value: "需要真机", hint: "模拟器无法注册远程推送 Token" },
    unconfigured: { value: "待配置", hint: "通知权限可用，等待 EAS projectId" },
    unsupported: { value: "不支持", hint: "当前平台不提供手机系统通知" },
    error: { value: "重试", hint: "暂时无法读取系统通知状态" },
  };

  const handleExport = async () => {
    if (busyAction) return;
    if (!user?.id) {
      showDialog("导出失败", "当前账号状态不可用，请重新登录后再试。");
      return;
    }
    setBusyAction("export");
    try {
      await exportMessagesToFile(user.id);
    } catch (error: any) {
      showDialog("导出失败", error.message || "请稍后重试");
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = () => {
    if (busyAction) return;
    showDialog(
      "退出 Kin",
      "本机聊天记录不会被删除。下次使用同一账号登录时，仍可读取该账号在这台设备上的历史消息。",
      [
        { text: "取消", tone: "cancel" },
        {
          text: "退出",
          tone: "destructive",
          onPress: async () => {
            setBusyAction("logout");
            try {
              await logoutAction();
            } catch {
              setBusyAction(null);
              showDialog("退出失败", "请稍后重试。");
            }
          },
        },
      ]
    );
  };

  const handleClearAllMessages = () => {
    if (busyAction || !user?.id) return;
    showDialog(
      "清空当前账号的全部聊天记录？",
      "这会从当前设备删除此账号的全部聊天消息。其他账号、好友关系和对方设备上的记录不会受到影响；该操作无法撤销。",
      [
        { text: "取消", tone: "cancel" },
        {
          text: "确认清空",
          tone: "destructive",
          onPress: async () => {
            setBusyAction("clear-all");
            try {
              await clearAllMessages(user.id);
              setMessageCount(0);
              setConversationCount(0);
              setBusyAction(null);
              showDialog("本地聊天记录已清空", "当前账号在这台设备上的聊天消息已经删除。其他账号的数据没有变化。");
            } catch {
              setBusyAction(null);
              showDialog("清空失败", "无法修改当前账号的本地聊天记录，请稍后重试。");
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        {isFocused ? <ExpoStatusBar style="light" /> : null}
        <ActivityIndicator size="small" color={COLORS.accent} />
        <Text style={styles.loadingText}>正在读取本机设置</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回上一页"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{currentPage.title}</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
      >
        {currentPage.kind === "overview" ? (
          <>
            <TouchableOpacity
              style={styles.identity}
              onPress={() => navigation.navigate("ProfileEdit")}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel="编辑个人资料"
              accessibilityHint="修改头像、背景、昵称和个性签名"
            >
              <View style={styles.avatar}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImage} accessibilityLabel={`${displayName}的头像`} />
                ) : (
                  <Text style={styles.avatarInitials}>{getInitials(displayName)}</Text>
                )}
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.identityName}>{displayName}</Text>
                <Text style={styles.identityUsername}>@{user?.username}</Text>
                <Text style={styles.identityStatus} numberOfLines={2}>{user?.status_msg || "还没有留下个性签名"}</Text>
              </View>
              <Text style={styles.identityEdit}>编辑</Text>
            </TouchableOpacity>
            <Section title="身份展示">
              <ActionRow title="我的名片" hint="以好友视角查看自己的名片" onPress={() => navigation.navigate("MyProfileCard")} />
              <ActionRow title="个人资料" hint="修改头像、背景、昵称和个性签名" onPress={() => navigation.navigate("ProfileEdit")} />
            </Section>
            <Section title="账户与应用">
              <ActionRow title="通知与状态" hint="消息提醒、声音、触觉与在线状态" onPress={() => navigation.navigate("NotificationSettings")} />
              <ActionRow title="账户与安全" hint="登录账号、密钥和本地数据保护" onPress={() => navigation.navigate("AccountSecurity")} />
              <ActionRow title="聊天数据" hint="本机记录、统计、导入和导出" onPress={() => navigation.navigate("ChatDataSettings")} />
              <ActionRow title="帮助与法律" hint="使用帮助、隐私、协议和版本" onPress={() => navigation.navigate("HelpLegal")} />
            </Section>
          </>
        ) : null}

        {currentPage.kind === "notifications" ? <Section title="提醒方式">
          <ActionRow
            title="系统通知"
            hint={pushStatusCopy[pushStatus].hint}
            value={pushStatusCopy[pushStatus].value}
            onPress={() => { void handleSystemNotifications(); }}
            loading={pushBusy}
          />
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
        </Section> : null}

        {currentPage.kind === "security" ? <>
          <Section title="账户">
            <ActionRow
              title="当前登录账号"
              hint="测试阶段账号与设备登录状态"
              value={`@${user?.username || "unknown"}`}
              onPress={() => showDialog("当前登录账号", `你正在使用 @${user?.username || "unknown"} 登录 Kin。`)}
            />
            <ActionRow
              title="密码与找回"
              hint="测试阶段暂不提供修改密码和找回密码"
              value="暂缓"
              onPress={() => {}}
              disabled
            />
          </Section>
          <Section title="消息保护">
          <ActionRow
            title="端到端加密"
            hint="查看本机密钥与消息保护范围"
            value={hasKeyPair === null ? "不可用" : hasKeyPair ? "正常" : "未建立"}
            onPress={showEncryptionStatus}
          />
          <ActionRow
            title="本地数据保护"
            hint="聊天正文保存在这台设备的 SQLite 中"
            onPress={() => showDialog(
              "本地数据保护",
              "Kin 的完整聊天记录主要保存在当前设备。请使用系统锁屏，并谨慎导出聊天备份。"
            )}
          />
          </Section>
          <Section title="登录操作">
            <ActionRow
              title="退出账号"
              hint="保留这台设备上属于当前账号的聊天记录"
              onPress={handleLogout}
              destructive
              loading={busyAction === "logout"}
            />
          </Section>
        </> : null}

        {currentPage.kind === "data" ? <Section title="本机聊天记录">
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
            onPress={() => showDialog(
              "本地存储",
              "当前版本按设备保存聊天记录。清理单个会话请进入对应的会话详情页。"
            )}
          />
          <ActionRow
            title="清空全部本地聊天记录"
            hint="只删除当前账号在这台设备上的消息"
            onPress={handleClearAllMessages}
            destructive
            loading={busyAction === "clear-all"}
          />
        </Section> : null}

        {currentPage.kind === "help" ? <>
          <Section title="使用帮助">
            <ActionRow
              title="如何添加好友"
              hint="了解碰一碰与备用配对码流程"
              onPress={() => showDialog("如何添加好友", "双方主动开启碰一碰并发现彼此后，需要分别确认名片才会成为好友。NFC 不可用时，可以使用临时配对码完成相同流程。")}
            />
            <ActionRow
              title="聊天记录保存在什么位置"
              hint="了解本机记录和服务器临时消息"
              onPress={() => showDialog("聊天记录保存位置", "完整聊天记录主要保存在当前设备，并按登录账号隔离。服务器只临时保存尚未送达的加密消息。")}
            />
          </Section>
          <Section title="法律与版本">
          <ActionRow
            title="隐私说明"
            hint="了解服务器与本机分别保存什么"
            onPress={() => showDialog(
              "隐私说明",
              "聊天历史主要保存在你的设备。服务器只临时保存尚未送达的加密消息，并在接收设备确认保存后清除密文正文。"
            )}
          />
          <ActionRow
            title="用户协议"
            hint="查看当前测试版本的使用边界"
            onPress={() => showDialog("用户协议 · 测试版", "Kin 当前处于开发测试阶段，仅用于功能验证。请勿在测试账号中保存重要、敏感或不可恢复的信息。")}
          />
          <ActionRow
            title="开源许可"
            hint="查看 Kin 使用的开源软件说明"
            onPress={() => showDialog("开源许可", "Kin 使用 React Native、Expo、FastAPI 等开源软件。正式发布前将在此提供完整依赖与许可清单。")}
          />
          <ActionRow
            title="关于 Kin"
            hint="只和现实中见过的人聊天"
            value="0.1.0"
            onPress={() => showDialog("Kin 0.1.0", "通过近距离碰一碰建立关系，以聊天为核心。")}
          />
          </Section>
        </> : null}
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
  headerAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  content: { paddingBottom: 40 },
  identity: {
    minHeight: 128, paddingHorizontal: 20, paddingVertical: 24,
    flexDirection: "row", alignItems: "center",
    backgroundColor: GRAPHITE_COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAPHITE_COLORS.line,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed,
    borderWidth: 3, borderColor: GRAPHITE_COLORS.surfaceStrong,
  },
  avatarImage: { width: 72, height: 72 },
  avatarInitials: { color: GRAPHITE_COLORS.text, fontSize: 22, fontWeight: "800" },
  identityCopy: { flex: 1, marginLeft: 16 },
  identityName: { color: COLORS.ink, fontSize: 21, fontWeight: "700" },
  identityUsername: { marginTop: 2, color: COLORS.muted, fontSize: 13 },
  identityStatus: { marginTop: 9, color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  identityEdit: {
    minWidth: 48, minHeight: 48, marginLeft: 12,
    color: COLORS.accentDark, fontSize: 13, fontWeight: "800",
    textAlign: "center", textAlignVertical: "center",
  },
  section: {
    marginTop: 14, marginHorizontal: 14, overflow: "hidden",
    borderRadius: 18, backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
  },
  sectionTitle: {
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8,
    color: COLORS.faint, fontSize: 12, fontWeight: "700",
  },
  row: {
    minHeight: 72, marginLeft: 18, paddingRight: 16,
    flexDirection: "row", alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  rowCopy: { flex: 1, paddingVertical: 11, paddingRight: 12 },
  rowTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "600" },
  rowHint: { marginTop: 4, color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  rowValueWrap: { flexDirection: "row", alignItems: "center" },
  rowValue: { maxWidth: 90, color: COLORS.muted, fontSize: 13, textAlign: "right" },
  chevron: { marginLeft: 10, color: COLORS.faint, fontSize: 26, fontWeight: "300" },
  dangerText: { color: COLORS.danger },
  disabledText: { color: COLORS.faint },
  rowDisabled: { opacity: 0.52 },
});
