import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { GRAPHITE_COLORS, GRAPHITE_RADII } from "../theme/graphite";

export interface KinDialogAction {
  text: string;
  tone?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
}

interface KinDialogProps {
  visible: boolean;
  title: string;
  message: string;
  actions?: KinDialogAction[];
  onClose: () => void;
}

export default function KinDialog({
  visible,
  title,
  message,
  actions,
  onClose,
}: KinDialogProps) {
  const resolvedActions = actions?.length ? actions : [{ text: "知道了" }];
  const stacked = resolvedActions.length > 2;

  const runAction = (action: KinDialogAction) => {
    onClose();
    void action.onPress?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {resolvedActions.map((action, index) => {
              const destructive = action.tone === "destructive";
              const cancel = action.tone === "cancel";
              const primary = !destructive && !cancel && index === resolvedActions.length - 1;
              return (
                <TouchableOpacity
                  key={`${action.text}-${index}`}
                  style={[
                    styles.action,
                    stacked && styles.actionStacked,
                    cancel && styles.actionCancel,
                    primary && styles.actionPrimary,
                    destructive && styles.actionDestructive,
                  ]}
                  onPress={() => runAction(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.text}
                >
                  <Text style={[
                    styles.actionText,
                    cancel && styles.actionCancelText,
                    primary && styles.actionPrimaryText,
                    destructive && styles.actionDestructiveText,
                  ]}>
                    {action.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    padding: 22,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong,
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
    shadowColor: GRAPHITE_COLORS.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.44,
    shadowRadius: 30,
    elevation: 24,
  },
  title: { color: GRAPHITE_COLORS.text, fontSize: 20, fontWeight: "800" },
  message: {
    marginTop: 10,
    color: GRAPHITE_COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  actions: { marginTop: 22, flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  actionsStacked: { flexDirection: "column" },
  action: {
    minWidth: 92,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: GRAPHITE_RADII.control,
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
  },
  actionStacked: { width: "100%" },
  actionCancel: { backgroundColor: GRAPHITE_COLORS.surface },
  actionPrimary: { borderColor: GRAPHITE_COLORS.primary, backgroundColor: GRAPHITE_COLORS.primary },
  actionDestructive: { borderColor: GRAPHITE_COLORS.dangerLine, backgroundColor: GRAPHITE_COLORS.surface },
  actionText: { color: GRAPHITE_COLORS.text, fontSize: 14, fontWeight: "800" },
  actionCancelText: { color: GRAPHITE_COLORS.textMuted },
  actionPrimaryText: { color: GRAPHITE_COLORS.onPrimary },
  actionDestructiveText: { color: GRAPHITE_COLORS.danger },
});
