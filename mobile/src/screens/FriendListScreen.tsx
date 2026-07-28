/** 会话列表页面 — Online / Offline 分组 + 本地消息摘要 */

import React, {
  useState, useCallback, useEffect, useMemo, useRef,
} from "react";
import {
  View, Text, SectionList, TouchableOpacity, Image,
  StyleSheet, Alert, RefreshControl, Animated, AccessibilityInfo,
  Easing, LayoutAnimation, Platform, UIManager, ActivityIndicator,
} from "react-native";
import type { ImageStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getFriendList, deleteFriend, Friend } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { kinWS } from "../api/ws";
import {
  cacheFriends, ConversationSummary, getCachedFriends, getConversationSummaries,
  hasCachedFriendSnapshot,
  removeCachedFriend,
} from "../services/db";
import { kinFeedback } from "../services/feedback";
import { mergeFriendProfile, parseFriendProfileEvent } from "../services/friendProfile";

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

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function configurePresenceLayout(reduceMotion: boolean): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: 360,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

function getPulseDelay(userId: string): number {
  let hash = 0;
  for (const character of userId) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 720;
}

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
  onlineEventKey,
}: {
  friend: Friend;
  reduceMotion: boolean;
  onlineEventKey: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const lastBurstKey = useRef(0);

  useEffect(() => {
    if (!friend.is_online || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
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
    const animation = Animated.sequence([
      Animated.delay(getPulseDelay(friend.user_id)),
      loop,
    ]);
    animation.start();
    return () => {
      animation.stop();
      loop.stop();
    };
  }, [friend.is_online, friend.user_id, pulse, reduceMotion]);

  useEffect(() => {
    if (onlineEventKey <= lastBurstKey.current) return;
    lastBurstKey.current = onlineEventKey;
    if (!friend.is_online || reduceMotion || Date.now() - onlineEventKey > 1_500) return;

    burst.stopAnimation();
    burst.setValue(0);
    const animation = Animated.timing(burst, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [burst, friend.is_online, onlineEventKey, reduceMotion]);

  const ringStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.48, 0.08] }),
    transform: [{
      scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }),
    }],
  };
  const burstStyle = {
    opacity: burst.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0.5, 0] }),
    transform: [{
      scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.48] }),
    }],
  };

  return (
    <View style={styles.avatarFrame}>
      {friend.is_online && !reduceMotion ? (
        <Animated.View style={[styles.onlineBurst, burstStyle]} />
      ) : null}
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

function PresenceHighlight({
  eventKey,
  reduceMotion,
  children,
}: {
  eventKey: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const highlight = useRef(new Animated.Value(0)).current;
  const lastEventKey = useRef(0);

  useEffect(() => {
    if (eventKey <= lastEventKey.current) return;
    lastEventKey.current = eventKey;
    if (reduceMotion || Date.now() - eventKey > 1_500) return;

    highlight.stopAnimation();
    highlight.setValue(1);
    const animation = Animated.timing(highlight, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [eventKey, highlight, reduceMotion]);

  const backgroundColor = highlight.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.surface, "#EAF7F2"],
  });

  return <Animated.View style={{ backgroundColor }}>{children}</Animated.View>;
}

export default function FriendListScreen({ navigation }: any) {
  const { state } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [listSource, setListSource] = useState<
    "loading" | "cache_refreshing" | "network" | "cache" | "unavailable"
  >("loading");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [onlineEventKeys, setOnlineEventKeys] = useState<Record<string, number>>({});
  const friendsRef = useRef<Friend[]>([]);
  const cachedOwnerRef = useRef<string | null>(null);
  const hasCachedSnapshotRef = useRef(false);
  const hasLiveSnapshotRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  const applyFriends = useCallback(async (nextFriends: Friend[], detectPresence: boolean) => {
      const previousFriends = friendsRef.current;
      const previousById = new Map(previousFriends.map((friend) => [friend.user_id, friend]));
      const presenceChanged = detectPresence && previousFriends.length > 0 && nextFriends.some((friend) => (
        previousById.has(friend.user_id)
        && previousById.get(friend.user_id)?.is_online !== friend.is_online
      ));
      const becameOnline = detectPresence ? nextFriends.filter((friend) => (
        friend.is_online && previousById.get(friend.user_id)?.is_online === false
      )) : [];

      if (presenceChanged) configurePresenceLayout(reduceMotion);
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
      if (becameOnline.length > 0 && !reduceMotion) {
        setOnlineEventKeys((current) => {
          const next = { ...current };
          const eventTime = Date.now();
          becameOnline.forEach((friend) => {
            next[friend.user_id] = eventTime;
          });
          return next;
        });
      }
      kinFeedback.seedFriendStatuses(nextFriends);
      const nextSummaries = await getConversationSummaries(
        nextFriends.map((friend) => friend.user_id),
        state.user?.id || ""
      );
      setSummaries(nextSummaries);
  }, [reduceMotion, state.user?.id]);

  const loadFriends = useCallback(async (): Promise<boolean> => {
    const ownerId = state.user?.id;
    if (!ownerId) {
      setListSource("unavailable");
      return false;
    }

    if (cachedOwnerRef.current !== ownerId) {
      cachedOwnerRef.current = ownerId;
      hasCachedSnapshotRef.current = false;
      hasLiveSnapshotRef.current = false;
      try {
        const [cachedFriends, hasCachedSnapshot] = await Promise.all([
          getCachedFriends(ownerId),
          hasCachedFriendSnapshot(ownerId),
        ]);
        if (hasCachedSnapshot) {
          hasCachedSnapshotRef.current = true;
          await applyFriends(cachedFriends, false);
          setListSource("cache_refreshing");
        }
      } catch { /* 缓存不可用时继续请求服务器 */ }
    }

    try {
      const data = await getFriendList();
      await applyFriends(data.friends, hasLiveSnapshotRef.current);
      hasLiveSnapshotRef.current = true;
      setListSource("network");
      try {
        await cacheFriends(ownerId, data.friends);
        hasCachedSnapshotRef.current = true;
      } catch { /* 缓存写入失败不影响当前在线列表 */ }
      return true;
    } catch {
      setListSource(
        hasCachedSnapshotRef.current || friendsRef.current.length > 0
          ? "cache"
          : "unavailable"
      );
      return false;
    }
  }, [applyFriends, state.user?.id]);

  // 每次页面获得焦点时刷新
  useFocusEffect(
    useCallback(() => { loadFriends(); }, [loadFriends])
  );

  // 好友状态变化时立即在 Online / Offline 分组之间更新
  useEffect(() => {
    const onFriendStatus = (data: any) => {
      if (typeof data.user_id !== "string") return;
      const online = !!data.is_online;
      kinFeedback.handleFriendStatus(data.user_id, online);

      const existing = friendsRef.current.find((friend) => friend.user_id === data.user_id);
      if (!existing || existing.is_online === online) return;

      configurePresenceLayout(reduceMotion);
      const nextFriends = friendsRef.current.map((friend) => (
        friend.user_id === data.user_id ? { ...friend, is_online: online } : friend
      ));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);

      if (online && !reduceMotion) {
        setOnlineEventKeys((current) => ({
          ...current,
          [data.user_id]: Date.now(),
        }));
      }
    };
    kinWS.on("friend_status", onFriendStatus);
    return () => kinWS.off("friend_status", onFriendStatus);
  }, [reduceMotion]);

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

  useEffect(() => {
    const onResumed = () => { void loadFriends(); };
    kinWS.on("resumed", onResumed);
    return () => kinWS.off("resumed", onResumed);
  }, [loadFriends]);

  // 好友修改公开资料后，保持列表名称与头像即时一致。
  useEffect(() => {
    const onFriendProfile = (data: any) => {
      const update = parseFriendProfileEvent(data);
      if (!update || !friendsRef.current.some((friend) => friend.user_id === update.user_id)) return;
      const nextFriends = friendsRef.current.map((friend) => mergeFriendProfile(friend, update));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
    };
    kinWS.on("friend_profile", onFriendProfile);
    return () => kinWS.off("friend_profile", onFriendProfile);
  }, []);

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
            const ownerId = state.user?.id;
            if (ownerId) await removeCachedFriend(ownerId, friend.user_id);
            const nextFriends = friendsRef.current.filter((item) => item.user_id !== friend.user_id);
            friendsRef.current = nextFriends;
            setFriends(nextFriends);
            setSummaries((current) => {
              const next = { ...current };
              delete next[friend.user_id];
              return next;
            });
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
      <PresenceHighlight
        eventKey={onlineEventKeys[item.user_id] || 0}
        reduceMotion={reduceMotion}
      >
        <TouchableOpacity
          style={styles.friendItem}
          onPress={() => navigation.navigate("Chat", { friend: item })}
          onLongPress={() => handleDelete(item)}
          accessibilityRole="button"
          accessibilityLabel={`与${getDisplayName(item)}聊天，${item.is_online ? "在线" : "离线"}`}
          accessibilityHint="轻点进入聊天，长按删除好友"
        >
          <FriendAvatar
            friend={item}
            reduceMotion={reduceMotion}
            onlineEventKey={onlineEventKeys[item.user_id] || 0}
          />
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
      </PresenceHighlight>
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
      {listSource === "cache" ? (
        <View style={styles.cacheNotice} accessibilityLiveRegion="polite">
          <Text style={styles.cacheNoticeMark}>!</Text>
          <Text style={styles.cacheNoticeText}>当前无法连接服务器，正在显示本机缓存；在线状态可能不是最新</Text>
        </View>
      ) : null}
      {listSource === "cache_refreshing" ? (
        <View style={[styles.cacheNotice, styles.syncNotice]} accessibilityLiveRegion="polite">
          <Text style={[styles.cacheNoticeMark, styles.syncNoticeMark]}>·</Text>
          <Text style={[styles.cacheNoticeText, styles.syncNoticeText]}>正在同步最新好友和在线状态…</Text>
        </View>
      ) : null}

      {listSource === "loading" ? (
        <View style={styles.empty}>
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.loadingText}>正在载入会话…</Text>
        </View>
      ) : listSource === "unavailable" && friends.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>暂时无法载入好友</Text>
          <Text style={styles.emptyHint}>请检查网络连接后重试。本机暂无可用的好友缓存。</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => { void loadFriends(); }}
            accessibilityRole="button"
            accessibilityLabel="重新载入好友列表"
          >
            <Text style={styles.retryButtonText}>重新载入</Text>
          </TouchableOpacity>
        </View>
      ) : friends.length === 0 ? (
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
  cacheNotice: {
    minHeight: 40, paddingHorizontal: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: "#F6EADB",
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#E4CEB2",
  },
  cacheNoticeMark: {
    width: 18, height: 18, borderRadius: 9, textAlign: "center", lineHeight: 18,
    color: "#955D25", borderWidth: 1, borderColor: "#B77A3C", fontSize: 12, fontWeight: "800",
  },
  cacheNoticeText: { flexShrink: 1, color: "#75481F", fontSize: 12, lineHeight: 17 },
  syncNotice: { backgroundColor: "#ECEEEC", borderColor: "#D9DCD8" },
  syncNoticeMark: { color: COLORS.muted, borderColor: COLORS.faint },
  syncNoticeText: { color: COLORS.muted },
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
    backgroundColor: "transparent",
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
  onlineBurst: {
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
  loadingText: { marginTop: 12, color: COLORS.muted, fontSize: 14 },
  retryButton: {
    minHeight: 44, marginTop: 20, paddingHorizontal: 18,
    alignItems: "center", justifyContent: "center",
    borderRadius: 22, backgroundColor: COLORS.accentSoft,
  },
  retryButtonText: { color: "#157454", fontSize: 14, fontWeight: "700" },
});
