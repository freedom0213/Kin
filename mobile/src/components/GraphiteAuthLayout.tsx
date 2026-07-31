import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GRAPHITE_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

interface GraphiteAuthLayoutProps {
  mode: "login" | "register";
  title: string;
  subtitle: string;
  onModeChange: (mode: "login" | "register") => void;
  children: ReactNode;
}

export default function GraphiteAuthLayout({
  mode,
  title,
  subtitle,
  onModeChange,
  children,
}: GraphiteAuthLayoutProps) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.nearField, styles.nearFieldTop, mode === "register" && styles.nearFieldTopRegister]} />
        <View style={[styles.nearField, styles.nearFieldBottom, mode === "register" && styles.nearFieldBottomRegister]} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 24, 48),
            paddingBottom: Math.max(insets.bottom + 28, 36),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentColumn}>
          <View style={styles.brandMark} accessibilityRole="image" accessibilityLabel="Kin">
            <Text style={styles.brandText}>K</Text>
          </View>

          <View style={styles.headingGroup}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <View style={styles.modeSwitch} accessibilityRole="tablist">
            {(["login", "register"] as const).map((item) => {
              const selected = item === mode;
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.modeButton, selected && styles.modeButtonSelected]}
                  onPress={() => onModeChange(item)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item === "login" ? "登录" : "注册"}
                >
                  <Text style={[styles.modeText, selected && styles.modeTextSelected]}>
                    {item === "login" ? "登录" : "注册"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  scrollContent: { flexGrow: 1, paddingHorizontal: 25 },
  contentColumn: { width: "100%", maxWidth: 480, alignSelf: "center" },
  nearField: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(105,200,164,0.10)",
    backgroundColor: "rgba(105,200,164,0.025)",
  },
  nearFieldTop: { width: 280, height: 280, top: 70, right: -170 },
  nearFieldBottom: { width: 230, height: 230, left: -145, bottom: 55 },
  nearFieldTopRegister: { top: 145, right: -125 },
  nearFieldBottomRegister: { left: -95, bottom: 120 },
  brandMark: {
    width: 54,
    height: 54,
    borderRadius: GRAPHITE_RADII.brand,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.primaryLine,
    backgroundColor: GRAPHITE_COLORS.primarySoft,
  },
  brandText: {
    color: GRAPHITE_COLORS.primaryStrong,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -1.4,
  },
  headingGroup: { marginTop: 27 },
  title: {
    color: GRAPHITE_COLORS.text,
    fontSize: 31,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -1.1,
  },
  subtitle: {
    marginTop: 9,
    maxWidth: 360,
    color: GRAPHITE_COLORS.textMuted,
    fontSize: 13,
    lineHeight: 21,
  },
  modeSwitch: {
    marginTop: 27,
    marginBottom: 7,
    padding: 4,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.line,
    borderRadius: GRAPHITE_RADII.control,
    backgroundColor: "rgba(23,27,24,0.72)",
  },
  modeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  modeButtonSelected: {
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
    shadowColor: GRAPHITE_COLORS.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  modeText: { color: GRAPHITE_COLORS.textFaint, fontSize: 13, fontWeight: "700" },
  modeTextSelected: { color: GRAPHITE_COLORS.text },
});
