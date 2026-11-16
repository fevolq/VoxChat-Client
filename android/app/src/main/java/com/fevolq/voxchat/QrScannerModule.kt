package com.fevolq.voxchat

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import com.facebook.react.bridge.*
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions

class PairingCaptureActivity : CaptureActivity()

class QrScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null
  private val requestCode = 58142
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != this@QrScannerModule.requestCode) return
      val promise = pending ?: return
      pending = null
      promise.resolve(if (resultCode == Activity.RESULT_OK && data != null) ScanIntentResult.parseActivityResult(resultCode, data).contents else null)
    }
  }

  init { context.addActivityEventListener(listener) }
  override fun getName() = "QrScanner"

  @Suppress("DEPRECATION")
  @ReactMethod fun scan(promise: Promise) {
    context.runOnUiQueueThread {
      val activity = context.currentActivity
      if (activity == null) { promise.reject("NO_ACTIVITY", "请返回应用后再扫码"); return@runOnUiQueueThread }
      if (pending != null) { promise.reject("BUSY", "扫码已打开"); return@runOnUiQueueThread }
      if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("CAMERA_PERMISSION", "请在系统设置中允许 VoxChat 使用相机"); return@runOnUiQueueThread
      }
      pending = promise
      try {
        val options = ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
          .setCaptureActivity(PairingCaptureActivity::class.java)
          .setPrompt("扫描 VoxChat 设备配对二维码")
          .setBeepEnabled(false).setBarcodeImageEnabled(false)
        activity.startActivityForResult(options.createScanIntent(activity), requestCode)
      } catch (e: Exception) {
        pending = null
        promise.reject("SCAN_FAILED", "无法打开相机，请检查相机是否被占用", e)
      }
    }
  }

  override fun invalidate() {
    context.removeActivityEventListener(listener)
    pending?.reject("SCAN_CANCELLED", "扫码已取消")
    pending = null
    super.invalidate()
  }
}
