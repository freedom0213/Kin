/** 本地 SQLite 消息存储 — expo-sqlite */

import * as SQLite from "expo-sqlite";
import type { Friend } from "../api/client";

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MESSAGE_SCHEMA_VERSION = 1;
const MESSAGE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    owner_id TEXT NOT NULL,
    id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT,
    duration REAL,
    is_read INTEGER DEFAULT 0,
    encrypted INTEGER DEFAULT 0,
    wire_content TEXT,
    delivery_status TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, id)
  );
`;
const MESSAGE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_msg_chat
  ON messages(owner_id, chat_id, created_at);
`;

/** 获取数据库实例（懒初始化） */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("kin_messages.db");
      await db.execAsync("PRAGMA journal_mode = WAL");
      await db.execAsync(`
        ${MESSAGE_TABLE_SQL}
        CREATE TABLE IF NOT EXISTS contacts (
          owner_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          nickname TEXT,
          avatar TEXT,
          profile_banner TEXT,
          status_msg TEXT,
          meet_at TEXT NOT NULL,
          last_seen REAL,
          public_key TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id, username);
        CREATE TABLE IF NOT EXISTS contact_cache_meta (
          owner_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL
        );
      `);
      await migrateMessagesToOwnerScope(db);
      await ensureMessageColumns(db);
      await ensureContactColumns(db);
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

/**
 * 测试阶段迁移：旧消息无法可靠推断属于哪个登录账号，因此检测到旧结构时
 * 直接清空并重建为 owner_id + id 复合主键。
 */
async function migrateMessagesToOwnerScope(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string; pk: number }>(
    "PRAGMA table_info(messages)"
  );
  const ownerColumn = columns.find((column) => column.name === "owner_id");
  const idColumn = columns.find((column) => column.name === "id");
  const hasOwnerScopedPrimaryKey = ownerColumn?.pk === 1 && idColumn?.pk === 2;

  if (!hasOwnerScopedPrimaryKey) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(`
        DROP TABLE IF EXISTS messages;
        ${MESSAGE_TABLE_SQL}
        ${MESSAGE_INDEX_SQL}
        PRAGMA user_version = ${MESSAGE_SCHEMA_VERSION};
      `);
    });
    return;
  }

  // 确保旧的同名索引不会继续只按 chat_id 工作。
  await db.execAsync(`
    DROP INDEX IF EXISTS idx_msg_chat;
    ${MESSAGE_INDEX_SQL}
    PRAGMA user_version = ${MESSAGE_SCHEMA_VERSION};
  `);
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

async function ensureContactColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(contacts)");
  if (!columns.some((column) => column.name === "profile_banner")) {
    await db.execAsync("ALTER TABLE contacts ADD COLUMN profile_banner TEXT");
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

/** 用服务端最新快照替换当前账号的好友缓存。 */
export async function cacheFriends(ownerId: string, friends: Friend[]): Promise<void> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM contacts WHERE owner_id = ?", ownerId);
    for (const friend of friends) {
      await db.runAsync(
        `INSERT INTO contacts
         (owner_id, user_id, username, nickname, avatar, profile_banner, status_msg, meet_at, last_seen, public_key, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ownerId,
        friend.user_id,
        friend.username,
        friend.nickname,
        friend.avatar,
        friend.profile_banner,
        friend.status_msg,
        friend.meet_at,
        friend.last_seen,
        friend.public_key,
        updatedAt
      );
    }
    await db.runAsync(
      `INSERT OR REPLACE INTO contact_cache_meta (owner_id, updated_at)
       VALUES (?, ?)`,
      ownerId,
      updatedAt
    );
  });
}

/** 判断当前账号是否保存过好友快照，包括“好友数量为零”的有效快照。 */
export async function hasCachedFriendSnapshot(ownerId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ owner_id: string }>(
    "SELECT owner_id FROM contact_cache_meta WHERE owner_id = ? LIMIT 1",
    ownerId
  );
  return !!row;
}

/** 读取好友缓存。缓存中的在线状态统一视为离线，避免展示过期在线信息。 */
export async function getCachedFriends(ownerId: string): Promise<Friend[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT * FROM contacts WHERE owner_id = ? ORDER BY username COLLATE NOCASE",
    ownerId
  );
  return (rows as any[]).map((row) => ({
    user_id: row.user_id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar,
    profile_banner: row.profile_banner,
    status_msg: row.status_msg,
    meet_at: row.meet_at,
    is_online: false,
    last_seen: row.last_seen,
    public_key: row.public_key,
  }));
}

/** 删除当前账号的一条好友缓存记录。 */
export async function removeCachedFriend(ownerId: string, friendId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM contacts WHERE owner_id = ? AND user_id = ?",
    ownerId,
    friendId
  );
}

/** 收到实时资料事件后，只更新对应好友的公开资料缓存。 */
export async function updateCachedFriendProfile(
  ownerId: string,
  friendId: string,
  profile: Pick<
    Friend,
    "username" | "nickname" | "avatar" | "profile_banner" | "status_msg" | "public_key"
  >
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE contacts
     SET username = ?, nickname = ?, avatar = ?, profile_banner = ?, status_msg = ?, public_key = ?, updated_at = ?
     WHERE owner_id = ? AND user_id = ?`,
    profile.username,
    profile.nickname,
    profile.avatar,
    profile.profile_banner,
    profile.status_msg,
    profile.public_key,
    new Date().toISOString(),
    ownerId,
    friendId
  );
}

/** 保存当前账号的一条消息到本地。 */
export async function saveMessage(ownerId: string, msg: LocalMessage): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
     (owner_id, id, chat_id, sender_id, type, content, duration, is_read, encrypted, wire_content, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ownerId,
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

/** 批量保存当前账号的消息（事务包裹）。 */
export async function saveMessages(ownerId: string, msgs: LocalMessage[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const msg of msgs) {
      await db.runAsync(
        `INSERT OR REPLACE INTO messages
         (owner_id, id, chat_id, sender_id, type, content, duration, is_read, encrypted, wire_content, delivery_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ownerId,
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
  ownerId: string,
  chatId: string,
  limit = 50,
  beforeId?: string
): Promise<LocalMessage[]> {
  const db = await getDb();
  let sql = "SELECT * FROM messages WHERE owner_id = ? AND chat_id = ?";
  const params: any[] = [ownerId, chatId];

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

/** 获取当前账号与某人的消息总数。 */
export async function getMessageCount(ownerId: string, chatId: string): Promise<number> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(
    "SELECT COUNT(*) as cnt FROM messages WHERE owner_id = ? AND chat_id = ?",
    ownerId,
    chatId
  );
  return row?.cnt || 0;
}

/** 批量读取会话列表所需的最后消息和本地未读数 */
export async function getConversationSummaries(
  ownerId: string,
  chatIds: string[]
): Promise<Record<string, ConversationSummary>> {
  if (chatIds.length === 0) return {};

  const db = await getDb();
  const placeholders = chatIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync(
    `WITH ranked AS (
       SELECT messages.*,
              ROW_NUMBER() OVER (
                PARTITION BY owner_id, chat_id
                ORDER BY created_at DESC, id DESC
              ) AS row_number
       FROM messages
       WHERE owner_id = ? AND chat_id IN (${placeholders})
     ), unread AS (
       SELECT owner_id, chat_id, COUNT(*) AS unread_count
       FROM messages
       WHERE owner_id = ? AND chat_id IN (${placeholders})
         AND sender_id != ?
         AND is_read = 0
       GROUP BY owner_id, chat_id
     )
     SELECT ranked.*, COALESCE(unread.unread_count, 0) AS unread_count
     FROM ranked
     LEFT JOIN unread
       ON unread.owner_id = ranked.owner_id AND unread.chat_id = ranked.chat_id
     WHERE ranked.row_number = 1`,
    ownerId,
    ...chatIds,
    ownerId,
    ...chatIds,
    ownerId
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

/** 删除当前账号与某人的所有消息。 */
export async function clearMessages(ownerId: string, chatId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM messages WHERE owner_id = ? AND chat_id = ?",
    ownerId,
    chatId
  );
}

/** 删除当前账号在这台设备上的全部消息，不影响其他登录账号。 */
export async function clearAllMessages(ownerId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM messages WHERE owner_id = ?", ownerId);
}

/** 只从当前设备删除一条消息，不影响对方设备或服务端已投递内容。 */
export async function deleteMessage(ownerId: string, msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM messages WHERE owner_id = ? AND id = ?", ownerId, msgId);
}

/** 获取设置页展示所需的本地消息统计。 */
export async function getLocalMessageStats(ownerId: string): Promise<LocalMessageStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    message_count: number;
    conversation_count: number;
  }>(
    `SELECT COUNT(*) AS message_count,
            COUNT(DISTINCT chat_id) AS conversation_count
     FROM messages
     WHERE owner_id = ?`,
    ownerId
  );
  return {
    messageCount: Number(row?.message_count) || 0,
    conversationCount: Number(row?.conversation_count) || 0,
  };
}

/** 标记当前账号的一条消息已读。 */
export async function markAsRead(ownerId: string, msgId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE messages SET is_read = 1 WHERE owner_id = ? AND id = ?",
    ownerId,
    msgId
  );
}

/** 更新自己发送消息的服务器投递状态。 */
export async function updateMessageDeliveryStatus(
  ownerId: string,
  msgId: string,
  status: StoredDeliveryStatus
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE messages
     SET delivery_status = ?, is_read = CASE WHEN ? = 'read' THEN 1 ELSE is_read END
     WHERE owner_id = ? AND id = ?`,
    status,
    status,
    ownerId,
    msgId
  );
}

/** 判断消息是否已被全局收件箱保存，用于重连补发去重。 */
export async function messageExists(ownerId: string, msgId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM messages WHERE owner_id = ? AND id = ? LIMIT 1",
    ownerId,
    msgId
  );
  return !!row;
}

/** 获取需要在 WebSocket 重连后重新提交的本地 Outbox。 */
export async function getPendingOutgoingMessages(ownerId: string): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT * FROM messages
     WHERE owner_id = ?
       AND sender_id = ?
       AND delivery_status IN ('sending', 'queued')
       AND wire_content IS NOT NULL
     ORDER BY created_at, id`,
    ownerId,
    ownerId
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
  ownerId: string,
  chatId: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE messages
     SET is_read = 1
     WHERE owner_id = ? AND chat_id = ? AND sender_id != ? AND is_read = 0`,
    ownerId,
    chatId,
    ownerId
  );
}

/** 导出所有消息（用于备份） */
export async function exportAllMessages(ownerId: string): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT * FROM messages WHERE owner_id = ? ORDER BY created_at",
    ownerId
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
    delivery_status: row.delivery_status || undefined,
    created_at: row.created_at,
  }));
}

/** 导出单个会话的全部本地消息 */
export async function exportConversationMessages(
  ownerId: string,
  chatId: string
): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT * FROM messages WHERE owner_id = ? AND chat_id = ? ORDER BY created_at, id",
    ownerId,
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
export async function importMessages(ownerId: string, msgs: LocalMessage[]): Promise<number> {
  await saveMessages(ownerId, msgs);
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
