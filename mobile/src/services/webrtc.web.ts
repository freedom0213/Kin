/**
 * Expo Web 的通话服务降级实现。
 *
 * react-native-webrtc 依赖原生模块，不能在 React Native Web 启动阶段加载。
 * Metro 会在 Web 平台优先选择本文件；Android/iOS 继续使用 webrtc.ts。
 */

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
  onRemoteStream: (stream: unknown) => void;
  onConnectionStateChange: (state: string) => void;
}

class WebRTCWebFallbackService {
  private sendSignal: ((data: any) => boolean) | null = null;

  setSignalSender(sendFn: (data: any) => boolean): void {
    this.sendSignal = sendFn;
  }

  setHandlers(_handlers: Partial<CallHandlers>): void {}

  saveIncomingOffer(
    _callId: unknown,
    _callerId: string,
    _callerName: string,
    _sdp: any,
  ): boolean {
    return false;
  }

  getPendingOffer(): null {
    return null;
  }

  peekPendingOffer(): null {
    return null;
  }

  async startCall(
    _targetUserId: string,
    _callerName?: string,
  ): Promise<CallSetupResult> {
    return { ok: false, reason: "media-unavailable" };
  }

  async answerCall(
    _callerId: string,
    _remoteSdp: any,
  ): Promise<CallSetupResult> {
    return { ok: false, reason: "media-unavailable" };
  }

  setMuted(_muted: boolean): boolean {
    return false;
  }

  hasActiveCall(): boolean {
    return false;
  }

  supportsSpeakerSelection(): boolean {
    return false;
  }

  async setSpeakerEnabled(_enabled: boolean): Promise<boolean> {
    return false;
  }

  async handleAnswer(_callId: unknown, _remoteSdp: any): Promise<boolean> {
    return false;
  }

  async beginIceRecovery(_targetUserId: string): Promise<boolean> {
    return false;
  }

  async resumeIceRecovery(): Promise<boolean> {
    return false;
  }

  async handleRestartRequest(
    _callId: unknown,
    _calleeId: string,
  ): Promise<boolean> {
    return false;
  }

  async handleRestartOffer(
    _callId: unknown,
    _callerId: string,
    _remoteSdp: any,
  ): Promise<boolean> {
    return false;
  }

  async handleRestartAnswer(
    _callId: unknown,
    _remoteSdp: any,
  ): Promise<boolean> {
    return false;
  }

  async handleIceCandidate(_callId: unknown, _candidate: any): Promise<void> {}

  handleRemoteRejected(_callId: unknown, _reason?: string): boolean {
    return false;
  }

  handleRemoteEnded(_callId: unknown): boolean {
    return false;
  }

  async getAudioLevel(): Promise<number> {
    return 0;
  }

  hangup(_targetUserId?: string): void {}

  reject(_callerId: string): void {}

  rejectIncomingOffer(callerId: string, callId: unknown): void {
    if (typeof callId !== "string" || !callId) return;
    this.sendSignal?.({
      type: "call_rejected",
      to: callerId,
      call_id: callId,
      detail: "Web 预览暂不支持语音通话",
    });
  }

  cleanup(): void {}
}

export const webrtcService = new WebRTCWebFallbackService();
