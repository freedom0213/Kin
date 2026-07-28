/** Kin 前端配置 */

const configuredApiBase = process.env.EXPO_PUBLIC_KIN_API_BASE?.trim();

/**
 * Android 模拟器默认通过 10.0.2.2 访问宿主机。
 * 真机联调时在 mobile/.env.local 中配置电脑的局域网地址。
 */
export const API_BASE = (configuredApiBase || "http://10.0.2.2:8000").replace(/\/+$/, "");
export const WS_BASE = API_BASE.replace("http", "ws");
