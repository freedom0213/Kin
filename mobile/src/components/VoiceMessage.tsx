/** 语音录制/播放组件 — 基于 expo-av */

import React, { useState, useRef, useCallback } from "react";
import {
  TouchableOpacity, Text, View, StyleSheet, ActivityIndicator, PanResponder,
} from "react-native";
import { Audio } from "expo-av";
import { Paths, File } from "expo-file-system";

interface VoiceRecorderProps {
  onRecordComplete: (base64Audio: string, duration: number) => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onRecordComplete, disabled = false }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartRef = useRef<number>(0);
  const gestureActiveRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      // Android 需要先请求权限
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      // 权限弹窗可能让用户先松手；此时直接丢弃刚创建的录音，避免后台持续录制。
      if (!gestureActiveRef.current) {
        await recording.stopAndUnloadAsync();
        return;
      }

      recordingRef.current = recording;
      pressStartRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);

      // 计时器
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.log("录音启动失败", e);
    }
  }, []);

  // 停止录音：正常松手发送，上滑后松手则丢弃。
  const finishRecording = useCallback(async (cancelled: boolean) => {
    setIsRecording(false);
    setIsCancelling(false);
    clearTimer();
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (cancelled || !uri) return;

      // 用 fetch + FileReader 读取录音文件为 base64（兼容 expo-file-system v18+）
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

      const duration = (Date.now() - pressStartRef.current) / 1000;

      // 太短的录音忽略（< 0.5秒）
      if (duration < 0.5) return;

      onRecordComplete(base64, duration);
    } catch (e) {
      console.log("录音保存失败", e);
    }
  }, [clearTimer, onRecordComplete]);

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
      const shouldCancel = gestureState.dy <= -56;
      if (cancelRequestedRef.current !== shouldCancel) {
        cancelRequestedRef.current = shouldCancel;
        setIsCancelling(shouldCancel);
      }
    },
    onPanResponderRelease: () => {
      gestureActiveRef.current = false;
      void finishRecording(cancelRequestedRef.current);
    },
    onPanResponderTerminate: () => {
      gestureActiveRef.current = false;
      cancelRequestedRef.current = true;
      void finishRecording(true);
    },
  })).current;

  React.useEffect(() => () => {
    gestureActiveRef.current = false;
    clearTimer();
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    if (activeRecording) void activeRecording.stopAndUnloadAsync();
  }, [clearTimer]);

  return (
    <View style={styles.container}>
      {isRecording ? (
        <View style={[styles.recordingIndicator, isCancelling && styles.recordingIndicatorCancel]}>
          {isCancelling ? <View style={styles.cancelChevron} /> : <View style={styles.recordingDot} />}
          <Text style={[styles.recordingText, isCancelling && styles.recordingTextCancel]}>
            {isCancelling
              ? `松开取消 · ${recordingSeconds}s`
              : `录音中 ${recordingSeconds}s · 上滑取消`}
          </Text>
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
        accessibilityLabel={disabled ? "语音发送暂不可用" : isCancelling ? "松开取消语音" : isRecording ? "松开发送语音" : "按住录制语音"}
        accessibilityHint={disabled ? "当前会话无法建立加密保护" : "按住录音，松开发送，上滑后松开取消"}
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
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const togglePlay = useCallback(async () => {
    if (playing) {
      // 暂停
      await soundRef.current?.pauseAsync();
      setPlaying(false);
      return;
    }

    setLoading(true);
    try {
      // 将 base64 写入缓存临时文件然后播放（使用 expo-file-system v18+ File API）
      const tmpFile = new File(Paths.cache, `voice_${Date.now()}.m4a`);
      await tmpFile.write(audioBase64, { encoding: "base64" } as any);

      const { sound } = await Audio.Sound.createAsync(
        { uri: tmpFile.uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlaying(false);
          }
        }
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch (e) {
      console.log("语音播放失败", e);
    } finally {
      setLoading(false);
    }
  }, [playing, audioBase64]);

  // 清理
  React.useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

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
    position: "absolute", left: 0, bottom: 52, width: 188,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: "#FFFFFF", borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3BDB9",
  },
  recordingIndicatorCancel: {
    backgroundColor: "#F1F2EF", borderColor: "#C7CBC6",
  },
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
  playIconFrame: { width: 22, height: 22, alignItems: "center", justifyContent: "center", marginRight: 6 },
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
