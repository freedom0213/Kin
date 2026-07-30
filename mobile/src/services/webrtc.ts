/** WebRTC 语音通话服务 — react-native-webrtc + WebSocket 信令 */

import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from "react-native-webrtc";
import { requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { Platform } from "react-native";

// STUN 服务器（Google 免费 STUN，用于 NAT 穿透）
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function createCallId(): string {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `call_${Date.now().toString(36)}_${randomPart}`;
}

function isValidCallId(callId: unknown): callId is string {
  return typeof callId === "string" && callId.length >= 8 && callId.length <= 128;
}

export type CallFailureReason =
  | "microphone-permission"
  | "signaling-unavailable"
  | "media-unavailable"
  | "cancelled";

export type CallSetupResult =
  | { ok: true }
  | { ok: false; reason: CallFailureReason };

export interface CallHandlers {
  onIncomingCall: (callerId: string, callerName: string) => void;
  onCallAccepted: () => void;
  onCallRejected: (reason?: string) => void;
  onCallEnded: () => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private handlers: CallHandlers | null = null;
  private _sendSignal: ((data: any) => boolean) | null = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private audioRouteVersion = 0;
  private sessionVersion = 0;
  private currentCallId: string | null = null;
  private currentPeerId: string | null = null;
  private isCaller = false;
  private signalingReady = false;
  private pendingLocalIceCandidates: any[] = [];
  private recoveryRequested = false;
  private restartPreparing = false;
  private restartInFlight = false;
  private pendingRestartRequest = false;
  private pendingRestartOffer: any | null = null;
  private pendingRestartAnswer: any | null = null;
  private lastRestartSignalAt = 0;
  // 存储来电的 SDP，供 VoiceCallScreen 接听时使用
  private _pendingOffer: {
    callId: string;
    callerId: string;
    sdp: any;
    callerName: string;
  } | null = null;

  /** 注入信令发送函数 */
  setSignalSender(sendFn: (data: any) => boolean) {
    this._sendSignal = sendFn;
  }

  /** 注册通话事件回调 */
  setHandlers(h: Partial<CallHandlers>) {
    this.handlers = h as CallHandlers;
  }

  /** 存储来电 SDP 供后续接听使用 */
  saveIncomingOffer(callId: unknown, callerId: string, callerName: string, sdp: any): boolean {
    if (!isValidCallId(callId)) return false;
    if (this.currentCallId && this.currentCallId !== callId) return false;
    this.currentCallId = callId;
    this.currentPeerId = callerId;
    this.isCaller = false;
    this.signalingReady = true;
    this._pendingOffer = { callId, callerId, callerName, sdp };
    return true;
  }

  /** 获取并清除待处理的来电 */
  getPendingOffer() {
    const offer = this._pendingOffer;
    this._pendingOffer = null;
    return offer;
  }

  /** 只查看待处理来电，供通知导航确认 WebSocket Offer 已经补发。 */
  peekPendingOffer() {
    return this._pendingOffer;
  }

  // -- 发起呼叫 --

  async startCall(targetUserId: string, callerName?: string): Promise<CallSetupResult> {
    const sessionVersion = ++this.sessionVersion;
    const callId = createCallId();
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        return { ok: false, reason: "microphone-permission" };
      }
      if (sessionVersion !== this.sessionVersion) {
        return { ok: false, reason: "cancelled" };
      }

      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (sessionVersion !== this.sessionVersion) {
        localStream.getTracks().forEach((track) => track.stop());
        return { ok: false, reason: "cancelled" };
      }
      this.localStream = localStream;
      this.currentCallId = callId;
      this.currentPeerId = targetUserId;
      this.isCaller = true;
      this.signalingReady = false;
      this.pendingLocalIceCandidates = [];

      this.pc = new RTCPeerConnection(ICE_SERVERS);

      // 添加本地 track
      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });

      // 收到远程 track
      this.pc.ontrack = (event: any) => {
        if (event.streams?.[0]) {
          this.handlers?.onRemoteStream(event.streams[0]);
        }
      };

      this.pc.onconnectionstatechange = () => this.handleConnectionStateChange();

      // ICE 候选 → 通过 WebSocket 发送
      this.pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          this.sendIceCandidate(targetUserId, callId, event.candidate);
        }
      };

      // 创建 offer
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);
      if (sessionVersion !== this.sessionVersion) {
        return { ok: false, reason: "cancelled" };
      }

      // 发送呼叫请求（含 SDP + 呼叫方名称）
      const sent = this._sendSignal?.({
        type: "call_request",
        to: targetUserId,
        call_id: callId,
        sdp: offer,
        caller_name: callerName || "",
      }) ?? false;
      if (!sent) {
        this.cleanup();
        return { ok: false, reason: "signaling-unavailable" };
      }
      this.signalingReady = true;
      this.flushLocalIceCandidates(targetUserId, callId);
      return { ok: true };
    } catch (error) {
      console.log("发起呼叫失败", error);
      this.cleanup();
      return { ok: false, reason: "media-unavailable" };
    }
  }

  // -- 接收呼叫（收到 offer 后调用） --

  async answerCall(callerId: string, remoteSdp: RTCSessionDescription): Promise<CallSetupResult> {
    const sessionVersion = ++this.sessionVersion;
    const callId = this.currentCallId;
    if (!callId) return { ok: false, reason: "cancelled" };
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        return { ok: false, reason: "microphone-permission" };
      }
      if (sessionVersion !== this.sessionVersion) {
        return { ok: false, reason: "cancelled" };
      }

      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (sessionVersion !== this.sessionVersion) {
        localStream.getTracks().forEach((track) => track.stop());
        return { ok: false, reason: "cancelled" };
      }
      this.localStream = localStream;
      this.currentPeerId = callerId;
      this.isCaller = false;

      this.pc = new RTCPeerConnection(ICE_SERVERS);

      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });

      this.pc.ontrack = (event: any) => {
        if (event.streams?.[0]) {
          this.handlers?.onRemoteStream(event.streams[0]);
        }
      };

      this.pc.onconnectionstatechange = () => this.handleConnectionStateChange();

      this.pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          this._sendSignal?.({
            type: "ice_candidate",
            to: callerId,
            call_id: callId,
            candidate: event.candidate,
          });
        }
      };

      // 设置远端 SDP + 创建 answer
      await this.pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      await this.flushPendingIceCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (sessionVersion !== this.sessionVersion) {
        return { ok: false, reason: "cancelled" };
      }

      const sent = this._sendSignal?.({
        type: "call_accepted",
        to: callerId,
        call_id: callId,
        sdp: answer,
      }) ?? false;
      if (!sent) {
        this.cleanup();
        return { ok: false, reason: "signaling-unavailable" };
      }
      return { ok: true };
    } catch (error) {
      console.log("接听呼叫失败", error);
      this.cleanup();
      return { ok: false, reason: "media-unavailable" };
    }
  }

  /** 启用或关闭当前通话的本机麦克风。 */
  setMuted(muted: boolean): boolean {
    const audioTracks = this.localStream?.getAudioTracks() || [];
    if (audioTracks.length === 0) return false;
    audioTracks.forEach((track) => {
      track.enabled = !muted;
    });
    return true;
  }

  hasActiveCall(): boolean {
    return !!this.currentCallId || !!this.pc || !!this.localStream;
  }

  /** 当前无需额外原生依赖即可切换通话音频输出的平台。 */
  supportsSpeakerSelection(): boolean {
    return Platform.OS === "android";
  }

  /** Android 通话期间在听筒和扬声器之间切换。 */
  async setSpeakerEnabled(enabled: boolean): Promise<boolean> {
    if (!this.supportsSpeakerSelection() || !this.localStream) return false;
    const routeVersion = this.audioRouteVersion;
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "doNotMix",
        shouldRouteThroughEarpiece: !enabled,
      });
      if (routeVersion !== this.audioRouteVersion || !this.localStream) {
        await this.restoreAudioRoute();
        return false;
      }
      return true;
    } catch (error) {
      console.log("切换通话音频输出失败", error);
      return false;
    }
  }

  private async restoreAudioRoute(): Promise<void> {
    if (Platform.OS !== "android") return;
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "duckOthers",
      shouldRouteThroughEarpiece: false,
    });
  }

  // -- 处理对方 answer --

  async handleAnswer(callId: unknown, remoteSdp: RTCSessionDescription): Promise<boolean> {
    try {
      if (!isValidCallId(callId) || callId !== this.currentCallId) return false;
      if (!this.pc) throw new Error("呼叫连接尚未初始化");
      await this.pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      await this.flushPendingIceCandidates();
      this.handlers?.onCallAccepted();
      return true;
    } catch (e) {
      console.log("设置远端 SDP 失败", e);
      this.cleanup();
      this.handlers?.onCallRejected("无法建立远端连接");
      return false;
    }
  }

  /** 标记通话网络异常；呼叫方负责发起 ICE Restart，接听方等待恢复 offer。 */
  async beginIceRecovery(targetUserId: string): Promise<boolean> {
    if (!this.pc || !this.currentCallId) return false;
    this.currentPeerId = targetUserId;
    this.recoveryRequested = true;
    if (!this.isCaller) {
      this.pendingRestartRequest = true;
      return this.sendPendingRestartRequest();
    }
    return this.prepareIceRestart();
  }

  /** WebSocket 恢复后重新发送尚未投递的恢复协商。 */
  async resumeIceRecovery(): Promise<boolean> {
    if (!this.recoveryRequested || !this.currentCallId || !this.currentPeerId) return false;
    if (this.pendingRestartRequest) return this.sendPendingRestartRequest();
    if (this.pendingRestartOffer) return this.sendPendingRestartOffer();
    if (this.pendingRestartAnswer) return this.sendPendingRestartAnswer();
    if (this.isCaller && !this.restartInFlight) return this.prepareIceRestart();
    return true;
  }

  private sendPendingRestartRequest(): boolean {
    if (!this.pendingRestartRequest || !this.currentCallId || !this.currentPeerId) return false;
    if (Date.now() - this.lastRestartSignalAt < 300) return true;
    const sent = this._sendSignal?.({
      type: "ice_restart_request",
      to: this.currentPeerId,
      call_id: this.currentCallId,
    }) ?? false;
    if (sent) this.lastRestartSignalAt = Date.now();
    return sent;
  }

  async handleRestartRequest(callId: unknown, calleeId: string): Promise<boolean> {
    if (!isValidCallId(callId) || callId !== this.currentCallId || !this.pc || !this.isCaller) return false;
    this.currentPeerId = calleeId;
    this.recoveryRequested = true;
    return this.prepareIceRestart();
  }

  private async prepareIceRestart(): Promise<boolean> {
    if (!this.pc || !this.currentCallId || !this.currentPeerId) return false;
    if (this.restartPreparing || this.restartInFlight) return true;
    this.restartPreparing = true;
    this.signalingReady = false;
    this.pendingLocalIceCandidates = [];
    try {
      this.pc.restartIce();
      const offer = await this.pc.createOffer({ iceRestart: true, offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);
      this.pendingRestartOffer = offer;
      this.restartInFlight = true;
      return this.sendPendingRestartOffer();
    } catch (error) {
      console.log("发起 ICE Restart 失败", error);
      this.restartInFlight = false;
      return false;
    } finally {
      this.restartPreparing = false;
    }
  }

  private sendPendingRestartOffer(): boolean {
    if (!this.pendingRestartOffer || !this.currentCallId || !this.currentPeerId) return false;
    if (Date.now() - this.lastRestartSignalAt < 300) return true;
    const sent = this._sendSignal?.({
      type: "ice_restart_offer",
      to: this.currentPeerId,
      call_id: this.currentCallId,
      sdp: this.pendingRestartOffer,
    }) ?? false;
    if (sent) {
      this.lastRestartSignalAt = Date.now();
      this.signalingReady = true;
      this.flushLocalIceCandidates(this.currentPeerId, this.currentCallId);
    }
    return sent;
  }

  async handleRestartOffer(callId: unknown, callerId: string, remoteSdp: RTCSessionDescription): Promise<boolean> {
    if (!isValidCallId(callId) || callId !== this.currentCallId || !this.pc || this.isCaller) return false;
    this.currentPeerId = callerId;
    this.recoveryRequested = true;
    this.pendingRestartRequest = false;
    this.lastRestartSignalAt = 0;
    this.signalingReady = false;
    this.pendingLocalIceCandidates = [];
    this.pendingIceCandidates = [];
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.pendingRestartAnswer = answer;
      return this.sendPendingRestartAnswer();
    } catch (error) {
      console.log("响应 ICE Restart 失败", error);
      return false;
    }
  }

  private sendPendingRestartAnswer(): boolean {
    if (!this.pendingRestartAnswer || !this.currentCallId || !this.currentPeerId) return false;
    if (Date.now() - this.lastRestartSignalAt < 300) return true;
    const sent = this._sendSignal?.({
      type: "ice_restart_answer",
      to: this.currentPeerId,
      call_id: this.currentCallId,
      sdp: this.pendingRestartAnswer,
    }) ?? false;
    if (sent) {
      this.lastRestartSignalAt = Date.now();
      this.signalingReady = true;
      this.flushLocalIceCandidates(this.currentPeerId, this.currentCallId);
    }
    return sent;
  }

  async handleRestartAnswer(callId: unknown, remoteSdp: RTCSessionDescription): Promise<boolean> {
    if (!isValidCallId(callId) || callId !== this.currentCallId || !this.pc || !this.isCaller) return false;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      await this.flushPendingIceCandidates();
      this.restartInFlight = false;
      this.pendingRestartOffer = null;
      return true;
    } catch (error) {
      console.log("完成 ICE Restart 失败", error);
      this.restartInFlight = false;
      return false;
    }
  }

  // -- 处理 ICE 候选 --

  async handleIceCandidate(callId: unknown, candidate: RTCIceCandidate): Promise<void> {
    try {
      if (!isValidCallId(callId) || callId !== this.currentCallId) return;
      const normalized = new RTCIceCandidate(candidate);
      if (!this.pc || !this.pc.remoteDescription) {
        this.pendingIceCandidates.push(normalized);
        return;
      }
      await this.pc.addIceCandidate(normalized);
    } catch (e) {
      console.log("添加 ICE 候选失败", e);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription || this.pendingIceCandidates.length === 0) return;
    const pending = this.pendingIceCandidates.splice(0);
    for (const candidate of pending) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  private sendIceCandidate(targetUserId: string, callId: string, candidate: any): void {
    if (!this.signalingReady) {
      this.pendingLocalIceCandidates.push(candidate);
      return;
    }
    this._sendSignal?.({
      type: "ice_candidate",
      to: targetUserId,
      call_id: callId,
      candidate,
    });
  }

  private flushLocalIceCandidates(targetUserId: string, callId: string): void {
    const pending = this.pendingLocalIceCandidates.splice(0);
    pending.forEach((candidate) => this.sendIceCandidate(targetUserId, callId, candidate));
  }

  private handleConnectionStateChange(): void {
    if (!this.pc) return;
    const connectionState = this.pc.connectionState;
    if (connectionState === "connected") {
      this.recoveryRequested = false;
      this.restartPreparing = false;
      this.restartInFlight = false;
      this.pendingRestartRequest = false;
      this.pendingRestartOffer = null;
      this.pendingRestartAnswer = null;
      this.lastRestartSignalAt = 0;
    }
    this.handlers?.onConnectionStateChange(connectionState);
  }

  handleRemoteRejected(callId: unknown, reason?: string): boolean {
    if (!isValidCallId(callId) || callId !== this.currentCallId) return false;
    this.cleanup();
    this.handlers?.onCallRejected(reason);
    return true;
  }

  handleRemoteEnded(callId: unknown): boolean {
    if (!isValidCallId(callId) || callId !== this.currentCallId) return false;
    this.cleanup();
    this.handlers?.onCallEnded();
    return true;
  }

  /** 读取可用的 WebRTC 音频强度；运行时不提供 audioLevel 时返回 0。 */
  async getAudioLevel(): Promise<number> {
    if (!this.pc) return 0;
    try {
      const reports = await this.pc.getStats();
      let level = 0;
      reports.forEach((report: any) => {
        if (
          report.type === "inbound-rtp"
          && (report.kind === "audio" || report.mediaType === "audio")
          && typeof report.audioLevel === "number"
        ) {
          level = Math.max(level, Math.min(1, report.audioLevel));
        }
      });
      return level;
    } catch {
      return 0;
    }
  }

  // -- 挂断 --

  hangup(targetUserId?: string) {
    const callId = this.currentCallId;
    this.cleanup();
    if (targetUserId && callId) {
      this._sendSignal?.({ type: "call_end", to: targetUserId, call_id: callId });
    }
  }

  // -- 拒绝 --

  reject(callerId: string) {
    const callId = this.currentCallId;
    this.cleanup();
    if (callId) {
      this._sendSignal?.({ type: "call_rejected", to: callerId, call_id: callId });
    }
  }

  rejectIncomingOffer(callerId: string, callId: unknown): void {
    if (!isValidCallId(callId)) return;
    this._sendSignal?.({
      type: "call_rejected",
      to: callerId,
      call_id: callId,
      detail: "对方正在通话",
    });
  }

  // -- 清理资源 --

  cleanup() {
    this.sessionVersion += 1;
    this.audioRouteVersion += 1;
    this.localStream?.getTracks().forEach((t) => {
      t.stop();
      t.enabled = false;
    });
    this.localStream = null;
    this.pc?.close();
    this.pc = null;
    this.pendingIceCandidates = [];
    this.pendingLocalIceCandidates = [];
    this.currentCallId = null;
    this.currentPeerId = null;
    this.isCaller = false;
    this.signalingReady = false;
    this.recoveryRequested = false;
    this.restartPreparing = false;
    this.restartInFlight = false;
    this.pendingRestartRequest = false;
    this.pendingRestartOffer = null;
    this.pendingRestartAnswer = null;
    this.lastRestartSignalAt = 0;
    this._pendingOffer = null;
    void this.restoreAudioRoute().catch(() => undefined);
  }
}

export const webrtcService = new WebRTCService();
