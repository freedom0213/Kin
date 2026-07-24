/** NFC 碰一碰服务 — 基于 react-native-nfc-manager v3 */

import NfcManager, { NfcTech, Ndef, NfcEvents, TagEvent } from "react-native-nfc-manager";

let _initialized = false;

/** 初始化 NFC 模块（应用启动时调用一次） */
export async function initNfc(): Promise<boolean> {
  if (_initialized) return true;
  try {
    const supported = await NfcManager.isSupported();
    if (supported) {
      await NfcManager.start();
      _initialized = true;
    }
    return supported || false;
  } catch {
    return false;
  }
}

/** 设备是否支持 NFC */
export async function isNfcAvailable(): Promise<boolean> {
  try {
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

/** 清理 NFC 资源（离开加好友页面时调用） */
export async function cancelNfc(): Promise<void> {
  try {
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    NfcManager.setEventListener(NfcEvents.SessionClosed, null);
    await NfcManager.cancelTechnologyRequest();
    await NfcManager.unregisterTagEvent();
  } catch {
    // 忽略清理阶段的错误
  }
}

// -- 发送模式：将 token 编码为 NDEF 写入 NFC --

/** 启动 NFC 发送，将 token 写入 NDEF 消息等待对方读取。返回 cancel 函数 */
export async function startNfcSend(token: string): Promise<() => void> {
  await NfcManager.requestTechnology(NfcTech.Ndef);

  // 编码 NDEF 文本记录
  const ndefBytes = Ndef.encodeMessage([Ndef.textRecord(token)]);
  await NfcManager.ndefHandler.writeNdefMessage(ndefBytes);

  const cancel = async () => {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch { /* ignore */ }
  };

  return cancel;
}

// -- 接收模式：前台调度监听 NFC tag，读取 token --

/** 启动 NFC 接收模式，返回读取到的 token。超时抛出错误 */
export function startNfcReceive(timeoutMs = 60000): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    let settled = false;

    // 超时定时器
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
      NfcManager.unregisterTagEvent().catch(() => {});
      reject(new Error("NFC 扫描超时，请重新碰一碰"));
    }, timeoutMs);

    // 发现 NFC tag 的回调
    const onTagDiscovered = (tag: TagEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        const ndefMessage = tag?.ndefMessage;
        if (!ndefMessage || ndefMessage.length === 0) {
          reject(new Error("未检测到 NFC 数据，请重试"));
          return;
        }

        const firstRecord = ndefMessage[0];
        if (!firstRecord?.payload) {
          reject(new Error("NFC 数据为空"));
          return;
        }

        // payload 是 any[]，转为 Uint8Array 调用 decodePayload
        const payloadBytes = new Uint8Array(firstRecord.payload as number[]);
        const token = Ndef.text.decodePayload(payloadBytes);

        if (!token) {
          reject(new Error("无法解析 NFC 数据"));
          return;
        }

        // 读取成功，清理并返回
        NfcManager.unregisterTagEvent().catch(() => {});
        NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
        resolve(token);
      } catch (e: any) {
        reject(new Error(e.message || "NFC 读取失败"));
      }
    };

    // 注册事件监听
    NfcManager.setEventListener(NfcEvents.DiscoverTag, onTagDiscovered);

    // 启动前台调度
    try {
      await NfcManager.registerTagEvent({
        invalidateAfterFirstRead: true,
        alertMessage: "将手机靠近对方的手机",
      });
    } catch (e: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
        reject(new Error("NFC 启动失败: " + (e.message || "未知错误")));
      }
    }
  });
}
