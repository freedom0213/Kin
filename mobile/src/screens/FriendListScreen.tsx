/** 会话列表页面 — Online / Offline 分组 + 本地消息摘要 */

import React, {
  useState, useCallback, useEffect, useMemo, useRef,
} from "react";
import {
  View, Text, SectionList, TouchableOpacity, Image,
  StyleSheet, Alert, RefreshControl, Animated, AccessibilityInfo,
} from "react-native";
import type { ImageStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getFriendList, deleteFriend, Friend } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { kinWS } from "../api/ws";
import {
  ConversationSummary, getConversationSummaries,
} from "../services/db";

const COLORS = {
  background: "#F4F5F2",
  surface: "#FFFFFF",
  ink: "#171A1F",
  muted: "#70757D",
  faint: "#A5A9AE",
  line: "#E4E6E2",
  accent: "#2DAD82",
  accentSoft: "#DDF3EB",
};

function getDisplayName(friend: Friend): string {
  return friend.nickname || friend.username;
}

function getInitials(friend: Friend): string {
  return Array.from(getDisplayName(friend)).slice(0, 2).join("").toUpperCase();
}

function formatConversationTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );

  if (dayDiff === 0) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (dayDiff === 1) return "昨天";
  if (dayDiff > 1 && dayDiff < 7) {
    return `周${"日一二三四五六"[date.getDay()]}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getMessagePreview(summary?: ConversationSummary): string {
  if (!summary) return "开始聊天";
  const message = summary.last_message;
  if (message.type === "voice") {
    return `[语音] ${Math.max(1, Math.round(message.duration || 0))}″`;
  }
  return message.content || "[空消息]";
}

function getSummaryStatus(summary: ConversationSummary | undefined, currentUserId: string): string {
  const message = summary?.last_message;
  if (!message || message.sender_id !== currentUserId) return "";
  if (message.delivery_status === "sending" || message.delivery_status === "queued") return "◷";
  if (message.delivery_status === "failed") return "!";
  if (message.delivery_status === "read" || message.is_read) return "✓✓";
  return "✓";
}

function FriendAvatar({
  friend,
  reduceMotion,
}: {
  friend: Friend;
  reduceMotion: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!friend.is_online || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [friend.is_online, pulse, reduceMotion]);

  const ringStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.48, 0.08] }),
    transform: [{
      scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }),
    }],
  };

  return (
    <View style={styles.avatarFrame}>
      {friend.is_online ? (
        <Animated.View style={[styles.pulseRing, ringStyle]} />
      ) : null}
      <View style={[styles.avatar, !friend.is_online && styles.avatarOffline]}>
        {friend.avatar ? (
          <Image
            source={{ uri: friend.avatar }}
            style={styles.avatarImage as ImageStyle}
            accessibilityLabel={`${getDisplayName(friend)}的头像`}
          />
        ) : (
          <Text style={styles.avatarInitials}>{getInitials(friend)}</Text>
        )}
      </View>
      <View
        style={[
          styles.presenceDot,
          friend.is_online ? styles.presenceOnline : styles.presenceOffline,
        ]}
      />
    </View>
  );
}

export default function FriendListScreen({ navigation }: any) {
  const { state } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const data = await getFriendList();
      setFriends(data.friends);
      const nextSummaries = await getConversationSummaries(
        data.friends.map((friend) => friend.user_id),
        state.user?.id || ""
      );
      setSummaries(nextSummaries);
    } catch { /* 忽略 */ }
  }, [state.user?.id]);

  // 每次页面获得焦点时刷新
  useFocusEffect(
    useCallback(() => { loadFriends(); }, [loadFriends])
  );

  // 监听来电（WebRTC incoming call）
  useEffect(() => {
    const onIncomingCall = (data: any) => {
      const callerName = data.caller_name || "未知用户";
      // 跳转到语音通话页面（来电方）
      navigation.navigate("VoiceCall", {
        direction: "incoming",
        targetId: data.from,
        targetName: callerName,
      });
    };
    kinWS.on("incoming_call", onIncomingCall);
    return () => { kinWS.off("incoming_call", onIncomingCall); };
  }, [navigation]);

  // 好友状态变化时立即在 Online / Offline 分组之间更新
  useEffect(() => {
    const onFriendStatus = (data: any) => {
      setFriends((current) => current.map((friend) => (
        friend.user_id === data.user_id
          ? { ...friend, is_online: !!data.is_online }
          : friend
      )));
    };
    kinWS.on("friend_status", onFriendStatus);
    return () => kinWS.off("friend_status", onFriendStatus);
  }, []);

  // 全局收件箱在任何页面收到消息后，立即刷新最后消息与未读数。
  useEffect(() => {
    const onInboxMessage = () => { void loadFriends(); };
    kinWS.on("inbox_message", onInboxMessage);
    return () => kinWS.off("inbox_message", onInboxMessage);
  }, [loadFriends]);

  useEffect(() => {
    const onFriendAdded = () => { void loadFriends(); };
    kinWS.on("friend_added", onFriendAdded);
    return () => kinWS.off("friend_added", onFriendAdded);
  }, [loadFriends]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFriends();
    setRefreshing(false);
  };

  const handleDelete = (friend: Friend) => {
    Alert.alert("删除好友", `确定要删除 ${friend.username} 吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除", style: "destructive",
        onPress: async () => {
          try {
            await deleteFriend(friend.user_id);
            loadFriends();
          } catch (e: any) {
            Alert.alert("错误", e.message);
          }
        },
      },
    ]);
  };

  const sections = useMemo(() => {
    const sortByLastMessage = (left: Friend, right: Friend) => {
      const leftTime = summaries[left.user_id]?.last_message.created_at || "";
      const rightTime = summaries[right.user_id]?.last_message.created_at || "";
      if (leftTime !== rightTime) return rightTime.localeCompare(leftTime);
      return getDisplayName(left).localeCompare(getDisplayName(right), "zh-CN");
    };

    return [
      {
        title: "Online",
        data: friends.filter((friend) => friend.is_online).sort(sortByLastMessage),
      },
      {
        title: "Offline",
        data: friends.filter((friend) => !friend.is_online).sort(sortByLastMessage),
      },
    ];
  }, [friends, summaries]);

  const renderFriend = ({ item }: { item: Friend }) => {
    const summary = summaries[item.user_id];
    const statusMark = getSummaryStatus(summary, state.user?.id || "");
    return (
    <TouchableOpacity
      style={styles.friendItem}
      onPress={() => navigation.navigate("Chat", { friend: item })}
      onLongPress={() => handleDelete(item)}
      accessibilityRole="button"
      accessibilityLabel={`与${getDisplayName(item)}聊天，${item.is_online ? "在线" : "离线"}`}
      accessibilityHint="轻点进入聊天，长按删除好友"
    >
      <FriendAvatar friend={item} reduceMotion={reduceMotion} />
      <View style={styles.friendInfo}>
        <Text style={styles.friendName} numberOfLines={1}>{getDisplayName(item)}</Text>
        <Text style={styles.messagePreview} numberOfLines={1}>
          {getMessagePreview(summary)}
        </Text>
      </View>
      <View style={styles.friendMeta}>
        <Text style={styles.messageTime}>
          {formatConversationTime(summary?.last_message.created_at)}
        </Text>
        {statusMark ? (
          <Text style={[
            styles.summaryStatus,
            statusMark === "✓✓" && styles.summaryStatusRead,
            statusMark === "!" && styles.summaryStatusFailed,
          ]}>
            {statusMark}
          </Text>
        ) : null}
        {summary?.unread_count ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {summary.unread_count > 99 ? "99+" : summary.unread_count}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Kin</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate("AddFriend")}
            accessibilityRole="button"
            accessibilityLabel="添加好友"
          >
            <Text style={styles.addBtnText}>+ 添加</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => navigation.navigate("Settings")}
            accessibilityRole="button"
            accessibilityLabel="打开设置"
          >
            <View style={styles.moreIcon}>
              <View style={styles.moreDot} />
              <View style={styles.moreDot} />
              <View style={styles.moreDot} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* 好友列表 */}
      {friends.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有好友</Text>
          <Text style={styles.emptyHint}>点击右上角「+ 添加」{"\n"}和朋友碰一碰手机吧</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.user_id}
          renderItem={renderFriend}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderSectionFooter={({ section }) => section.data.length === 0 ? (
            <Text style={styles.sectionEmpty}>
              {section.title === "Online" ? "暂无在线好友" : "没有离线好友"}
            </Text>
          ) : null}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 18,
    backgroundColor: COLORS.background,
  },
  headerTitle: { color: COLORS.ink, fontSize: 20, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  addBtn: {
    minHeight: 44, justifyContent: "center",
    backgroundColor: COLORS.accentSoft,
    paddingHorizontal: 14, borderRadius: 22,
  },
  addBtnText: { color: "#157454", fontSize: 14, fontWeight: "700" },
  settingsBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#ECEEEC",
  },
  moreIcon: { flexDirection: "row", gap: 3 },
  moreDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.ink },
  list: { paddingBottom: 28 },
  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8,
  },
  sectionTitle: {
    color: COLORS.ink, fontSize: 13, fontWeight: "700", letterSpacing: 0.3,
  },
  sectionCount: { color: COLORS.faint, fontSize: 12, marginLeft: 7 },
  sectionEmpty: {
    color: COLORS.faint, fontSize: 13,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  friendItem: {
    flexDirection: "row", alignItems: "center",
    minHeight: 76, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  avatarFrame: {
    width: 52, height: 52, marginRight: 14,
    alignItems: "center", justifyContent: "center",
  },
  pulseRing: {
    position: "absolute", width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: COLORS.accent,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, overflow: "hidden",
    backgroundColor: "#28313A", alignItems: "center", justifyContent: "center",
  },
  avatarOffline: { backgroundColor: "#70757D" },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitials: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  presenceDot: {
    position: "absolute", right: 1, bottom: 2,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: COLORS.surface,
  },
  presenceOnline: { backgroundColor: COLORS.accent },
  presenceOffline: { backgroundColor: COLORS.faint },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 16, fontWeight: "600", color: COLORS.ink },
  messagePreview: { fontSize: 14, color: COLORS.muted, marginTop: 4 },
  friendMeta: { minWidth: 46, marginLeft: 10, alignItems: "flex-end", alignSelf: "stretch", paddingTop: 5 },
  messageTime: { color: COLORS.faint, fontSize: 12 },
  summaryStatus: { marginTop: 7, color: COLORS.faint, fontSize: 12 },
  summaryStatusRead: { color: COLORS.accent },
  summaryStatusFailed: { color: "#B43A33" },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    paddingHorizontal: 6, marginTop: 8,
    backgroundColor: COLORS.accent,
    alignItems: "center", justifyContent: "center",
  },
  unreadText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 100 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: COLORS.ink, marginBottom: 8 },
  emptyHint: { fontSize: 14, color: COLORS.muted, textAlign: "center", lineHeight: 22 },
});
