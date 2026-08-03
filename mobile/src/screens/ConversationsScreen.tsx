import React, { useMemo } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Friend } from "../api/client";
import FriendAvatar from "../components/FriendAvatar";
import { useKinDialog } from "../components/KinDialog";
import PresenceWakeHighlight from "../components/PresenceWakeHighlight";
import {
  formatConversationTime,
  getFriendDisplayName,
  getMessagePreview,
  getSummaryStatus,
  sortFriendsByName,
} from "../services/friendPresentation";
import { useAuth } from "../stores/AuthContext";
import { useFriendsHome } from "../stores/FriendsHomeContext";
import { GRAPHITE_COLORS, GRAPHITE_RADII } from "../theme/graphite";

export default function ConversationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { showDialog, dialog } = useKinDialog();
  const {
    friends,
    summaries,
    source,
    refreshing,
    reduceMotion,
    onlineEventKeys,
    refresh,
    removeFriend,
  } = useFriendsHome();

  const onlineFriends = useMemo(
    () => sortFriendsByName(friends.filter((friend) => friend.is_online)),
    [friends],
  );
  const offlineFriends = useMemo(
    () => sortFriendsByName(friends.filter((friend) => !friend.is_online)),
    [friends],
  );
  const recentFriends = useMemo(() => friends
    .filter((friend) => !!summaries[friend.user_id])
    .sort((left, right) => {
      const leftTime = summaries[left.user_id]?.last_message.created_at || "";
      const rightTime = summaries[right.user_id]?.last_message.created_at || "";
      return rightTime.localeCompare(leftTime);
    }), [friends, summaries]);

  const confirmDelete = (friend: Friend) => {
    showDialog({ title: "删除好友", message: `确定要删除 ${getFriendDisplayName(friend)} 吗？`, actions: [
      { text: "取消", tone: "cancel" },
      {
        text: "删除",
        tone: "destructive",
        onPress: () => {
          void removeFriend(friend.user_id).catch((error: any) => {
            showDialog({ title: "删除失败", message: error.message || "请稍后重试" });
          });
        },
      },
    ] });
  };

  const renderPresencePerson = (friend: Friend) => (
    <PresenceWakeHighlight
      key={friend.user_id}
      style={styles.presenceWake}
      eventKey={onlineEventKeys[friend.user_id] || 0}
      reduceMotion={reduceMotion}
    >
      <TouchableOpacity
        style={styles.presencePerson}
        onPress={() => navigation.navigate("Chat", { friend })}
        accessibilityRole="button"
        accessibilityLabel={`${getFriendDisplayName(friend)}，${friend.is_online ? "在线" : "离线"}`}
      >
        <FriendAvatar
          friend={friend}
          reduceMotion={reduceMotion}
          onlineEventKey={onlineEventKeys[friend.user_id] || 0}
          size={50}
        />
        <Text style={styles.presenceName} numberOfLines={1}>{getFriendDisplayName(friend)}</Text>
      </TouchableOpacity>
    </PresenceWakeHighlight>
  );

  const renderConversation = ({ item }: { item: Friend }) => {
    const summary = summaries[item.user_id];
    const statusMark = getSummaryStatus(summary, state.user?.id || "");
    return (
      <PresenceWakeHighlight
        eventKey={onlineEventKeys[item.user_id] || 0}
        reduceMotion={reduceMotion}
      >
        <TouchableOpacity
          style={styles.conversationRow}
          onPress={() => navigation.navigate("Chat", { friend: item })}
          onLongPress={() => confirmDelete(item)}
          accessibilityRole="button"
          accessibilityLabel={`与${getFriendDisplayName(item)}的会话`}
          accessibilityHint="轻点进入聊天，长按删除好友"
        >
          <FriendAvatar
            friend={item}
            reduceMotion={reduceMotion}
            onlineEventKey={onlineEventKeys[item.user_id] || 0}
          />
          <View style={styles.conversationCopy}>
            <Text style={styles.conversationName} numberOfLines={1}>{getFriendDisplayName(item)}</Text>
            <Text style={styles.messagePreview} numberOfLines={1}>{getMessagePreview(summary)}</Text>
          </View>
          <View style={styles.conversationMeta}>
            <Text style={styles.messageTime}>
              {formatConversationTime(summary?.last_message.created_at)}
            </Text>
            {summary?.unread_count ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{summary.unread_count > 99 ? "99+" : summary.unread_count}</Text>
              </View>
            ) : statusMark ? (
              <Text style={[
                styles.summaryStatus,
                statusMark === "✓✓" && styles.summaryRead,
                statusMark === "!" && styles.summaryFailed,
              ]}>{statusMark}</Text>
            ) : null}
          </View>
        </TouchableOpacity>
      </PresenceWakeHighlight>
    );
  };

  const header = (
    <>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 18, 42) }]}>
        <View>
          <Text style={styles.kicker}>KIN · GRAPHITE FLOW</Text>
          <Text style={styles.title}>会话</Text>
        </View>
        <TouchableOpacity
          style={styles.pairButton}
          onPress={() => navigation.navigate("AddFriend")}
          accessibilityRole="button"
          accessibilityLabel="开启碰一碰"
        >
          <Text style={styles.pairMark}>⌁</Text>
          <Text style={styles.pairButtonText}>碰一碰</Text>
        </TouchableOpacity>
      </View>

      {source === "cache" || source === "cache_refreshing" ? (
        <View style={styles.syncNotice} accessibilityLiveRegion="polite">
          <View style={styles.syncDot} />
          <Text style={styles.syncText}>
            {source === "cache" ? "当前显示本机缓存，在线状态可能不是最新" : "正在同步最新好友和在线状态…"}
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Online</Text>
        <Text style={styles.sectionCount}>{onlineFriends.length}</Text>
      </View>
      {onlineFriends.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presenceRail}
        >
          {onlineFriends.map(renderPresencePerson)}
        </ScrollView>
      ) : (
        <Text style={styles.compactEmpty}>目前没有好友在线</Text>
      )}

      <View style={[styles.sectionHeading, styles.recentHeading]}>
        <Text style={styles.sectionTitle}>最近会话</Text>
        <Text style={styles.sectionCount}>{recentFriends.length}</Text>
      </View>
    </>
  );

  const footer = (
    <View style={styles.offlineSection}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Offline</Text>
        <Text style={styles.sectionCount}>{offlineFriends.length}</Text>
      </View>
      {offlineFriends.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presenceRail}
        >
          {offlineFriends.map(renderPresencePerson)}
        </ScrollView>
      ) : (
        <Text style={styles.compactEmpty}>没有离线好友</Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={recentFriends}
        keyExtractor={(item) => item.user_id}
        renderItem={renderConversation}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={(
          <View style={styles.emptyRecent}>
            <Text style={styles.emptyTitle}>
              {source === "loading" ? "正在载入会话" : friends.length ? "还没有最近会话" : "还没有好友"}
            </Text>
            <Text style={styles.emptyHint}>
              {friends.length ? "从上方头像开始一段聊天。" : "通过碰一碰添加现实中见过的人。"}
            </Text>
          </View>
        )}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={GRAPHITE_COLORS.primary}
            colors={[GRAPHITE_COLORS.primary]}
            progressBackgroundColor={GRAPHITE_COLORS.surface}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  listContent: { paddingBottom: 118 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  kicker: { color: GRAPHITE_COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  title: { marginTop: 4, color: GRAPHITE_COLORS.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  pairButton: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.primaryLine,
    backgroundColor: GRAPHITE_COLORS.primarySoft,
  },
  pairMark: { color: GRAPHITE_COLORS.primaryStrong, fontSize: 21, lineHeight: 23 },
  pairButtonText: { color: GRAPHITE_COLORS.primaryStrong, fontSize: 12, fontWeight: "800" },
  syncNotice: {
    minHeight: 38,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GRAPHITE_COLORS.textFaint },
  syncText: { flex: 1, color: GRAPHITE_COLORS.textMuted, fontSize: 11, lineHeight: 16 },
  sectionHeading: {
    minHeight: 32,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  recentHeading: { marginTop: 18, marginBottom: 4 },
  sectionTitle: { color: GRAPHITE_COLORS.text, fontSize: 14, fontWeight: "800" },
  sectionCount: { marginLeft: 7, color: GRAPHITE_COLORS.textFaint, fontSize: 12 },
  presenceRail: { paddingHorizontal: 16, paddingVertical: 9, gap: 4 },
  presenceWake: { width: 76, borderRadius: GRAPHITE_RADII.control },
  presencePerson: { width: 76, minHeight: 88, alignItems: "center", justifyContent: "flex-start" },
  presenceName: { width: 72, marginTop: 5, color: GRAPHITE_COLORS.textMuted, fontSize: 11, textAlign: "center" },
  compactEmpty: { paddingHorizontal: 20, paddingVertical: 16, color: GRAPHITE_COLORS.textFaint, fontSize: 12 },
  conversationRow: {
    minHeight: 76,
    marginHorizontal: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: GRAPHITE_RADII.control,
    flexDirection: "row",
    alignItems: "center",
  },
  conversationCopy: { flex: 1, minWidth: 0, marginLeft: 9 },
  conversationName: { color: GRAPHITE_COLORS.text, fontSize: 15, fontWeight: "700" },
  messagePreview: { marginTop: 4, color: GRAPHITE_COLORS.textMuted, fontSize: 13 },
  conversationMeta: { minWidth: 48, marginLeft: 10, alignItems: "flex-end", alignSelf: "stretch", paddingTop: 5 },
  messageTime: { color: GRAPHITE_COLORS.textFaint, fontSize: 11 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    marginTop: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.primary,
  },
  unreadText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 10, fontWeight: "800" },
  summaryStatus: { marginTop: 8, color: GRAPHITE_COLORS.textFaint, fontSize: 11 },
  summaryRead: { color: GRAPHITE_COLORS.primary },
  summaryFailed: { color: GRAPHITE_COLORS.danger },
  emptyRecent: { minHeight: 140, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: GRAPHITE_COLORS.text, fontSize: 17, fontWeight: "700" },
  emptyHint: { marginTop: 7, color: GRAPHITE_COLORS.textMuted, fontSize: 12, lineHeight: 19, textAlign: "center" },
  offlineSection: { marginTop: 22, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GRAPHITE_COLORS.line },
});
