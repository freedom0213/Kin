/** Kin 前端配置 */

// 后端地址 — 开发时指向本机，真机调试改为电脑局域网IP
export const API_BASE = "http://10.0.2.2:8000"; // Android 模拟器指向宿主机
// export const API_BASE = "http://192.168.x.x:8000"; // 真机用局域网IP

export const WS_BASE = API_BASE.replace("http", "ws");
