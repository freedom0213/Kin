/** 本地 SQLite 消息存储 — expo-sqlite */

import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

/** 获取数据库实例（懒初始化） */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync("kin_messages.db");
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT,
      duration REAL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, created_at);
  `);
  return _db;
}

export interface LocalMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  type: "text" | "voice";
  content: string;
  duration?: number;
  is_read: boolean;
  created_at: string;
}

export interface ConversationSummary {
  chat_id: string;
  last_message: LocalMessage;
  unread_count: number;
}

/** 保存消息到本地 */
export async function saveMessage(msg: LocalMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, chat_id, sender_id, type, content, duration, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    msg.id,
    msg.chat_id,
    msg.sender_id,
    msg.type,
    msg.content,
    msg.duration ?? null,
    msg.is_read ? 1 : 0,
    msg.created_at
  );
}

/** 批量保存消息（事务包裹） */
export async function saveMessages(msgs: LocalMessage[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const msg of msgs) {
      await db.runAsync(
        `INSERT OR REPLACE INTO messages (id, chat_id, sender_id, type, content, duration, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        msg.id,
        msg.chat_id,
        msg.sender_id,
        msg.type,
        msg.content,
        msg.duration ?? null,
        msg.is_read ? 1 : 0,
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

/** 标记消息已读 */
export async function markAsRead(msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET is_read = 1 WHERE id = ?", msgId);
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
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
}
