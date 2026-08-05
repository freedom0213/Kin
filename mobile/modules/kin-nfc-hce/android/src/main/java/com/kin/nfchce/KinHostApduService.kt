package com.kin.nfchce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import java.nio.charset.StandardCharsets

class KinHostApduService : HostApduService() {
  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
    if (!isKinSelectAid(commandApdu)) return STATUS_AID_NOT_FOUND
    val token = KinHceStore.activeToken(applicationContext)
      ?: return STATUS_CONDITIONS_NOT_SATISFIED
    val payload = "$PROTOCOL_PREFIX$token".toByteArray(StandardCharsets.US_ASCII)
    return payload + STATUS_SUCCESS
  }

  override fun onDeactivated(reason: Int) {
    // The token remains active until the JS pairing flow completes, cancels, or expires.
  }

  private fun isKinSelectAid(command: ByteArray?): Boolean {
    if (command == null || command.size < 5 + KIN_AID.size) return false
    if (command[0] != 0x00.toByte()) return false
    if (command[1] != 0xA4.toByte()) return false
    if (command[2] != 0x04.toByte()) return false
    if (command[3] != 0x00.toByte()) return false
    val aidLength = command[4].toInt() and 0xFF
    if (aidLength != KIN_AID.size || command.size < 5 + aidLength) return false
    return KIN_AID.indices.all { index -> command[5 + index] == KIN_AID[index] }
  }

  companion object {
    private const val PROTOCOL_PREFIX = "KIN1:"
    private val KIN_AID = byteArrayOf(
      0xF0.toByte(), 0x4B, 0x49, 0x4E, 0x30, 0x31
    )
    private val STATUS_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
    private val STATUS_AID_NOT_FOUND = byteArrayOf(0x6A, 0x82.toByte())
    private val STATUS_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69, 0x85.toByte())
  }
}
