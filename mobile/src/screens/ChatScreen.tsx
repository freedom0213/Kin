/** 聊天页面 — E2E 加密/文字/语音消息 + 在线状态 + 语音通话入口 + 本地存储 */

import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { kinWS } from "../api/ws";
import { useAuth } from "../stores/AuthContext";
import { encrypt, decrypt } from "../services/encryption";
import { getSecretKey } from "../services/keys";
import { VoiceRecorder, VoiceMessageBubble } from "../components/VoiceMessage";
import { saveMessage, getMessages, markChatAsRead } from "../services/db";

interface Message {
  id: string;
  from: string;
  content: string;
  type: "text" | "voice";
  duration?: number;  // 语音消息时长（秒）
  is_read: boolean;
  created_at: string;
}

let _msgCounter = 0;
function genMsgId(): string {
  return `${Date.now()}_${++_msgCounter}`;
}

export default function ChatScreen({ route }: any) {
  const { friend } = route.params;
  const { state } = useAuth();
  const myId = state.user?.id || "";
  const navigation = useNavigation<any>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isOnline, setIsOnline] = useState(friend.is_online);
  const flatListRef = useRef<FlatList>(null);

  const [mySecretKey, setMySecretKey] = useState<string | null>(null);
  const friendPublicKey: string | null = friend.public_key || null;
  const [loadingHistory, setLoadingHistory] = useState(true);

  // 加载私钥 + 本地历史消息
  useEffect(() => {
    getSecretKey().then(setMySecretKey);
    (async () => {
      try {
        const history = await getMessages(friend.user_id, 50);
        if (history.length > 0) {
          setMessages(history.map((m) => ({
            id: m.id, from: m.sender_id, content: m.content,
            type: m.type, duration: m.duration,
            is_read: m.is_read, created_at: m.created_at,
          })));
        }
        await markChatAsRead(friend.user_id, myId);
      } catch { /* 本地加载失败不阻塞 */ }
      setLoadingHistory(false);
    })();
  }, []);

  // WebSocket 消息监听
  useEffect(() => {
    const onMessage = (data: any) => {
      if (data.from !== friend.user_id) return;

      if (data.type === "chat_message" || data.type === "voice_message") {
        let displayContent: string = data.content;
        const isVoice = data.type === "voice_message";

        // E2E 解密（语音和文字统一处理）
        if (data.encrypted && friendPublicKey && mySecretKey && displayContent) {
          try {
            displayContent = decrypt(data.content, friendPublicKey, mySecretKey);
          } catch {
            displayContent = isVoice ? "" : "[解密失败]";
          }
        }

        const msg: Message = {
          id: data.msg_id || genMsgId(),
          from: data.from,
          content: displayContent,
          type: isVoice ? "voice" : "text",
          duration: isVoice ? (data.duration || 0) : undefined,
          is_read: true,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, msg]);
        kinWS.sendReadReceipt(friend.user_id, msg.id);
        // 存入本地 SQLite
        saveMessage({
          id: msg.id, chat_id: friend.user_id, sender_id: msg.from,
          type: msg.type, content: msg.content, duration: msg.duration,
          is_read: true, created_at: msg.created_at,
        }).catch(() => {});
      } else if (data.type === "delivered" && data.to === friend.user_id) {
        // 消息已送达
      } else if (data.type === "read_receipt" && data.from === friend.user_id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === data.msg_id ? { ...m, is_read: true } : m))
        );
      } else if (data.type === "friend_status" && data.user_id === friend.user_id) {
        setIsOnline(data.is_online);
      } else if (data.type === "error" && data.code === "OFFLINE") {
        // 对方离线
      }
    };

    kinWS.on("chat_message", onMessage);
    kinWS.on("voice_message", onMessage);
    kinWS.on("delivered", onMessage);
    kinWS.on("read_receipt", onMessage);
    kinWS.on("friend_status", onMessage);
    kinWS.on("error", onMessage);

    return () => {
      kinWS.off("chat_message", onMessage);
      kinWS.off("voice_message", onMessage);
      kinWS.off("delivered", onMessage);
      kinWS.off("read_receipt", onMessage);
      kinWS.off("friend_status", onMessage);
      kinWS.off("error", onMessage);
    };
  }, [friend.user_id, friendPublicKey, mySecretKey]);

  // 发送文字消息
  const sendTextMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    const msgId = genMsgId();
    let contentToSend: string;
    let isEncrypted = false;

    if (friendPublicKey && mySecretKey) {
      try {
        contentToSend = encrypt(text, friendPublicKey, mySecretKey);
        isEncrypted = true;
      } catch {
        contentToSend = text;
      }
    } else {
      contentToSend = text;
    }

    const msg: Message = {
      id: msgId, from: myId, content: text,
      type: "text", is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    setInputText("");
    kinWS.sendMessage(friend.user_id, contentToSend, msgId, isEncrypted);
    // 存入本地 SQLite
    saveMessage({
      id: msg.id, chat_id: friend.user_id, sender_id: myId,
      type: "text", content: text, is_read: false, created_at: msg.created_at,
    }).catch(() => {});
  };

  // 语音录制完成回调
  const handleVoiceRecord = (base64Audio: string, duration: number) => {
    const msgId = genMsgId();
    let contentToSend = base64Audio;
    let isEncrypted = false;

    if (friendPublicKey && mySecretKey) {
      try {
        contentToSend = encrypt(base64Audio, friendPublicKey, mySecretKey);
        isEncrypted = true;
      } catch {
        // 加密失败降级
      }
    }

    const msg: Message = {
      id: msgId, from: myId, content: base64Audio,
      type: "voice", duration, is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    kinWS.sendVoiceMessage(friend.user_id, contentToSend, duration, msgId, isEncrypted);
    // 存入本地 SQLite
    saveMessage({
      id: msg.id, chat_id: friend.user_id, sender_id: myId,
      type: "voice", content: base64Audio, duration,
      is_read: false, created_at: msg.created_at,
    }).catch(() => {});
  };

  // 发起语音通话
  const startCall = () => {
    navigation.navigate("VoiceCall", {
      direction: "outgoing",
      targetId: friend.user_id,
      targetName: friend.nickname || friend.username,
    });
  };

  // 渲染消息气泡
  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.from === myId;
    const bubbleStyle = isMine ? styles.msgMine : styles.msgOther;
    const textStyle = isMine ? styles.msgTextMine : styles.msgTextOther;

    return (
      <View style={[styles.msgBubble, bubbleStyle]}>
        {item.type === "voice" ? (
          <VoiceMessageBubble
            duration={item.duration || 0}
            audioBase64={item.content}
            isMine={isMine}
          />
        ) : (
          <Text style={textStyle}>{item.content}</Text>
        )}
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
      {/* 顶部栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← 返回</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>
            {friend.nickname || friend.username}
          </Text>
          <View style={styles.headerInfo}>
            <Text style={[styles.onlineStatus, isOnline ? styles.online : styles.offline]}>
              {isOnline ? "在线" : "离线"}
            </Text>
            {friendPublicKey ? (
              <Text style={styles.encryptedBadge}>🔒 E2E</Text>
            ) : null}
          </View>
        </View>
        {/* 语音通话按钮 */}
        {isOnline ? (
          <TouchableOpacity onPress={startCall} style={styles.callBtn}>
            <Text style={styles.callBtnText}>📞</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
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

      {/* 输入栏：文字 + 语音 */}
      <View style={styles.inputBar}>
        <VoiceRecorder onRecordComplete={handleVoiceRecord} />
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
          onPress={sendTextMessage}
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
  headerInfo: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  onlineStatus: { fontSize: 12 },
  online: { color: "#4cd964" },
  offline: { color: "#aaa" },
  encryptedBadge: { fontSize: 11, color: "rgba(255,255,255,0.6)" },
  callBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  callBtnText: { fontSize: 20 },
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
    backgroundColor: "#fff", gap: 6,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 16,
    maxHeight: 100, backgroundColor: "#fafafa",
  },
  sendBtn: {
    backgroundColor: "#1a1a2e", borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
