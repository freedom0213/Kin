import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

interface NativeHceCapabilities {
  nfcSupported: boolean;
  nfcEnabled: boolean;
  hceSupported: boolean;
}

interface KinNfcHceNativeModule {
  getCapabilitiesAsync(): Promise<NativeHceCapabilities>;
  startSharingAsync(token: string, ttlSeconds: number): Promise<void>;
  stopSharingAsync(): Promise<void>;
}

export interface KinHceCapabilities extends NativeHceCapabilities {
  nativeModuleAvailable: boolean;
}

const nativeModule = Platform.OS === "android"
  ? requireOptionalNativeModule<KinNfcHceNativeModule>("KinNfcHce")
  : null;

export async function getKinHceCapabilities(): Promise<KinHceCapabilities> {
  if (!nativeModule) {
    return {
      nfcSupported: false,
      nfcEnabled: false,
      hceSupported: false,
      nativeModuleAvailable: false,
    };
  }
  const capabilities = await nativeModule.getCapabilitiesAsync();
  return { ...capabilities, nativeModuleAvailable: true };
}

export async function startKinHceSharing(token: string, ttlSeconds = 120): Promise<void> {
  if (!nativeModule) throw new Error("当前 APK 尚未包含 Kin 碰一碰原生模块");
  await nativeModule.startSharingAsync(token, ttlSeconds);
}

export async function stopKinHceSharing(): Promise<void> {
  await nativeModule?.stopSharingAsync();
}
