/** WebRTC 语音通话页 — 状态圆环、真实静音、失败反馈与结束时长。 */

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, BackHandler, StyleSheet,
  Linking, Text, TouchableOpacity, View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type CallFailureReason, webrtcService } from "../services/webrtc";
import { useAuth } from "../stores/AuthContext";
import { GRAPHITE_COLORS } from "../theme/graphite";

type CallState = "calling" | "ringing" | "connecting" | "connected" | "recovering" | "ended" | "failed";
type TerminalReason = CallFailureReason | "unanswered" | "connection-timeout" | "network-interrupted" | "offline" | "busy" | "local-busy" | "rejected" | null;

const RING_TIMEOUT_MS = 35_000;
const CONNECTION_TIMEOUT_MS = 18_000;
const CALL_RECOVERY_GRACE_MS = 8_000;

const COLORS = {
  background: GRAPHITE_COLORS.canvas,
  surface: GRAPHITE_COLORS.surfaceStrong,
  ink: GRAPHITE_COLORS.text,
  muted: GRAPHITE_COLORS.textMuted,
  faint: GRAPHITE_COLORS.textFaint,
  accent: GRAPHITE_COLORS.primary,
  accentSoft: GRAPHITE_COLORS.primarySoft,
  control: GRAPHITE_COLORS.surfacePressed,
  controlActive: GRAPHITE_COLORS.text,
  danger: GRAPHITE_COLORS.danger,
};

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function ControlButton({
  label,
  hint,
  active = false,
  disabled = false,
  destructive = false,
  loading = false,
  onPress,
}: {
  label: string;
  hint: string;
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.controlItem}>
      <TouchableOpacity
        style={[
          styles.controlButton,
          active && styles.controlButtonActive,
          destructive && styles.controlButtonDanger,
          disabled && styles.controlButtonDisabled,
        ]}
        onPress={onPress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: disabled || loading, selected: active, busy: loading }}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.ink} />
        ) : (
          <Text style={[
            styles.controlMark,
            active && styles.controlMarkActive,
            destructive && styles.controlMarkDanger,
          ]}>
            {destructive ? "×" : label.slice(0, 1)}
          </Text>
        )}
      </TouchableOpacity>
      <Text style={[styles.controlLabel, disabled && styles.controlLabelDisabled]}>{label}</Text>
    </View>
  );
}

export default function VoiceCallScreen({ route, navigation }: any) {
  const { direction, targetId, targetName, callId, autoAccept = false } = route.params;
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { state } = useAuth();
  const [remoteSdp, setRemoteSdp] = useState<any>(null);
  const [callState, setCallState] = useState<CallState>(
    direction === "incoming" ? "ringing" : "calling"
  );
  const [callSeconds, setCallSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(false);
  const [speakerBusy, setSpeakerBusy] = useState(false);
  const [audioRouteError, setAudioRouteError] = useState(false);
  const [terminalReason, setTerminalReason] = useState<TerminalReason>(null);
  const [outgoingReady, setOutgoingReady] = useState(false);
  const [connectionReady, setConnectionReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const connectTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const autoAcceptStartedRef = useRef(false);
  const ringPulse = useRef(new Animated.Value(0)).current;
  const voicePulse = useRef(new Animated.Value(0)).current;

  const displayName = targetName || "未知用户";
  const myDisplayName = state.user?.nickname || state.user?.username || "";
  const initials = Array.from(displayName).slice(0, 2).join("").toUpperCase();
  const activeCall = ["calling", "ringing", "connecting", "connected", "recovering"].includes(callState);

  const scheduleReturn = (delay: number) => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => navigation.goBack(), delay);
  };

  const finishCall = (
    state: "ended" | "failed",
    delay: number | null = 1800,
    reason: TerminalReason = null
  ) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
    setTerminalReason(reason);
    setCallState(state);
    if (delay !== null) scheduleReturn(delay);
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!["connected", "recovering"].includes(callState)) return;
    if (!connectTimeRef.current) connectTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - connectTimeRef.current) / 1000));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [callState]);

  useEffect(() => {
    if (reduceMotion || !["calling", "ringing", "connecting"].includes(callState)) {
      ringPulse.stopAnimation();
      ringPulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(ringPulse, {
        toValue: 1,
        duration: 2600,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [callState, reduceMotion, ringPulse]);

  useEffect(() => {
    if (reduceMotion || callState !== "connected") {
      voicePulse.stopAnimation();
      voicePulse.setValue(0);
      return;
    }
    let cancelled = false;
    let reading = false;
    const updateLevel = async () => {
      if (reading) return;
      reading = true;
      const level = await webrtcService.getAudioLevel();
      reading = false;
      if (cancelled) return;
      Animated.timing(voicePulse, {
        toValue: Math.min(1, level * 3),
        duration: 180,
        useNativeDriver: true,
      }).start();
    };
    void updateLevel();
    const levelTimer = setInterval(() => void updateLevel(), 240);
    return () => {
      cancelled = true;
      clearInterval(levelTimer);
      voicePulse.stopAnimation();
      voicePulse.setValue(0);
    };
  }, [callState, reduceMotion, voicePulse]);

  useEffect(() => {
    if (callState === "connected") {
      AccessibilityInfo.announceForAccessibility("语音通话已接通");
    } else if (callState === "recovering") {
      AccessibilityInfo.announceForAccessibility("通话网络不稳定，正在恢复通话");
    } else if (callState === "failed") {
      const failureAnnouncement = terminalReason === "microphone-permission"
        ? "需要麦克风权限才能进行语音通话"
        : terminalReason === "connection-timeout"
          ? "通话连接超时"
          : terminalReason === "network-interrupted"
            ? "通话连接已中断"
          : terminalReason === "signaling-unavailable"
            ? "当前网络连接不可用"
            : "暂时无法建立语音通话";
      AccessibilityInfo.announceForAccessibility(failureAnnouncement);
    } else if (callState === "ended") {
      AccessibilityInfo.announceForAccessibility(
        terminalReason === "unanswered" ? "对方暂未接听" : "语音通话已结束"
      );
    }
  }, [callState, terminalReason]);

  useEffect(() => {
    webrtcService.setHandlers({
      onIncomingCall: () => {},
      onCallAccepted: () => {
        if (!finishedRef.current) {
          setConnectionReady(true);
          setCallState((current) => current === "connected" ? current : "connecting");
        }
      },
      onCallRejected: (reason) => {
        const terminalReason = reason === "对方暂未接听"
          ? "unanswered"
          : reason === "对方不在线"
          ? "offline"
          : reason === "对方正在通话"
            ? "busy"
            : reason === "你正在进行另一场通话"
              ? "local-busy"
              : "rejected";
        finishCall("ended", 2200, terminalReason);
      },
      onCallEnded: () => finishCall("ended"),
      onRemoteStream: () => {},
      onConnectionStateChange: (connectionState) => {
        if (finishedRef.current) return;
        if (connectionState === "connected") {
          if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = null;
          if (!connectTimeRef.current) connectTimeRef.current = Date.now();
          setCallState("connected");
        } else if (["disconnected", "failed"].includes(connectionState) && connectTimeRef.current > 0) {
          setCallState("recovering");
          void webrtcService.beginIceRecovery(targetId);
          if (!recoveryTimerRef.current) {
            recoveryTimerRef.current = setTimeout(() => {
              if (finishedRef.current) return;
              webrtcService.hangup(targetId);
              finishCall("failed", 2600, "network-interrupted");
            }, CALL_RECOVERY_GRACE_MS);
          }
        } else if (connectionState === "failed") {
          finishCall("failed");
        } else if (connectionState === "disconnected" || connectionState === "closed") {
          finishCall("ended");
        }
      },
    });

    if (direction === "outgoing") {
      void webrtcService.startCall(targetId, myDisplayName).then((result) => {
        if (result.ok) {
          setOutgoingReady(true);
        } else if (result.reason !== "cancelled" && !finishedRef.current) {
          finishCall(
            "failed",
            result.reason === "microphone-permission" ? null : 2600,
            result.reason
          );
        }
      });
    } else {
      const pending = webrtcService.getPendingOffer();
      if (pending && pending.callId === callId) {
        setRemoteSdp(pending.sdp);
      } else {
        finishCall("failed");
      }
    }

    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
      webrtcService.cleanup();
      webrtcService.setHandlers({
        onIncomingCall: () => {},
        onCallAccepted: () => {},
        onCallRejected: () => {},
        onCallEnded: () => {},
        onRemoteStream: () => {},
        onConnectionStateChange: () => {},
      });
    };
  }, [callId, direction, myDisplayName, navigation, targetId]);

  const handleAccept = async () => {
    if (!remoteSdp || callState !== "ringing") return;
    setCallState("connecting");
    const result = await webrtcService.answerCall(targetId, remoteSdp);
    if (result.ok) {
      setConnectionReady(true);
    } else if (result.reason !== "cancelled" && !finishedRef.current) {
      webrtcService.reject(targetId);
      finishCall(
        "failed",
        result.reason === "microphone-permission" ? null : 2600,
        result.reason
      );
    }
  };

  useEffect(() => {
    if (!autoAccept || !remoteSdp || callState !== "ringing" || autoAcceptStartedRef.current) return;
    autoAcceptStartedRef.current = true;
    void handleAccept();
  }, [autoAccept, callState, remoteSdp]);

  useEffect(() => {
    if (callState !== "calling" && callState !== "ringing") return;
    if (callState === "calling" && !outgoingReady) return;
    const timeout = setTimeout(() => {
      if (finishedRef.current) return;
      if (direction === "incoming") {
        webrtcService.reject(targetId);
      } else if (webrtcService.hasActiveCall()) {
        webrtcService.hangup(targetId);
      } else {
        webrtcService.cleanup();
      }
      finishCall("ended", 2400, "unanswered");
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [callState, direction, outgoingReady, targetId]);

  useEffect(() => {
    if (callState !== "connecting" || !connectionReady) return;
    const timeout = setTimeout(() => {
      if (finishedRef.current) return;
      webrtcService.hangup(targetId);
      finishCall("failed", 2600, "connection-timeout");
    }, CONNECTION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [callState, connectionReady, targetId]);

  const handleMute = () => {
    if (callState !== "connected") return;
    const nextMuted = !muted;
    if (webrtcService.setMuted(nextMuted)) {
      setMuted(nextMuted);
      AccessibilityInfo.announceForAccessibility(nextMuted ? "已静音" : "已取消静音");
    }
  };

  const handleSpeaker = async () => {
    if (callState !== "connected" || speakerBusy) return;
    const nextEnabled = !speakerEnabled;
    setSpeakerBusy(true);
    setAudioRouteError(false);
    const changed = await webrtcService.setSpeakerEnabled(nextEnabled);
    setSpeakerBusy(false);
    if (changed) {
      setSpeakerEnabled(nextEnabled);
      AccessibilityInfo.announceForAccessibility(nextEnabled ? "已切换到扬声器" : "已切换到听筒");
      return;
    }
    setAudioRouteError(true);
    AccessibilityInfo.announceForAccessibility("音频输出切换失败，请重试");
  };

  const handleHangup = () => {
    if (!activeCall) {
      navigation.goBack();
      return;
    }
    if (direction === "incoming" && callState === "ringing") {
      webrtcService.reject(targetId);
    } else {
      webrtcService.hangup(targetId);
    }
    finishCall("ended", 1600);
  };

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      AccessibilityInfo.announceForAccessibility("无法打开系统设置，请手动开启 Kin 的麦克风权限");
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event: any) => {
      if (!activeCall || finishedRef.current) return;
      event.preventDefault();
      handleHangup();
    });
    return unsubscribe;
  }, [activeCall, callState, direction, navigation, targetId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!activeCall) return false;
      handleHangup();
      return true;
    });
    return () => subscription.remove();
  }, [activeCall, callState, direction, targetId]);

  const statusText = (() => {
    if (callState === "ringing") return "邀请你进行语音通话";
    if (callState === "calling") return "正在等待对方接听";
    if (callState === "connecting") return "正在建立安全连接";
    if (callState === "connected") return formatSeconds(callSeconds);
    if (callState === "recovering") return "通话网络不稳定，正在恢复通话…";
    if (callState === "failed") {
      if (terminalReason === "microphone-permission") return "需要麦克风权限才能通话";
      if (terminalReason === "connection-timeout") return "连接超时，请稍后重试";
      if (terminalReason === "network-interrupted") return "通话连接已中断";
      if (terminalReason === "signaling-unavailable") return "网络连接不可用，请稍后重试";
      if (terminalReason === "media-unavailable") return "麦克风暂时不可用";
      return "暂时无法建立通话";
    }
    if (terminalReason === "unanswered") return "对方暂未接听";
    if (terminalReason === "offline") return "对方当前离线";
    if (terminalReason === "busy") return "对方正在通话";
    if (terminalReason === "local-busy") return "你正在进行另一场通话";
    if (terminalReason === "rejected") return "对方已拒绝通话";
    return callSeconds > 0
      ? `通话结束 · ${formatSeconds(callSeconds)}`
      : "通话已结束";
  })();

  const ringStyle = (startScale: number, endScale: number, opacity: number) => ({
    opacity: ringPulse.interpolate({ inputRange: [0, 1], outputRange: [opacity, 0] }),
    transform: [{
      scale: ringPulse.interpolate({ inputRange: [0, 1], outputRange: [startScale, endScale] }),
    }],
  });

  const voiceScale = voicePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 18) }]}>
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={styles.content}>
        <View style={styles.orbitArea}>
          {callState === "connected" ? (
            <>
              <Animated.View style={[styles.orbit, styles.orbitOne, styles.connectedOrbit, { transform: [{ scale: voiceScale }] }]} />
              <Animated.View style={[styles.orbit, styles.orbitTwo, styles.connectedOrbitSoft, { transform: [{ scale: voiceScale }] }]} />
              <Animated.View style={[styles.orbit, styles.orbitThree, styles.connectedOrbitFaint, { transform: [{ scale: voiceScale }] }]} />
            </>
          ) : (
            <>
              <Animated.View style={[styles.orbit, styles.orbitOne, ringStyle(0.82, 1.18, 0.34)]} />
              <Animated.View style={[styles.orbit, styles.orbitTwo, ringStyle(0.78, 1.12, 0.22)]} />
              <Animated.View style={[styles.orbit, styles.orbitThree, ringStyle(0.74, 1.08, 0.14)]} />
            </>
          )}
          <Animated.View style={[styles.avatar, callState === "connected" && { transform: [{ scale: voiceScale }] }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </Animated.View>
        </View>

        <Text style={styles.callerName}>{displayName}</Text>
        <View style={styles.statusRow}>
          {callState === "connecting" ? (
            <ActivityIndicator size="small" color={COLORS.accent} />
          ) : callState === "connected" ? (
            <View style={styles.connectedDot} />
          ) : null}
          <Text style={[styles.statusText, callState === "failed" && styles.failedText]}>
            {statusText}
          </Text>
        </View>

        {callState === "connected" ? (
          <View style={styles.voiceBars} accessibilityLabel="通话连接正常">
            {[0.48, 0.76, 1, 0.7, 0.42].map((height, index) => (
              <Animated.View
                key={`${height}-${index}`}
                style={[
                  styles.voiceBar,
                  {
                    height: 30 * height,
                    transform: [{
                      scaleY: voicePulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: index % 2 === 0 ? [0.55, 1] : [1, 0.58],
                      }),
                    }],
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.actionArea}>
        {audioRouteError && callState === "connected" ? (
          <Text style={styles.audioRouteError} accessibilityLiveRegion="polite">
            音频输出切换失败，请重试
          </Text>
        ) : null}
        <View style={styles.actions}>
          {callState === "ringing" ? (
            <>
              <ControlButton
                label="拒绝"
                hint="拒绝这次语音通话"
                destructive
                onPress={handleHangup}
              />
              <ControlButton
                label="接听"
                hint="接听这次语音通话"
                active
                onPress={handleAccept}
              />
            </>
          ) : activeCall ? (
            <>
              <ControlButton
                label={muted ? "取消静音" : "静音"}
                hint={muted ? "重新开启麦克风" : "关闭本机麦克风"}
                active={muted}
                disabled={callState !== "connected"}
                onPress={handleMute}
              />
              <ControlButton
                label="扬声器"
                hint={webrtcService.supportsSpeakerSelection()
                  ? speakerEnabled ? "切换回听筒" : "切换到扬声器"
                  : "当前平台需要原生音频路由支持"}
                active={speakerEnabled}
                loading={speakerBusy}
                disabled={callState !== "connected" || !webrtcService.supportsSpeakerSelection()}
                onPress={() => { void handleSpeaker(); }}
              />
              <ControlButton
                label="挂断"
                hint="结束当前语音通话"
                destructive
                onPress={handleHangup}
              />
            </>
          ) : (
            terminalReason === "microphone-permission" ? (
              <>
                <ControlButton
                  label="设置"
                  hint="打开系统设置并允许 Kin 使用麦克风"
                  active
                  onPress={() => { void handleOpenSettings(); }}
                />
                <ControlButton
                  label="返回"
                  hint="返回聊天页面"
                  onPress={() => navigation.goBack()}
                />
              </>
            ) : (
              <ControlButton
                label="返回"
                hint="返回聊天页面"
                onPress={() => navigation.goBack()}
              />
            )
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: COLORS.background,
    alignItems: "center", justifyContent: "space-between",
  },
  content: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  orbitArea: { width: 232, height: 232, alignItems: "center", justifyContent: "center" },
  orbit: {
    position: "absolute", borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.accent,
  },
  orbitOne: { width: 226, height: 226 },
  orbitTwo: { width: 190, height: 190 },
  orbitThree: { width: 158, height: 158 },
  connectedOrbit: { opacity: 0.18 },
  connectedOrbitSoft: { opacity: 0.11 },
  connectedOrbitFaint: { opacity: 0.07 },
  avatar: {
    width: 126, height: 126, borderRadius: 63,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  avatarText: { color: COLORS.ink, fontSize: 32, fontWeight: "700" },
  callerName: { marginTop: 18, color: COLORS.ink, fontSize: 25, fontWeight: "700" },
  statusRow: { minHeight: 26, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  connectedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent },
  statusText: { color: COLORS.muted, fontSize: 14, fontVariant: ["tabular-nums"] },
  failedText: { color: GRAPHITE_COLORS.danger },
  voiceBars: { height: 34, marginTop: 30, flexDirection: "row", alignItems: "center", gap: 5 },
  voiceBar: { width: 3, borderRadius: 2, backgroundColor: COLORS.accent },
  actionArea: { width: "100%", minHeight: 144, justifyContent: "flex-end" },
  audioRouteError: {
    marginBottom: 2, color: GRAPHITE_COLORS.danger, fontSize: 12, textAlign: "center",
  },
  actions: {
    width: "100%", minHeight: 126, paddingHorizontal: 22,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
  },
  controlItem: { minWidth: 76, alignItems: "center" },
  controlButton: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.control,
    borderWidth: StyleSheet.hairlineWidth, borderColor: GRAPHITE_COLORS.lineStrong,
  },
  controlButtonActive: { backgroundColor: COLORS.controlActive },
  controlButtonDanger: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  controlButtonDisabled: { opacity: 0.34 },
  controlMark: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  controlMarkActive: { color: COLORS.background },
  controlMarkDanger: { color: GRAPHITE_COLORS.onPrimary, fontSize: 30, fontWeight: "300", lineHeight: 32 },
  controlLabel: { marginTop: 9, color: COLORS.muted, fontSize: 12 },
  controlLabelDisabled: { color: COLORS.faint },
});
