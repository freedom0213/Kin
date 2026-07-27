/** 好友公开资料事件的校验与合并。 */

import type { Friend } from "../api/client";

export interface FriendProfileEvent {
  user_id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  profile_banner: string | null;
  status_msg: string | null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseFriendProfileEvent(data: any): FriendProfileEvent | null {
  if (!data || data.type !== "friend_profile") return null;
  if (typeof data.user_id !== "string" || typeof data.username !== "string") return null;
  if (
    !isNullableString(data.nickname)
    || !isNullableString(data.avatar)
    || !isNullableString(data.profile_banner)
    || !isNullableString(data.status_msg)
  ) return null;

  return {
    user_id: data.user_id,
    username: data.username,
    nickname: data.nickname,
    avatar: data.avatar,
    profile_banner: data.profile_banner,
    status_msg: data.status_msg,
  };
}

export function mergeFriendProfile(friend: Friend, update: FriendProfileEvent): Friend {
  if (friend.user_id !== update.user_id) return friend;
  return {
    ...friend,
    username: update.username,
    nickname: update.nickname,
    avatar: update.avatar,
    profile_banner: update.profile_banner,
    status_msg: update.status_msg,
  };
}
