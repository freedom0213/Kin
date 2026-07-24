/** 添加好友 — NFC 碰一碰（支持真机 NFC + 手动输入降级） */

import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { generateNfcToken, addFriendByToken } from "../api/client";
import { initNfc, isNfcAvailable, startNfcSend, startNfcReceive, cancelNfc } from "../services/nfc";

export default function AddFriendScreen({ navigation }: any) {
  const [mode, setMode] = useState<"send" | "receive">("send");
  const [myToken, setMyToken] = useState("");
  const [theirToken, setTheirToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [nfcAvailable, setNfcAvailable] = useState(false);
  const [nfcActive, setNfcActive] = useState(false);
  const [nfcCancel, setNfcCancel] = useState<(() => void) | null>(null);

  // 检查设备是否支持 NFC
  useEffect(() => {
    (async () => {
      const ok = await initNfc();
      setNfcAvailable(ok);
    })();
    // 离开页面时清理 NFC
    return () => { cancelNfc(); };
  }, []);

  // -- 发送模式：生成 token + NFC 写入 --

  const handleNfcSend = async () => {
    try {
      // 1. 从服务器获取 NFC token
      const result = await generateNfcToken();
      setMyToken(result.token);

      if (nfcAvailable) {
        // 2. 通过 NFC 写入 token（让对方手机读取）
        const cancel = await startNfcSend(result.token);
        setNfcCancel(() => cancel);
        setNfcActive(true);
        Alert.alert(
          "NFC 已就绪",
          `Token 有效期 ${result.ttl} 秒\n\n将手机背面靠近对方的手机`,
          [
            {
              text: "停止发送",
              onPress: async () => {
                await cancel();
                setNfcActive(false);
              },
            },
          ]
        );
      } else {
        // NFC 不可用 → 显示手动复制提示
        Alert.alert(
          "Token 已生成（NFC 不可用）",
          `有效期 ${result.ttl} 秒\n\n请复制 token 发送给对方测试：\n${result.token.slice(0, 20)}...`,
          [{ text: "知道了" }]
        );
      }
    } catch (e: any) {
      Alert.alert("生成失败", e.message);
    }
  };

  // -- 接收模式：NFC 读取 token → 添加好友 --

  const handleNfcReceive = async () => {
    if (!nfcAvailable) {
      // NFC 不可用，提示用户手动输入
      if (theirToken.trim()) {
        await handleManualAdd();
      }
      return;
    }

    setNfcActive(true);
    try {
      const token = await startNfcReceive();
      setTheirToken(token);
      setNfcActive(false);

      // 读取成功后自动添加好友
      await handleAddWithToken(token);
    } catch (e: any) {
      setNfcActive(false);
      Alert.alert("NFC 读取", e.message || "请重试碰一碰");
    }
  };

  // 手动输入 token 添加
  const handleManualAdd = async () => {
    if (!theirToken.trim()) {
      Alert.alert("提示", "请输入对方的 token（或通过 NFC 碰一碰读取）");
      return;
    }
    await handleAddWithToken(theirToken.trim());
  };

  // 通过 token 添加好友
  const handleAddWithToken = async (token: string) => {
    setLoading(true);
    try {
      const result = await addFriendByToken(token);
      Alert.alert("成功", result.message);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("添加失败", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>添加好友</Text>
      <Text style={styles.subtitle}>
        {nfcAvailable ? "手机碰一碰加好友" : "手动输入对方 Token"}
      </Text>

      {/* 模式切换 */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, mode === "send" && styles.tabActive]}
          onPress={() => { setMode("send"); cancelNfc(); setNfcActive(false); }}
        >
          <Text style={[styles.tabText, mode === "send" && styles.tabTextActive]}>
            我来发出
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === "receive" && styles.tabActive]}
          onPress={() => { setMode("receive"); cancelNfc(); setNfcActive(false); }}
        >
          <Text style={[styles.tabText, mode === "receive" && styles.tabTextActive]}>
            收到碰一碰
          </Text>
        </TouchableOpacity>
      </View>

      {mode === "send" ? (
        <View style={styles.card}>
          <Text style={styles.cardHint}>
            点击下方按钮生成专属 Token{'\n'}
            {nfcAvailable ? "然后将手机背面靠近对方手机" : "然后复制给对方"}
          </Text>

          <TouchableOpacity
            style={[styles.nfcButton, nfcActive && styles.nfcButtonActive]}
            onPress={handleNfcSend}
            disabled={nfcActive}
          >
            {nfcActive ? (
              <ActivityIndicator color="#2e7d32" />
            ) : (
              <Text style={styles.nfcButtonText}>
                {nfcAvailable ? "📱 开始 NFC 发送" : "📋 生成碰一碰 Token"}
              </Text>
            )}
          </TouchableOpacity>

          {myToken ? (
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>Token（60秒有效）</Text>
              <Text style={styles.tokenValue} selectable>{myToken}</Text>
              <Text style={styles.tokenHint}>
                {nfcActive ? "↑ NFC 发送中，请靠近对方手机" : "↑ 复制此 Token 给对方测试"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardHint}>
            {nfcAvailable
              ? "点击下方按钮，然后将手机背面靠近对方的手机"
              : "输入对方的 Token"}
          </Text>

          {nfcAvailable ? (
            <TouchableOpacity
              style={[styles.nfcButton, nfcActive && styles.nfcButtonActive]}
              onPress={handleNfcReceive}
              disabled={nfcActive || loading}
            >
              {nfcActive ? (
                <View style={styles.nfcReadingRow}>
                  <ActivityIndicator color="#2e7d32" style={{ marginRight: 10 }} />
                  <Text style={styles.nfcButtonText}>正在读取...</Text>
                </View>
              ) : (
                <Text style={styles.nfcButtonText}>📱 开始 NFC 读取</Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                style={styles.tokenInput}
                placeholder="粘贴对方的 Token"
                value={theirToken}
                onChangeText={setTheirToken}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.addBtn, loading && { opacity: 0.5 }]}
                onPress={handleManualAdd}
                disabled={loading}
              >
                <Text style={styles.addBtnText}>
                  {loading ? "添加中..." : "添加好友"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* NFC 模式下也保留手动输入作为降级方案 */}
          {nfcAvailable && !nfcActive && (
            <View style={styles.fallbackSection}>
              <Text style={styles.fallbackHint}>NFC 读不到？手动输入 Token</Text>
              <TextInput
                style={styles.tokenInput}
                placeholder="粘贴对方的 Token"
                value={theirToken}
                onChangeText={setTheirToken}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.addBtn, loading && { opacity: 0.5 }]}
                onPress={handleManualAdd}
                disabled={loading}
              >
                <Text style={styles.addBtnText}>
                  {loading ? "添加中..." : "手动添加"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#1a1a2e" },
  subtitle: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 4, marginBottom: 30 },
  tabs: { flexDirection: "row", marginHorizontal: 32, borderRadius: 10, overflow: "hidden", marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: "#f0f0f0" },
  tabActive: { backgroundColor: "#1a1a2e" },
  tabText: { fontSize: 15, color: "#666" },
  tabTextActive: { color: "#fff", fontWeight: "600" },
  card: { marginHorizontal: 32, padding: 20, backgroundColor: "#fafafa", borderRadius: 14 },
  cardHint: { fontSize: 14, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 20 },
  nfcButton: {
    backgroundColor: "#e8f5e9", borderRadius: 12,
    paddingVertical: 16, alignItems: "center",
  },
  nfcButtonActive: { backgroundColor: "#c8e6c9" },
  nfcReadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  nfcButtonText: { fontSize: 17, fontWeight: "600", color: "#2e7d32" },
  tokenBox: { marginTop: 20, padding: 14, backgroundColor: "#fff", borderRadius: 10 },
  tokenLabel: { fontSize: 13, color: "#888", marginBottom: 8 },
  tokenValue: { fontSize: 12, fontFamily: "monospace", color: "#1a1a2e", lineHeight: 18 },
  tokenHint: { fontSize: 12, color: "#bbb", marginTop: 8, textAlign: "center" },
  tokenInput: {
    borderWidth: 1, borderColor: "#ddd", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    marginBottom: 16, backgroundColor: "#fff",
  },
  addBtn: {
    backgroundColor: "#1a1a2e", borderRadius: 10,
    paddingVertical: 14, alignItems: "center",
  },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fallbackSection: {
    marginTop: 24, paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#ddd",
  },
  fallbackHint: { fontSize: 12, color: "#999", textAlign: "center", marginBottom: 12 },
});
