/** 个人资料编辑 — 头像、背景名片、昵称与个性签名 */

import React, { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  removeAvatar, removeProfileBanner, resolveMediaUrl, updateProfile,
  uploadAvatar, uploadProfileBanner,
  type UserProfile,
} from "../api/client";
import { useKinDialog } from "../components/KinDialog";
import { useAuth } from "../stores/AuthContext";
import { GRAPHITE_COLORS } from "../theme/graphite";

const COLORS = {
  background: GRAPHITE_COLORS.canvas,
  surface: GRAPHITE_COLORS.surface,
  ink: GRAPHITE_COLORS.text,
  muted: GRAPHITE_COLORS.textMuted,
  faint: GRAPHITE_COLORS.textFaint,
  line: GRAPHITE_COLORS.line,
  accent: GRAPHITE_COLORS.primary,
  accentDark: GRAPHITE_COLORS.primaryStrong,
  accentSoft: GRAPHITE_COLORS.primarySoft,
};

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

function normalizeField(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getInitials(name: string): string {
  return Array.from(name).slice(0, 2).join("").toUpperCase();
}

function inferMimeType(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType;
  const extension = asset.uri.split("?")[0].split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

export default function ProfileEditScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { state, updateProfileAction } = useAuth();
  const { showDialog, dialog } = useKinDialog();
  const user = state.user;
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [statusMessage, setStatusMessage] = useState(user?.status_msg || "");
  const [selectedAvatar, setSelectedAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [removeAvatarImage, setRemoveAvatarImage] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [selectingMedia, setSelectingMedia] = useState<"avatar" | "banner" | null>(null);
  const [saving, setSaving] = useState(false);

  const normalizedNickname = normalizeField(nickname);
  const normalizedStatus = normalizeField(statusMessage);
  const textChanged = normalizedNickname !== normalizeField(user?.nickname || "")
    || normalizedStatus !== normalizeField(user?.status_msg || "");
  const avatarChanged = !!selectedAvatar || (removeAvatarImage && !!user?.avatar);
  const bannerChanged = !!selectedBanner || (removeBanner && !!user?.profile_banner);
  const hasChanges = textChanged || avatarChanged || bannerChanged;
  const canSave = !!user && hasChanges && !saving && !selectingMedia;
  const displayName = normalizedNickname || user?.username || "Kin";
  const currentAvatar = removeAvatarImage
    ? null
    : selectedAvatar?.uri || resolveMediaUrl(user?.avatar);
  const currentBanner = removeBanner
    ? null
    : selectedBanner?.uri || resolveMediaUrl(user?.profile_banner);

  const handleChooseImage = async (kind: "avatar" | "banner") => {
    if (saving || selectingMedia) return;
    setSelectingMedia(kind);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showDialog({
          title: "需要相册权限",
          message: `请允许 Kin 访问相册，才能选择${kind === "avatar" ? "头像" : "背景名片"}。`,
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: kind === "avatar" ? [1, 1] : [16, 7],
        quality: 0.82,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_PROFILE_IMAGE_BYTES) {
        showDialog({ title: "图片过大", message: "请选择小于 5 MB 的图片；裁剪后再试通常可以减小体积。" });
        return;
      }
      if (kind === "avatar") {
        setSelectedAvatar(asset);
        setRemoveAvatarImage(false);
      } else {
        setSelectedBanner(asset);
        setRemoveBanner(false);
      }
    } catch (error: any) {
      showDialog({ title: "无法选择图片", message: error?.message || "请稍后重试。" });
    } finally {
      setSelectingMedia(null);
    }
  };

  const handleRemoveAvatar = () => {
    setSelectedAvatar(null);
    setRemoveAvatarImage(true);
  };

  const handleRemoveBanner = () => {
    setSelectedBanner(null);
    setRemoveBanner(true);
  };

  const handleSave = async () => {
    if (!user || !canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    let latest: UserProfile = user;
    try {
      if (textChanged) {
        latest = await updateProfile(normalizedNickname || null, normalizedStatus || null);
        await updateProfileAction(latest);
      }
      if (selectedAvatar) {
        latest = await uploadAvatar(selectedAvatar.uri, inferMimeType(selectedAvatar));
        await updateProfileAction(latest);
        setSelectedAvatar(null);
      } else if (removeAvatarImage && user.avatar) {
        latest = await removeAvatar();
        await updateProfileAction(latest);
        setRemoveAvatarImage(false);
      }
      if (selectedBanner) {
        latest = await uploadProfileBanner(selectedBanner.uri, inferMimeType(selectedBanner));
        await updateProfileAction(latest);
        setSelectedBanner(null);
      } else if (removeBanner && user.profile_banner) {
        latest = await removeProfileBanner();
        await updateProfileAction(latest);
        setRemoveBanner(false);
      }
      navigation.goBack();
    } catch (error: any) {
      showDialog({
        title: "资料未完全保存",
        message: error?.message || "无法连接 Kin 服务器，请检查网络后重试。",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {isFocused ? <ExpoStatusBar style="light" /> : null}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="返回设置"
        >
          <Text style={styles.backMark}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>编辑资料</Text>
        <TouchableOpacity
          onPress={() => { void handleSave(); }}
          disabled={!canSave}
          style={styles.saveAction}
          accessibilityRole="button"
          accessibilityLabel="保存个人资料"
          accessibilityState={{ disabled: !canSave, busy: saving }}
        >
          {saving ? <ActivityIndicator size="small" color={COLORS.accent} /> : (
            <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>保存</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
      >
        <View style={styles.cardPreview}>
          <View style={styles.bannerFrame}>
            {currentBanner ? (
              <Image
                source={{ uri: currentBanner }}
                style={styles.bannerImage}
                resizeMode="cover"
                accessibilityLabel={`${displayName}的背景名片`}
              />
            ) : (
              <View style={styles.bannerFallback}>
                <View style={styles.bannerOrbLarge} />
                <View style={styles.bannerOrbSmall} />
              </View>
            )}
          </View>

          <View style={styles.avatar}>
            {currentAvatar ? (
              <Image
                source={{ uri: currentAvatar }}
                style={styles.avatarImage}
                accessibilityLabel={`${displayName}的头像`}
              />
            ) : (
              <Text style={styles.avatarInitials}>{getInitials(displayName)}</Text>
            )}
          </View>

          <Text style={styles.previewName}>{displayName}</Text>
          <Text style={styles.username}>@{user?.username}</Text>
          <View style={styles.avatarActions}>
            <TouchableOpacity
              style={styles.avatarActionPrimary}
              onPress={() => { void handleChooseImage("avatar"); }}
              disabled={saving || !!selectingMedia}
              accessibilityRole="button"
              accessibilityLabel={currentAvatar ? "更换头像" : "选择头像"}
              accessibilityState={{
                busy: selectingMedia === "avatar",
                disabled: saving || !!selectingMedia,
              }}
            >
              {selectingMedia === "avatar" ? (
                <ActivityIndicator size="small" color={COLORS.accentDark} />
              ) : (
                <Text style={styles.avatarActionPrimaryText}>{currentAvatar ? "更换头像" : "选择头像"}</Text>
              )}
            </TouchableOpacity>
            {currentAvatar ? (
              <TouchableOpacity
                style={styles.avatarActionSecondary}
                onPress={handleRemoveAvatar}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="移除头像"
              >
                <Text style={styles.avatarActionSecondaryText}>移除头像</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.avatarHint}>头像会以圆形展示，建议选择主体居中的正方形图片。</Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity
              style={styles.bannerActionPrimary}
              onPress={() => { void handleChooseImage("banner"); }}
              disabled={saving || !!selectingMedia}
              accessibilityRole="button"
              accessibilityLabel={currentBanner ? "更换背景名片" : "选择背景名片"}
              accessibilityState={{ busy: selectingMedia === "banner", disabled: saving || !!selectingMedia }}
            >
              {selectingMedia === "banner" ? <ActivityIndicator size="small" color={COLORS.accentDark} /> : (
                <Text style={styles.bannerActionPrimaryText}>{currentBanner ? "更换背景" : "选择背景"}</Text>
              )}
            </TouchableOpacity>
            {currentBanner ? (
              <TouchableOpacity
                style={styles.bannerActionSecondary}
                onPress={handleRemoveBanner}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="移除背景名片"
              >
                <Text style={styles.bannerActionSecondaryText}>移除</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.bannerHint}>建议使用横向图片，保存后好友也能看到。</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.fieldHeader}>
            <Text style={styles.label}>昵称</Text>
            <Text style={styles.counter}>{nickname.length}/24</Text>
          </View>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder={user?.username || "输入昵称"}
            placeholderTextColor={COLORS.faint}
            maxLength={24}
            autoCapitalize="words"
            returnKeyType="next"
            accessibilityLabel="昵称"
            accessibilityHint="清空后将使用用户名作为显示名称"
          />
          <Text style={styles.fieldHint}>清空后，Kin 将使用用户名作为显示名称。</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.fieldHeader}>
            <Text style={styles.label}>个性签名</Text>
            <Text style={styles.counter}>{statusMessage.length}/80</Text>
          </View>
          <TextInput
            style={[styles.input, styles.statusInput]}
            value={statusMessage}
            onChangeText={setStatusMessage}
            placeholder="留下一句现在的心情"
            placeholderTextColor={COLORS.faint}
            maxLength={80}
            multiline
            textAlignVertical="top"
            accessibilityLabel="个性签名"
          />
        </View>

        <View style={styles.privacyNote}>
          <Text style={styles.privacyTitle}>谁能看到？</Text>
          <Text style={styles.privacyText}>头像、背景名片、昵称和个性签名会展示给已经与你成为好友的人。</Text>
        </View>
      </ScrollView>
      {dialog}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    minHeight: 58, paddingHorizontal: 12, paddingBottom: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
    backgroundColor: COLORS.background,
  },
  headerAction: { width: 52, height: 48, alignItems: "center", justifyContent: "center" },
  backMark: { color: COLORS.ink, fontSize: 36, fontWeight: "300", lineHeight: 38 },
  headerTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "700" },
  saveAction: { width: 52, height: 48, alignItems: "center", justifyContent: "center" },
  saveText: { color: COLORS.accentDark, fontSize: 15, fontWeight: "700" },
  saveTextDisabled: { color: COLORS.faint },
  content: { paddingBottom: 40 },
  cardPreview: { paddingBottom: 24, alignItems: "center", backgroundColor: COLORS.surface },
  bannerFrame: { width: "100%", height: 172, overflow: "hidden", backgroundColor: GRAPHITE_COLORS.surfacePressed },
  bannerImage: { width: "100%", height: "100%" },
  bannerFallback: { flex: 1, backgroundColor: GRAPHITE_COLORS.surfaceStrong, overflow: "hidden" },
  bannerOrbLarge: {
    position: "absolute", width: 230, height: 230, borderRadius: 115,
    right: -42, top: -96, backgroundColor: "rgba(105,200,164,0.12)",
  },
  bannerOrbSmall: {
    position: "absolute", width: 130, height: 130, borderRadius: 65,
    left: -28, bottom: -69, backgroundColor: "rgba(52,92,76,0.26)",
  },
  avatar: {
    width: 84, height: 84, marginTop: -42, borderRadius: 42, borderWidth: 4,
    borderColor: COLORS.surface, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  avatarInitials: { color: GRAPHITE_COLORS.text, fontSize: 24, fontWeight: "800" },
  avatarImage: { width: "100%", height: "100%" },
  previewName: { marginTop: 10, color: COLORS.ink, fontSize: 19, fontWeight: "700" },
  username: { marginTop: 2, color: COLORS.muted, fontSize: 13, fontWeight: "500" },
  avatarActions: { marginTop: 15, flexDirection: "row", alignItems: "center" },
  avatarActionPrimary: {
    minWidth: 112, minHeight: 48, paddingHorizontal: 16, borderRadius: 16,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.accentSoft,
  },
  avatarActionPrimaryText: { color: COLORS.accentDark, fontSize: 13, fontWeight: "700" },
  avatarActionSecondary: {
    minWidth: 92, minHeight: 48, marginLeft: 8, paddingHorizontal: 14, borderRadius: 16,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.line,
  },
  avatarActionSecondaryText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  avatarHint: { marginTop: 8, paddingHorizontal: 24, color: COLORS.faint, fontSize: 12, textAlign: "center" },
  bannerActions: { marginTop: 20, flexDirection: "row", alignItems: "center" },
  bannerActionPrimary: {
    minWidth: 108, minHeight: 48, paddingHorizontal: 16, borderRadius: 16,
    alignItems: "center", justifyContent: "center", backgroundColor: COLORS.accentSoft,
  },
  bannerActionPrimaryText: { color: COLORS.accentDark, fontSize: 13, fontWeight: "700" },
  bannerActionSecondary: {
    minWidth: 72, minHeight: 48, marginLeft: 8, paddingHorizontal: 14, borderRadius: 16,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.line,
  },
  bannerActionSecondaryText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  bannerHint: { marginTop: 9, color: COLORS.faint, fontSize: 12 },
  formSection: {
    marginTop: 12, paddingHorizontal: 20, paddingVertical: 17,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
  },
  fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  counter: { color: COLORS.faint, fontSize: 12 },
  input: {
    minHeight: 48, marginTop: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: COLORS.line, borderRadius: 15,
    backgroundColor: GRAPHITE_COLORS.surfacePressed, color: COLORS.ink, fontSize: 15,
  },
  statusInput: { minHeight: 108, paddingTop: 13, paddingBottom: 13 },
  fieldHint: { marginTop: 8, color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  privacyNote: {
    marginHorizontal: 20, marginTop: 22, padding: 16,
    borderWidth: 1, borderColor: GRAPHITE_COLORS.primaryLine, borderRadius: 16,
    backgroundColor: COLORS.accentSoft,
  },
  privacyTitle: { color: COLORS.accentDark, fontSize: 13, fontWeight: "700" },
  privacyText: { marginTop: 5, color: COLORS.muted, fontSize: 12, lineHeight: 18 },
});
