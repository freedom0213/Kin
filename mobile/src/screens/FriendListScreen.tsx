/** 好友列表页面 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getFriendList, deleteFriend, Friend } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { exportMessagesToFile } from "../services/export";
import { kinWS } from "../api/ws";

export default function FriendListScreen({ navigation }: any) {
  const { state, logoutAction } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadFriends = useCallback(async () => {
    try {
      const data = await getFriendList();
      setFriends(data.friends);
    } catch { /* 忽略 */ }
  }, []);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFriends();
    setRefreshing(false);
  };

  // 导出聊天记录
  const handleExport = async () => {
    try {
      await exportMessagesToFile();
    } catch (e: any) {
      Alert.alert("导出失败", e.message);
    }
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

  const renderFriend = ({ item }: { item: Friend }) => (
    <TouchableOpacity
      style={styles.friendItem}
      onPress={() => navigation.navigate("Chat", { friend: item })}
      onLongPress={() => handleDelete(item)}
    >
      <View style={[styles.dot, item.is_online ? styles.online : styles.offline]} />
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{item.nickname || item.username}</Text>
        {item.status_msg ? (
          <Text style={styles.friendStatus} numberOfLines={1}>{item.status_msg}</Text>
        ) : null}
      </View>
      <Text style={styles.meetHint}>相识于{item.meet_at?.slice(0, 10)}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 顶部栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Kin · {state.user?.username}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleExport}>
            <Text style={styles.logoutText}>导出</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate("AddFriend")}
          >
            <Text style={styles.addBtnText}>+ 添加</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={logoutAction}>
            <Text style={styles.logoutText}>退出</Text>
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
        <FlatList
          data={friends}
          keyExtractor={(item) => item.user_id}
          renderItem={renderFriend}
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
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16, backgroundColor: "#1a1a2e",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  addBtn: { backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  logoutText: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
  list: { paddingVertical: 8 },
  friendItem: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee",
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 14 },
  online: { backgroundColor: "#4cd964" },
  offline: { backgroundColor: "#ccc" },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 17, fontWeight: "600", color: "#1a1a2e" },
  friendStatus: { fontSize: 13, color: "#999", marginTop: 2 },
  meetHint: { fontSize: 11, color: "#bbb" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 100 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#1a1a2e", marginBottom: 8 },
  emptyHint: { fontSize: 14, color: "#999", textAlign: "center", lineHeight: 22 },
});
