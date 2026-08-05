package com.kin.nfchce

import android.content.Context
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KinNfcHceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KinNfcHce")

    AsyncFunction("getCapabilitiesAsync") {
      val packageManager = context.packageManager
      val adapter = NfcAdapter.getDefaultAdapter(context)
      mapOf(
        "nfcSupported" to packageManager.hasSystemFeature(PackageManager.FEATURE_NFC),
        "nfcEnabled" to (adapter?.isEnabled == true),
        "hceSupported" to packageManager.hasSystemFeature(
          PackageManager.FEATURE_NFC_HOST_CARD_EMULATION
        )
      )
    }

    AsyncFunction("startSharingAsync") { token: String, ttlSeconds: Int ->
      require(token.matches(Regex("^[A-Za-z0-9_-]{20,128}$"))) {
        "Invalid Kin pairing token"
      }
      require(context.packageManager.hasSystemFeature(
        PackageManager.FEATURE_NFC_HOST_CARD_EMULATION
      )) {
        "This Android device does not support NFC host card emulation"
      }
      require(NfcAdapter.getDefaultAdapter(context)?.isEnabled == true) {
        "NFC is disabled"
      }
      check(KinHceStore.start(context, token, ttlSeconds)) {
        "Unable to store the temporary Kin pairing token"
      }
    }

    AsyncFunction("stopSharingAsync") {
      KinHceStore.stop(context)
    }
  }
}
