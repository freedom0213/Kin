/** 语音录制/播放组件 — 基于 expo-av */

import React, { useState, useRef, useCallback } from "react";
import {
  TouchableOpacity, Text, View, StyleSheet, ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import { Paths, File } from "expo-file-system";

interface VoiceRecorderProps {
  onRecordComplete: (base64Audio: string, duration: number) => void;
}

export function VoiceRecorder({ onRecordComplete }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartRef = useRef<number>(0);

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

  // 停止录音并回调
  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;

    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) return;

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
  }, [onRecordComplete]);

  // 长按录音
  const onPressIn = () => { startRecording(); };
  const onPressOut = () => { stopRecording(); };

  return (
    <View style={styles.container}>
      {isRecording ? (
        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            录音中 {recordingSeconds}s （松开发送）
          </Text>
        </View>
      ) : null}
      <TouchableOpacity
        style={[styles.micBtn, isRecording && styles.micBtnActive]}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={0.7}
      >
        <Text style={styles.micIcon}>🎤</Text>
      </TouchableOpacity>
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
        <Text style={[styles.playIcon, isMine && styles.playIconMine]}>
          {playing ? "⏸" : "▶"}
        </Text>
      )}
      <Text style={[styles.durationText, isMine && styles.durationTextMine]}>
        {Math.round(duration)}″
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center" },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center",
  },
  micBtnActive: { backgroundColor: "#ff4444" },
  micIcon: { fontSize: 20 },
  recordingIndicator: {
    flexDirection: "row", alignItems: "center",
    marginRight: 8, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "#fff0f0", borderRadius: 12,
  },
  recordingDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "#ff4444", marginRight: 6,
  },
  recordingText: { fontSize: 12, color: "#ff4444" },
  voiceBubble: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6,
    minWidth: 70,
  },
  playIcon: { fontSize: 14, color: "#1a1a2e", marginRight: 6 },
  playIconMine: { color: "#fff" },
  durationText: { fontSize: 13, color: "#1a1a2e" },
  durationTextMine: { color: "#fff" },
});
