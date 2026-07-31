import { useRef, useState } from "react";
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import {
  GRAPHITE_COLORS,
  GRAPHITE_INPUT_COLORS,
  GRAPHITE_RADII,
} from "../theme/graphite";

export const INPUT_COLORS = GRAPHITE_INPUT_COLORS;

interface PasswordInputProps {
  value: string;
  onChangeText: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  accessibilityLabel?: string;
}

export function PasswordInput({
  value,
  onChangeText,
  autoComplete,
  placeholder = "输入密码",
  accessibilityLabel = "密码",
}: PasswordInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const handleSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    setSelection(event.nativeEvent.selection);
  };

  const toggleVisibility = () => {
    setVisible((current) => !current);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={INPUT_COLORS.placeholder}
        cursorColor={INPUT_COLORS.cursor}
        selectionColor={INPUT_COLORS.selection}
        secureTextEntry={!visible}
        value={value}
        onChangeText={onChangeText}
        selection={selection}
        onSelectionChange={handleSelectionChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={32}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={autoComplete === "new-password" ? "newPassword" : "password"}
        accessibilityLabel={accessibilityLabel}
      />
      <TouchableOpacity
        style={styles.visibilityButton}
        onPress={toggleVisibility}
        accessibilityRole="button"
        accessibilityLabel={visible ? "隐藏密码" : "显示密码"}
        accessibilityHint="切换密码是否以明文显示"
        accessibilityValue={{ text: visible ? "密码当前可见" : "密码当前隐藏" }}
      >
        <View style={styles.eyeIcon}>
          <View style={styles.eyePupil} />
          {!visible ? <View style={styles.eyeSlash} /> : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.line,
    borderRadius: GRAPHITE_RADII.control,
    backgroundColor: GRAPHITE_COLORS.surface,
  },
  containerFocused: {
    borderColor: "rgba(105,200,164,0.62)",
    backgroundColor: GRAPHITE_COLORS.surfaceStrong,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 15,
    paddingVertical: 14,
    color: INPUT_COLORS.text,
    fontSize: 16,
  },
  visibilityButton: {
    minWidth: 48, height: 48,
    marginRight: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeIcon: {
    width: 22, height: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: GRAPHITE_COLORS.textMuted, borderRadius: 11,
  },
  eyePupil: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: GRAPHITE_COLORS.textMuted,
  },
  eyeSlash: {
    position: "absolute",
    width: 25, height: 1.5,
    backgroundColor: GRAPHITE_COLORS.textMuted,
    transform: [{ rotate: "-35deg" }],
  },
});
