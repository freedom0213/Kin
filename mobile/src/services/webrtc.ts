/** WebRTC 语音通话服务 — react-native-webrtc + WebSocket 信令 */

import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from "react-native-webrtc";

// STUN 服务器（Google 免费 STUN，用于 NAT 穿透）
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export interface CallHandlers {
  onIncomingCall: (callerId: string, callerName: string) => void;
  onCallAccepted: () => void;
  onCallRejected: (reason?: string) => void;
  onCallEnded: () => void;
  onRemoteStream: (stream: MediaStream) => void;
}

class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private handlers: CallHandlers | null = null;
  private _sendSignal: ((data: any) => void) | null = null;
  // 存储来电的 SDP，供 VoiceCallScreen 接听时使用
  private _pendingOffer: { callerId: string; sdp: any; callerName: string } | null = null;

  /** 注入信令发送函数 */
  setSignalSender(sendFn: (data: any) => void) {
    this._sendSignal = sendFn;
  }

  /** 注册通话事件回调 */
  setHandlers(h: Partial<CallHandlers>) {
    this.handlers = h as CallHandlers;
  }

  /** 存储来电 SDP 供后续接听使用 */
  saveIncomingOffer(callerId: string, callerName: string, sdp: any) {
    this._pendingOffer = { callerId, callerName, sdp };
  }

  /** 获取并清除待处理的来电 */
  getPendingOffer() {
    const offer = this._pendingOffer;
    this._pendingOffer = null;
    return offer;
  }

  // -- 发起呼叫 --

  async startCall(targetUserId: string, callerName?: string): Promise<void> {
    try {
      // 获取本地音频流
      this.localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

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

      // ICE 候选 → 通过 WebSocket 发送
      this.pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          this._sendSignal?.({
            type: "ice_candidate",
            to: targetUserId,
            candidate: event.candidate,
          });
        }
      };

      // 创建 offer
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);

      // 发送呼叫请求（含 SDP + 呼叫方名称）
      this._sendSignal?.({
        type: "call_request",
        to: targetUserId,
        sdp: offer,
        caller_name: callerName || "",
      });
    } catch (e: any) {
      console.log("发起呼叫失败", e);
      this.cleanup();
    }
  }

  // -- 接收呼叫（收到 offer 后调用） --

  async answerCall(callerId: string, remoteSdp: RTCSessionDescription): Promise<void> {
    try {
      this.localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.pc = new RTCPeerConnection(ICE_SERVERS);

      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });

      this.pc.ontrack = (event: any) => {
        if (event.streams?.[0]) {
          this.handlers?.onRemoteStream(event.streams[0]);
        }
      };

      this.pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          this._sendSignal?.({
            type: "ice_candidate",
            to: callerId,
            candidate: event.candidate,
          });
        }
      };

      // 设置远端 SDP + 创建 answer
      await this.pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this._sendSignal?.({
        type: "call_accepted",
        to: callerId,
        sdp: answer,
      });
    } catch (e: any) {
      console.log("接听呼叫失败", e);
      this.cleanup();
    }
  }

  // -- 处理对方 answer --

  async handleAnswer(remoteSdp: RTCSessionDescription): Promise<void> {
    try {
      await this.pc?.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    } catch (e) {
      console.log("设置远端 SDP 失败", e);
    }
  }

  // -- 处理 ICE 候选 --

  async handleIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      await this.pc?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.log("添加 ICE 候选失败", e);
    }
  }

  // -- 挂断 --

  hangup(targetUserId?: string) {
    this.cleanup();
    if (targetUserId) {
      this._sendSignal?.({ type: "call_end", to: targetUserId });
    }
  }

  // -- 拒绝 --

  reject(callerId: string) {
    this.cleanup();
    this._sendSignal?.({ type: "call_rejected", to: callerId });
  }

  // -- 清理资源 --

  cleanup() {
    this.localStream?.getTracks().forEach((t) => {
      t.stop();
      t.enabled = false;
    });
    this.localStream = null;
    this.pc?.close();
    this.pc = null;
  }
}

export const webrtcService = new WebRTCService();
