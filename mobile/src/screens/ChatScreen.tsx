/** 聊天页面 — 文字消息 + 在线状态 */

import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { kinWS } from "../api/ws";
import { useAuth } from "../stores/AuthContext";

interface Message {
  id: string;
  from: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

let _msgCounter = 0;
function genMsgId(): string {
  return `${Date.now()}_${++_msgCounter}`;
}

export default function ChatScreen({ route, navigation }: any) {
  const { friend } = route.params; // friend 包含 user_id, username, is_online 等
  const { state } = useAuth();
  const myId = state.user?.id || "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isOnline, setIsOnline] = useState(friend.is_online);
  const flatListRef = useRef<FlatList>(null);

  // 加载本地消息（MVP 阶段用内存，后续接入 SQLite）
  // const loadMessages = async () => { ... }

  // WebSocket 消息监听
  useEffect(() => {
    const onMessage = (data: any) => {
      if (data.from === friend.user_id && data.type === "chat_message") {
        const msg: Message = {
          id: data.msg_id || genMsgId(),
          from: data.from,
          content: data.content,
          type: "text",
          is_read: false,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, msg]);
        // 自动发送已读回执
        kinWS.sendReadReceipt(friend.user_id, msg.id);
      } else if (data.type === "delivered" && data.to === friend.user_id) {
        // 标记消息已送达
      } else if (data.type === "read_receipt" && data.from === friend.user_id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === data.msg_id ? { ...m, is_read: true } : m))
        );
      } else if (data.type === "friend_status" && data.user_id === friend.user_id) {
        setIsOnline(data.is_online);
      } else if (data.type === "error" && data.code === "OFFLINE") {
        // 对方离线 → 标记最新一条消息为未送达
      }
    };

    kinWS.on("chat_message", onMessage);
    kinWS.on("delivered", onMessage);
    kinWS.on("read_receipt", onMessage);
    kinWS.on("friend_status", onMessage);
    kinWS.on("error", onMessage);

    return () => {
      kinWS.off("chat_message", onMessage);
      kinWS.off("delivered", onMessage);
      kinWS.off("read_receipt", onMessage);
      kinWS.off("friend_status", onMessage);
      kinWS.off("error", onMessage);
    };
  }, [friend.user_id]);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    const msgId = genMsgId();
    const msg: Message = {
      id: msgId,
      from: myId,
      content: text,
      type: "text",
      is_read: false,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, msg]);
    setInputText("");
    kinWS.sendMessage(friend.user_id, text, msgId);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.from === myId;
    return (
      <View style={[styles.msgBubble, isMine ? styles.msgMine : styles.msgOther]}>
        <Text style={isMine ? styles.msgTextMine : styles.msgTextOther}>
          {item.content}
        </Text>
        {isMine && (
          <Text style={styles.readStatus}>
            {item.is_read ? "已读" : "送达"}
          </Text>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      {/* 顶部 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{friend.nickname || friend.username}</Text>
          <Text style={[styles.onlineStatus, isOnline ? styles.online : styles.offline]}>
            {isOnline ? "在线" : "离线"}
          </Text>
        </View>
        <View style={{ width: 50 }} />
      </View>

      {/* 消息列表 */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.msgList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      {/* 输入栏 */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="说点什么..."
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
        >
          <Text style={styles.sendBtnText}>发送</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12,
    backgroundColor: "#1a1a2e",
  },
  backBtn: { color: "#fff", fontSize: 16 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerName: { color: "#fff", fontSize: 17, fontWeight: "600" },
  onlineStatus: { fontSize: 12, marginTop: 2 },
  online: { color: "#4cd964" },
  offline: { color: "#aaa" },
  msgList: { padding: 14 },
  msgBubble: {
    maxWidth: "75%", paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18, marginBottom: 8,
  },
  msgMine: { alignSelf: "flex-end", backgroundColor: "#1a1a2e" },
  msgOther: { alignSelf: "flex-start", backgroundColor: "#fff" },
  msgTextMine: { color: "#fff", fontSize: 16, lineHeight: 22 },
  msgTextOther: { color: "#1a1a2e", fontSize: 16, lineHeight: 22 },
  readStatus: { color: "rgba(255,255,255,0.5)", fontSize: 11, textAlign: "right", marginTop: 4 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end",
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#ddd",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 16,
    maxHeight: 100, backgroundColor: "#fafafa",
  },
  sendBtn: {
    backgroundColor: "#1a1a2e", borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 10, marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
