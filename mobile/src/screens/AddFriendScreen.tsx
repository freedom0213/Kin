/**
 * THESIS: NFC 只负责让两名现实中相遇的人进入同一确认时刻，拒绝把 Token 技术细节当作主界面。
 * OWN-WORLD: Graphite Flow 石墨层级、克制 Kin 绿；大面积留白配合两台设备靠近的线性图形。
 * STORY: 用户选择发起或接收，发现对方后在半弹窗核对身份，双方确认才建立好友关系。
 * FIRST VIEWPORT: 简短说明位于上方，设备靠近图形居中，两项稳定操作位于下方。
 * FORM: 既有 Kin Operate 界面的 NFC 专用流程；半弹窗承载受保护的双方确认任务。
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, Image, Keyboard,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import type { ImageStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import KinBottomSheet from "../components/KinBottomSheet";
import {
  cancelPairing, confirmPairing, createPairing, getFriendList, getPairing,
  joinPairing, PairingSession, resolveMediaUrl,
} from "../api/client";
import { kinWS } from "../api/ws";
import {
  cancelNfc, initNfc, startNfcReceive, startNfcSend,
} from "../services/nfc";
import {
  GRAPHITE_COLORS,
  GRAPHITE_INPUT_COLORS,
  PROFILE_BANNER_ASPECT_RATIO,
} from "../theme/graphite";

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

type BusyAction = "create" | "receive" | "join" | "confirm" | "cancel" | "open-chat" | null;
type SheetMode = "pairing" | "receiving" | "error";

const ACTIVE_STATUSES = new Set(["awaiting_peer", "awaiting_confirmation"]);

function peerName(pairing: PairingSession): string {
  return pairing.peer?.nickname || pairing.peer?.username || "附近的 Kin 用户";
}

function initials(value: string): string {
  return Array.from(value).slice(0, 2).join("").toUpperCase();
}

function DevicePairVisual({
  active,
  success,
  reduceMotion,
}: {
  active: boolean;
  success: boolean;
  reduceMotion: boolean;
}) {
  const motion = useRef(new Animated.Value(success ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(motion, {
      toValue: success ? 1 : 0,
      duration: reduceMotion ? 0 : 420,
      useNativeDriver: true,
    }).start();
  }, [motion, reduceMotion, success]);

  useEffect(() => {
    if (!active || success || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1500, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, pulse, reduceMotion, success]);

  const leftTransform = {
    transform: [{
      translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [-8, 16] }),
    }],
  };
  const rightTransform = {
    transform: [{
      translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [8, -16] }),
    }],
  };
  const waveStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.62] }),
    transform: [{
      scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.12] }),
    }],
  };

  return (
    <View style={styles.pairVisual} accessibilityLabel={success ? "两台设备已完成配对" : "两台设备正在靠近"}>
      <Animated.View style={[styles.device, leftTransform]}>
        <View style={styles.deviceSpeaker} />
        <View style={styles.deviceDot} />
      </Animated.View>
      <Animated.View style={[styles.nearWave, waveStyle]} />
      <View style={styles.nearCore} />
      <Animated.View style={[styles.device, rightTransform]}>
        <View style={styles.deviceSpeaker} />
        <View style={styles.deviceDot} />
      </Animated.View>
    </View>
  );
}

export default function AddFriendScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [nfcAvailable, setNfcAvailable] = useState<boolean | null>(null);
  const [pairing, setPairing] = useState<PairingSession | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("pairing");
  const [sheetMessage, setSheetMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [failedPairingBannerKey, setFailedPairingBannerKey] = useState<string | null>(null);
  const nfcCancelRef = useRef<(() => void) | null>(null);
  const pairingRef = useRef<PairingSession | null>(null);

  const updatePairing = (next: PairingSession | null) => {
    pairingRef.current = next;
    setPairing(next);
    if (next && !ACTIVE_STATUSES.has(next.status)) {
      void cancelNfc();
      nfcCancelRef.current = null;
    }
  };

  useEffect(() => {
    let mounted = true;
    void initNfc().then((available) => {
      if (mounted) setNfcAvailable(available);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const motionSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      motionSubscription.remove();
      nfcCancelRef.current?.();
      void cancelNfc();
    };
  }, []);

  useEffect(() => {
    const onPairingUpdated = (data: any) => {
      const next = data.pairing as PairingSession | undefined;
      if (!next || next.id !== pairingRef.current?.id) return;
      updatePairing(next);
      setSheetMode("pairing");
      setSheetVisible(true);
    };
    kinWS.on("pairing_updated", onPairingUpdated);
    return () => kinWS.off("pairing_updated", onPairingUpdated);
  }, []);

  useEffect(() => {
    if (!pairing || !ACTIVE_STATUSES.has(pairing.status)) return;
    const refresh = async () => {
      try {
        const next = await getPairing(pairing.id);
        updatePairing(next);
      } catch { /* WebSocket 或下一次轮询会继续恢复状态 */ }
    };
    const pollTimer = setInterval(() => void refresh(), 2200);
    return () => clearInterval(pollTimer);
  }, [pairing?.id, pairing?.status]);

  useEffect(() => {
    if (!pairing || !ACTIVE_STATUSES.has(pairing.status)) {
      setRemainingSeconds(0);
      return;
    }
    const updateRemaining = () => {
      setRemainingSeconds(Math.max(0, Math.ceil(pairing.expires_at - Date.now() / 1000)));
    };
    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [pairing?.expires_at, pairing?.status]);

  useEffect(() => {
    if (!pairing) return;
    if (pairing.status === "completed") {
      AccessibilityInfo.announceForAccessibility("双方已确认，你们已经成为好友");
    } else if (pairing.status === "cancelled") {
      AccessibilityInfo.announceForAccessibility("配对已取消");
    } else if (pairing.status === "expired") {
      AccessibilityInfo.announceForAccessibility("配对等待已超时");
    }
  }, [pairing?.status]);

  const startSharing = async () => {
    if (busyAction) return;
    setBusyAction("create");
    setSheetMessage("");
    try {
      const created = await createPairing();
      updatePairing(created);
      setSheetMode("pairing");
      setSheetVisible(true);
      if (nfcAvailable && created.token) {
        void startNfcSend(created.token).then((cancel) => {
          nfcCancelRef.current = cancel;
        }).catch((error: any) => {
          setSheetMessage(error.message || "NFC 暂时无法发送，可使用下方配对码");
        });
      } else {
        setSheetMessage("这台设备暂时无法使用 NFC，可使用下方配对码完成测试");
      }
    } catch (error: any) {
      setSheetMode("error");
      setSheetMessage(error.message || "暂时无法创建配对，请稍后重试");
      setSheetVisible(true);
    } finally {
      setBusyAction(null);
    }
  };

  const startReceiving = async () => {
    if (busyAction) return;
    Keyboard.dismiss();
    if (!nfcAvailable) {
      setManualOpen(true);
      return;
    }
    setBusyAction("receive");
    setSheetMode("receiving");
    setSheetMessage("将手机背面靠近对方设备");
    setSheetVisible(true);
    try {
      const token = await startNfcReceive();
      const joined = await joinPairing(token);
      updatePairing(joined);
      setSheetMode("pairing");
      setSheetMessage("");
    } catch (error: any) {
      setSheetMode("error");
      setSheetMessage(error.message || "没有读取到有效的配对信息，请重新尝试");
    } finally {
      setBusyAction(null);
    }
  };

  const joinManually = async () => {
    const token = manualToken.trim();
    if (!token || busyAction) return;
    setBusyAction("join");
    Keyboard.dismiss();
    try {
      const joined = await joinPairing(token);
      updatePairing(joined);
      setSheetMode("pairing");
      setSheetMessage("");
      setSheetVisible(true);
      setManualOpen(false);
    } catch (error: any) {
      setSheetMode("error");
      setSheetMessage(error.message || "配对码无效，请向对方重新获取");
      setSheetVisible(true);
    } finally {
      setBusyAction(null);
    }
  };

  const confirmCurrentPairing = async () => {
    if (!pairing || pairing.viewer_confirmed || busyAction) return;
    setBusyAction("confirm");
    try {
      updatePairing(await confirmPairing(pairing.id));
    } catch (error: any) {
      setSheetMode("error");
      setSheetMessage(error.message || "确认失败，请重新尝试");
    } finally {
      setBusyAction(null);
    }
  };

  const closePairing = async (leaveScreen = false) => {
    if (busyAction === "cancel") return;
    const current = pairingRef.current;
    setBusyAction("cancel");
    try {
      if (current && ACTIVE_STATUSES.has(current.status)) {
        await cancelPairing(current.id);
      }
    } catch { /* 会话也会在服务端自动过期 */ }
    nfcCancelRef.current?.();
    nfcCancelRef.current = null;
    await cancelNfc();
    updatePairing(null);
    setSheetVisible(false);
    setSheetMode("pairing");
    setSheetMessage("");
    setBusyAction(null);
    if (leaveScreen) navigation.goBack();
  };

  const openCompletedChat = async () => {
    if (!pairing?.peer || busyAction) return;
    setBusyAction("open-chat");
    try {
      const result = await getFriendList();
      const friend = result.friends.find((item) => item.user_id === pairing.peer?.id);
      setSheetVisible(false);
      updatePairing(null);
      if (friend) navigation.replace("Chat", { friend });
      else navigation.goBack();
    } finally {
      setBusyAction(null);
    }
  };

  const sheetTitle = useMemo(() => {
    if (sheetMode === "receiving") return "正在寻找附近的手机";
    if (sheetMode === "error") return "这次没有碰上";
    if (!pairing) return "碰一碰";
    if (pairing.status === "awaiting_peer") return "等待另一台手机加入";
    if (pairing.status === "awaiting_confirmation") {
      return pairing.viewer_confirmed ? "等待对方确认" : "确认是你认识的人";
    }
    if (pairing.status === "completed") return "你们已经成为好友";
    if (pairing.status === "expired") return "配对已超时";
    if (pairing.status === "cancelled") return "配对已取消";
    return "暂时无法完成配对";
  }, [pairing, sheetMode]);

  const peerDisplayName = pairing ? peerName(pairing) : "";
  const pairingSucceeded = pairing?.status === "completed";
  const peerBannerUrl = pairing?.peer
    ? resolveMediaUrl(pairing.peer.profile_banner)
    : null;
  const peerBannerKey = pairing && peerBannerUrl ? `${pairing.id}:${peerBannerUrl}` : null;
  const showPeerBanner = !!peerBannerKey && failedPairingBannerKey !== peerBannerKey;
  const sheetHasError = sheetMode === "error"
    || pairing?.status === "expired"
    || pairing?.status === "cancelled"
    || pairing?.status === "failed";

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => void closePairing(true)}
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>添加好友</Text>
        <View style={styles.headerAction} />
      </View>

      <View style={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.title}>碰一碰</Text>
          <Text style={styles.subtitle}>
            让两台手机靠近。发现对方后，只有你们都确认，才会建立好友关系。
          </Text>
        </View>

        <DevicePairVisual active={false} success={false} reduceMotion={reduceMotion} />

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, !!busyAction && styles.buttonDisabled]}
            onPress={startSharing}
            disabled={!!busyAction}
            accessibilityRole="button"
            accessibilityLabel="发起碰一碰"
            accessibilityState={{ disabled: !!busyAction, busy: busyAction === "create" }}
          >
            {busyAction === "create" ? (
              <ActivityIndicator color={GRAPHITE_COLORS.onPrimary} />
            ) : (
              <Text style={styles.primaryButtonText}>发起碰一碰</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, !!busyAction && styles.buttonDisabled]}
            onPress={startReceiving}
            disabled={!!busyAction}
            accessibilityRole="button"
            accessibilityLabel="接收附近设备的碰一碰"
            accessibilityState={{ disabled: !!busyAction, busy: busyAction === "receive" }}
          >
            <Text style={styles.secondaryButtonText}>接收附近设备</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.capabilityLine}>
          <View style={[
            styles.capabilityDot,
            nfcAvailable ? styles.capabilityAvailable : styles.capabilityUnavailable,
          ]} />
          <Text style={styles.capabilityText}>
            {nfcAvailable === null
              ? "正在检查这台设备"
              : nfcAvailable
                ? "NFC 已可用"
                : "NFC 不可用，可使用配对码"}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.fallbackToggle}
          onPress={() => setManualOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={manualOpen ? "收起配对码输入" : "使用配对码"}
        >
          <Text style={styles.fallbackToggleText}>
            {manualOpen ? "收起配对码" : "无法碰一碰？使用配对码"}
          </Text>
        </TouchableOpacity>

        {manualOpen ? (
          <View style={styles.manualArea}>
            <TextInput
              style={styles.manualInput}
              value={manualToken}
              onChangeText={setManualToken}
              placeholder="粘贴对方手机显示的配对码"
              placeholderTextColor={GRAPHITE_INPUT_COLORS.placeholder}
              cursorColor={GRAPHITE_INPUT_COLORS.cursor}
              selectionColor={GRAPHITE_INPUT_COLORS.selection}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="配对码"
            />
            <TouchableOpacity
              style={[
                styles.manualButton,
                (!manualToken.trim() || !!busyAction) && styles.buttonDisabled,
              ]}
              onPress={joinManually}
              disabled={!manualToken.trim() || !!busyAction}
              accessibilityRole="button"
              accessibilityLabel="使用配对码加入"
            >
              {busyAction === "join" ? (
                <ActivityIndicator size="small" color={GRAPHITE_COLORS.onPrimary} />
              ) : (
                <Text style={styles.manualButtonText}>加入</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <KinBottomSheet
        visible={sheetVisible}
        onRequestClose={() => void closePairing(false)}
        reduceMotion={reduceMotion}
        accessibilityLabel="碰一碰确认弹窗"
      >
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View accessibilityLiveRegion="polite" style={styles.sheetInnerContent}>
              {pairing?.peer ? (
                <View style={styles.peerIdentityVisual}>
                  {showPeerBanner && peerBannerUrl ? (
                    <View style={styles.pairingBannerFrame}>
                      <Image
                        source={{ uri: peerBannerUrl }}
                        style={styles.pairingBannerImage as ImageStyle}
                        resizeMode="contain"
                        onError={() => setFailedPairingBannerKey(peerBannerKey)}
                        accessibilityLabel={`${peerDisplayName}的背景名片`}
                      />
                    </View>
                  ) : null}
                  <View style={[styles.peerAvatar, showPeerBanner && styles.peerAvatarOverBanner]}>
                    {pairing.peer.avatar ? (
                      <Image
                        source={{ uri: resolveMediaUrl(pairing.peer.avatar) || pairing.peer.avatar }}
                        style={styles.peerAvatarImage as ImageStyle}
                        accessibilityLabel={`${peerDisplayName}的头像`}
                      />
                    ) : (
                      <Text style={styles.peerInitials}>{initials(peerDisplayName)}</Text>
                    )}
                  </View>
                </View>
              ) : (
                <DevicePairVisual
                  active={!reduceMotion && sheetMode !== "error"}
                  success={!!pairingSucceeded}
                  reduceMotion={reduceMotion}
                />
              )}

              <Text style={[styles.sheetTitle, sheetHasError && styles.sheetTitleError]}>{sheetTitle}</Text>
              {pairing?.peer ? (
                <>
                  <Text style={styles.peerName}>{peerDisplayName}</Text>
                  <Text style={styles.peerUsername}>@{pairing.peer.username}</Text>
                </>
              ) : null}

              <Text style={styles.sheetDescription}>
                {sheetMode === "receiving"
                  ? sheetMessage
                  : sheetMode === "error"
                    ? sheetMessage
                    : pairing?.status === "awaiting_peer"
                      ? "保持当前页面打开。另一台手机加入后，你们会同时看到确认信息。"
                      : pairing?.status === "awaiting_confirmation"
                        ? pairing.viewer_confirmed
                          ? "你已确认。只有对方也确认后，你们才会成为好友。"
                          : "请核对头像和用户名。只有双方确认后才会成为好友。"
                        : pairing?.status === "completed"
                          ? "配对确认已经完成，现在可以开始聊天。"
                          : pairing?.failure_reason || "可以关闭后重新发起一次碰一碰。"}
              </Text>

              {sheetMessage && sheetMode === "pairing" ? (
                <Text style={styles.inlineNotice}>{sheetMessage}</Text>
              ) : null}

              {pairing && ACTIVE_STATUSES.has(pairing.status) ? (
                <Text style={styles.countdown}>本次配对将在 {remainingSeconds} 秒后结束</Text>
              ) : null}

              {pairing?.status === "awaiting_peer" && pairing.token ? (
                <View style={styles.pairingCodeArea}>
                  <Text style={styles.pairingCodeLabel}>配对码 · 仅在 NFC 不可用时使用</Text>
                  <Text style={styles.pairingCode} selectable>{pairing.token}</Text>
                </View>
              ) : null}
          </View>
        </ScrollView>

        <View style={styles.sheetActions}>
              {pairing?.status === "awaiting_confirmation" ? (
                <>
                  <TouchableOpacity
                    style={[styles.cancelButton, !!busyAction && styles.buttonDisabled]}
                    onPress={() => void closePairing(false)}
                    disabled={!!busyAction}
                    accessibilityRole="button"
                    accessibilityLabel="取消本次配对"
                  >
                    <Text style={styles.cancelButtonText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.confirmButton,
                      pairing.viewer_confirmed && styles.confirmedButton,
                      !!busyAction && styles.buttonDisabled,
                    ]}
                    onPress={confirmCurrentPairing}
                    disabled={pairing.viewer_confirmed || !!busyAction}
                    accessibilityRole="button"
                    accessibilityLabel={pairing.viewer_confirmed ? "你已确认" : "确认是本人"}
                    accessibilityState={{ disabled: pairing.viewer_confirmed || !!busyAction }}
                  >
                    {busyAction === "confirm" ? (
                      <ActivityIndicator size="small" color={GRAPHITE_COLORS.onPrimary} />
                    ) : (
                      <Text style={[
                        styles.confirmButtonText,
                        pairing.viewer_confirmed && styles.confirmedButtonText,
                      ]}>
                        {pairing.viewer_confirmed ? "已确认" : "确认是本人"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : pairing?.status === "completed" ? (
                <TouchableOpacity
                  style={[styles.confirmButton, !!busyAction && styles.buttonDisabled]}
                  onPress={openCompletedChat}
                  disabled={!!busyAction}
                  accessibilityRole="button"
                  accessibilityLabel="开始聊天"
                >
                  {busyAction === "open-chat" ? (
                    <ActivityIndicator size="small" color={GRAPHITE_COLORS.onPrimary} />
                  ) : (
                    <Text style={styles.confirmButtonText}>开始聊天</Text>
                  )}
                </TouchableOpacity>
              ) : sheetMode === "error" || (pairing && !ACTIVE_STATUSES.has(pairing.status)) ? (
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={() => void closePairing(false)}
                  accessibilityRole="button"
                  accessibilityLabel="关闭并重新尝试"
                >
                  <Text style={styles.confirmButtonText}>重新尝试</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.cancelButtonWide, !!busyAction && styles.buttonDisabled]}
                  onPress={() => void closePairing(false)}
                  disabled={!!busyAction}
                  accessibilityRole="button"
                  accessibilityLabel="取消等待"
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
              )}
        </View>
      </KinBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    minHeight: 54, paddingHorizontal: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  headerAction: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  content: { flex: 1, paddingHorizontal: 24, paddingBottom: 24 },
  intro: { paddingTop: 28 },
  title: { color: COLORS.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.7 },
  subtitle: { marginTop: 12, maxWidth: 340, color: COLORS.muted, fontSize: 15, lineHeight: 23 },
  pairVisual: {
    height: 210, flexDirection: "row", alignItems: "center", justifyContent: "center",
  },
  device: {
    width: 74, height: 128, borderRadius: 20,
    borderWidth: 1.5, borderColor: GRAPHITE_COLORS.lineStrong, backgroundColor: GRAPHITE_COLORS.surfaceStrong,
    alignItems: "center",
  },
  deviceSpeaker: { width: 24, height: 3, marginTop: 9, borderRadius: 2, backgroundColor: GRAPHITE_COLORS.textFaint },
  deviceDot: { width: 5, height: 5, marginTop: "auto", marginBottom: 10, borderRadius: 3, backgroundColor: COLORS.accent },
  nearWave: {
    width: 58, height: 58, marginHorizontal: -10, borderRadius: 29,
    borderWidth: 1.5, borderColor: COLORS.accent,
  },
  nearCore: {
    position: "absolute", width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.accent,
  },
  actions: { marginTop: "auto", gap: 12 },
  primaryButton: {
    minHeight: 54, borderRadius: 16, backgroundColor: COLORS.accent,
    alignItems: "center", justifyContent: "center",
  },
  primaryButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong, alignItems: "center", justifyContent: "center",
  },
  secondaryButtonText: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  capabilityLine: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  capabilityDot: { width: 7, height: 7, marginRight: 7, borderRadius: 4 },
  capabilityAvailable: { backgroundColor: COLORS.accent },
  capabilityUnavailable: { backgroundColor: COLORS.faint },
  capabilityText: { color: COLORS.muted, fontSize: 12 },
  fallbackToggle: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  fallbackToggleText: { color: COLORS.accentDark, fontSize: 13, fontWeight: "600" },
  manualArea: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 4 },
  manualInput: {
    flex: 1, minHeight: 48, paddingHorizontal: 14, borderRadius: 13,
    borderWidth: 1, borderColor: GRAPHITE_COLORS.lineStrong, backgroundColor: GRAPHITE_COLORS.surfacePressed,
    color: COLORS.ink, fontSize: 13,
  },
  manualButton: {
    minWidth: 68, minHeight: 48, borderRadius: 13,
    backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center",
  },
  manualButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 14, fontWeight: "800" },
  buttonDisabled: { opacity: 0.42 },
  sheetScroll: { flex: 1, paddingHorizontal: 22 },
  sheetContent: { flexGrow: 1, paddingBottom: 8 },
  sheetInnerContent: { alignItems: "center", paddingTop: 6 },
  peerIdentityVisual: { width: "100%", alignItems: "center" },
  pairingBannerFrame: {
    width: "100%", aspectRatio: PROFILE_BANNER_ASPECT_RATIO, borderRadius: 16, overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  pairingBannerImage: { width: "100%", height: "100%" },
  peerAvatar: {
    width: 82, height: 82, borderRadius: 41, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  peerAvatarOverBanner: { marginTop: -30, borderWidth: 3, borderColor: COLORS.surface },
  peerAvatarImage: { width: "100%", height: "100%" },
  peerInitials: { color: GRAPHITE_COLORS.text, fontSize: 25, fontWeight: "700" },
  sheetTitle: { marginTop: 6, color: COLORS.ink, fontSize: 22, fontWeight: "700", textAlign: "center" },
  sheetTitleError: { color: COLORS.danger },
  peerName: { marginTop: 13, color: COLORS.ink, fontSize: 18, fontWeight: "700" },
  peerUsername: { marginTop: 3, color: COLORS.muted, fontSize: 13 },
  sheetDescription: {
    maxWidth: 330, marginTop: 14, color: COLORS.muted,
    fontSize: 14, lineHeight: 21, textAlign: "center",
  },
  inlineNotice: {
    marginTop: 14, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    backgroundColor: GRAPHITE_COLORS.surfacePressed, color: COLORS.muted, fontSize: 12, lineHeight: 18,
  },
  countdown: { marginTop: 12, color: COLORS.faint, fontSize: 12, fontVariant: ["tabular-nums"] },
  pairingCodeArea: {
    width: "100%", marginTop: 18, padding: 14, borderRadius: 14,
    backgroundColor: GRAPHITE_COLORS.surfacePressed, borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  pairingCodeLabel: { color: COLORS.muted, fontSize: 11, textAlign: "center" },
  pairingCode: { marginTop: 8, color: COLORS.ink, fontSize: 12, lineHeight: 18, textAlign: "center" },
  sheetActions: {
    paddingHorizontal: 22, paddingTop: 14, paddingBottom: 4,
    flexDirection: "row", gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
  },
  cancelButton: {
    flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong, alignItems: "center", justifyContent: "center",
  },
  cancelButtonWide: {
    flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line,
    alignItems: "center", justifyContent: "center",
  },
  cancelButtonText: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  confirmButton: {
    flex: 1, minHeight: 52, borderRadius: 16,
    backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center",
  },
  confirmedButton: { backgroundColor: GRAPHITE_COLORS.primaryDeep },
  confirmButtonText: { color: GRAPHITE_COLORS.onPrimary, fontSize: 15, fontWeight: "800" },
  confirmedButtonText: { color: GRAPHITE_COLORS.primaryStrong },
});
