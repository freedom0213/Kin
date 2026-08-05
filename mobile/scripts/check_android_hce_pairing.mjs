import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const read = (relativePath) => readFileSync(path.join(mobileRoot, relativePath), "utf8");

const nfcService = read("src/services/nfc.ts");
const nativeBridge = read("src/native/kinNfcHce.ts");
const addFriend = read("src/screens/AddFriendScreen.tsx");
const manifest = read("modules/kin-nfc-hce/android/src/main/AndroidManifest.xml");
const hceConfig = read("modules/kin-nfc-hce/android/src/main/res/xml/kin_hce_service.xml");
const hostService = read("modules/kin-nfc-hce/android/src/main/java/com/kin/nfchce/KinHostApduService.kt");
const moduleConfig = read("modules/kin-nfc-hce/expo-module.config.json");

assert.match(moduleConfig, /com\.kin\.nfchce\.KinNfcHceModule/, "本地 Expo HCE 模块没有声明 Android module");
assert.match(manifest, /android\.permission\.NFC/, "HCE 模块没有声明 NFC 权限");
assert.match(manifest, /android\.permission\.BIND_NFC_SERVICE/, "HCE 服务缺少系统绑定权限");
assert.match(manifest, /android:exported="true"/, "Android 12+ 要求 HCE 服务显式 exported");
assert.match(hceConfig, /android:category="other"/, "Kin 私有 AID 必须使用 other 类别");
assert.match(hceConfig, /android:requireDeviceUnlock="true"/, "HCE 必须要求设备解锁");
assert.match(hceConfig, /android:requireDeviceScreenOn="true"/, "HCE 必须要求屏幕点亮");
assert.match(hceConfig, /F04B494E3031/, "HCE AID 配置发生变化");

assert.match(nfcService, /const KIN_AID = \[0xF0, 0x4B, 0x49, 0x4E, 0x30, 0x31\]/, "Reader AID 与 Android HCE 配置不一致");
assert.match(nfcService, /NfcTech\.IsoDep/, "接收方没有使用 Android IsoDep Reader Mode");
assert.match(nfcService, /FLAG_READER_SKIP_NDEF_CHECK/, "接收方不应进入旧 NDEF 标签流程");
assert.doesNotMatch(nfcService, /Ndef|ndefHandler|writeNdefMessage/, "仍残留旧 NFC 标签读写实现");
assert.match(nfcService, /const PROTOCOL_PREFIX = "KIN1:"/, "JS 协议版本前缀缺失");
assert.match(hostService, /private const val PROTOCOL_PREFIX = "KIN1:"/, "原生 HCE 协议版本前缀缺失");
assert.match(hostService, /STATUS_CONDITIONS_NOT_SATISFIED/, "HCE 未拒绝过期或未激活的配对会话");

assert.match(nativeBridge, /requireOptionalNativeModule/, "旧 APK 缺少 HCE 模块时必须安全降级");
assert.match(addFriend, /无法碰一碰？使用配对码/, "配对码备用入口不可见");
assert.match(addFriend, /await startNfcSend\(created\.token\)/, "发起方没有等待 HCE 激活完成");
assert.match(addFriend, /只有双方确认后/, "NFC 不得绕过双方名片确认直接添加好友");

console.log("PASS: Android HCE 发起、IsoDep 接收、短期凭证和配对码降级规则完整");
