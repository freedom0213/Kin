/** 全局消息收件箱：解密、去重、落库、设备确认，以及重连 Outbox 重发。 */

import { getFriendList, type Friend } from "../api/client";
import { kinWS } from "../api/ws";
import {
  getPendingOutgoingMessages,
  messageExists,
  saveMessage,
  updateMessageDeliveryStatus,
  type StoredDeliveryStatus,
} from "./db";
import { decrypt } from "./encryption";
import { getSecretKey } from "./keys";

function normalizeCreatedAt(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

class MessageInbox {
  private userId: string | null = null;
  private secretKey: string | null = null;
  private friends = new Map<string, Friend>();
  private started = false;

  async start(userId: string): Promise<void> {
    this.stop();
    this.userId = userId;
    const [secretKey] = await Promise.all([
      getSecretKey(),
      this.refreshFriends(),
    ]);
    this.secretKey = secretKey;
    kinWS.setIncomingMessageProcessor(this.processIncoming);
    kinWS.on("connected", this.handleConnected);
    kinWS.on("queued", this.handleQueued);
    kinWS.on("delivered", this.handleDelivered);
    kinWS.on("read_receipt", this.handleRead);
    kinWS.on("message_status", this.handleStatusSnapshot);
    kinWS.on("error", this.handleError);
    kinWS.on("friend_added", this.handleFriendChanged);
    kinWS.on("friend_removed", this.handleFriendChanged);
    this.started = true;
  }

  stop(): void {
    if (this.started) {
      kinWS.off("connected", this.handleConnected);
      kinWS.off("queued", this.handleQueued);
      kinWS.off("delivered", this.handleDelivered);
      kinWS.off("read_receipt", this.handleRead);
      kinWS.off("message_status", this.handleStatusSnapshot);
      kinWS.off("error", this.handleError);
      kinWS.off("friend_added", this.handleFriendChanged);
      kinWS.off("friend_removed", this.handleFriendChanged);
    }
    kinWS.setIncomingMessageProcessor(null);
    this.userId = null;
    this.secretKey = null;
    this.friends.clear();
    this.started = false;
  }

  private refreshFriends = async (): Promise<void> => {
    try {
      const result = await getFriendList();
      this.friends = new Map(result.friends.map((friend) => [friend.user_id, friend]));
    } catch {
      this.friends.clear();
    }
  };

  private getFriend = async (userId: string): Promise<Friend | undefined> => {
    let friend = this.friends.get(userId);
    if (!friend) {
      await this.refreshFriends();
      friend = this.friends.get(userId);
    }
    return friend;
  };

  private processIncoming = async (data: any): Promise<any | null> => {
    const msgId = data.msg_id;
    const senderId = data.from;
    if (!this.userId || typeof msgId !== "string" || typeof senderId !== "string") {
      return null;
    }

    if (await messageExists(msgId)) {
      kinWS.sendMessageReceived(msgId);
      return null;
    }

    let content = data.content;
    if (data.encrypted) {
      const friend = await this.getFriend(senderId);
      if (!friend?.public_key || !this.secretKey) {
        throw new Error("缺少消息解密密钥");
      }
      content = decrypt(data.content, friend.public_key, this.secretKey);
    }

    const createdAt = normalizeCreatedAt(data.created_at);
    await saveMessage({
      id: msgId,
      chat_id: senderId,
      sender_id: senderId,
      type: data.type === "voice_message" ? "voice" : "text",
      content,
      duration: data.duration,
      is_read: false,
      encrypted: !!data.encrypted,
      created_at: createdAt,
    });
    kinWS.sendMessageReceived(msgId);

    return {
      ...data,
      content,
      created_at: createdAt,
      type: "inbox_message",
      message_type: data.type === "voice_message" ? "voice" : "text",
    };
  };

  private handleConnected = () => {
    void this.flushAndSync();
  };

  private async flushAndSync(): Promise<void> {
    if (!this.userId) return;
    const pending = await getPendingOutgoingMessages(this.userId);
    for (const message of pending) {
      if (!message.wire_content) continue;
      if (message.type === "voice") {
        kinWS.sendVoiceMessage(
          message.chat_id,
          message.wire_content,
          message.duration || 0,
          message.id,
          !!message.encrypted
        );
      } else {
        kinWS.sendMessage(
          message.chat_id,
          message.wire_content,
          message.id,
          !!message.encrypted
        );
      }
    }
    kinWS.syncMessages();
  }

  private setStatus(msgId: unknown, status: StoredDeliveryStatus): void {
    if (typeof msgId === "string") {
      void updateMessageDeliveryStatus(msgId, status);
    }
  }

  private handleQueued = (data: any) => this.setStatus(data.msg_id, "queued");
  private handleDelivered = (data: any) => this.setStatus(data.msg_id, "delivered");
  private handleRead = (data: any) => this.setStatus(data.msg_id, "read");
  private handleStatusSnapshot = (data: any) => {
    if (["queued", "delivered", "read"].includes(data.status)) {
      this.setStatus(data.msg_id, data.status as StoredDeliveryStatus);
    }
  };
  private handleError = (data: any) => {
    if (data.msg_id) this.setStatus(data.msg_id, "failed");
  };
  private handleFriendChanged = () => { void this.refreshFriends(); };
}

export const messageInbox = new MessageInbox();
