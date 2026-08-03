/** 好友从离线到在线时的三阶段“苏醒”时间轴。 */

export const PRESENCE_STATUS_WAKE_MS = 180;
export const PRESENCE_LANDING_START_MS = 500;
export const PRESENCE_TOTAL_MS = 860;
export const PRESENCE_EVENT_STALE_MS = 1_600;
export const PRESENCE_STAGGER_MS = 80;
export const PRESENCE_MAX_STAGGER_MS = 320;

export function getPresenceDelay(
  eventTime: number,
  stageOffset: number,
  now = Date.now(),
): number {
  return Math.max(0, eventTime + stageOffset - now);
}

export function isRecentPresenceEvent(eventTime: number, now = Date.now()): boolean {
  return eventTime > 0 && now - eventTime <= PRESENCE_EVENT_STALE_MS;
}
