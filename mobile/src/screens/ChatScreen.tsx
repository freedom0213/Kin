/** 聊天页面 — E2E 加密/文字/语音消息 + 在线状态 + 语音通话入口 + 本地存储 */

import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Alert,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kinWS } from "../api/ws";
import { useAuth } from "../stores/AuthContext";
import { encrypt, decrypt } from "../services/encryption";
import { getSecretKey } from "../services/keys";
import { VoiceRecorder, VoiceMessageBubble } from "../components/VoiceMessage";
import {
  saveMessage, getMessages, markAsRead, markChatAsRead,
} from "../services/db";

type DeliveryStatus = "sending" | "delivered" | "read" | "failed";

interface Message {
  id: string;
  from: string;
  content: string;
  type: "text" | "voice";
  duration?: number;  // 语音消息时长（秒）
  is_read: boolean;
  created_at: string;
  delivery_status?: DeliveryStatus;
}

const EMOJIS = ["😀", "😂", "🥹", "😊", "😍", "🤔", "👍", "👏", "❤️", "🎉", "🌙", "✨"];

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function LockMark() {
  return (
    <View style={styles.lockIcon}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

function MoreMark() {
  return (
    <View style={styles.moreIcon}>
      <View style={styles.moreDot} />
      <View style={styles.moreDot} />
      <View style={styles.moreDot} />
    </View>
  );
}

function SmileMark() {
  return (
    <View style={styles.smileIcon}>
      <View style={[styles.smileEye, styles.smileEyeLeft]} />
      <View style={[styles.smileEye, styles.smileEyeRight]} />
      <View style={styles.smileMouth} />
    </View>
  );
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
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isOnline, setIsOnline] = useState(friend.is_online);
  const [showMore, setShowMore] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [showEncryptionNotice, setShowEncryptionNotice] = useState(!!friend.public_key);
  const flatListRef = useRef<FlatList>(null);
  const pendingMessageIdsRef = useRef<string[]>([]);

  const [mySecretKey, setMySecretKey] = useState<string | null>(null);
  const friendPublicKey: string | null = friend.public_key || null;
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    if (!friendPublicKey) return;
    const timer = setTimeout(() => setShowEncryptionNotice(false), 2400);
    return () => clearTimeout(timer);
  }, [friendPublicKey]);

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
            delivery_status: m.sender_id === myId
              ? (m.is_read ? "read" : "delivered")
              : undefined,
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
      if (data.type === "chat_message" || data.type === "voice_message") {
        if (data.from !== friend.user_id) return;
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
        pendingMessageIdsRef.current = pendingMessageIdsRef.current.filter(
          (id) => id !== data.msg_id
        );
        setMessages((prev) => prev.map((message) => (
          message.id === data.msg_id
            ? { ...message, delivery_status: "delivered" }
            : message
        )));
      } else if (data.type === "read_receipt" && data.from === friend.user_id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === data.msg_id
            ? { ...m, is_read: true, delivery_status: "read" }
            : m))
        );
        markAsRead(data.msg_id).catch(() => {});
      } else if (data.type === "friend_status" && data.user_id === friend.user_id) {
        setIsOnline(data.is_online);
      } else if (
        data.type === "error"
        && data.code === "OFFLINE"
        && data.to === friend.user_id
      ) {
        const failedId = pendingMessageIdsRef.current.shift();
        if (failedId) {
          setMessages((prev) => prev.map((message) => (
            message.id === failedId
              ? { ...message, delivery_status: "failed" }
              : message
          )));
        }
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
      delivery_status: "sending",
    };
    pendingMessageIdsRef.current.push(msgId);
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
      delivery_status: "sending",
    };
    pendingMessageIdsRef.current.push(msgId);
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
    if (!isOnline) return;
    setShowMore(false);
    navigation.navigate("VoiceCall", {
      direction: "outgoing",
      targetId: friend.user_id,
      targetName: friend.nickname || friend.username,
    });
  };

  const showConversationDetails = () => {
    setShowMore(false);
    const meetDate = friend.meet_at?.slice(0, 10) || "未知";
    Alert.alert(
      friend.nickname || friend.username,
      `用户名：${friend.username}\n相识时间：${meetDate}\n${friendPublicKey ? "仅你和对方可读取消息" : "当前未建立加密保护"}`
    );
  };

  const showEncryptionDetails = () => {
    Alert.alert(
      "仅你和对方可读取",
      "消息会在发送设备上加密，并在对方设备上解密。Kin 服务器只负责转发加密后的内容。"
    );
  };

  const appendEmoji = (emoji: string) => {
    setInputText((current) => `${current}${emoji}`);
  };

  const getStatusMark = (message: Message): string => {
    if (message.delivery_status === "sending") return "◷";
    if (message.delivery_status === "failed") return "!";
    if (message.delivery_status === "read" || message.is_read) return "✓✓";
    return "✓";
  };

  // 渲染消息气泡
  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.from === myId;
    const bubbleStyle = isMine ? styles.msgMine : styles.msgOther;
    const textStyle = isMine ? styles.msgTextMine : styles.msgTextOther;
    const statusMark = isMine ? getStatusMark(item) : "";
    const isRead = statusMark === "✓✓";
    const isFailed = statusMark === "!";

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
        <View style={styles.messageMeta}>
          <Text style={[styles.messageTime, isMine && styles.messageTimeMine]}>
            {formatMessageTime(item.created_at)}
          </Text>
          {isMine ? (
            <Text
              style={[
                styles.deliveryStatus,
                isRead && styles.deliveryStatusRead,
                isFailed && styles.deliveryStatusFailed,
              ]}
            >
              {statusMark}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
        >
          <Text style={styles.backBtn}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>
            {friend.nickname || friend.username}
          </Text>
          <View style={styles.headerInfo}>
            <View style={[styles.headerStatusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
            <Text style={[styles.onlineStatus, isOnline ? styles.online : styles.offline]}>
              {isOnline ? "Online" : "Offline"}
            </Text>
            {friendPublicKey ? (
              <TouchableOpacity
                onPress={showEncryptionDetails}
                style={styles.lockButton}
                accessibilityRole="button"
                accessibilityLabel="查看消息加密说明"
              >
                <LockMark />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => setShowMore((visible) => !visible)}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="更多聊天功能"
        >
          <MoreMark />
        </TouchableOpacity>
      </View>

      {showEncryptionNotice ? (
        <View style={styles.encryptionNotice} accessibilityLiveRegion="polite">
          <LockMark />
          <Text style={styles.encryptionNoticeText}>仅你和对方可读取</Text>
        </View>
      ) : null}

      {!isOnline ? (
        <View style={styles.offlineNotice} accessibilityLiveRegion="polite">
          <Text style={styles.offlineNoticeMark}>!</Text>
          <Text style={styles.offlineNoticeText}>对方当前离线，暂时无法立即收到消息</Text>
        </View>
      ) : null}

      {/* 消息列表 */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.msgList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        keyboardShouldPersistTaps="handled"
      />

      {showEmojiPanel ? (
        <View style={styles.emojiPanel}>
          {EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              onPress={() => appendEmoji(emoji)}
              style={styles.emojiItem}
              accessibilityRole="button"
              accessibilityLabel={`插入表情${emoji}`}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <VoiceRecorder onRecordComplete={handleVoiceRecord} />
        <TextInput
          style={styles.input}
          placeholder="说点什么..."
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={2000}
          accessibilityLabel="消息输入框"
          onFocus={() => setShowEmojiPanel(false)}
        />
        <TouchableOpacity
          style={[styles.inputIconButton, showEmojiPanel && styles.inputIconButtonActive]}
          onPress={() => {
            Keyboard.dismiss();
            setShowEmojiPanel((visible) => !visible);
          }}
          accessibilityRole="button"
          accessibilityLabel={showEmojiPanel ? "关闭表情面板" : "打开表情面板"}
        >
          <SmileMark />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={sendTextMessage}
          disabled={!inputText.trim()}
          accessibilityRole="button"
          accessibilityLabel="发送消息"
        >
          <Text style={styles.sendBtnText}>发送</Text>
        </TouchableOpacity>
      </View>

      {showMore ? (
        <>
          <Pressable
            style={styles.menuScrim}
            onPress={() => setShowMore(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭更多功能菜单"
          />
          <View style={[styles.moreMenu, { top: Math.max(insets.top, 12) + 48 }]}>
            <TouchableOpacity
              style={[styles.menuItem, !isOnline && styles.menuItemDisabled]}
              onPress={startCall}
              disabled={!isOnline}
              accessibilityRole="button"
              accessibilityLabel="发起语音通话"
              accessibilityState={{ disabled: !isOnline }}
            >
              <Text style={styles.menuItemTitle}>语音通话</Text>
              <Text style={styles.menuItemHint}>{isOnline ? "现在呼叫" : "对方当前离线"}</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={showConversationDetails}
              accessibilityRole="button"
              accessibilityLabel="查看会话详情"
            >
              <Text style={styles.menuItemTitle}>会话详情</Text>
              <Text style={styles.menuItemHint}>资料、相识信息与隐私</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EEF0ED" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 10,
    backgroundColor: "#F4F5F2",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DDE0DC",
  },
  headerAction: {
    width: 48, height: 48, alignItems: "center", justifyContent: "center",
  },
  backBtn: { color: "#171A1F", fontSize: 36, lineHeight: 38, fontWeight: "300" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerName: { color: "#171A1F", fontSize: 17, fontWeight: "600" },
  headerInfo: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  headerStatusDot: { width: 7, height: 7, borderRadius: 4 },
  onlineDot: { backgroundColor: "#2DAD82" },
  offlineDot: { backgroundColor: "#A5A9AE" },
  onlineStatus: { fontSize: 12, fontWeight: "500" },
  online: { color: "#157454" },
  offline: { color: "#777C82" },
  lockButton: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  lockIcon: {
    width: 14, height: 16, alignItems: "center", justifyContent: "flex-end",
  },
  lockShackle: {
    position: "absolute", top: 0,
    width: 9, height: 9, borderWidth: 1.5, borderColor: "#596068",
    borderBottomWidth: 0, borderTopLeftRadius: 5, borderTopRightRadius: 5,
  },
  lockBody: {
    width: 12, height: 9, borderRadius: 2, backgroundColor: "#596068",
  },
  moreIcon: {
    width: 24, height: 24, flexDirection: "row", gap: 4,
    alignItems: "center", justifyContent: "center",
  },
  moreDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#343A40" },
  encryptionNotice: {
    minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#E2F2EC",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#C8E4DA",
  },
  encryptionNoticeText: { color: "#266A54", fontSize: 13, fontWeight: "500" },
  offlineNotice: {
    minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, backgroundColor: "#E7E8E5",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#D7D9D5",
  },
  offlineNoticeMark: {
    width: 18, height: 18, borderRadius: 9, textAlign: "center",
    color: "#62676D", fontSize: 12, lineHeight: 18, fontWeight: "700",
    borderWidth: 1, borderColor: "#878C91",
  },
  offlineNoticeText: { color: "#565B61", fontSize: 13 },
  msgList: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 20 },
  msgBubble: {
    maxWidth: "82%", minWidth: 76,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7,
    borderRadius: 18, marginBottom: 8,
  },
  msgMine: {
    alignSelf: "flex-end", backgroundColor: "#273A34", borderBottomRightRadius: 6,
  },
  msgOther: {
    alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#E0E3DF",
  },
  msgTextMine: { color: "#FFFFFF", fontSize: 16, lineHeight: 23 },
  msgTextOther: { color: "#171A1F", fontSize: 16, lineHeight: 23 },
  messageMeta: {
    alignSelf: "flex-end", flexDirection: "row", alignItems: "center",
    minHeight: 16, gap: 4, marginTop: 3,
  },
  messageTime: { color: "#858A90", fontSize: 10, fontVariant: ["tabular-nums"] },
  messageTimeMine: { color: "rgba(255,255,255,0.62)" },
  deliveryStatus: {
    minWidth: 12, color: "rgba(255,255,255,0.68)",
    fontSize: 11, fontWeight: "600", letterSpacing: -2,
  },
  deliveryStatusRead: { color: "#75E0B8" },
  deliveryStatusFailed: { color: "#FFAAA4", letterSpacing: 0 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end",
    paddingHorizontal: 8, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DDE0DC",
    backgroundColor: "#FFFFFF", gap: 6,
  },
  input: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: "#DDE0DC", borderRadius: 22,
    paddingHorizontal: 15, paddingVertical: 10, fontSize: 16, lineHeight: 22,
    maxHeight: 112, backgroundColor: "#F7F8F6", color: "#171A1F",
  },
  inputIconButton: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center", backgroundColor: "#F0F2EF",
  },
  inputIconButtonActive: { backgroundColor: "#DDF3EB" },
  smileIcon: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.7, borderColor: "#4E555B",
  },
  smileEye: {
    position: "absolute", top: 6, width: 2.5, height: 2.5,
    borderRadius: 2, backgroundColor: "#4E555B",
  },
  smileEyeLeft: { left: 5 },
  smileEyeRight: { right: 5 },
  smileMouth: {
    position: "absolute", left: 5, right: 5, bottom: 4,
    height: 5, borderBottomWidth: 1.7, borderColor: "#4E555B",
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  sendBtn: {
    minWidth: 58, height: 44, backgroundColor: "#273A34", borderRadius: 22,
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#D9DCD8" },
  sendBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  emojiPanel: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DDE0DC",
  },
  emojiItem: {
    width: "16.66%", minHeight: 44, alignItems: "center", justifyContent: "center",
  },
  emojiText: { fontSize: 25 },
  menuScrim: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 10, backgroundColor: "rgba(0,0,0,0.12)",
  },
  moreMenu: {
    position: "absolute", right: 12, zIndex: 20, width: 224,
    backgroundColor: "#FFFFFF", borderRadius: 14, overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#D9DCD8",
    shadowColor: "#000000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16, shadowRadius: 18, elevation: 8,
  },
  menuItem: { minHeight: 68, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center" },
  menuItemDisabled: { opacity: 0.42 },
  menuItemTitle: { color: "#171A1F", fontSize: 15, fontWeight: "600" },
  menuItemHint: { color: "#6D7278", fontSize: 12, marginTop: 3 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#E3E5E1", marginLeft: 16 },
});
