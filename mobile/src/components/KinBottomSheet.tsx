import React, {
  ReactNode, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface KinBottomSheetProps {
  visible: boolean;
  children: ReactNode;
  onRequestClose: () => void;
  reduceMotion?: boolean;
  dragDismissEnabled?: boolean;
  sheetStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const DEFAULT_HEIGHT_RATIO = 0.72;
const EXPANDED_HEIGHT_RATIO = 0.88;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1.1;

export default function KinBottomSheet({
  visible,
  children,
  onRequestClose,
  reduceMotion = false,
  dragDismissEnabled = true,
  sheetStyle,
  accessibilityLabel = "底部弹窗",
}: KinBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const expandedHeight = Math.max(320, windowHeight * EXPANDED_HEIGHT_RATIO);
  const defaultHeight = Math.min(
    expandedHeight,
    Math.max(360, windowHeight * DEFAULT_HEIGHT_RATIO),
  );
  const defaultSnapOffset = expandedHeight - defaultHeight;
  const translateY = useRef(new Animated.Value(expandedHeight)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const dragStartRef = useRef(defaultSnapOffset);
  const closingRef = useRef(false);
  const onRequestCloseRef = useRef(onRequestClose);
  const dragAreaRef = useRef<View | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  const animateTo = useCallback((offset: number, onComplete?: () => void) => {
    setIsExpanded(offset === 0);
    Animated.timing(translateY, {
      toValue: offset,
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onComplete?.();
    });
  }, [reduceMotion, translateY]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: expandedHeight,
        duration: reduceMotion ? 0 : 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      closingRef.current = false;
      if (finished) onRequestCloseRef.current();
    });
  }, [expandedHeight, reduceMotion, scrimOpacity, translateY]);

  useEffect(() => {
    if (!visible) {
      closingRef.current = false;
      return;
    }
    setIsExpanded(false);
    translateY.setValue(expandedHeight);
    scrimOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: defaultSnapOffset,
        duration: reduceMotion ? 0 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : 180,
        useNativeDriver: true,
      }),
    ]).start();
    const focusFrame = requestAnimationFrame(() => {
      const target = findNodeHandle(dragAreaRef.current);
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [defaultSnapOffset, expandedHeight, reduceMotion, scrimOpacity, translateY, visible]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dy) > 4
      && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation((value) => {
        dragStartRef.current = value;
      });
    },
    onPanResponderMove: (_, gestureState) => {
      const nextOffset = Math.max(
        0,
        Math.min(expandedHeight, dragStartRef.current + gestureState.dy),
      );
      translateY.setValue(nextOffset);
    },
    onPanResponderRelease: (_, gestureState) => {
      const shouldDismiss = (
        gestureState.dy > DISMISS_DISTANCE
        || gestureState.vy > DISMISS_VELOCITY
      );
      if (shouldDismiss) {
        if (dragDismissEnabled) requestClose();
        else animateTo(dragStartRef.current < defaultSnapOffset / 2 ? 0 : defaultSnapOffset);
        return;
      }
      const shouldExpand = (
        gestureState.dy < -36
        || dragStartRef.current + gestureState.dy < defaultSnapOffset / 2
      );
      animateTo(shouldExpand ? 0 : defaultSnapOffset);
    },
    onPanResponderTerminate: () => (
      animateTo(dragStartRef.current < defaultSnapOffset / 2 ? 0 : defaultSnapOffset)
    ),
    onPanResponderTerminationRequest: () => false,
  }), [animateTo, defaultSnapOffset, dragDismissEnabled, expandedHeight, requestClose, translateY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel={`关闭${accessibilityLabel}`}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: expandedHeight,
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateY }],
            },
            sheetStyle,
          ]}
          accessibilityViewIsModal
          importantForAccessibility="yes"
        >
          <View
            ref={dragAreaRef}
            style={styles.dragArea}
            {...panResponder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${accessibilityLabel}拖动区域`}
            accessibilityHint="上下拖动，或使用读屏操作展开、收起和关闭"
            accessibilityValue={{ text: isExpanded ? "已展开" : "默认高度" }}
            accessibilityActions={[
              { name: "increment", label: "展开弹窗" },
              { name: "decrement", label: "收起弹窗" },
              { name: "escape", label: "关闭弹窗" },
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (nativeEvent.actionName === "increment") animateTo(0);
              if (nativeEvent.actionName === "decrement") animateTo(defaultSnapOffset);
              if (nativeEvent.actionName === "escape") requestClose();
            }}
          >
            <View style={styles.handle} />
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(19,25,22,0.34)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FFFFFF",
    shadowColor: "#101713",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 20,
  },
  dragArea: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D5D9D5",
  },
});
