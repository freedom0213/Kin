/** WebSocket 客户端 */

import { WS_BASE } from "../config";
import { getToken } from "./client";

type MessageHandler = (data: any) => void;

class KinWebSocket {
  private ws: WebSocket | null = null;
  private _handlers: Map<string, Set<MessageHandler>> = new Map();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _userId: string | null = null;

  get userId(): string | null {
    return this._userId;
  }

  connect(token: string) {
    if (this.ws) this.ws.close();

    this.ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);

    this.ws.onopen = () => {
      console.log("[WS] 已连接");
      this._startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;
        if (type && this._handlers.has(type)) {
          this._handlers.get(type)!.forEach((fn) => fn(data));
        }
        // 通用消息处理器
        if (this._handlers.has("*")) {
          this._handlers.get("*")!.forEach((fn) => fn(data));
        }
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      console.log("[WS] 已断开");
      this._stopHeartbeat();
      // 自动重连
      const t = getToken();
      if (t) {
        this._reconnectTimer = setTimeout(() => this.connect(t), 3000);
      }
    };

    this.ws.onerror = () => {
      // onclose 会自动触发
      this.ws?.close();
    };
  }

  disconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: Record<string, any>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** 发送聊天消息（encrypted=true 表示内容已 E2E 加密） */
  sendMessage(to: string, content: string, msgId: string, encrypted = false) {
    this.send({ type: "chat_message", to, content, msg_id: msgId, encrypted });
  }

  /** 发送已读回执 */
  sendReadReceipt(to: string, msgId: string) {
    this.send({ type: "read_receipt", to, msg_id: msgId });
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
