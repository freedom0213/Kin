package com.kin.nfchce

import android.content.Context

internal object KinHceStore {
  private const val PREFERENCES_NAME = "kin_hce_pairing"
  private const val TOKEN_KEY = "token"
  private const val EXPIRES_AT_KEY = "expires_at"
  private const val ACTIVE_KEY = "active"

  fun start(context: Context, token: String, ttlSeconds: Int): Boolean {
    val expiresAt = System.currentTimeMillis() + ttlSeconds.coerceIn(15, 180) * 1_000L
    return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(TOKEN_KEY, token)
      .putLong(EXPIRES_AT_KEY, expiresAt)
      .putBoolean(ACTIVE_KEY, true)
      .commit()
  }

  fun stop(context: Context) {
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(TOKEN_KEY)
      .remove(EXPIRES_AT_KEY)
      .putBoolean(ACTIVE_KEY, false)
      .apply()
  }

  fun activeToken(context: Context): String? {
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    if (!preferences.getBoolean(ACTIVE_KEY, false)) return null
    if (preferences.getLong(EXPIRES_AT_KEY, 0L) <= System.currentTimeMillis()) {
      stop(context)
      return null
    }
    return preferences.getString(TOKEN_KEY, null)
  }
}
