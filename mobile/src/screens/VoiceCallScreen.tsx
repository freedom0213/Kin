/** WebRTC 语音通话页面 */

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
} from "react-native";
import { RTCView, MediaStream } from "react-native-webrtc";
import { webrtcService } from "../services/webrtc";
import { useAuth } from "../stores/AuthContext";

type CallState = "calling" | "ringing" | "connected" | "ended";

export default function VoiceCallScreen({ route, navigation }: any) {
  const { direction, targetId, targetName } = route.params;
  const { state } = useAuth();

  const [callState, setCallState] = useState<CallState>(
    direction === "incoming" ? "ringing" : "calling"
  );
  const [callSeconds, setCallSeconds] = useState(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const connectTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 计时器
  useEffect(() => {
    if (callState === "connected") {
      connectTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setCallSeconds(Math.floor((Date.now() - connectTimeRef.current) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // 注册 WebRTC 事件
  useEffect(() => {
    webrtcService.setHandlers({
      onIncomingCall: () => {},
      onCallAccepted: () => setCallState("connected"),
      onCallRejected: () => {
        setCallState("ended");
        setTimeout(() => navigation.goBack(), 2000);
      },
      onCallEnded: () => {
        setCallState("ended");
        setTimeout(() => navigation.goBack(), 2000);
      },
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
      },
    });

    // 如果是呼出方，开始呼叫
    if (direction === "outgoing") {
      webrtcService.startCall(targetId);
    }

    return () => {
      webrtcService.setHandlers({
        onIncomingCall: () => {},
        onCallAccepted: () => {},
        onCallRejected: () => {},
        onCallEnded: () => {},
        onRemoteStream: () => {},
      });
    };
  }, []);

  // 接听
  const handleAccept = () => {
    // answerCall 在 ws 消息处理中触发（收到 offer 后）
    setCallState("connected");
  };

  // 拒绝/挂断
  const handleHangup = () => {
    if (direction === "incoming" && callState === "ringing") {
      webrtcService.reject(targetId);
    } else {
      webrtcService.hangup(targetId);
    }
    setCallState("ended");
    setTimeout(() => navigation.goBack(), 1500);
  };

  return (
    <View style={styles.container}>
      {/* 静音背景动画区域 */}
      <View style={styles.callArea}>
        {remoteStream ? (
          <RTCView streamURL={remoteStream.toURL()} style={styles.rtcView} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {targetName.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.callerName}>{targetName}</Text>

      <Text style={styles.statusText}>
        {callState === "ringing" && "对方邀请你语音通话..."}
        {callState === "calling" && "等待对方接听..."}
        {callState === "connected" && formatSeconds(callSeconds)}
        {callState === "ended" && "通话已结束"}
      </Text>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        {callState === "ringing" ? (
          <>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleHangup}>
              <Text style={styles.btnText}>拒绝</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
              <Text style={styles.btnText}>接听</Text>
            </TouchableOpacity>
          </>
        ) : callState === "ended" ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.btnText}>返回</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.rejectBtn} onPress={handleHangup}>
            <Text style={styles.btnText}>挂断</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#1a1a2e",
    alignItems: "center", justifyContent: "center",
  },
  callArea: {
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 24,
    overflow: "hidden",
  },
  rtcView: { width: "100%", height: "100%" },
  avatarPlaceholder: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 40, fontWeight: "700", color: "#fff" },
  callerName: { fontSize: 24, fontWeight: "600", color: "#fff", marginBottom: 8 },
  statusText: { fontSize: 15, color: "rgba(255,255,255,0.6)", marginBottom: 60 },
  actions: { flexDirection: "row", gap: 40 },
  rejectBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: "#ff4444", alignItems: "center", justifyContent: "center",
  },
  acceptBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: "#4cd964", alignItems: "center", justifyContent: "center",
  },
  backBtn: {
    paddingHorizontal: 30, paddingVertical: 14, borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
