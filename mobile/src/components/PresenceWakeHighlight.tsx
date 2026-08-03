import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  getPresenceDelay,
  isRecentPresenceEvent,
  PRESENCE_LANDING_START_MS,
} from "../services/presenceMotion";
import { GRAPHITE_COLORS } from "../theme/graphite";

export default function PresenceWakeHighlight({
  eventKey,
  reduceMotion,
  style,
  children,
}: {
  eventKey: number;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const wash = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const lastEventKey = useRef(0);

  useEffect(() => {
    if (reduceMotion || !isRecentPresenceEvent(eventKey)) {
      wash.stopAnimation();
      sweep.stopAnimation();
      wash.setValue(0);
      sweep.setValue(0);
      return;
    }
    if (eventKey <= lastEventKey.current) return;
    lastEventKey.current = eventKey;
    wash.setValue(0);
    sweep.setValue(0);

    const washAnimation = Animated.sequence([
      Animated.delay(getPresenceDelay(eventKey, 0)),
      Animated.timing(wash, {
        toValue: 1,
        duration: 110,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(wash, {
        toValue: 0,
        duration: 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    const sweepAnimation = Animated.sequence([
      Animated.delay(getPresenceDelay(eventKey, PRESENCE_LANDING_START_MS)),
      Animated.timing(sweep, {
        toValue: 1,
        duration: 330,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    washAnimation.start();
    sweepAnimation.start();
    return () => {
      washAnimation.stop();
      sweepAnimation.stop();
    };
  }, [eventKey, reduceMotion, sweep, wash]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.container, style]} onLayout={handleLayout}>
      <Animated.View
        pointerEvents="none"
        style={[styles.wash, { opacity: wash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] }) }]}
      />
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sweep,
            {
              opacity: sweep.interpolate({
                inputRange: [0, 0.08, 0.72, 1],
                outputRange: [0, 0.58, 0.24, 0],
              }),
              transform: [{
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-88, width + 28],
                }),
              }],
            },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative", overflow: "hidden" },
  wash: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: GRAPHITE_COLORS.primarySoft,
  },
  sweep: {
    position: "absolute",
    zIndex: 1,
    top: 0,
    bottom: 0,
    width: 64,
    backgroundColor: GRAPHITE_COLORS.primarySoft,
  },
});
