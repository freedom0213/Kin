/** 本地 SQLite 消息存储 — expo-sqlite */

import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 获取数据库实例（懒初始化） */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("kin_messages.db");
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'text',
          content TEXT,
          duration REAL,
          is_read INTEGER DEFAULT 0,
          encrypted INTEGER DEFAULT 0,
          wire_content TEXT,
          delivery_status TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, created_at);
      `);
      await ensureMessageColumns(db);
      _db = db;
      return db;
    })();
  }
  try {
    return await _dbPromise;
  } finally {
    _dbPromise = null;
  }
}

async function ensureMessageColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(messages)");
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ["encrypted", "INTEGER DEFAULT 0"],
    ["wire_content", "TEXT"],
    ["delivery_status", "TEXT"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`);
    }
  }
}

export type StoredDeliveryStatus = "sending" | "queued" | "delivered" | "read" | "failed";

export interface LocalMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  type: "text" | "voice";
  content: string;
  duration?: number;
  is_read: boolean;
  encrypted?: boolean;
  wire_content?: string | null;
  delivery_status?: StoredDeliveryStatus;
  created_at: string;
}

export interface ConversationSummary {
  chat_id: string;
  last_message: LocalMessage;
  unread_count: number;
}

export interface LocalMessageStats {
  messageCount: number;
  conversationCount: number;
}

/** 保存消息到本地 */
export async function saveMessage(msg: LocalMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
     (id, chat_id, sender_id, type, content, duration, is_read, encrypted, wire_content, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    msg.id,
    msg.chat_id,
    msg.sender_id,
    msg.type,
    msg.content,
    msg.duration ?? null,
    msg.is_read ? 1 : 0,
    msg.encrypted ? 1 : 0,
    msg.wire_content ?? null,
    msg.delivery_status ?? null,
    msg.created_at
  );
}

/** 批量保存消息（事务包裹） */
export async function saveMessages(msgs: LocalMessage[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const msg of msgs) {
      await db.runAsync(
        `INSERT OR REPLACE INTO messages
         (id, chat_id, sender_id, type, content, duration, is_read, encrypted, wire_content, delivery_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        msg.id,
        msg.chat_id,
        msg.sender_id,
        msg.type,
        msg.content,
        msg.duration ?? null,
        msg.is_read ? 1 : 0,
        msg.encrypted ? 1 : 0,
        msg.wire_content ?? null,
        msg.delivery_status ?? null,
        msg.created_at
      );
    }
  });
}

/** 读取与某人的历史消息（分页） */
export async function getMessages(
  chatId: string,
  limit = 50,
  beforeId?: string
): Promise<LocalMessage[]> {
  const db = await getDb();
  let sql = "SELECT * FROM messages WHERE chat_id = ?";
  const params: any[] = [chatId];

  if (beforeId) {
    sql += " AND id < ?";
    params.push(beforeId);
  }

  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  params.push(limit);

  const rows = await db.getAllAsync(sql, ...params);

  return (rows as any[]).map((row) => ({
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    type: row.type,
    content: row.content,
    duration: row.duration,
    is_read: !!row.is_read,
    encrypted: !!row.encrypted,
    delivery_status: row.delivery_status || undefined,
    created_at: row.created_at,
  })).reverse(); // 反转时间序 → 正序
}

/** 获取与某人的消息总数 */
export async function getMessageCount(chatId: string): Promise<number> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(
    "SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?",
    chatId
  );
  return row?.cnt || 0;
}

/** 批量读取会话列表所需的最后消息和本地未读数 */
export async function getConversationSummaries(
  chatIds: string[],
  currentUserId: string
): Promise<Record<string, ConversationSummary>> {
  if (chatIds.length === 0) return {};

  const db = await getDb();
  const placeholders = chatIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync(
    `WITH ranked AS (
       SELECT messages.*,
              ROW_NUMBER() OVER (
                PARTITION BY chat_id
                ORDER BY created_at DESC, id DESC
              ) AS row_number
       FROM messages
       WHERE chat_id IN (${placeholders})
     ), unread AS (
       SELECT chat_id, COUNT(*) AS unread_count
       FROM messages
       WHERE chat_id IN (${placeholders})
         AND sender_id != ?
         AND is_read = 0
       GROUP BY chat_id
     )
     SELECT ranked.*, COALESCE(unread.unread_count, 0) AS unread_count
     FROM ranked
     LEFT JOIN unread ON unread.chat_id = ranked.chat_id
     WHERE ranked.row_number = 1`,
    ...chatIds,
    ...chatIds,
    currentUserId
  );

  const summaries: Record<string, ConversationSummary> = {};
  for (const rawRow of rows as any[]) {
    summaries[rawRow.chat_id] = {
      chat_id: rawRow.chat_id,
      last_message: {
        id: rawRow.id,
        chat_id: rawRow.chat_id,
        sender_id: rawRow.sender_id,
        type: rawRow.type,
        content: rawRow.content,
        duration: rawRow.duration,
        is_read: !!rawRow.is_read,
        encrypted: !!rawRow.encrypted,
        delivery_status: rawRow.delivery_status || undefined,
        created_at: rawRow.created_at,
      },
      unread_count: Number(rawRow.unread_count) || 0,
    };
  }

  return summaries;
}

/** 删除与某人的所有消息 */
export async function clearMessages(chatId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM messages WHERE chat_id = ?", chatId);
}

/** 只从当前设备删除一条消息，不影响对方设备或服务端已投递内容。 */
export async function deleteMessage(msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM messages WHERE id = ?", msgId);
}

/** 获取设置页展示所需的本地消息统计。 */
export async function getLocalMessageStats(): Promise<LocalMessageStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    message_count: number;
    conversation_count: number;
  }>(
    `SELECT COUNT(*) AS message_count,
            COUNT(DISTINCT chat_id) AS conversation_count
     FROM messages`
  );
  return {
    messageCount: Number(row?.message_count) || 0,
    conversationCount: Number(row?.conversation_count) || 0,
  };
}

/** 标记消息已读 */
export async function markAsRead(msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET is_read = 1 WHERE id = ?", msgId);
}

/** 更新自己发送消息的服务器投递状态。 */
export async function updateMessageDeliveryStatus(
  msgId: string,
  status: StoredDeliveryStatus
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE messages
     SET delivery_status = ?, is_read = CASE WHEN ? = 'read' THEN 1 ELSE is_read END
     WHERE id = ?`,
    status,
    status,
    msgId
  );
}

/** 判断消息是否已被全局收件箱保存，用于重连补发去重。 */
export async function messageExists(msgId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM messages WHERE id = ? LIMIT 1",
    msgId
  );
  return !!row;
}

/** 获取需要在 WebSocket 重连后重新提交的本地 Outbox。 */
export async function getPendingOutgoingMessages(senderId: string): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT * FROM messages
     WHERE sender_id = ?
       AND delivery_status IN ('sending', 'queued')
       AND wire_content IS NOT NULL
     ORDER BY created_at, id`,
    senderId
  );
  return (rows as any[]).map((row) => ({
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    type: row.type,
    content: row.content,
    duration: row.duration,
    is_read: !!row.is_read,
    encrypted: !!row.encrypted,
    wire_content: row.wire_content,
    delivery_status: row.delivery_status,
    created_at: row.created_at,
  }));
}

/** 进入会话后，将对方发送给我的本地消息统一标记为已读 */
export async function markChatAsRead(
  chatId: string,
  currentUserId: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE messages
     SET is_read = 1
     WHERE chat_id = ? AND sender_id != ? AND is_read = 0`,
    chatId,
    currentUserId
  );
}

/** 导出所有消息（用于备份） */
export async function exportAllMessages(): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM messages ORDER BY created_at");
  return (rows as any[]).map((row) => ({
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    type: row.type,
    content: row.content,
    duration: row.duration,
    is_read: !!row.is_read,
    encrypted: !!row.encrypted,
    delivery_status: row.delivery_status || undefined,
    created_at: row.created_at,
  }));
}

/** 导出单个会话的全部本地消息 */
export async function exportConversationMessages(chatId: string): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, id",
    chatId
  );
  return (rows as any[]).map((row) => ({
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    type: row.type,
    content: row.content,
    duration: row.duration,
    is_read: !!row.is_read,
    created_at: row.created_at,
  }));
}

/** 导入消息（增量合并） */
export async function importMessages(msgs: LocalMessage[]): Promise<number> {
  await saveMessages(msgs);
  return msgs.length;
}

/** 关闭数据库 */
export async function closeDb(): Promise<void> {
  if (_dbPromise) await _dbPromise;
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
  _dbPromise = null;
}
