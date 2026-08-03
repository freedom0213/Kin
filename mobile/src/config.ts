/** Kin 前端配置 */

import { Platform } from "react-native";

const configuredApiBase = process.env.EXPO_PUBLIC_KIN_API_BASE?.trim();
const defaultApiBase = Platform.OS === "web"
  ? "http://127.0.0.1:8000"
  : "http://10.0.2.2:8000";

/**
 * Web 默认通过 127.0.0.1 访问同一台电脑，Android 模拟器通过 10.0.2.2 访问宿主机。
 * 真机联调时在 mobile/.env.local 中配置电脑的局域网地址。
 */
export const API_BASE = (configuredApiBase || defaultApiBase).replace(/\/+$/, "");
export const WS_BASE = API_BASE.replace("http", "ws");
