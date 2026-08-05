/** Android 物理碰一碰：发起方 HCE 模拟卡，接收方 IsoDep Reader Mode。 */

import { Platform } from "react-native";
import NfcManager, { NfcAdapter, NfcTech } from "react-native-nfc-manager";
import {
  getKinHceCapabilities,
  startKinHceSharing,
  stopKinHceSharing,
  type KinHceCapabilities,
} from "../native/kinNfcHce";

const KIN_AID = [0xF0, 0x4B, 0x49, 0x4E, 0x30, 0x31];
const SELECT_KIN_AID_APDU = [0x00, 0xA4, 0x04, 0x00, KIN_AID.length, ...KIN_AID, 0x00];
const PROTOCOL_PREFIX = "KIN1:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export interface NfcCapabilities extends KinHceCapabilities {
  platformSupported: boolean;
}

let initialized = false;

export async function initNfc(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (initialized) return true;
  try {
    const supported = await NfcManager.isSupported();
    if (!supported) return false;
    await NfcManager.start();
    initialized = true;
    return true;
  } catch {
    return false;
  }
}

export async function getNfcCapabilities(): Promise<NfcCapabilities> {
  if (Platform.OS !== "android") {
    return {
      platformSupported: false,
      nativeModuleAvailable: false,
      nfcSupported: false,
      nfcEnabled: false,
      hceSupported: false,
    };
  }

  const managerSupported = await initNfc();
  let managerEnabled = false;
  if (managerSupported) {
    try {
      managerEnabled = await NfcManager.isEnabled();
    } catch { /* native capability result remains authoritative */ }
  }

  try {
    const nativeCapabilities = await getKinHceCapabilities();
    return {
      ...nativeCapabilities,
      platformSupported: true,
      nfcSupported: managerSupported && nativeCapabilities.nfcSupported,
      nfcEnabled: managerEnabled && nativeCapabilities.nfcEnabled,
    };
  } catch {
    return {
      platformSupported: true,
      nativeModuleAvailable: false,
      nfcSupported: managerSupported,
      nfcEnabled: managerEnabled,
      hceSupported: false,
    };
  }
}

export async function isNfcAvailable(): Promise<boolean> {
  const capabilities = await getNfcCapabilities();
  return capabilities.nfcSupported && capabilities.nfcEnabled;
}

export async function cancelNfc(): Promise<void> {
  await stopKinHceSharing().catch(() => {});
  try {
    await NfcManager.cancelTechnologyRequest({ throwOnError: false });
  } catch { /* cleanup is best effort */ }
  try {
    await NfcManager.unregisterTagEvent();
  } catch { /* no tag event may be active */ }
}

/** 发起方开启 HCE，等待另一台处于 Reader Mode 的 Android 手机靠近。 */
export async function startNfcSend(token: string): Promise<() => void> {
  const capabilities = await getNfcCapabilities();
  if (!capabilities.platformSupported) throw new Error("物理碰一碰目前仅支持 Android");
  if (!capabilities.nativeModuleAvailable) throw new Error("请安装包含 HCE 模块的新版 Kin APK");
  if (!capabilities.nfcSupported) throw new Error("这台手机不支持 NFC，可使用配对码");
  if (!capabilities.nfcEnabled) throw new Error("请先在系统设置中打开 NFC");
  if (!capabilities.hceSupported) throw new Error("这台手机不支持发起物理碰一碰，可使用配对码");
  if (!TOKEN_PATTERN.test(token)) throw new Error("配对凭证格式无效，请重新发起");

  await startKinHceSharing(token, 120);
  return () => { void stopKinHceSharing(); };
}

function decodeKinResponse(response: number[]): string {
  if (response.length < 2) throw new Error("碰一碰返回数据不完整，请重新靠近");
  const statusWord = response.slice(-2);
  if (statusWord[0] === 0x69 && statusWord[1] === 0x85) {
    throw new Error("对方的碰一碰会话已停止或过期");
  }
  if (statusWord[0] !== 0x90 || statusWord[1] !== 0x00) {
    throw new Error("附近设备不是可用的 Kin 碰一碰发起方");
  }
  const payload = String.fromCharCode(...response.slice(0, -2));
  if (!payload.startsWith(PROTOCOL_PREFIX)) {
    throw new Error("碰一碰协议不匹配，请确认双方使用同一版 Kin");
  }
  const token = payload.slice(PROTOCOL_PREFIX.length);
  if (!TOKEN_PATTERN.test(token)) throw new Error("读取到的配对凭证无效");
  return token;
}

/** 接收方进入 Android IsoDep Reader Mode，读取发起方 HCE 返回的短期配对码。 */
export async function startNfcReceive(timeoutMs = 60_000): Promise<string> {
  const capabilities = await getNfcCapabilities();
  if (!capabilities.platformSupported) throw new Error("物理碰一碰目前仅支持 Android");
  if (!capabilities.nfcSupported) throw new Error("这台手机不支持 NFC，可使用配对码");
  if (!capabilities.nfcEnabled) throw new Error("请先在系统设置中打开 NFC");

  let timer: ReturnType<typeof setTimeout> | null = null;
  const receive = (async () => {
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: "请将两台手机背部靠近",
      isReaderModeEnabled: true,
      readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
      readerModeDelay: 0,
    });
    await NfcManager.setTimeout(5_000);
    const response = await NfcManager.isoDepHandler.transceive(SELECT_KIN_AID_APDU);
    return decodeKinResponse(response);
  })();

  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => reject(new Error("没有检测到发起碰一碰的 Android 手机，请重新尝试")), timeoutMs);
  });

  try {
    return await Promise.race([receive, timeout]);
  } catch (error: any) {
    const message = String(error?.message || error || "");
    if (/cancel|cancelled|canceled/i.test(message)) throw new Error("已取消接收附近设备");
    if (/unsupported tag api/i.test(message)) {
      throw new Error("当前 APK 仍在使用旧 NFC 标签流程，请安装新版 Kin APK");
    }
    throw error instanceof Error ? error : new Error("NFC 读取失败，请重新靠近");
  } finally {
    if (timer) clearTimeout(timer);
    await NfcManager.cancelTechnologyRequest({ throwOnError: false }).catch(() => {});
  }
}
