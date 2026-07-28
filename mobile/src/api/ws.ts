/** WebSocket 客户端 — 聊天消息 + 语音 + 通话信令 */

import { WS_BASE } from "../config";
import { getToken } from "./client";
import { webrtcService } from "../services/webrtc";

type MessageHandler = (data: any) => void;
type IncomingMessageProcessor = (data: any) => Promise<any | null>;

class KinWebSocket {
  private ws: WebSocket | null = null;
  private _handlers: Map<string, Set<MessageHandler>> = new Map();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _userId: string | null = null;
  private _shouldReconnect = false;
  private _incomingMessageProcessor: IncomingMessageProcessor | null = null;
  private _resumeProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private _resumeRequested = false;
  private _connectionVersion = 0;

  get userId(): string | null {
    return this._userId;
  }

  connect(token: string) {
    const connectionVersion = ++this._connectionVersion;
    this._shouldReconnect = true;
    this._clearResumeProbe();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this._stopHeartbeat();
      this.ws.onclose = null;
      this.ws.close();
    }

    const socket = new WebSocket(`${WS_BASE}/ws?token=${token}`);
    this.ws = socket;

    socket.onopen = () => {
      if (connectionVersion !== this._connectionVersion || this.ws !== socket) return;
      console.log("[WS] 已连接");
      this._startHeartbeat();
      // 设置 WebRTC 信令发送函数
      webrtcService.setSignalSender((data) => this.send(data));
      this._dispatch("connected", { type: "connected" });
      if (this._resumeRequested) this._completeResume(true);
    };

    socket.onmessage = async (event) => {
      if (connectionVersion !== this._connectionVersion || this.ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        const type = data.type;
        if (type === "heartbeat_ack" && this._resumeRequested) {
          this._completeResume(false);
        }
        if (
          (type === "chat_message" || type === "voice_message")
          && this._incomingMessageProcessor
        ) {
          const processed = await this._incomingMessageProcessor(data);
          if (processed) this._dispatch("inbox_message", processed);
        } else if (type) {
          this._dispatch(type, data);
        }
        if (this._handlers.has("*")) {
          this._handlers.get("*")!.forEach((fn) => fn(data));
        }
        // WebRTC 信令处理
        this._handleCallSignaling(data);
      } catch { /* ignore parse errors */ }
    };

    socket.onclose = () => {
      if (connectionVersion !== this._connectionVersion || this.ws !== socket) return;
      console.log("[WS] 已断开");
      this.ws = null;
      this._stopHeartbeat();
      const t = getToken();
      if (t && this._shouldReconnect) {
        this._dispatch("connection_state", { type: "connection_state", state: "offline" });
        this._reconnectTimer = setTimeout(() => this.connect(t), 3000);
      }
    };

    socket.onerror = () => {
      if (connectionVersion !== this._connectionVersion || this.ws !== socket) return;
      socket.close();
    };
  }

  disconnect() {
    this._connectionVersion += 1;
    this._shouldReconnect = false;
    this._resumeRequested = false;
    this._clearResumeProbe();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: Record<string, any>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  setIncomingMessageProcessor(processor: IncomingMessageProcessor | null) {
    this._incomingMessageProcessor = processor;
  }

  /** App 回到前台时先探测现有连接；失活连接在超时后重新建立。 */
  resume(token: string): void {
    this._shouldReconnect = true;
    this._resumeRequested = true;
    this._clearResumeProbe();
    this._dispatch("connection_state", { type: "connection_state", state: "restoring" });

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      this._resumeProbeTimer = setTimeout(() => {
        if (!this._resumeRequested) return;
        console.log("[WS] 前台恢复时连接建立超时，重新连接");
        this.connect(token);
      }, 2500);
      return;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.connect(token);
      return;
    }

    if (!this.send({ type: "heartbeat" })) {
      this.connect(token);
      return;
    }
    this._resumeProbeTimer = setTimeout(() => {
      if (!this._resumeRequested) return;
      console.log("[WS] 前台恢复探测超时，重新连接");
      this.connect(token);
    }, 2500);
  }

  // -- WebRTC 信令分发 --

  /** 收到 WebSocket 消息时自动处理通话信令 */
  private _handleCallSignaling(data: any) {
    const { type } = data;

    if (type === "call_request") {
      const saved = webrtcService.saveIncomingOffer(
        data.call_id,
        data.from,
        data.caller_name || "",
        data.sdp
      );
      if (!saved) {
        webrtcService.rejectIncomingOffer(data.from, data.call_id);
        return;
      }
      this._dispatch("incoming_call", data);
    } else if (type === "call_accepted") {
      void webrtcService.handleAnswer(data.call_id, data.sdp).then((handled) => {
        if (handled) this._dispatch("call_accepted", data);
      });
    } else if (type === "call_rejected") {
      if (webrtcService.handleRemoteRejected(data.call_id, data.detail)) {
        this._dispatch("call_rejected", data);
      }
    } else if (type === "ice_candidate" && data.candidate) {
      void webrtcService.handleIceCandidate(data.call_id, data.candidate);
    } else if (type === "call_end") {
      if (webrtcService.handleRemoteEnded(data.call_id)) {
        this._dispatch("call_end", data);
      }
    }
  }

  private _dispatch(type: string, data: any) {
    if (this._handlers.has(type)) {
      this._handlers.get(type)!.forEach((fn) => fn(data));
    }
  }

  private _completeResume(reconnected: boolean): void {
    if (!this._resumeRequested) return;
    this._resumeRequested = false;
    this._clearResumeProbe();
    this._dispatch("resumed", { type: "resumed", reconnected });
  }

  private _clearResumeProbe(): void {
    if (this._resumeProbeTimer) clearTimeout(this._resumeProbeTimer);
    this._resumeProbeTimer = null;
  }

  // -- 消息发送方法 --

  /** 发送聊天消息 */
  sendMessage(to: string, content: string, msgId: string, encrypted = false): boolean {
    return this.send({ type: "chat_message", to, content, msg_id: msgId, encrypted });
  }

  /** 发送语音消息 */
  sendVoiceMessage(
    to: string,
    base64Audio: string,
    duration: number,
    msgId: string,
    encrypted = false
  ): boolean {
    return this.send({
      type: "voice_message", to,
      content: base64Audio,
      duration,
      msg_id: msgId,
      encrypted,
    });
  }

  /** 发送已读回执 */
  sendReadReceipt(to: string, msgId: string) {
    this.send({ type: "read_receipt", to, msg_id: msgId });
  }

  /** 接收设备已完成去重、解密和本地保存。 */
  sendMessageReceived(msgId: string) {
    this.send({ type: "message_received", msg_id: msgId });
  }

  /** 请求服务端补发消息并恢复 Outbox 状态。 */
  syncMessages() {
    this.send({ type: "sync_messages" });
  }

  /** 发送正在输入 */
  sendTyping(to: string) {
    this.send({ type: "typing", to });
  }

  // -- 事件监听 --

  on(type: string, handler: MessageHandler) {
    if (!this._handlers.has(type)) {
      this._handlers.set(type, new Set());
    }
    this._handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler) {
    this._handlers.get(type)?.delete(handler);
  }

  // -- 心跳 --

  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 30000);
  }

  private _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}

/** 全局 WebSocket 单例 */
export const kinWS = new KinWebSocket();
