import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Friend } from "../api/client";
import FriendAvatar from "../components/FriendAvatar";
import { getFriendDisplayName, sortFriendsByName } from "../services/friendPresentation";
import { useFriendsHome } from "../stores/FriendsHomeContext";
import {
  GRAPHITE_COLORS,
  GRAPHITE_INPUT_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

export default function ContactsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const {
    friends,
    source,
    refreshing,
    reduceMotion,
    onlineEventKeys,
    refresh,
    removeFriend,
  } = useFriendsHome();

  const filteredFriends = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return sortFriendsByName(friends).filter((friend) => {
      if (!normalizedQuery) return true;
      return [friend.nickname, friend.username, friend.status_msg]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    });
  }, [friends, query]);

  const confirmDelete = (friend: Friend) => {
    Alert.alert("删除好友", `确定要删除 ${getFriendDisplayName(friend)} 吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void removeFriend(friend.user_id).catch((error: any) => {
            Alert.alert("删除失败", error.message || "请稍后重试");
          });
        },
      },
    ]);
  };

  const renderContact = ({ item }: { item: Friend }) => (
    <View style={styles.contactRow}>
      <TouchableOpacity
        style={styles.avatarAction}
        onPress={() => navigation.navigate("ConversationDetails", { friend: item })}
        accessibilityRole="button"
        accessibilityLabel={`查看${getFriendDisplayName(item)}的好友资料`}
      >
        <FriendAvatar
          friend={item}
          reduceMotion={reduceMotion}
          onlineEventKey={onlineEventKeys[item.user_id] || 0}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.contactMain}
        onPress={() => navigation.navigate("Chat", { friend: item })}
        onLongPress={() => confirmDelete(item)}
        accessibilityRole="button"
        accessibilityLabel={`与${getFriendDisplayName(item)}聊天`}
        accessibilityHint="长按可以删除好友"
      >
        <View style={styles.contactCopy}>
          <Text style={styles.contactName} numberOfLines={1}>{getFriendDisplayName(item)}</Text>
          <Text style={styles.contactStatus} numberOfLines={1}>
            {item.status_msg || (item.is_online ? "当前在线" : "当前离线")}
          </Text>
        </View>
        <View style={styles.statusWrap}>
          <View style={[styles.statusDot, item.is_online ? styles.onlineDot : styles.offlineDot]} />
          <Text style={[styles.statusText, item.is_online && styles.onlineText]}>
            {item.is_online ? "Online" : "Offline"}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 18, 42) }]}>
        <View>
          <Text style={styles.kicker}>ALL CONNECTIONS</Text>
          <Text style={styles.title}>通讯录</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate("AddFriend")}
          accessibilityRole="button"
          accessibilityLabel="添加好友或开启碰一碰"
        >
          <Text style={styles.addMark}>＋</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.searchShell, searchFocused && styles.searchShellFocused]}>
        <View style={styles.searchGlyph} accessibilityElementsHidden>
          <View style={styles.searchCircle} />
          <View style={styles.searchHandle} />
        </View>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="搜索好友"
          placeholderTextColor={GRAPHITE_INPUT_COLORS.placeholder}
          cursorColor={GRAPHITE_INPUT_COLORS.cursor}
          selectionColor={GRAPHITE_INPUT_COLORS.selection}
          autoCorrect={false}
          accessibilityLabel="搜索好友"
        />
        {query ? (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setQuery("")}
            accessibilityRole="button"
            accessibilityLabel="清空搜索"
          >
            <Text style={styles.clearText}>×</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.listHeading}>
        <Text style={styles.listTitle}>全部好友</Text>
        <Text style={styles.listCount}>{filteredFriends.length}</Text>
        {source === "cache" ? <Text style={styles.cacheLabel}>本机缓存</Text> : null}
      </View>

      <FlatList
        data={filteredFriends}
        keyExtractor={(item) => item.user_id}
        renderItem={renderContact}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={GRAPHITE_COLORS.primary}
            colors={[GRAPHITE_COLORS.primary]}
            progressBackgroundColor={GRAPHITE_COLORS.surface}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {query ? "没有匹配的好友" : source === "loading" ? "正在载入通讯录" : "通讯录还是空的"}
            </Text>
            <Text style={styles.emptyHint}>
              {query ? "换一个昵称或用户名试试。" : "点击右上角，通过碰一碰添加现实中见过的人。"}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  kicker: { color: GRAPHITE_COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  title: { marginTop: 4, color: GRAPHITE_COLORS.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.primaryLine,
    backgroundColor: GRAPHITE_COLORS.primarySoft,
  },
  addMark: { color: GRAPHITE_COLORS.primaryStrong, fontSize: 25, fontWeight: "400" },
  searchShell: {
    minHeight: 52,
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.line,
    borderRadius: GRAPHITE_RADII.control,
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  searchShellFocused: { borderColor: "rgba(105,200,164,0.62)", backgroundColor: GRAPHITE_COLORS.surfaceStrong },
  searchGlyph: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  searchCircle: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: GRAPHITE_COLORS.textFaint },
  searchHandle: { position: "absolute", width: 7, height: 1.5, marginLeft: 13, marginTop: 14, backgroundColor: GRAPHITE_COLORS.textFaint, transform: [{ rotate: "45deg" }] },
  searchInput: { flex: 1, minWidth: 0, minHeight: 50, color: GRAPHITE_COLORS.text, fontSize: 14 },
  clearButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  clearText: { color: GRAPHITE_COLORS.textMuted, fontSize: 22, fontWeight: "300" },
  listHeading: { minHeight: 50, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" },
  listTitle: { color: GRAPHITE_COLORS.text, fontSize: 14, fontWeight: "800" },
  listCount: { marginLeft: 7, color: GRAPHITE_COLORS.textFaint, fontSize: 12 },
  cacheLabel: { marginLeft: "auto", color: GRAPHITE_COLORS.textFaint, fontSize: 10 },
  listContent: { flexGrow: 1, paddingBottom: 118 },
  contactRow: {
    minHeight: 76,
    marginHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAPHITE_COLORS.line,
  },
  avatarAction: { width: 66, minHeight: 76, alignItems: "center", justifyContent: "center" },
  contactMain: { flex: 1, minWidth: 0, minHeight: 76, flexDirection: "row", alignItems: "center" },
  contactCopy: { flex: 1, minWidth: 0 },
  contactName: { color: GRAPHITE_COLORS.text, fontSize: 15, fontWeight: "700" },
  contactStatus: { marginTop: 4, color: GRAPHITE_COLORS.textMuted, fontSize: 12 },
  statusWrap: { marginLeft: 10, alignItems: "flex-end" },
  statusDot: { width: 7, height: 7, marginBottom: 5, borderRadius: 4 },
  onlineDot: { backgroundColor: GRAPHITE_COLORS.primary },
  offlineDot: { backgroundColor: GRAPHITE_COLORS.textFaint },
  statusText: { color: GRAPHITE_COLORS.textFaint, fontSize: 10 },
  onlineText: { color: GRAPHITE_COLORS.primary },
  empty: { flex: 1, minHeight: 300, paddingHorizontal: 30, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: GRAPHITE_COLORS.text, fontSize: 17, fontWeight: "700" },
  emptyHint: { marginTop: 8, color: GRAPHITE_COLORS.textMuted, fontSize: 12, lineHeight: 19, textAlign: "center" },
});
