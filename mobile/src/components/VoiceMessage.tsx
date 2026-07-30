/** 语音录制/播放组件 — 基于 expo-audio */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";

interface VoiceRecorderProps {
  onRecordComplete: (base64Audio: string, duration: number) => void;
  disabled?: boolean;
}

const CANCEL_DISTANCE = -56;
const MIN_RECORDING_SECONDS = 0.5;
const MAX_RECORDING_SECONDS = 60;

type RecorderNotice = "too-short" | "failed" | "max-duration" | null;

function formatRecordingDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.min(MAX_RECORDING_SECONDS, Math.floor(seconds)));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({ onRecordComplete, disabled = false }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [notice, setNotice] = useState<RecorderNotice>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef<typeof recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef(0);
  const gestureActiveRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const finishRecordingRef = useRef<(
    cancelled: boolean,
    reachedLimit?: boolean
  ) => Promise<void>>(async () => undefined);
  disabledRef.current = disabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const showNotice = useCallback((nextNotice: Exclude<RecorderNotice, null>) => {
    clearNoticeTimer();
    setNotice(nextNotice);
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 2_200);
  }, [clearNoticeTimer]);

  const restorePlaybackMode = useCallback(async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      // 音频路由恢复失败不应覆盖已经完成的发送或取消结果。
    }
  }, []);

  // 权限弹窗出现时用户可能先松手，因此创建录音后还要再次检查手势状态。
  const startRecording = useCallback(async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        gestureActiveRef.current = false;
        Alert.alert(
          "需要麦克风权限",
          "开启麦克风权限后，才能在 Kin 中发送语音消息。",
          [
            { text: "暂不", style: "cancel" },
            { text: "去设置", onPress: () => { void Linking.openSettings(); } },
          ]
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();

      if (!gestureActiveRef.current) {
        await restorePlaybackMode();
        return;
      }

      recorder.record();
      recordingRef.current = recorder;
      pressStartRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      setNotice(null);

      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - pressStartRef.current) / 1000;
        setRecordingSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) {
          gestureActiveRef.current = false;
          void finishRecordingRef.current(false, true);
        }
      }, 250);
    } catch (error) {
      gestureActiveRef.current = false;
      setIsRecording(false);
      setIsCancelling(false);
      clearTimer();
      await restorePlaybackMode();
      showNotice("failed");
      console.log("录音启动失败", error);
    }
  }, [clearTimer, recorder, restorePlaybackMode, showNotice]);

  // 正常松手发送；进入取消区后松手丢弃；达到上限时自动发送。
  const finishRecording = useCallback(async (cancelled: boolean, reachedLimit = false) => {
    setIsRecording(false);
    setIsCancelling(false);
    clearTimer();
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    if (!activeRecording) return;
    const duration = Math.min(
      MAX_RECORDING_SECONDS,
      (Date.now() - pressStartRef.current) / 1000
    );

    try {
      await activeRecording.stop();
      const uri = activeRecording.uri;
      if (cancelled || !uri) return;

      if (duration < MIN_RECORDING_SECONDS) {
        showNotice("too-short");
        return;
      }

      const response = await fetch(uri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      onRecordComplete(base64, duration);
      if (reachedLimit) showNotice("max-duration");
    } catch (error) {
      if (!cancelled) showNotice(duration < MIN_RECORDING_SECONDS ? "too-short" : "failed");
      console.log("录音保存失败", error);
    } finally {
      await restorePlaybackMode();
    }
  }, [clearTimer, onRecordComplete, restorePlaybackMode, showNotice]);

  finishRecordingRef.current = finishRecording;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onPanResponderGrant: () => {
      if (disabledRef.current) return;
      gestureActiveRef.current = true;
      cancelRequestedRef.current = false;
      setIsCancelling(false);
      void startRecording();
    },
    onPanResponderMove: (_, gestureState) => {
      const shouldCancel = gestureState.dy <= CANCEL_DISTANCE;
      if (cancelRequestedRef.current !== shouldCancel) {
        cancelRequestedRef.current = shouldCancel;
        setIsCancelling(shouldCancel);
      }
    },
    onPanResponderRelease: () => {
      gestureActiveRef.current = false;
      void finishRecordingRef.current(cancelRequestedRef.current);
    },
    onPanResponderTerminate: () => {
      gestureActiveRef.current = false;
      cancelRequestedRef.current = true;
      void finishRecordingRef.current(true);
    },
  })).current;

  React.useEffect(() => () => {
    gestureActiveRef.current = false;
    clearTimer();
    clearNoticeTimer();
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    if (activeRecording) {
      void activeRecording.stop()
        .catch(() => undefined)
        .finally(() => restorePlaybackMode());
    }
  }, [clearNoticeTimer, clearTimer, restorePlaybackMode]);

  const noticeText = notice === "too-short"
    ? "录音时间太短"
    : notice === "failed"
      ? "录音失败，请重试"
      : notice === "max-duration"
        ? "已达到 60 秒并发送"
        : null;

  return (
    <View style={styles.container}>
      {isRecording ? (
        <View style={[styles.recordingIndicator, isCancelling && styles.recordingIndicatorCancel]}>
          {isCancelling ? <View style={styles.cancelChevron} /> : <View style={styles.recordingDot} />}
          <Text style={[styles.recordingText, isCancelling && styles.recordingTextCancel]}>
            {isCancelling
              ? `松开取消 · ${formatRecordingDuration(recordingSeconds)}`
              : `录音中 ${formatRecordingDuration(recordingSeconds)} · 上滑取消`}
          </Text>
        </View>
      ) : null}
      {!isRecording && noticeText ? (
        <View style={styles.noticeIndicator} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{noticeText}</Text>
        </View>
      ) : null}
      <View
        {...panResponder.panHandlers}
        style={[
          styles.micBtn,
          disabled && styles.micBtnDisabled,
          isRecording && styles.micBtnActive,
          isCancelling && styles.micBtnCancel,
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={disabled
          ? "语音发送暂不可用"
          : isCancelling
            ? "松开取消语音"
            : isRecording
              ? "松开发送语音"
              : "按住录制语音"}
        accessibilityHint={disabled
          ? "当前会话尚未建立加密保护"
          : "按住录音，松开发送，上滑后松开取消"}
        accessibilityState={{ disabled }}
      >
        <View style={styles.micIcon}>
          <View style={styles.micCapsule} />
          <View style={styles.micArc} />
          <View style={styles.micStem} />
          <View style={styles.micBase} />
        </View>
      </View>
    </View>
  );
}

/** 语音消息气泡 — 播放按钮 + 时长 */
export function VoiceMessageBubble({
  duration,
  audioBase64,
  isMine,
}: {
  duration: number;
  audioBase64: string;
  isMine: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const player = useAudioPlayer(null);
  const playbackStatus = useAudioPlayerStatus(player);
  const loadedAudioRef = useRef<string | null>(null);
  const playing = playbackStatus.playing;

  const togglePlay = useCallback(async () => {
    if (playing) {
      player.pause();
      return;
    }

    setLoading(true);
    try {
      if (loadedAudioRef.current !== audioBase64) {
        const tmpFile = new File(Paths.cache, `voice_${Date.now()}.m4a`);
        await tmpFile.write(audioBase64, { encoding: "base64" } as any);
        player.replace({ uri: tmpFile.uri });
        loadedAudioRef.current = audioBase64;
      } else if (playbackStatus.didJustFinish) {
        await player.seekTo(0);
      }
      player.play();
    } catch (error) {
      console.log("语音播放失败", error);
    } finally {
      setLoading(false);
    }
  }, [audioBase64, playbackStatus.didJustFinish, player, playing]);

  return (
    <TouchableOpacity onPress={togglePlay} style={styles.voiceBubble}>
      {loading ? (
        <ActivityIndicator size="small" color={isMine ? "#fff" : "#1a1a2e"} />
      ) : (
        <View style={styles.playIconFrame}>
          {playing ? (
            <View style={styles.pauseIcon}>
              <View style={[styles.pauseBar, isMine && styles.iconShapeMine]} />
              <View style={[styles.pauseBar, isMine && styles.iconShapeMine]} />
            </View>
          ) : (
            <View style={[styles.playTriangle, isMine && styles.playTriangleMine]} />
          )}
        </View>
      )}
      <Text style={[styles.durationText, isMine && styles.durationTextMine]}>
        {Math.round(duration)}″
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#F0F2EF", alignItems: "center", justifyContent: "center",
  },
  micBtnActive: { backgroundColor: "#F9DCD9" },
  micBtnCancel: { backgroundColor: "#E3E6E2" },
  micBtnDisabled: { opacity: 0.42 },
  micIcon: { width: 22, height: 24, alignItems: "center" },
  micCapsule: {
    width: 8, height: 13, borderRadius: 4,
    borderWidth: 1.7, borderColor: "#4E555B",
  },
  micArc: {
    position: "absolute", top: 5, width: 15, height: 11,
    borderWidth: 1.7, borderTopWidth: 0, borderColor: "#4E555B",
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  micStem: { width: 1.7, height: 5, backgroundColor: "#4E555B" },
  micBase: { width: 10, height: 1.7, borderRadius: 1, backgroundColor: "#4E555B" },
  recordingIndicator: {
    position: "absolute", left: 0, bottom: 52, width: 204,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: "#FFFFFF", borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3BDB9",
  },
  recordingIndicatorCancel: {
    backgroundColor: "#F1F2EF", borderColor: "#C7CBC6",
  },
  noticeIndicator: {
    position: "absolute", left: 0, bottom: 52, minWidth: 132,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: "#FFFFFF", borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#D7DCD7",
  },
  noticeText: { fontSize: 12, color: "#555B58" },
  recordingDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "#C84E46", marginRight: 6,
  },
  recordingText: { fontSize: 12, color: "#9D3731" },
  recordingTextCancel: { color: "#555B58", fontWeight: "600" },
  cancelChevron: {
    width: 8, height: 8, marginRight: 8, marginLeft: 1,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderColor: "#626966",
    transform: [{ rotate: "45deg" }],
  },
  voiceBubble: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 2, paddingVertical: 4,
    minWidth: 70,
  },
  playIconFrame: {
    width: 22, height: 22, alignItems: "center", justifyContent: "center", marginRight: 6,
  },
  playTriangle: {
    width: 0, height: 0, marginLeft: 2,
    borderTopWidth: 6, borderBottomWidth: 6, borderLeftWidth: 9,
    borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "#273A34",
  },
  playTriangleMine: { borderLeftColor: "#FFFFFF" },
  pauseIcon: { flexDirection: "row", gap: 4 },
  pauseBar: { width: 3, height: 12, borderRadius: 1, backgroundColor: "#273A34" },
  iconShapeMine: { backgroundColor: "#FFFFFF" },
  durationText: { fontSize: 13, color: "#171A1F" },
  durationTextMine: { color: "#FFFFFF" },
});
