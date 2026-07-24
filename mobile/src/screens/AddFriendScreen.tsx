/** 添加好友 — NFC 碰一碰（当前为模拟界面） */

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from "react-native";
import { generateNfcToken, addFriendByToken } from "../api/client";

export default function AddFriendScreen({ navigation }: any) {
  const [mode, setMode] = useState<"send" | "receive">("send");
  const [myToken, setMyToken] = useState("");
  const [theirToken, setTheirToken] = useState("");
  const [loading, setLoading] = useState(false);

  // 生成我的 NFC token（碰一碰时发给对方）
  const handleGenerate = async () => {
    try {
      const result = await generateNfcToken();
      setMyToken(result.token);
      Alert.alert(
        "Token 已生成",
        `有效期 ${result.ttl} 秒\n\n在 NFC 集成前，你可以手动复制这个 token 给对方测试：\n${result.token.slice(0, 16)}...`
      );
    } catch (e: any) {
      Alert.alert("错误", e.message);
    }
  };

  // 输入对方 token 并添加好友
  const handleAdd = async () => {
    if (!theirToken.trim()) {
      Alert.alert("提示", "请输入对方的 token（或将来通过 NFC 读取）");
      return;
    }
    setLoading(true);
    try {
      const result = await addFriendByToken(theirToken.trim());
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
      <Text style={styles.subtitle}>只有碰一碰才能成为 Kin 好友</Text>

      {/* 模式切换 */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, mode === "send" && styles.tabActive]}
          onPress={() => setMode("send")}
        >
          <Text style={[styles.tabText, mode === "send" && styles.tabTextActive]}>
            我要发出
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === "receive" && styles.tabActive]}
          onPress={() => setMode("receive")}
        >
          <Text style={[styles.tabText, mode === "receive" && styles.tabTextActive]}>
            收到碰一碰
          </Text>
        </TouchableOpacity>
      </View>

      {mode === "send" ? (
        <View style={styles.card}>
          <Text style={styles.cardHint}>
            点击下方按钮生成你的专属 token，{"\n"}然后和朋友碰一碰手机
          </Text>
          <TouchableOpacity style={styles.nfcButton} onPress={handleGenerate}>
            <Text style={styles.nfcButtonText}>📱 生成碰一碰 Token</Text>
          </TouchableOpacity>
          {myToken ? (
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>你的 Token（60秒有效）</Text>
              <Text style={styles.tokenValue} selectable>{myToken}</Text>
              <Text style={styles.tokenHint}>
                ↑ NFC 集成前，复制给对方测试
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardHint}>
            输入对方碰一碰分享的 token，{"\n"}或等待 NFC 自动读取
          </Text>
          <TextInput
            style={styles.tokenInput}
            placeholder="粘贴对方的 token"
            value={theirToken}
            onChangeText={setTheirToken}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.addBtn, loading && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={loading}
          >
            <Text style={styles.addBtnText}>
              {loading ? "添加中..." : "添加好友"}
            </Text>
          </TouchableOpacity>
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
});
