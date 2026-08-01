import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ImageStyle } from "react-native";
import { resolveMediaUrl, type Friend } from "../api/client";
import { getFriendDisplayName, getFriendInitials } from "../services/friendPresentation";
import { GRAPHITE_COLORS } from "../theme/graphite";

function getPulseDelay(userId: string): number {
  let hash = 0;
  for (const character of userId) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 720;
}

export default function FriendAvatar({
  friend,
  reduceMotion,
  onlineEventKey,
  size = 46,
}: {
  friend: Friend;
  reduceMotion: boolean;
  onlineEventKey: number;
  size?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const lastBurstKey = useRef(0);
  const imageUrl = resolveMediaUrl(friend.avatar);
  const frameSize = size + 10;

  useEffect(() => {
    if (!friend.is_online || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1800, useNativeDriver: true }),
    ]));
    const animation = Animated.sequence([Animated.delay(getPulseDelay(friend.user_id)), loop]);
    animation.start();
    return () => {
      animation.stop();
      loop.stop();
    };
  }, [friend.is_online, friend.user_id, pulse, reduceMotion]);

  useEffect(() => {
    if (onlineEventKey <= lastBurstKey.current) return;
    lastBurstKey.current = onlineEventKey;
    if (!friend.is_online || reduceMotion || Date.now() - onlineEventKey > 1_500) return;
    burst.stopAnimation();
    burst.setValue(0);
    const animation = Animated.timing(burst, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [burst, friend.is_online, onlineEventKey, reduceMotion]);

  const ringStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.44, 0.08] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) }],
  };
  const burstStyle = {
    opacity: burst.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.46] }) }],
  };

  return (
    <View style={{ width: frameSize, height: frameSize, alignItems: "center", justifyContent: "center" }}>
      {friend.is_online && !reduceMotion ? (
        <Animated.View
          style={[
            styles.ring,
            { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 },
            burstStyle,
          ]}
        />
      ) : null}
      {friend.is_online ? (
        <Animated.View
          style={[
            styles.ring,
            { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 },
            ringStyle,
          ]}
        />
      ) : null}
      <View
        style={[
          styles.avatar,
          { width: size, height: size, borderRadius: size / 2 },
          !friend.is_online && styles.avatarOffline,
        ]}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image as ImageStyle}
            accessibilityLabel={`${getFriendDisplayName(friend)}的头像`}
          />
        ) : (
          <Text style={[styles.initials, { fontSize: Math.max(13, size * 0.32) }]}>
            {getFriendInitials(friend)}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.presenceDot,
          friend.is_online ? styles.online : styles.offline,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: GRAPHITE_COLORS.primary,
  },
  avatar: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GRAPHITE_COLORS.surfacePressed,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRAPHITE_COLORS.lineStrong,
  },
  avatarOffline: { backgroundColor: "#343A36" },
  image: { width: "100%", height: "100%" },
  initials: { color: GRAPHITE_COLORS.text, fontWeight: "800" },
  presenceDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: GRAPHITE_COLORS.canvas,
  },
  online: { backgroundColor: GRAPHITE_COLORS.primary },
  offline: { backgroundColor: GRAPHITE_COLORS.textFaint },
});
