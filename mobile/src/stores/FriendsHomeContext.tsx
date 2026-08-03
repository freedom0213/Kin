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
import {
  getPresenceDelay,
  PRESENCE_MAX_STAGGER_MS,
  PRESENCE_STAGGER_MS,
  PRESENCE_STATUS_WAKE_MS,
} from "../services/presenceMotion";
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
  const presenceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const presenceBurstRef = useRef({ startedAt: 0, count: 0 });

  const clearPresenceTimer = useCallback((userId: string) => {
    const timer = presenceTimersRef.current.get(userId);
    if (timer) clearTimeout(timer);
    presenceTimersRef.current.delete(userId);
  }, []);

  const allocatePresenceEventTime = useCallback((): number => {
    const now = Date.now();
    const burst = presenceBurstRef.current;
    if (now - burst.startedAt > PRESENCE_MAX_STAGGER_MS) {
      burst.startedAt = now;
      burst.count = 0;
    }
    const stagger = Math.min(
      burst.count * PRESENCE_STAGGER_MS,
      PRESENCE_MAX_STAGGER_MS,
    );
    burst.count += 1;
    return now + stagger;
  }, []);

  const scheduleOnlineCommit = useCallback((
    userId: string,
    eventTime: number,
    expectedOwnerId: string,
  ) => {
    clearPresenceTimer(userId);
    setOnlineEventKeys((current) => ({ ...current, [userId]: eventTime }));
    const timer = setTimeout(() => {
      presenceTimersRef.current.delete(userId);
      if (ownerIdRef.current !== expectedOwnerId) return;
      const existing = friendsRef.current.find((friend) => friend.user_id === userId);
      if (!existing || existing.is_online) return;
      configurePresenceLayout(false);
      const nextFriends = friendsRef.current.map((friend) => (
        friend.user_id === userId ? { ...friend, is_online: true } : friend
      ));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
    }, getPresenceDelay(eventTime, PRESENCE_STATUS_WAKE_MS));
    presenceTimersRef.current.set(userId, timer);
  }, [clearPresenceTimer]);

  useEffect(() => {
    ownerIdRef.current = ownerId;
    if (cachedOwnerRef.current === ownerId) return;
    presenceTimersRef.current.forEach((timer) => clearTimeout(timer));
    presenceTimersRef.current.clear();
    cachedOwnerRef.current = null;
    hasCachedSnapshotRef.current = false;
    hasLiveSnapshotRef.current = false;
    friendsRef.current = [];
    setFriends([]);
    setSummaries({});
    setOnlineEventKeys({});
    setSource(ownerId ? "loading" : "unavailable");
  }, [ownerId]);

  useEffect(() => () => {
    presenceTimersRef.current.forEach((timer) => clearTimeout(timer));
    presenceTimersRef.current.clear();
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!reduceMotion || presenceTimersRef.current.size === 0) return;
    const pendingIds = new Set(presenceTimersRef.current.keys());
    presenceTimersRef.current.forEach((timer) => clearTimeout(timer));
    presenceTimersRef.current.clear();
    const nextFriends = friendsRef.current.map((friend) => (
      pendingIds.has(friend.user_id) ? { ...friend, is_online: true } : friend
    ));
    friendsRef.current = nextFriends;
    setFriends(nextFriends);
    setOnlineEventKeys({});
  }, [reduceMotion]);

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
      && !presenceTimersRef.current.has(friend.user_id)
    )) : [];
    const pendingOnlineIds = new Set(nextFriends
      .filter((friend) => friend.is_online && presenceTimersRef.current.has(friend.user_id))
      .map((friend) => friend.user_id));
    const stagedOnlineIds = new Set([
      ...becameOnline.map((friend) => friend.user_id),
      ...pendingOnlineIds,
    ]);
    const shouldStageOnline = stagedOnlineIds.size > 0 && !reduceMotion;
    const presentedFriends = shouldStageOnline
      ? nextFriends.map((friend) => (
        stagedOnlineIds.has(friend.user_id)
          ? { ...friend, is_online: false }
          : friend
      ))
      : nextFriends;

    if (presenceChanged && !shouldStageOnline) configurePresenceLayout(reduceMotion);
    friendsRef.current = presentedFriends;
    setFriends(presentedFriends);
    if (shouldStageOnline) {
      becameOnline.forEach((friend) => {
        scheduleOnlineCommit(friend.user_id, allocatePresenceEventTime(), expectedOwnerId);
      });
    }
    kinFeedback.seedFriendStatuses(nextFriends);
    const nextSummaries = await getConversationSummaries(
      expectedOwnerId,
      nextFriends.map((friend) => friend.user_id),
    );
    if (ownerIdRef.current === expectedOwnerId) setSummaries(nextSummaries);
  }, [allocatePresenceEventTime, reduceMotion, scheduleOnlineCommit]);

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
      const pendingOnline = presenceTimersRef.current.has(data.user_id);
      if (!existing || (existing.is_online === online && !(pendingOnline && !online))) return;

      if (online && !reduceMotion) {
        if (!pendingOnline) {
          scheduleOnlineCommit(data.user_id, allocatePresenceEventTime(), ownerIdRef.current || "");
        }
        return;
      }

      clearPresenceTimer(data.user_id);
      configurePresenceLayout(reduceMotion);
      const nextFriends = friendsRef.current.map((friend) => (
        friend.user_id === data.user_id ? { ...friend, is_online: online } : friend
      ));
      friendsRef.current = nextFriends;
      setFriends(nextFriends);
      if (!online) {
        setOnlineEventKeys((current) => {
          if (!current[data.user_id]) return current;
          const next = { ...current };
          delete next[data.user_id];
          return next;
        });
      }
    };
    kinWS.on("friend_status", onFriendStatus);
    return () => kinWS.off("friend_status", onFriendStatus);
  }, [allocatePresenceEventTime, clearPresenceTimer, reduceMotion, scheduleOnlineCommit]);

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
