/** Kin 的轻量声音与触觉反馈，并负责过滤消息连响和在线状态抖动。 */

import { Audio } from "expo-av";
import { File, Paths } from "expo-file-system";
import { Platform, Vibration } from "react-native";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  subscribePreferences,
  type KinPreferences,
} from "./preferences";

const SOFT_TONE_BASE64 = "UklGRvQCAABXQVZFZm10IBAAAAABAAEAoA8AAEAfAAACABAAZGF0YdACAAAAAKcAegGaACf+mfwT/qYB+gPPAnH/Q/31/dj/QQAf/yj/FAJgBTgET/0V9oT2pACrDBEPzgOk8xbt3vbyCG0TLg06/Mnv9/EP/2EK7goBA+H7YPvK/t//NP3p+7wAzggsC3oCe/RK7rj3QAqVFY0OUfpz6gftpf+6Ed4TiAV79D3vL/glBY8KLwYl/8r8Cv8uABL9uvmg/PMFPA1XCf36Ru7/76oAaBILFV0FxfBU6UD1ewlHFGcNrPxj8djzDv+PBzMHtAGM/gAAdAFM/s34cfjyACgMnQ5UA5nyueuF9sAKrBY7D6P69eqY7Vb/ARC6EQMFqfbE8g36YANGBu4C0v/2ADYD2wDR+XH12/rRB8MQhQt4+iLsRu5bAPkSjRWvBXPxa+rA9UgIthGFC4b91PQy90T/FwTMAiEAOAGsBC8E7vy99DT1/gDwDn0RIQRW8QDqq/XFCtAWRg8s+1bs9O4d/6gN0g4vBCX52/ZI/JcBwgF1/1sABQVQB6MB6/aT8TH5RAmVE0oNQPrY6kTtAAC8EigVwAW28mvsvPbPBm0OFQld/rD4+/ql/4sAPv5p/rgDJQnbBtH7LvFY8uMADBGqE9QEuvAw6Tv1VQoAFqoO3/uD7hDxAv/MCkMLEgPR+1T7yP7f/zT96fu8AM4ILAt6Anv0Su6490AKlRWNDlH6c+oH7aX/uhHdE4gFfvRF7zX4HwV+CiIGJ//U/A7/LgAi/eH5uPzDBcQM+Ag2+yTv3PCgADgRkBP0BAbyVutG9oQIERLYCxb9T/OK9TL/YgYEBmgB0P4AACoBqP5i+i36uAAeCc8KbQJg9qrxZ/lcB0IPEgqF/JbyfvSY/5wJawriAsD6vPjQ/MMBMQN0Aer/cwB1AWAAXv2o+/X9/gIsBhIEIP6R+Yb6GwBLBbAFagGa/Ev77P2NAQwDzQGn/5r+Cf/u/1IALQACAAoAEwA=";
const MESSAGE_THROTTLE_MS = 850;
const MINIMUM_OFFLINE_MS = 15_000;
const ONLINE_STABLE_MS = 2_000;
const ONLINE_COOLDOWN_MS = 30_000;

interface FriendPresence {
  online: boolean;
  offlineSince: number | null;
}

class KinFeedbackService {
  private preferences: KinPreferences = { ...DEFAULT_PREFERENCES };
  private lastMessageFeedbackAt = 0;
  private friendPresence = new Map<string, FriendPresence>();
  private pendingOnlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastOnlineFeedbackAt = new Map<string, number>();
  private activeSounds = new Set<Audio.Sound>();
  private toneUriPromise: Promise<string> | null = null;

  constructor() {
    void getPreferences().then((preferences) => { this.preferences = preferences; });
    subscribePreferences((preferences) => { this.preferences = preferences; });
  }

  async notifyIncomingMessage(): Promise<void> {
    const now = Date.now();
    if (now - this.lastMessageFeedbackAt < MESSAGE_THROTTLE_MS) return;
    this.lastMessageFeedbackAt = now;

    if (this.preferences.hapticFeedback && Platform.OS === "android") {
      Vibration.vibrate(10);
    }
    if (this.preferences.messageSound) await this.playSoftTone(0.18);
  }

  seedFriendStatuses(friends: Array<{ user_id: string; is_online?: boolean }>): void {
    const now = Date.now();
    friends.forEach((friend) => {
      const online = !!friend.is_online;
      if (!this.friendPresence.has(friend.user_id)) {
        this.friendPresence.set(friend.user_id, {
          online,
          offlineSince: online ? null : now,
        });
      }
    });
  }

  handleFriendStatus(userId: string, online: boolean): void {
    const now = Date.now();
    const current = this.friendPresence.get(userId);
    if (!current) {
      this.friendPresence.set(userId, { online, offlineSince: online ? null : now });
      return;
    }
    if (current.online === online) return;

    if (!online) {
      this.cancelPendingOnline(userId);
      this.friendPresence.set(userId, { online: false, offlineSince: now });
      return;
    }

    const offlineDuration = current.offlineSince === null ? 0 : now - current.offlineSince;
    this.friendPresence.set(userId, { online: true, offlineSince: null });
    if (offlineDuration < MINIMUM_OFFLINE_MS) return;

    this.cancelPendingOnline(userId);
    const timer = setTimeout(() => {
      this.pendingOnlineTimers.delete(userId);
      if (!this.friendPresence.get(userId)?.online) return;
      const lastFeedbackAt = this.lastOnlineFeedbackAt.get(userId) || 0;
      if (Date.now() - lastFeedbackAt < ONLINE_COOLDOWN_MS) return;
      this.lastOnlineFeedbackAt.set(userId, Date.now());
      if (this.preferences.friendOnlineSound) void this.playSoftTone(0.13);
    }, ONLINE_STABLE_MS);
    this.pendingOnlineTimers.set(userId, timer);
  }

  reset(): void {
    this.pendingOnlineTimers.forEach((timer) => clearTimeout(timer));
    this.pendingOnlineTimers.clear();
    this.friendPresence.clear();
    this.lastOnlineFeedbackAt.clear();
    this.lastMessageFeedbackAt = 0;
    this.activeSounds.forEach((sound) => {
      void sound.unloadAsync().catch(() => undefined);
    });
    this.activeSounds.clear();
  }

  private cancelPendingOnline(userId: string): void {
    const timer = this.pendingOnlineTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.pendingOnlineTimers.delete(userId);
  }

  private async playSoftTone(volume: number): Promise<void> {
    try {
      const uri = await this.getToneUri();
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, volume }
      );
      this.activeSounds.add(sound);
      setTimeout(() => {
        this.activeSounds.delete(sound);
        void sound.unloadAsync().catch(() => undefined);
      }, 1_000);
    } catch {
      // 声音不可用时保持安静，不阻塞消息接收或在线状态更新。
    }
  }

  private getToneUri(): Promise<string> {
    if (!this.toneUriPromise) {
      this.toneUriPromise = (async () => {
        const toneFile = new File(Paths.cache, "kin_soft_tone.wav");
        await toneFile.write(SOFT_TONE_BASE64, { encoding: "base64" } as any);
        return toneFile.uri;
      })().catch((error) => {
        this.toneUriPromise = null;
        throw error;
      });
    }
    return this.toneUriPromise;
  }
}

export const kinFeedback = new KinFeedbackService();
