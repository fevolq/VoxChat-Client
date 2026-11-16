package com.fevolq.voxchat

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.*
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.sqrt

class VoiceDevicePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(VoiceDeviceModule(context), QrScannerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

/** File-backed recording/upload avoids sending large audio buffers through the JS bridge. */
class VoiceDeviceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(125, TimeUnit.SECONDS).callTimeout(11, TimeUnit.MINUTES)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
  @Volatile private var recording = false
  @Volatile private var recorder: AudioRecord? = null
  @Volatile private var recordThread: Thread? = null
  private var recordingFile: File? = null
  @Volatile private var recordingError: String? = null
  @Volatile private var call: Call? = null
  @Volatile private var activeRequest: String? = null
  private var player: MediaPlayer? = null
  private var playbackFile: File? = null
  private var playbackPromise: Promise? = null
  private var focus: AudioFocusRequest? = null
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change < 0) { cancelAll(); emit("interrupted", "音频被其他应用打断") }
  }
  private val directory = File(context.cacheDir, "voxchat-audio").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "VoiceDevice"
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
  @ReactMethod fun copyText(value: String, promise: Promise) {
    main.post {
      try {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("VoxChat 配对地址", value))
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("CLIPBOARD", "复制失败，请重试", e) }
    }
  }
  private fun emit(type: String, value: String, id: String? = null) {
    if (!context.hasActiveReactInstance()) return
    val event = Arguments.createMap().apply { putString("type", type); putString("value", value); putString("requestId", id) }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("VoxChatDevice", event)
  }
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    return (store.getKey("voxchat-device", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("voxchat-device", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @ReactMethod fun readCredentials(promise: Promise) {
    try {
      val value = context.getSharedPreferences("voxchat", Context.MODE_PRIVATE).getString("credentials", null)
      if (value == null) { promise.resolve(null); return }
      val bytes = Base64.decode(value, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      promise.resolve(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    } catch (e: Exception) { promise.reject("CREDENTIALS", "无法读取设备凭证，请重新配对", e) }
  }
  @ReactMethod fun saveCredentials(value: String?, promise: Promise) {
    try {
      val edit = context.getSharedPreferences("voxchat", Context.MODE_PRIVATE).edit()
      if (value == null) edit.remove("credentials") else {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        edit.putString("credentials", Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
      }
      check(edit.commit()) { "无法保存设备凭证" }; promise.resolve(null)
    } catch (e: Exception) { promise.reject("CREDENTIALS", e.message, e) }
  }
  private fun acquireFocus() {
    val result = if (android.os.Build.VERSION.SDK_INT >= 26) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener(focusListener, main).build()
      focus = request; audioManager.requestAudioFocus(request)
    } else audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    check(result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "其他应用正在使用音频，请稍后再试" }
  }
  private fun releaseFocus() {
    if (android.os.Build.VERSION.SDK_INT >= 26) focus?.let { audioManager.abandonAudioFocusRequest(it) }
    else audioManager.abandonAudioFocus(focusListener)
    focus = null
  }
  @ReactMethod fun startRecording(promise: Promise) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "请允许麦克风权限"); return
    }
    if (recordThread != null || activeRequest != null) { promise.reject("BUSY", "当前语音任务尚未结束"); return }
    try {
      acquireFocus()
      val size = maxOf(3200, AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT))
      val record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size * 2)
      recorder = record
      check(record.state == AudioRecord.STATE_INITIALIZED) { "麦克风初始化失败" }
      val file = File(directory, "record-${UUID.randomUUID()}.wav")
      recordingFile = file; recordingError = null; recording = true
      record.startRecording()
      recordThread = Thread({
        try {
          RandomAccessFile(file, "rw").use { out ->
            out.write(ByteArray(44)); val buffer = ByteArray(3200); var bytes = 0; var lastLevel = 0L
            while (recording && bytes < 16000 * 2 * 120) {
              val count = record.read(buffer, 0, buffer.size)
              if (count < 0) { if (recording) error("麦克风读取失败") else break }
              if (count == 0) continue
              out.write(buffer, 0, count); bytes += count
              val now = System.currentTimeMillis()
              if (now - lastLevel >= 90) {
                var sum = 0.0
                for (i in 0 until count - 1 step 2) {
                  val sample = ((buffer[i].toInt() and 255) or (buffer[i + 1].toInt() shl 8)).toShort().toDouble() / 32768.0
                  sum += sample * sample
                }
                emit("level", JSONObject().put("level", sqrt(sum / (count / 2))).put("durationMs", bytes / 32).toString())
                lastLevel = now
              }
            }
            out.seek(0); out.write(wavHeader(bytes, 16000))
            if (recording) emit("recordLimit", "录音已达到两分钟上限")
          }
        } catch (e: Exception) { recordingError = e.message; emit("recordError", e.message ?: "录音失败") }
        finally { recording = false; try { record.stop() } catch (_: Exception) {}; record.release(); recorder = null }
      }, "VoxChat-recorder").also { it.start() }
      promise.resolve(null)
    } catch (e: Exception) {
      recording = false; recorder?.release(); recorder = null; releaseFocus(); promise.reject("RECORDING", e.message, e)
    }
  }
  @ReactMethod fun stopRecording(promise: Promise) {
    recording = false
    io.execute {
      try {
        recordThread?.join(2000); check(recordThread?.isAlive != true) { "麦克风未能停止" }; recordThread = null
        releaseFocus(); recordingError?.let { error(it) }
        val file = recordingFile ?: error("没有录音")
        recordingFile = null
        promise.resolve(Arguments.createMap().apply { putString("path", file.absolutePath); putDouble("durationMs", (file.length() - 44) / 32.0) })
      } catch (e: Exception) { promise.reject("RECORDING", e.message, e) }
    }
  }
  @ReactMethod fun discardRecording(path: String) { checkedFile(path)?.delete() }
  private fun checkedFile(path: String): File? = File(path).canonicalFile.takeIf { it.parentFile == directory.canonicalFile }
  private fun wavHeader(bytes: Int, rate: Int): ByteArray = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
    put("RIFF".toByteArray()); putInt(bytes + 36); put("WAVEfmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
    putInt(rate); putInt(rate * 2); putShort(2); putShort(16); put("data".toByteArray()); putInt(bytes)
  }.array()
  @ReactMethod fun submitTurn(origin: String, token: String, id: String, path: String, promise: Promise) {
    if (activeRequest != null) { promise.reject("BUSY", "当前请求尚未结束"); return }
    activeRequest = id
    io.execute {
      val input = checkedFile(path)
      var output: File? = null
      try {
        check(input != null && input.exists()) { "录音文件已失效" }
        check(input.length() in 45..(25L * 1024 * 1024)) { "录音为空或过大" }
        val request = Request.Builder().url("${origin.trimEnd('/')}/voxchat/api/turns")
          .header("Authorization", "Bearer $token").header("X-Request-Id", id)
          .post(input.asRequestBody("audio/wav".toMediaType())).build()
        val currentCall = client.newCall(request); call = currentCall
        check(activeRequest == id) { "请求已取消" }
        var seq = 0; var index = 0; var audioBytes = 0L; var format = ""; var ended = false; var complete = false
        currentCall.execute().use { response ->
          if (!response.isSuccessful) {
            val body = response.peekBody(4096).string()
            val message = try { JSONObject(body).getJSONObject("error").getString("message") } catch (_: Exception) { "请求失败（HTTP ${response.code}）" }
            if (response.code == 401) emit("unauthorized", message, id)
            error(message)
          }
          val source = response.body?.source() ?: error("响应为空")
          while (!source.exhausted()) {
            check(activeRequest == id) { "请求已取消" }
            val line = source.readUtf8LineStrict(2L * 1024 * 1024)
            if (line.isBlank()) continue
            check(!complete) { "结束事件后收到额外数据" }
            val frame = JSONObject(line)
            check(frame.optInt("protocol") == 2 && frame.optString("requestId") == id && frame.getInt("seq") == seq++) { "语音响应协议或序号不匹配" }
            val type = frame.getString("type"); val data = frame.optJSONObject("data")
            when (type) {
              "error" -> error(frame.optJSONObject("error")?.optString("message") ?: "语音请求失败")
              "audio.start" -> {
                check(output == null) { "重复音频头" }; format = data!!.getString("format")
                check(format in listOf("mp3", "aac", "opus", "flac", "wav", "pcm")) { "不支持的音频格式" }
                if (format == "pcm") check(data.optInt("sampleRate") == 24000 && data.optInt("channels") == 1 && data.optString("sampleFormat") == "s16le") { "PCM 采样参数不支持" }
                output = File(directory, "reply-$id.${if (format == "pcm") "wav" else format}")
                output!!.writeBytes(if (format == "pcm") ByteArray(44) else ByteArray(0))
              }
              "audio.chunk" -> {
                check(output != null && !ended && data!!.getInt("index") == index++) { "音频块顺序错误" }
                val bytes = Base64.decode(data!!.getString("data"), Base64.DEFAULT); audioBytes += bytes.size
                check(audioBytes <= 64L * 1024 * 1024) { "回复音频过大" }; output!!.appendBytes(bytes)
              }
              "audio.end" -> {
                check(output != null && !ended && data!!.getInt("chunks") == index && data.getLong("bytes") == audioBytes) { "音频传输不完整" }; ended = true
              }
              "complete" -> { check(ended && audioBytes > 0) { "回复音频不完整" }; complete = true }
            }
            // Audio stays in native files; only lightweight UI events cross the bridge.
            if (type != "audio.chunk") emit("frame", line, id)
          }
        }
        check(complete && activeRequest == id) { "连接中断，响应未完整交付；请查看会话历史" }
        if (format == "pcm") RandomAccessFile(output!!, "rw").use { it.write(wavHeader(audioBytes.toInt(), 24000)) }
        val audio = output!!
        main.post {
          if (activeRequest != id) { audio.delete(); promise.reject("CANCELLED", "请求已取消") }
          else play(audio, id, promise)
        }
      } catch (e: Exception) {
        output?.delete(); if (activeRequest == id) activeRequest = null
        promise.reject("TURN_FAILED", e.message ?: "连接失败，请检查网络", e)
      } finally { input?.delete(); call = null }
    }
  }
  private fun play(file: File, id: String, promise: Promise) {
    try {
      playbackFile = file; playbackPromise = promise; acquireFocus()
      player = MediaPlayer().apply {
        setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        setDataSource(file.absolutePath)
        setOnPreparedListener { emit("playing", "", id); it.start() }
        setOnCompletionListener { finishPlayback(null) }
        setOnErrorListener { _, _, _ -> finishPlayback("音频无法播放，请检查插件音频格式"); true }
        prepareAsync()
      }
    } catch (e: Exception) { finishPlayback(e.message ?: "播放失败") }
  }
  private fun finishPlayback(error: String?) {
    player?.release(); player = null; playbackFile?.delete(); playbackFile = null; activeRequest = null; releaseFocus()
    val promise = playbackPromise; playbackPromise = null
    if (error == null) promise?.resolve(null) else promise?.reject("PLAYBACK", error)
  }
  @ReactMethod fun cancelAll() { cancelInternal(null) }
  @ReactMethod fun cancel(promise: Promise) { cancelInternal(promise) }
  private fun cancelInternal(promise: Promise?) {
    recording = false; activeRequest = null; call?.cancel()
    main.post {
      finishPlayback("已停止")
      io.execute {
        recordThread?.join(2000); recordThread = null; recordingFile?.delete(); recordingFile = null; releaseFocus()
        promise?.resolve(null)
      }
    }
  }
  override fun onHostResume() {}
  override fun onHostPause() { cancelAll(); emit("interrupted", "已暂停，返回应用后可继续") }
  override fun onHostDestroy() { cancelAll() }
  override fun invalidate() { cancelAll(); context.removeLifecycleEventListener(this); super.invalidate() }
}
