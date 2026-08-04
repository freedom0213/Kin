/** 聊天页面 — E2E 加密/文字/语音消息 + 在线状态 + 语音通话入口 + 本地存储 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform, Keyboard,
  Animated, AccessibilityInfo, Clipboard, Easing,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kinWS } from "../api/ws";
import { getFriendList, type Friend } from "../api/client";
import { useAuth } from "../stores/AuthContext";
import { encrypt } from "../services/encryption";
import { getSecretKey } from "../services/keys";
import { VoiceRecorder, VoiceMessageBubble } from "../components/VoiceMessage";
import { useKinDialog } from "../components/KinDialog";
import {
  saveMessage, getMessages, markAsRead, markChatAsRead,
  updateMessageDeliveryStatus, deleteMessage,
} from "../services/db";
import { mergeFriendProfile, parseFriendProfileEvent } from "../services/friendProfile";
import { webrtcService } from "../services/webrtc";
import {
  isMessageListNearBottom,
  shouldAutoScrollAfterContentChange,
} from "../services/chatScrollPolicy";
import {
  GRAPHITE_COLORS,
  GRAPHITE_INPUT_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

type DeliveryStatus = "sending" | "queued" | "delivered" | "read" | "failed";
type EncryptionState = "loading" | "ready" | "missing_peer_key" | "missing_local_key" | "error";

interface Message {
  id: string;
  from: string;
  content: string;
  type: "text" | "voice";
  duration?: number;  // 语音消息时长（秒）
  is_read: boolean;
  created_at: string;
  delivery_status?: DeliveryStatus;
  encrypted?: boolean;
  wire_content?: string;
}

type InputMode = "text" | "voice";

const EMOJIS = ["😀", "😂", "🥹", "😊", "😍", "🤔", "👍", "👏", "❤️", "🎉", "🌙", "✨"];
const WEB_SCROLL_TRACK_INSET = 8;
const WEB_SCROLL_THUMB_HEIGHT = 42;

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getEncryptionIssueCopy(state: EncryptionState): string {
  if (state === "loading") return "正在验证这台设备的加密保护…";
  if (state === "missing_peer_key") return "对方尚未建立加密保护，暂时不能发送新消息";
  if (state === "missing_local_key") return "当前设备缺少加密密钥，暂时不能发送新消息";
  if (state === "error") return "无法读取本机加密密钥，请重新进入会话";
  return "";
}

function getWebComposerHeight(value: string): number {
  if (!value) return 48;
  const visualLines = value.split("\n").reduce((total, line) => (
    total + Math.max(1, Math.ceil(Array.from(line).length / 18))
  ), 0);
  return Math.min(112, 48 + Math.max(0, visualLines - 1) * 22);
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

function VoiceModeMark() {
  return (
    <View style={styles.voiceModeIcon}>
      <View style={styles.voiceModeCapsule} />
      <View style={styles.voiceModeArc} />
      <View style={styles.voiceModeStem} />
      <View style={styles.voiceModeBase} />
    </View>
  );
}

function KeyboardModeMark() {
  return (
    <View style={styles.keyboardModeIcon}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.keyboardModeRow}>
          {[0, 1, 2, 3].map((column) => (
            <View key={column} style={styles.keyboardModeKey} />
          ))}
        </View>
      ))}
      <View style={styles.keyboardModeSpace} />
    </View>
  );
}

function TypingIndicator() {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      dots.forEach((dot) => dot.setValue(0.55));
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.stagger(120, dots.map((dot) => Animated.sequence([
          Animated.timing(dot, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
        ]))),
        Animated.delay(260),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [dots, reduceMotion]);

  return (
    <View
      style={styles.typingBubble}
      accessibilityLabel="对方正在输入"
      accessibilityLiveRegion="polite"
    >
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.42, 1] }),
              transform: [{
                translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }),
              }],
            },
          ]}
        />
      ))}
    </View>
  );
}

type RippleSide = "mine" | "other";

function MessageEntry({
  isMine,
  animate,
  reduceMotion,
  onAnimationClaimed,
  children,
}: {
  isMine: boolean;
  animate: boolean;
  reduceMotion: boolean;
  onAnimationClaimed: () => void;
  children: ReactNode;
}) {
  const progress = useRef(new Animated.Value(animate && !reduceMotion ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    onAnimationClaimed();
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, onAnimationClaimed, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.messageEntry,
        {
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [isMine ? 6 : -6, 0],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function ChatAmbientBackground({
  isOnline,
  pulseKey,
  pulseSide,
}: {
  isOnline: boolean;
  pulseKey: number;
  pulseSide: RippleSide;
}) {
  const driftOne = useRef(new Animated.Value(0)).current;
  const driftTwo = useRef(new Animated.Value(1)).current;
  const onlineLayer = useRef(new Animated.Value(isOnline ? 1 : 0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    Animated.timing(onlineLayer, {
      toValue: isOnline ? 1 : 0,
      duration: reduceMotion ? 0 : 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isOnline, onlineLayer, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      driftOne.stopAnimation();
      driftTwo.stopAnimation();
      driftOne.setValue(0.35);
      driftTwo.setValue(0.65);
      return;
    }

    const duration = isOnline ? 11_000 : 17_000;
    const motion = Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(driftOne, {
          toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(driftOne, {
          toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(driftTwo, {
          toValue: 0, duration: duration + 2400,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(driftTwo, {
          toValue: 1, duration: duration + 2400,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ])),
    ]);
    motion.start();
    return () => motion.stop();
  }, [driftOne, driftTwo, isOnline, reduceMotion]);

  useEffect(() => {
    if (pulseKey === 0 || reduceMotion) return;
    ripple.stopAnimation();
    ripple.setValue(0);
    Animated.timing(ripple, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pulseKey, reduceMotion, ripple]);

  const driftOneStyle = {
    transform: [
      { translateX: driftOne.interpolate({ inputRange: [0, 1], outputRange: [-18, 32] }) },
      { translateY: driftOne.interpolate({ inputRange: [0, 1], outputRange: [-10, 28] }) },
      { scale: driftOne.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] }) },
    ],
  };
  const driftTwoStyle = {
    transform: [
      { translateX: driftTwo.interpolate({ inputRange: [0, 1], outputRange: [24, -28] }) },
      { translateY: driftTwo.interpolate({ inputRange: [0, 1], outputRange: [18, -24] }) },
      { scale: driftTwo.interpolate({ inputRange: [0, 1], outputRange: [1.06, 0.92] }) },
    ],
  };
  const rippleStyle = {
    opacity: ripple.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0.32, 0] }),
    transform: [{
      scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.4, 3.4] }),
    }],
  };

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={styles.ambientRoot}
    >
      <View style={styles.ambientBase} />
      <Animated.View style={[styles.ambientBlob, styles.ambientBlobMutedOne, driftOneStyle]} />
      <Animated.View style={[styles.ambientBlob, styles.ambientBlobMutedTwo, driftTwoStyle]} />
      <Animated.View style={[styles.ambientOnlineLayer, { opacity: onlineLayer }]}>
        <Animated.View style={[styles.ambientBlob, styles.ambientBlobOnlineOne, driftOneStyle]} />
        <Animated.View style={[styles.ambientBlob, styles.ambientBlobOnlineTwo, driftTwoStyle]} />
      </Animated.View>
      {pulseKey > 0 && !reduceMotion ? (
        <Animated.View
          style={[
            styles.messageRipple,
            pulseSide === "mine" ? styles.messageRippleMine : styles.messageRippleOther,
            rippleStyle,
          ]}
        />
      ) : null}
    </View>
  );
}

let _msgCounter = 0;
function genMsgId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}_${randomPart}_${++_msgCounter}`;
}

export default function ChatScreen({ route }: any) {
  const [friend, setFriend] = useState<Friend>(route.params.friend);
  const { state } = useAuth();
  const myId = state.user?.id || "";
  const navigation = useNavigation<any>();
  const { showDialog, dialog } = useKinDialog();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isOnline, setIsOnline] = useState(friend.is_online);
  const [showMore, setShowMore] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [backgroundPulse, setBackgroundPulse] = useState<{
    key: number;
    side: RippleSide;
  }>({ key: 0, side: "other" });
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const sendButtonScale = useRef(new Animated.Value(1)).current;
  const encryptionNoticeOpacity = useRef(new Animated.Value(0)).current;
  const animatedMessageIdsRef = useRef(new Map<string, number>());
  const lastBackgroundPulseAtRef = useRef(0);
  const userNearBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(true);
  const explicitScrollPendingRef = useRef(false);
  const lastTypingSentRef = useRef(0);
  const typingHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryingMessageIdsRef = useRef(new Set<string>());
  const webScrollThumbY = useRef(new Animated.Value(0)).current;
  const webScrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const webScrollVisibleRef = useRef(false);

  const [mySecretKey, setMySecretKey] = useState<string | null>(null);
  const [localKeyState, setLocalKeyState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [inputHeight, setInputHeight] = useState(48);
  const [showWebScrollIndicator, setShowWebScrollIndicator] = useState(false);
  const friendPublicKey: string | null = friend.public_key || null;
  const [loadingHistory, setLoadingHistory] = useState(true);
  const encryptionState: EncryptionState = !friendPublicKey
    ? "missing_peer_key"
    : localKeyState === "ready"
      ? "ready"
      : localKeyState === "missing"
        ? "missing_local_key"
        : localKeyState;
  const isEncryptionReady = encryptionState === "ready";

  const triggerBackgroundPulse = (side: RippleSide) => {
    const now = Date.now();
    if (now - lastBackgroundPulseAtRef.current < 280) return;
    lastBackgroundPulseAtRef.current = now;
    setBackgroundPulse((current) => ({ key: current.key + 1, side }));
  };

  const updateWebScrollIndicator = (metrics: Partial<{
    contentHeight: number;
    viewportHeight: number;
    offsetY: number;
  }>) => {
    if (Platform.OS !== "web") return;
    webScrollMetricsRef.current = { ...webScrollMetricsRef.current, ...metrics };
    const { contentHeight, viewportHeight, offsetY } = webScrollMetricsRef.current;
    const scrollableHeight = Math.max(0, contentHeight - viewportHeight);
    const shouldShow = scrollableHeight > 1 && viewportHeight > WEB_SCROLL_THUMB_HEIGHT;
    if (webScrollVisibleRef.current !== shouldShow) {
      webScrollVisibleRef.current = shouldShow;
      setShowWebScrollIndicator(shouldShow);
    }
    const trackHeight = Math.max(0, viewportHeight - WEB_SCROLL_TRACK_INSET * 2);
    const travel = Math.max(0, trackHeight - WEB_SCROLL_THUMB_HEIGHT);
    const progress = scrollableHeight > 0
      ? Math.max(0, Math.min(1, offsetY / scrollableHeight))
      : 0;
    webScrollThumbY.setValue(progress * travel);
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    encryptionNoticeOpacity.stopAnimation();
    if (!isFocused || !isEncryptionReady) {
      encryptionNoticeOpacity.setValue(0);
      return;
    }

    encryptionNoticeOpacity.setValue(1);
    const animation = Animated.sequence([
      Animated.delay(2000),
      Animated.timing(encryptionNoticeOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [encryptionNoticeOpacity, isEncryptionReady, isFocused, reduceMotion]);

  const handleMessageListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
    updateWebScrollIndicator({
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: contentOffset.y,
    });
    const isNearBottom = isMessageListNearBottom({
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: contentOffset.y,
    });
    userNearBottomRef.current = isNearBottom;
    if (isNearBottom) setHasNewMessages(false);
  };

  const handleMessageListContentChange = (_width: number, contentHeight: number) => {
    updateWebScrollIndicator({ contentHeight });
    if (loadingHistory) return;

    const shouldScroll = shouldAutoScrollAfterContentChange({
      initialScrollPending: initialScrollPendingRef.current,
      explicitScrollPending: explicitScrollPendingRef.current,
      userNearBottom: userNearBottomRef.current,
    });

    initialScrollPendingRef.current = false;
    explicitScrollPendingRef.current = false;
    if (!shouldScroll) return;

    flatListRef.current?.scrollToEnd({ animated: !userNearBottomRef.current });
    userNearBottomRef.current = true;
    setHasNewMessages(false);
  };

  useEffect(() => {
    if (loadingHistory) return;
    const shouldPrimeScroll = shouldAutoScrollAfterContentChange({
      initialScrollPending: initialScrollPendingRef.current,
      explicitScrollPending: explicitScrollPendingRef.current,
      userNearBottom: userNearBottomRef.current,
    });
    if (!shouldPrimeScroll) return;

    const frame = requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({
        animated: explicitScrollPendingRef.current && !userNearBottomRef.current,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [loadingHistory, messages.length]);

  const scrollToLatestMessage = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    userNearBottomRef.current = true;
    setHasNewMessages(false);
  };

  useEffect(() => {
    let active = true;
    getSecretKey(myId)
      .then((secretKey) => {
        if (!active) return;
        setMySecretKey(secretKey);
        setLocalKeyState(secretKey ? "ready" : "missing");
      })
      .catch(() => {
        if (!active) return;
        setMySecretKey(null);
        setLocalKeyState("error");
      });
    return () => { active = false; };
  }, [myId]);

  // 加载私钥 + 本地历史消息
  useEffect(() => {
    (async () => {
      try {
        const history = await getMessages(myId, friend.user_id, 50);
        if (history.length > 0) {
          setMessages(history.map((m) => ({
            id: m.id, from: m.sender_id, content: m.content,
            type: m.type, duration: m.duration,
            is_read: m.is_read, created_at: m.created_at,
            delivery_status: m.sender_id === myId
              ? (m.delivery_status || (m.is_read ? "read" : "delivered"))
              : undefined,
            encrypted: m.encrypted,
            wire_content: m.wire_content || undefined,
          })));
        }
        for (const message of history) {
          if (message.sender_id !== myId && !message.is_read) {
            kinWS.sendReadReceipt(friend.user_id, message.id);
          }
        }
        await markChatAsRead(myId, friend.user_id);
      } catch { /* 本地加载失败不阻塞 */ }
      setLoadingHistory(false);
    })();
  }, [friend.user_id, myId]);

  // WebSocket 消息监听
  useEffect(() => {
    const onMessage = (data: any) => {
      if (data.type === "inbox_message") {
        if (data.from !== friend.user_id) return;
        const shouldFollowMessage = userNearBottomRef.current;
        setIsTyping(false);
        if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);

        const msg: Message = {
          id: data.msg_id || genMsgId(),
          from: data.from,
          content: data.content,
          type: data.message_type === "voice" ? "voice" : "text",
          duration: data.message_type === "voice" ? (data.duration || 0) : undefined,
          is_read: true,
          created_at: data.created_at || new Date().toISOString(),
        };
        setMessages((prev) => {
          if (prev.some((item) => item.id === msg.id)) return prev;
          animatedMessageIdsRef.current.set(msg.id, Date.now());
          return [...prev, msg];
        });
        if (!shouldFollowMessage) setHasNewMessages(true);
        triggerBackgroundPulse("other");
        kinWS.sendReadReceipt(friend.user_id, msg.id);
        markAsRead(myId, msg.id).catch(() => {});
      } else if (data.type === "queued" && data.to === friend.user_id) {
        setMessages((prev) => prev.map((message) => (
          message.id === data.msg_id
            ? { ...message, delivery_status: "queued" }
            : message
        )));
      } else if (data.type === "delivered" && data.to === friend.user_id) {
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
        markAsRead(myId, data.msg_id).catch(() => {});
      } else if (data.type === "message_status" && data.to === friend.user_id) {
        if (!["queued", "delivered", "read"].includes(data.status)) return;
        setMessages((prev) => prev.map((message) => (
          message.id === data.msg_id
            ? {
              ...message,
              is_read: data.status === "read" ? true : message.is_read,
              delivery_status: data.status as DeliveryStatus,
            }
            : message
        )));
      } else if (data.type === "friend_status" && data.user_id === friend.user_id) {
        setIsOnline(data.is_online);
        if (!data.is_online) setIsTyping(false);
      } else if (data.type === "friend_profile") {
        const update = parseFriendProfileEvent(data);
        if (update?.user_id === friend.user_id) {
          setFriend((current) => mergeFriendProfile(current, update));
        }
      } else if (data.type === "resumed") {
        void getFriendList().then((result) => {
          const refreshedFriend = result.friends.find((item) => item.user_id === friend.user_id);
          if (!refreshedFriend) return;
          setFriend(refreshedFriend);
          setIsOnline(!!refreshedFriend.is_online);
          if (!refreshedFriend.is_online) setIsTyping(false);
        }).catch(() => {});
      } else if (data.type === "typing" && data.from === friend.user_id) {
        setIsTyping(true);
        if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);
        typingHideTimerRef.current = setTimeout(() => {
          setIsTyping(false);
          typingHideTimerRef.current = null;
        }, 1800);
      } else if (
        data.type === "error"
        && data.to === friend.user_id
      ) {
        const failedId = data.msg_id;
        if (failedId) {
          setMessages((prev) => prev.map((message) => (
            message.id === failedId
              ? { ...message, delivery_status: "failed" }
              : message
          )));
        }
      }
    };

    kinWS.on("inbox_message", onMessage);
    kinWS.on("queued", onMessage);
    kinWS.on("delivered", onMessage);
    kinWS.on("read_receipt", onMessage);
    kinWS.on("message_status", onMessage);
    kinWS.on("friend_status", onMessage);
    kinWS.on("friend_profile", onMessage);
    kinWS.on("resumed", onMessage);
    kinWS.on("typing", onMessage);
    kinWS.on("error", onMessage);

    return () => {
      kinWS.off("inbox_message", onMessage);
      kinWS.off("queued", onMessage);
      kinWS.off("delivered", onMessage);
      kinWS.off("read_receipt", onMessage);
      kinWS.off("message_status", onMessage);
      kinWS.off("friend_status", onMessage);
      kinWS.off("friend_profile", onMessage);
      kinWS.off("resumed", onMessage);
      kinWS.off("typing", onMessage);
      kinWS.off("error", onMessage);
      if (typingHideTimerRef.current) {
        clearTimeout(typingHideTimerRef.current);
        typingHideTimerRef.current = null;
      }
    };
  }, [friend.user_id, myId]);

  // 发送文字消息
  const sendTextMessage = async () => {
    const text = inputText.trim();
    if (!text) return;
    if (!friendPublicKey || !mySecretKey) {
      showDialog({ title: "暂时不能发送", message: getEncryptionIssueCopy(encryptionState) });
      return;
    }

    const msgId = genMsgId();
    let contentToSend: string;
    try {
      contentToSend = encrypt(text, friendPublicKey, mySecretKey);
    } catch {
      showDialog({ title: "发送失败", message: "消息加密失败，请稍后重试。" });
      return;
    }

    const msg: Message = {
      id: msgId, from: myId, content: text,
      type: "text", is_read: false,
      created_at: new Date().toISOString(),
      delivery_status: "sending",
      encrypted: true,
      wire_content: contentToSend,
    };
    explicitScrollPendingRef.current = true;
    animatedMessageIdsRef.current.set(msg.id, Date.now());
    setMessages((prev) => [...prev, msg]);
    triggerBackgroundPulse("mine");
    setInputText("");
    setInputHeight(48);
    try {
      await saveMessage(myId, {
        id: msg.id, chat_id: friend.user_id, sender_id: myId,
        type: "text", content: text, is_read: false,
        encrypted: true, wire_content: contentToSend,
        delivery_status: "sending", created_at: msg.created_at,
      });
      kinWS.sendMessage(friend.user_id, contentToSend, msgId, true);
    } catch {
      setMessages((prev) => prev.map((message) => (
        message.id === msgId ? { ...message, delivery_status: "failed" } : message
      )));
    }
  };

  // 语音录制完成回调
  const handleVoiceRecord = async (base64Audio: string, duration: number) => {
    if (!friendPublicKey || !mySecretKey) {
      showDialog({ title: "暂时不能发送", message: getEncryptionIssueCopy(encryptionState) });
      return;
    }
    const msgId = genMsgId();
    let contentToSend: string;
    try {
      contentToSend = encrypt(base64Audio, friendPublicKey, mySecretKey);
    } catch {
      showDialog({ title: "发送失败", message: "语音消息加密失败，请稍后重试。" });
      return;
    }

    const msg: Message = {
      id: msgId, from: myId, content: base64Audio,
      type: "voice", duration, is_read: false,
      created_at: new Date().toISOString(),
      delivery_status: "sending",
      encrypted: true,
      wire_content: contentToSend,
    };
    explicitScrollPendingRef.current = true;
    animatedMessageIdsRef.current.set(msg.id, Date.now());
    setMessages((prev) => [...prev, msg]);
    triggerBackgroundPulse("mine");
    try {
      await saveMessage(myId, {
        id: msg.id, chat_id: friend.user_id, sender_id: myId,
        type: "voice", content: base64Audio, duration,
        is_read: false, encrypted: true, wire_content: contentToSend,
        delivery_status: "sending", created_at: msg.created_at,
      });
      kinWS.sendVoiceMessage(friend.user_id, contentToSend, duration, msgId, true);
    } catch {
      setMessages((prev) => prev.map((message) => (
        message.id === msgId ? { ...message, delivery_status: "failed" } : message
      )));
    }
  };

  // 发起语音通话
  const startCall = () => {
    if (!isOnline) return;
    if (webrtcService.hasActiveCall()) {
      setShowMore(false);
      showDialog({ title: "通话正在进行", message: "请先结束当前语音通话，再发起新的通话。" });
      return;
    }
    setShowMore(false);
    navigation.navigate("VoiceCall", {
      direction: "outgoing",
      targetId: friend.user_id,
      targetName: friend.nickname || friend.username,
    });
  };

  const showConversationDetails = () => {
    setShowMore(false);
    navigation.navigate("ConversationDetails", { friend });
  };

  useEffect(() => {
    if (route.params?.historyClearedAt) {
      setMessages([]);
      setHasNewMessages(false);
    }
  }, [route.params?.historyClearedAt]);

  const showEncryptionDetails = () => {
    if (isEncryptionReady) {
      showDialog({
        title: "仅你和对方可读取",
        message: "新消息会在发送设备上加密，并在对方设备上解密。Kin 服务器只负责转发加密后的内容。",
      });
      return;
    }
    showDialog({ title: "加密保护不可用", message: getEncryptionIssueCopy(encryptionState) });
  };

  const notifyTyping = () => {
    const now = Date.now();
    if (!isOnline || !isEncryptionReady || now - lastTypingSentRef.current < 900) return;
    lastTypingSentRef.current = now;
    kinWS.sendTyping(friend.user_id);
  };

  const handleInputChange = (text: string) => {
    setInputText(text);
    if (Platform.OS === "web") setInputHeight(getWebComposerHeight(text));
    if (text.trim()) notifyTyping();
  };

  const selectInputMode = (mode: InputMode) => {
    setInputMode(mode);
    setShowEmojiPanel(false);
    if (mode === "voice") {
      Keyboard.dismiss();
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const appendEmoji = (emoji: string) => {
    setInputMode("text");
    setInputText((current) => `${current}${emoji}`);
    notifyTyping();
  };

  const animateSendButton = (pressed: boolean) => {
    if (reduceMotion) return;
    Animated.timing(sendButtonScale, {
      toValue: pressed ? 0.94 : 1,
      duration: pressed ? 80 : 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const getStatusMark = (message: Message): string => {
    if (message.delivery_status === "sending" || message.delivery_status === "queued") return "◷";
    if (message.delivery_status === "failed") return "!";
    if (message.delivery_status === "read" || message.is_read) return "✓✓";
    return "✓";
  };

  const retryMessage = async (message: Message) => {
    if (
      message.from !== myId
      || message.delivery_status !== "failed"
      || retryingMessageIdsRef.current.has(message.id)
    ) return;

    let contentToSend: string;
    if (message.encrypted && message.wire_content) {
      contentToSend = message.wire_content;
    } else if (friendPublicKey && mySecretKey) {
      try {
        contentToSend = encrypt(message.content, friendPublicKey, mySecretKey);
      } catch {
        showDialog({ title: "重试失败", message: "消息加密失败，请稍后再试。" });
        return;
      }
    } else {
      showDialog({ title: "暂时无法重试", message: getEncryptionIssueCopy(encryptionState) });
      return;
    }

    retryingMessageIdsRef.current.add(message.id);
    setMessages((current) => current.map((item) => (
      item.id === message.id
        ? {
          ...item,
          delivery_status: "sending",
          encrypted: true,
          wire_content: contentToSend,
        }
        : item
    )));

    try {
      await saveMessage(myId, {
        id: message.id,
        chat_id: friend.user_id,
        sender_id: myId,
        type: message.type,
        content: message.content,
        duration: message.duration,
        is_read: false,
        encrypted: true,
        wire_content: contentToSend,
        delivery_status: "sending",
        created_at: message.created_at,
      });
      if (message.type === "voice") {
        kinWS.sendVoiceMessage(
          friend.user_id,
          contentToSend,
          message.duration || 0,
          message.id,
          true
        );
      } else {
        kinWS.sendMessage(friend.user_id, contentToSend, message.id, true);
      }
    } catch {
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, delivery_status: "failed" } : item
      )));
      void updateMessageDeliveryStatus(myId, message.id, "failed").catch(() => undefined);
      showDialog({ title: "重试失败", message: "无法保存待发送消息，请检查设备存储后再试。" });
    } finally {
      retryingMessageIdsRef.current.delete(message.id);
    }
  };

  const deleteLocalMessage = (message: Message) => {
    showDialog({
      title: "从本机删除这条消息？",
      message: "这只会清除当前设备中的记录，不会撤回消息，也不会删除对方设备上的内容。",
      actions: [
        { text: "取消", tone: "cancel" },
        {
          text: "从本机删除",
          tone: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteMessage(myId, message.id);
                retryingMessageIdsRef.current.delete(message.id);
                setMessages((current) => current.filter((item) => item.id !== message.id));
              } catch {
                showDialog({ title: "删除失败", message: "无法修改本机聊天记录，请稍后再试。" });
              }
            })();
          },
        },
      ],
    });
  };

  const showMessageActions = (message: Message) => {
    const actions = [
      ...(message.type === "text"
        ? [{
          text: "复制文字",
          onPress: () => {
            Clipboard.setString(message.content);
            showDialog({ title: "已复制", message: "消息文字已复制到剪贴板。" });
          },
        }]
        : []),
      {
        text: "从本机删除",
        tone: "destructive" as const,
        onPress: () => deleteLocalMessage(message),
      },
      { text: "取消", tone: "cancel" as const },
    ];
    showDialog({
      title: message.type === "text" ? "消息操作" : "语音消息操作",
      message: "删除操作只影响当前设备。",
      actions,
    });
  };

  // 渲染消息气泡
  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.from === myId;
    const animationQueuedAt = animatedMessageIdsRef.current.get(item.id) || 0;
    const shouldAnimate = Date.now() - animationQueuedAt < 2_000;
    if (animationQueuedAt && !shouldAnimate) animatedMessageIdsRef.current.delete(item.id);
    const bubbleStyle = isMine ? styles.msgMine : styles.msgOther;
    const textStyle = isMine ? styles.msgTextMine : styles.msgTextOther;
    const statusMark = isMine ? getStatusMark(item) : "";
    const isRead = statusMark === "✓✓";
    const isFailed = statusMark === "!";

    return (
      <MessageEntry
        isMine={isMine}
        animate={shouldAnimate}
        reduceMotion={reduceMotion}
        onAnimationClaimed={() => animatedMessageIdsRef.current.delete(item.id)}
      >
        <Pressable
          style={[styles.msgBubble, bubbleStyle]}
          onLongPress={() => showMessageActions(item)}
          delayLongPress={360}
          accessibilityHint={item.type === "text" ? "长按可以复制或从本机删除" : "长按可以从本机删除"}
        >
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
              isFailed ? (
                <TouchableOpacity
                  style={styles.retryStatusButton}
                  onPress={() => { void retryMessage(item); }}
                  hitSlop={{ top: 13, right: 13, bottom: 13, left: 13 }}
                  accessibilityRole="button"
                  accessibilityLabel="消息发送失败"
                  accessibilityHint="轻点重新发送"
                >
                  <Text style={[styles.deliveryStatus, styles.deliveryStatusFailed]}>!</Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={[
                    styles.deliveryStatus,
                    isRead && styles.deliveryStatusRead,
                  ]}
                >
                  {statusMark}
                </Text>
              )
            ) : null}
          </View>
        </Pressable>
      </MessageEntry>
    );
  };

  const sendDisabled = inputMode === "voice" || !inputText.trim() || !isEncryptionReady;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {isFocused ? <ExpoStatusBar style="light" /> : null}
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
            <TouchableOpacity
              onPress={showEncryptionDetails}
              style={styles.lockButton}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              accessibilityRole="button"
              accessibilityLabel={isEncryptionReady ? "查看消息加密说明" : "查看加密保护问题"}
            >
              {isEncryptionReady ? <LockMark /> : <Text style={styles.securityWarningMark}>!</Text>}
            </TouchableOpacity>
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

      {!isEncryptionReady ? (
        <View
          style={[styles.securityNotice, encryptionState === "loading" && styles.securityNoticeLoading]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.securityNoticeMark}>{encryptionState === "loading" ? "·" : "!"}</Text>
          <Text style={styles.securityNoticeText}>{getEncryptionIssueCopy(encryptionState)}</Text>
        </View>
      ) : null}

      {!isOnline && isEncryptionReady ? (
        <View style={styles.offlineNotice} accessibilityLiveRegion="polite">
          <Text style={styles.offlineNoticeMark}>!</Text>
          <Text style={styles.offlineNoticeText}>对方当前离线，消息将在其上线后送达</Text>
        </View>
      ) : null}

      <ChatAmbientBackground
        isOnline={isOnline}
        pulseKey={backgroundPulse.key}
        pulseSide={backgroundPulse.side}
      />

      {/* 消息列表 */}
      <View
        style={styles.messageViewport}
        onLayout={({ nativeEvent }) => {
          updateWebScrollIndicator({ viewportHeight: nativeEvent.layout.height });
        }}
      >
        {isEncryptionReady ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.encryptionNotice, { opacity: encryptionNoticeOpacity }]}
            accessibilityLiveRegion="polite"
          >
            <LockMark />
            <Text style={styles.encryptionNoticeText}>仅你和对方可读取</Text>
          </Animated.View>
        ) : null}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          style={styles.messageList}
          contentContainerStyle={styles.msgList}
          onScroll={handleMessageListScroll}
          onContentSizeChange={handleMessageListContentChange}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={Platform.OS !== "web"}
        />
        {Platform.OS === "web" && showWebScrollIndicator ? (
          <View
            pointerEvents="none"
            style={styles.webScrollTrack}
            importantForAccessibility="no-hide-descendants"
          >
            <Animated.View
              style={[
                styles.webScrollThumb,
                { transform: [{ translateY: webScrollThumbY }] },
              ]}
            />
          </View>
        ) : null}
      </View>

      {hasNewMessages ? (
        <TouchableOpacity
          style={styles.newMessageButton}
          onPress={scrollToLatestMessage}
          accessibilityRole="button"
          accessibilityLabel="查看新消息"
        >
          <Text style={styles.newMessageButtonText}>有新消息 ↓</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.typingSlot} pointerEvents="none">
        {isTyping ? <TypingIndicator /> : null}
      </View>

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
        <TouchableOpacity
          style={styles.inputIconButton}
          onPress={() => selectInputMode(inputMode === "text" ? "voice" : "text")}
          accessibilityRole="button"
          accessibilityLabel={inputMode === "text" ? "切换到语音模式" : "切换到文字模式"}
          accessibilityHint={inputMode === "text" ? "显示按住说话按钮" : "恢复消息输入框并打开键盘"}
        >
          {inputMode === "text" ? <VoiceModeMark /> : <KeyboardModeMark />}
        </TouchableOpacity>
        {inputMode === "text" ? (
          <TextInput
            ref={inputRef}
            style={[styles.input, { height: inputHeight }]}
            placeholder={isEncryptionReady ? "说点什么..." : "加密保护不可用"}
            value={inputText}
            onChangeText={handleInputChange}
            placeholderTextColor={GRAPHITE_INPUT_COLORS.placeholder}
            cursorColor={GRAPHITE_INPUT_COLORS.cursor}
            selectionColor={GRAPHITE_INPUT_COLORS.selection}
            multiline
            numberOfLines={1}
            textAlignVertical={inputHeight > 52 ? "top" : "center"}
            onContentSizeChange={({ nativeEvent }) => {
              if (Platform.OS === "web") return;
              const nextHeight = Math.max(
                48,
                Math.min(112, Math.ceil(nativeEvent.contentSize.height) + 20),
              );
              setInputHeight((current) => current === nextHeight ? current : nextHeight);
            }}
            maxLength={2000}
            accessibilityLabel="消息输入框"
            onFocus={() => setShowEmojiPanel(false)}
          />
        ) : (
          <VoiceRecorder
            display="hold"
            onRecordComplete={handleVoiceRecord}
            disabled={!isEncryptionReady}
          />
        )}
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
        <Animated.View
          style={[styles.sendButtonShell, { transform: [{ scale: sendButtonScale }] }]}
        >
          <TouchableOpacity
            style={[
              styles.sendBtn,
              sendDisabled && styles.sendBtnDisabled,
            ]}
            onPress={() => { void sendTextMessage(); }}
            onPressIn={() => animateSendButton(true)}
            onPressOut={() => animateSendButton(false)}
            disabled={sendDisabled}
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            accessibilityState={{
              disabled: sendDisabled,
            }}
          >
            <Text style={[styles.sendBtnText, sendDisabled && styles.sendBtnTextDisabled]}>发送</Text>
          </TouchableOpacity>
        </Animated.View>
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
      {dialog}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  ambientRoot: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 0, overflow: "hidden",
  },
  ambientBase: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: GRAPHITE_COLORS.canvas,
  },
  ambientOnlineLayer: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: "rgba(0,0,0,0.10)", overflow: "hidden",
  },
  ambientBlob: { position: "absolute", borderRadius: 999 },
  ambientBlobMutedOne: {
    width: 280, height: 280, top: "9%", left: -96,
    backgroundColor: "rgba(235,242,237,0.022)",
  },
  ambientBlobMutedTwo: {
    width: 330, height: 330, right: -148, bottom: "7%",
    backgroundColor: "rgba(235,242,237,0.018)",
  },
  ambientBlobOnlineOne: {
    width: 280, height: 280, top: "9%", left: -96,
    backgroundColor: "rgba(235,242,237,0.040)",
  },
  ambientBlobOnlineTwo: {
    width: 330, height: 330, right: -148, bottom: "7%",
    backgroundColor: "rgba(235,242,237,0.030)",
  },
  messageRipple: {
    position: "absolute", top: "42%", width: 72, height: 72, borderRadius: 36,
    borderWidth: 1.5, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  messageRippleMine: { right: -8 },
  messageRippleOther: { left: -8 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 10,
    zIndex: 3,
    backgroundColor: GRAPHITE_COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GRAPHITE_COLORS.line,
  },
  headerAction: {
    width: 48, height: 48, alignItems: "center", justifyContent: "center",
  },
  backBtn: { color: GRAPHITE_COLORS.text, fontSize: 36, lineHeight: 38, fontWeight: "300" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerName: { color: GRAPHITE_COLORS.text, fontSize: 17, fontWeight: "700" },
  headerInfo: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  headerStatusDot: { width: 7, height: 7, borderRadius: 4 },
  onlineDot: { backgroundColor: GRAPHITE_COLORS.primary },
  offlineDot: { backgroundColor: GRAPHITE_COLORS.textFaint },
  onlineStatus: { fontSize: 12, fontWeight: "500" },
  online: { color: GRAPHITE_COLORS.primary },
  offline: { color: GRAPHITE_COLORS.textMuted },
  lockButton: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  securityWarningMark: { color: GRAPHITE_COLORS.warning, fontSize: 15, fontWeight: "800" },
  lockIcon: {
    width: 14, height: 16, alignItems: "center", justifyContent: "flex-end",
  },
  lockShackle: {
    position: "absolute", top: 0,
    width: 9, height: 9, borderWidth: 1.5, borderColor: GRAPHITE_COLORS.textMuted,
    borderBottomWidth: 0, borderTopLeftRadius: 5, borderTopRightRadius: 5,
  },
  lockBody: {
    width: 12, height: 9, borderRadius: 2, backgroundColor: GRAPHITE_COLORS.textMuted,
  },
  moreIcon: {
    width: 24, height: 24, flexDirection: "row", gap: 4,
    alignItems: "center", justifyContent: "center",
  },
  moreDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: GRAPHITE_COLORS.textMuted },
  encryptionNotice: {
    position: "absolute", top: 8, left: 0, right: 0, height: 28,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    zIndex: 3, gap: 7, backgroundColor: "transparent",
  },
  encryptionNoticeText: { color: GRAPHITE_COLORS.textMuted, fontSize: 12, fontWeight: "600" },
  securityNotice: {
    minHeight: 40, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    zIndex: 2, gap: 7, backgroundColor: GRAPHITE_COLORS.warningSoft,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GRAPHITE_COLORS.warningLine,
  },
  securityNoticeLoading: { backgroundColor: GRAPHITE_COLORS.surfaceStrong, borderBottomColor: GRAPHITE_COLORS.line },
  securityNoticeMark: {
    width: 18, height: 18, borderRadius: 9, textAlign: "center",
    color: GRAPHITE_COLORS.warningStrong, fontSize: 12, lineHeight: 18, fontWeight: "800",
    borderWidth: 1, borderColor: GRAPHITE_COLORS.warningLine,
  },
  securityNoticeText: { flexShrink: 1, color: GRAPHITE_COLORS.warningStrong, fontSize: 12, lineHeight: 17 },
  offlineNotice: {
    minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center",
    zIndex: 2,
    gap: 7, backgroundColor: GRAPHITE_COLORS.surfaceStrong,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GRAPHITE_COLORS.line,
  },
  offlineNoticeMark: {
    width: 18, height: 18, borderRadius: 9, textAlign: "center",
    color: GRAPHITE_COLORS.textMuted, fontSize: 12, lineHeight: 18, fontWeight: "700",
    borderWidth: 1, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  offlineNoticeText: { color: GRAPHITE_COLORS.textMuted, fontSize: 13 },
  messageViewport: { flex: 1, zIndex: 1, position: "relative" },
  messageList: { flex: 1 },
  msgList: { paddingHorizontal: 14, paddingTop: 48, paddingBottom: 20 },
  webScrollTrack: {
    position: "absolute", top: WEB_SCROLL_TRACK_INSET, right: 3, bottom: WEB_SCROLL_TRACK_INSET,
    width: 4, borderRadius: 2, alignItems: "center",
    backgroundColor: "rgba(235,242,237,0.025)",
  },
  webScrollThumb: {
    width: 3, height: WEB_SCROLL_THUMB_HEIGHT, borderRadius: 2,
    backgroundColor: "rgba(163,172,166,0.46)",
  },
  messageEntry: { width: "100%" },
  newMessageButton: {
    position: "absolute", right: 18, bottom: 112, zIndex: 4,
    minHeight: 48, paddingHorizontal: 16, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
    shadowColor: GRAPHITE_COLORS.shadow, shadowOpacity: 0.32, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  newMessageButtonText: { color: GRAPHITE_COLORS.text, fontSize: 13, fontWeight: "800" },
  msgBubble: {
    maxWidth: "82%", minWidth: 76,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7,
    borderRadius: 18, marginBottom: 8,
  },
  msgMine: {
    alignSelf: "flex-end", backgroundColor: GRAPHITE_COLORS.surfacePressed, borderBottomRightRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  msgOther: {
    alignSelf: "flex-start", backgroundColor: GRAPHITE_COLORS.surfaceStrong, borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  msgTextMine: { color: GRAPHITE_COLORS.text, fontSize: 16, lineHeight: 23 },
  msgTextOther: { color: GRAPHITE_COLORS.text, fontSize: 16, lineHeight: 23 },
  messageMeta: {
    alignSelf: "flex-end", flexDirection: "row", alignItems: "center",
    minHeight: 16, gap: 4, marginTop: 3,
  },
  messageTime: { color: GRAPHITE_COLORS.textFaint, fontSize: 10, fontVariant: ["tabular-nums"] },
  messageTimeMine: { color: GRAPHITE_COLORS.textMuted },
  deliveryStatus: {
    minWidth: 12, color: GRAPHITE_COLORS.textMuted,
    fontSize: 11, fontWeight: "600", letterSpacing: -2,
  },
  deliveryStatusRead: { color: GRAPHITE_COLORS.text },
  deliveryStatusFailed: { color: GRAPHITE_COLORS.danger, letterSpacing: 0 },
  retryStatusButton: {
    minWidth: 22, minHeight: 22, marginVertical: -3, marginRight: -4,
    alignItems: "center", justifyContent: "center",
  },
  typingSlot: {
    minHeight: 30, paddingHorizontal: 14, justifyContent: "center",
    zIndex: 1, backgroundColor: "transparent",
  },
  typingBubble: {
    width: 48, height: 24, borderRadius: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  typingDot: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: GRAPHITE_COLORS.textMuted,
  },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end",
    zIndex: 2,
    paddingHorizontal: 8, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GRAPHITE_COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surface, gap: 5,
  },
  input: {
    flex: 1, minWidth: 0, minHeight: 48, borderWidth: 1, borderColor: GRAPHITE_COLORS.lineStrong, borderRadius: 24,
    paddingHorizontal: 15, paddingVertical: 10, fontSize: 16, lineHeight: 22,
    maxHeight: 112, backgroundColor: GRAPHITE_COLORS.surfacePressed, color: GRAPHITE_INPUT_COLORS.text,
  },
  inputIconButton: {
    width: 46, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  inputIconButtonActive: { backgroundColor: GRAPHITE_COLORS.surfaceStrong },
  voiceModeIcon: { width: 22, height: 24, alignItems: "center" },
  voiceModeCapsule: {
    width: 8, height: 13, borderRadius: 4,
    borderWidth: 1.7, borderColor: GRAPHITE_COLORS.textMuted,
  },
  voiceModeArc: {
    position: "absolute", top: 5, width: 15, height: 11,
    borderWidth: 1.7, borderTopWidth: 0, borderColor: GRAPHITE_COLORS.textMuted,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  voiceModeStem: { width: 1.7, height: 5, backgroundColor: GRAPHITE_COLORS.textMuted },
  voiceModeBase: { width: 10, height: 1.7, borderRadius: 1, backgroundColor: GRAPHITE_COLORS.textMuted },
  keyboardModeIcon: {
    width: 23, height: 18, paddingHorizontal: 3, paddingTop: 3,
    borderWidth: 1.5, borderColor: GRAPHITE_COLORS.textMuted, borderRadius: 4,
  },
  keyboardModeRow: { height: 3, flexDirection: "row", justifyContent: "space-between" },
  keyboardModeKey: { width: 2.5, height: 2, borderRadius: 1, backgroundColor: GRAPHITE_COLORS.textMuted },
  keyboardModeSpace: {
    position: "absolute", left: 6, right: 6, bottom: 3,
    height: 1.7, borderRadius: 1, backgroundColor: GRAPHITE_COLORS.textMuted,
  },
  smileIcon: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.7, borderColor: GRAPHITE_COLORS.textMuted,
  },
  smileEye: {
    position: "absolute", top: 6, width: 2.5, height: 2.5,
    borderRadius: 2, backgroundColor: GRAPHITE_COLORS.textMuted,
  },
  smileEyeLeft: { left: 5 },
  smileEyeRight: { right: 5 },
  smileMouth: {
    position: "absolute", left: 5, right: 5, bottom: 4,
    height: 5, borderBottomWidth: 1.7, borderColor: GRAPHITE_COLORS.textMuted,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  sendBtn: {
    minWidth: 58, height: 48, backgroundColor: GRAPHITE_COLORS.surfaceStrong, borderRadius: 24,
    paddingHorizontal: 12, alignItems: "center", justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  sendButtonShell: { borderRadius: 24 },
  sendBtnDisabled: { backgroundColor: GRAPHITE_COLORS.surfacePressed },
  sendBtnText: { color: GRAPHITE_COLORS.text, fontSize: 14, fontWeight: "800" },
  sendBtnTextDisabled: { color: GRAPHITE_COLORS.textFaint },
  emojiPanel: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    zIndex: 2,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: GRAPHITE_COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GRAPHITE_COLORS.line,
  },
  emojiItem: {
    width: "16.66%", minHeight: 48, alignItems: "center", justifyContent: "center",
  },
  emojiText: { fontSize: 25 },
  menuScrim: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 10, backgroundColor: "rgba(0,0,0,0.58)",
  },
  moreMenu: {
    position: "absolute", right: 12, zIndex: 20, width: 224,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong, borderRadius: GRAPHITE_RADII.control, overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
    shadowColor: GRAPHITE_COLORS.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34, shadowRadius: 18, elevation: 8,
  },
  menuItem: { minHeight: 68, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center" },
  menuItemDisabled: { opacity: 0.42 },
  menuItemTitle: { color: GRAPHITE_COLORS.text, fontSize: 15, fontWeight: "700" },
  menuItemHint: { color: GRAPHITE_COLORS.textMuted, fontSize: 12, marginTop: 3 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: GRAPHITE_COLORS.line, marginLeft: 16 },
});
