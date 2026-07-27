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

  get userId(): string | null {
    return this._userId;
  }

  connect(token: string) {
    this._shouldReconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this._stopHeartbeat();
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);

    this.ws.onopen = () => {
      console.log("[WS] 已连接");
      this._startHeartbeat();
      // 设置 WebRTC 信令发送函数
      webrtcService.setSignalSender((data) => this.send(data));
      this._dispatch("connected", { type: "connected" });
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;
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

    this.ws.onclose = () => {
      console.log("[WS] 已断开");
      this._stopHeartbeat();
      const t = getToken();
      if (t && this._shouldReconnect) {
        this._reconnectTimer = setTimeout(() => this.connect(t), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this._shouldReconnect = false;
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

  // -- WebRTC 信令分发 --

  /** 收到 WebSocket 消息时自动处理通话信令 */
  private _handleCallSignaling(data: any) {
    const { type } = data;

    if (type === "call_request") {
      // 存储来电 SDP，然后通知 UI
      webrtcService.saveIncomingOffer(data.from, data.caller_name || "", data.sdp);
      this._dispatch("incoming_call", data);
    } else if (type === "call_accepted") {
      // 对方接听 → 设置远端 SDP
      void webrtcService.handleAnswer(data.sdp);
      this._dispatch("call_accepted", data);
    } else if (type === "call_rejected") {
      webrtcService.handleRemoteRejected(data.detail);
      this._dispatch("call_rejected", data);
    } else if (type === "ice_candidate" && data.candidate) {
      webrtcService.handleIceCandidate(data.candidate);
    } else if (type === "call_end") {
      webrtcService.handleRemoteEnded();
      this._dispatch("call_end", data);
    }
  }

  private _dispatch(type: string, data: any) {
    if (this._handlers.has(type)) {
      this._handlers.get(type)!.forEach((fn) => fn(data));
    }
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
