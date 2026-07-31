import { useRef, useState } from "react";
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";

export const INPUT_COLORS = {
  text: "#171A1F",
  placeholder: "#858B92",
  cursor: "#176B52",
  selection: "#A9DEC9",
};

interface PasswordInputProps {
  value: string;
  onChangeText: (value: string) => void;
  autoComplete: "current-password" | "new-password";
}

export function PasswordInput({ value, onChangeText, autoComplete }: PasswordInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [visible, setVisible] = useState(false);
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
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder="密码"
        placeholderTextColor={INPUT_COLORS.placeholder}
        cursorColor={INPUT_COLORS.cursor}
        selectionColor={INPUT_COLORS.selection}
        secureTextEntry={!visible}
        value={value}
        onChangeText={onChangeText}
        selection={selection}
        onSelectionChange={handleSelectionChange}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={autoComplete === "new-password" ? "newPassword" : "password"}
        accessibilityLabel="密码"
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
    minHeight: 50,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDDDDD",
    borderRadius: 10,
    backgroundColor: "#FAFAFA",
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 16,
    paddingVertical: 14,
    color: INPUT_COLORS.text,
    fontSize: 16,
  },
  visibilityButton: {
    minWidth: 44, height: 44,
    marginRight: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeIcon: {
    width: 22, height: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#666D75", borderRadius: 11,
  },
  eyePupil: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: "#4E555D",
  },
  eyeSlash: {
    position: "absolute",
    width: 25, height: 1.5,
    backgroundColor: "#666D75",
    transform: [{ rotate: "-35deg" }],
  },
});
