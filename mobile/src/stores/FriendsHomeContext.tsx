import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  deleteFriend as deleteFriendRequest,
  type Friend,
  getFriendList,
} from "../api/client";
import { kinWS } from "../api/ws";
import {
  cacheFriends,
  type ConversationSummary,
  getCachedFriends,
  getConversationSummaries,
  hasCachedFriendSnapshot,
  removeCachedFriend,
} from "../services/db";
import { kinFeedback } from "../services/feedback";
import { mergeFriendProfile, parseFriendProfileEvent } from "../services/friendProfile";
import { useAuth } from "./AuthContext";

export type FriendsHomeSource =
  | "loading"
  | "cache_refreshing"
  | "network"
  | "cache"
  | "unavailable";

interface FriendsHomeValue {
  friends: Friend[];
  summaries: Record<string, ConversationSummary>;
  source: FriendsHomeSource;
  refreshing: boolean;
  reduceMotion: boolean;
  onlineEventKeys: Record<string, number>;
  refresh: () => Promise<boolean>;
  removeFriend: (friendId: string) => Promise<void>;
}

const FriendsHomeContext = createContext<FriendsHomeValue | null>(null);

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function configurePresenceLayout(reduceMotion: boolean): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: 320,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

export function FriendsHomeProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const ownerId = state.user?.id || null;
  const [friends, setFriends] = useState<Friend[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({});
  const [source, setSource] = useState<FriendsHomeSource>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [onlineEventKeys, setOnlineEventKeys] = useState<Record<string, number>>({});
  const ownerIdRef = useRef<string | null>(ownerId);
  const friendsRef = useRef<Friend[]>([]);
  const cachedOwnerRef = useRef<string | null>(null);
  const hasCachedSnapshotRef = useRef(false);
  const hasLiveSnapshotRef = useRef(false);

  useEffect(() => {
    ownerIdRef.current = ownerId;
    if (cachedOwnerRef.current === ownerId) return;
    cachedOwnerRef.current = null;
    hasCachedSnapshotRef.current = false;
    hasLiveSnapshotRef.current = false;
    friendsRef.current = [];
    setFriends([]);
    setSummaries({});
    setOnlineEventKeys({});
    setSource(ownerId ? "loading" : "unavailable");
  }, [ownerId]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  const applyFriends = useCallback(async (
    nextFriends: Friend[],
    detectPresence: boolean,
    expectedOwnerId: string,
  ) => {
    if (ownerIdRef.current !== expectedOwnerId) return;
    const previousFriends = friendsRef.current;
    const previousById = new Map(previousFriends.map((friend) => [friend.user_id, friend]));
    const presenceChanged = detectPresence && previousFriends.length > 0 && nextFriends.some((friend) => (
      previousById.has(friend.user_id)
      && previousById.get(friend.user_id)?.is_online !== friend.is_online
    ));
    const becameOnline = detectPresence ? nextFriends.filter((friend) => (
      friend.is_online && previousById.get(friend.user_id)?.is_online === false
    )) : [];

    if (presenceChanged) configurePresenceLayout(reduceMotion);
    friendsRef.current = nextFriends;
    setFriends(nextFriends);
    if (becameOnline.length > 0 && !reduceMotion) {
      setOnlineEventKeys((current) => {
        const next = { ...current };
        const eventTime = Date.now();
        becameOnline.forEach((friend) => {
          next[friend.user_id] = eventTime;
        });
        return next;
      });
    }
    kinFeedback.seedFriendStatuses(nextFriends);
    const nextSummaries = await getConversationSummaries(
      expectedOwnerId,
      nextFriends.map((friend) => friend.user_id),
    );
    if (ownerIdRef.current === expectedOwnerId) setSummaries(nextSummaries);
  }, [reduceMotion]);

  const loadFriends = useCallback(async (): Promise<boolean> => {
    const expectedOwnerId = ownerIdRef.current;
    if (!expectedOwnerId) {
      setSource("unavailable");
      return false;
    }

    if (cachedOwnerRef.current !== expectedOwnerId) {
      cachedOwnerRef.current = expectedOwnerId;
      hasCachedSnapshotRef.current = false;
      hasLiveSnapshotRef.current = false;
      friendsRef.current = [];
      setFriends([]);
      setSummaries({});
      setSource("loading");
      try {
        const [cachedFriends, hasCachedSnapshot] = await Promise.all([
          getCachedFriends(expectedOwnerId),
          hasCachedFriendSnapshot(expectedOwnerId),
        ]);
        if (ownerIdRef.current !== expectedOwnerId) return false;
        if (hasCachedSnapshot) {
          hasCachedSnapshotRef.current = true;
          await applyFriends(cachedFriends, false, expectedOwnerId);
          setSource("cache_refreshing");
        }
      } catch { /* 缓存不可用时继续请求服务器 */ }
    }

    try {
      const data = await getFriendList();
      if (ownerIdRef.current !== expectedOwnerId) return false;
      await applyFriends(data.friends, hasLiveSnapshotRef.current, expectedOwnerId);
      hasLiveSnapshotRef.current = true;
      setSource("network");
      try {
        await cacheFriends(expectedOwnerId, data.friends);
        hasCachedSnapshotRef.current = true;
      } catch { /* 缓存写入失败不影响当前页面 */ }
      return true;
    } catch {
      if (ownerIdRef.current !== expectedOwnerId) return false;
      setSource(
        hasCachedSnapshotRef.current || friendsRef.current.length > 0
          ? "cache"
          : "unavailable",
      );
      return false;
    }
  }, [applyFriends]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      return await loadFriends();
    } finally {
      setRefreshing(false);
    }
  }, [loadFriends]);

  useFocusEffect(useCallback(() => {
    void loadFriends();
  }, [loadFriends]));

  useEffect(() => {
    const onFriendStatus = (data: any) => {
      if (typeof data.user_id !== "string") return;
      const online = !!data.is_online;
      kinFeedback.handleFriendStatus(data.user_id, online);
      const existing = friendsRef.current.find((friend) => friend.user_id === data.user_id);
      if (!existing || existing.is_online === online) return;

      configurePresenceLayout(reduceMotion);
      const nextFriends = friendsRef.current.map((friend) => (
        friend.user_id === data.user_id ? { ...friend, is_online: online } : friend
      ));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
      if (online && !reduceMotion) {
        setOnlineEventKeys((current) => ({ ...current, [data.user_id]: Date.now() }));
      }
    };
    kinWS.on("friend_status", onFriendStatus);
    return () => kinWS.off("friend_status", onFriendStatus);
  }, [reduceMotion]);

  useEffect(() => {
    const reload = () => { void loadFriends(); };
    kinWS.on("inbox_message", reload);
    kinWS.on("friend_added", reload);
    kinWS.on("resumed", reload);
    return () => {
      kinWS.off("inbox_message", reload);
      kinWS.off("friend_added", reload);
      kinWS.off("resumed", reload);
    };
  }, [loadFriends]);

  useEffect(() => {
    const onFriendProfile = (data: any) => {
      const update = parseFriendProfileEvent(data);
      if (!update || !friendsRef.current.some((friend) => friend.user_id === update.user_id)) return;
      const nextFriends = friendsRef.current.map((friend) => mergeFriendProfile(friend, update));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
    };
    kinWS.on("friend_profile", onFriendProfile);
    return () => kinWS.off("friend_profile", onFriendProfile);
  }, []);

  const removeFriend = useCallback(async (friendId: string) => {
    await deleteFriendRequest(friendId);
    const expectedOwnerId = ownerIdRef.current;
    if (expectedOwnerId) await removeCachedFriend(expectedOwnerId, friendId);
    const nextFriends = friendsRef.current.filter((friend) => friend.user_id !== friendId);
    friendsRef.current = nextFriends;
    setFriends(nextFriends);
    setSummaries((current) => {
      const next = { ...current };
      delete next[friendId];
      return next;
    });
  }, []);

  return (
    <FriendsHomeContext.Provider value={{
      friends,
      summaries,
      source,
      refreshing,
      reduceMotion,
      onlineEventKeys,
      refresh,
      removeFriend,
    }}>
      {children}
    </FriendsHomeContext.Provider>
  );
}

export function useFriendsHome(): FriendsHomeValue {
  const value = useContext(FriendsHomeContext);
  if (!value) throw new Error("useFriendsHome 必须在 FriendsHomeProvider 内使用");
  return value;
}
