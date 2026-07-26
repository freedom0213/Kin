/** 消息导出/导入 — JSON 文件 ↔ 本地 SQLite */

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  exportAllMessages, exportConversationMessages, importMessages, LocalMessage,
} from "./db";

/** 导出所有消息为 JSON 文件并通过系统分享 */
export async function exportMessagesToFile(): Promise<void> {
  const messages = await exportAllMessages();

  const exportData = {
    app: "Kin",
    version: 1,
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages,
  };

  const jsonStr = JSON.stringify(exportData, null, 2);

  // 新 API: 使用 File 类写入文档目录
  const file = new File(Paths.document, "kin_backup.json");
  await file.write(jsonStr);

  // 通过系统分享面板导出
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      dialogTitle: "导出 Kin 聊天记录",
    });
  }
}

/** 导出指定会话为 JSON 文件并通过系统分享 */
export async function exportConversationToFile(
  chatId: string,
  displayName: string
): Promise<number> {
  const messages = await exportConversationMessages(chatId);
  if (messages.length === 0) return 0;

  const exportData = {
    app: "Kin",
    version: 1,
    scope: "conversation",
    conversation_with: {
      user_id: chatId,
      display_name: displayName,
    },
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages,
  };

  const file = new File(Paths.document, `kin_conversation_${chatId}.json`);
  await file.write(JSON.stringify(exportData, null, 2));

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("当前设备不支持系统分享");

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: `导出与${displayName}的聊天记录`,
  });
  return messages.length;
}

/** 从 JSON 文件导入消息 */
export async function importMessagesFromFile(
  fileUri: string
): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const file = new File(fileUri);
    const jsonStr = await file.text();

    const data = JSON.parse(jsonStr);

    if (!data.app || data.app !== "Kin" || !Array.isArray(data.messages)) {
      return { success: false, count: 0, message: "无效的 Kin 备份文件" };
    }

    const msgs: LocalMessage[] = data.messages.map((m: any) => ({
      id: m.id || `${Date.now()}_${Math.random()}`,
      chat_id: m.chat_id,
      sender_id: m.sender_id,
      type: m.type || "text",
      content: m.content || "",
      duration: m.duration,
      is_read: !!m.is_read,
      encrypted: !!m.encrypted,
      delivery_status: m.delivery_status,
      created_at: m.created_at || new Date().toISOString(),
    }));

    const count = await importMessages(msgs);
    return { success: true, count, message: `成功导入 ${count} 条消息` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || "导入失败" };
  }
}
