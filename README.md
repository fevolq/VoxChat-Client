# VoxChat Client

VoxChat 的 Android 语音客户端，使用 React Native 0.88.1、React 19.3、TypeScript 6 和 Kotlin。支持手机和平板；目前没有可运行的 iOS 工程。

## 功能

- 手动输入或扫描 `voxchat://pair` 链接配对，凭证通过 Android Keystore 加密保存在本机。
- 工作区、会话和音色使用悬浮下拉框，选择随配对凭证加密保存在本机，重新打开时恢复，不请求服务端保存。切换工作区只查询对应会话列表；会话标题直接使用服务端数据。选择会话或点击“新会话”立即返回首页。
- 每轮语音携带当前工作区和可选的会话、音色 ID。“新会话”不提前创建，首次发送时不传会话 ID，收到服务端分配的 ID 后继续该会话。默认音色不传音色 ID，由服务端选择默认值。
- 按住说话、松手发送；上滑开启持续监听，检测到说话后的静音自动发送。上传和播报时暂停录音，播报结束后恢复监听。
- 首页展示识别文字和播报文字，历史页展示用户、助手文字及工具调用名称，支持加载更早记录。

打开设置或历史、切到后台、失去音频焦点会停止语音。请求失败不会自动重发。

## 开发

需要 Node.js 22.18+、JDK 17+、Android SDK API 37、Build Tools 37.0.0 和 NDK 27.1.12297006。使用仓库提供的 Gradle Wrapper，设置 `JAVA_HOME` 和 `ANDROID_HOME`，或在不提交的 `android/local.properties` 中配置 SDK 路径。

```sh
npm ci
npm run typecheck
npm run check
npm test
```

如同时检出 VoxChat 服务端，可额外执行本地 HTTP 接口验证（隔离内存数据库，使用模拟 DSH 和本地模型服务，不连接真实设备）：

```powershell
$env:VOXCHAT_SERVER_ROOT = '../VoxChat'
node --test tests/api.test.mjs
```

启动 Metro，再在另一个终端运行 Android 客户端：

```sh
npm start
# 另一个终端，设备或模拟器已连接
npm run android
```

生成 Release 安装包：

```powershell
cd android
.\gradlew.bat :app:assembleRelease
```

macOS/Linux 使用 `./gradlew`。输出位于 `android/app/build/outputs/apk/release/`；仓库不包含签名配置，Release APK 需要使用自己的密钥经 `zipalign`、`apksigner` 处理后才能安装。继续使用相同密钥才能覆盖升级。不要提交签名密钥、设备凭证或本机环境配置。

Windows 建议使用较短的仓库路径，避免 CMake/Ninja 路径长度限制。如果使用 `subst` 映射盘符构建，可加 `--init-script ../tools/windows-metro.gradle -PmetroProjectRoot=<仓库真实绝对路径>`，让 Metro 使用真实路径，原生构建仍使用短路径。该辅助脚本不包含开发者机器路径或代理配置。

## 代码结构

| 目录 | 用途 |
| --- | --- |
| `src/screens/` | 首页、设置、历史、下拉框、图标、主题及交互状态 |
| `src/core/api/` | HTTP 接口、配对链接校验、类型和展示数据转换 |
| `src/core/turn/listening.ts` | 持续监听的本地声音检测 |
| `src/platform/device.ts` | 原生模块类型、麦克风与相机权限 |
| `android/` | Android 工程，录音、上传、流校验、播放、扫码和安全存储 |
| `protocol/` | 客户端协议摘要、事件定义和校验样例 |
| `tests/` | 连接状态、本机配置恢复、对话交互、历史展示和接口测试 |
| `tools/` | 协议检查和 Windows 构建辅助 |

Android 录音为 16 kHz 单声道 WAV。NDJSON 在原生线程增量解析，文本随事件更新；音频先写临时文件，校验完成后播放，目前不支持边下载边播放。默认录音上限两分钟，持续监听的单段上限一分钟。

响应流协议版本为 `2`，设备接口摘要见 [protocol/README.md](protocol/README.md)。服务端需要支持按请求传入的工作区、会话和音色处理语音，以及按工作区查询会话/历史；旧版依赖设备已保存选择的接口不兼容此流程。服务端管理、模型提供方和隧道配置由 VoxChat 插件仓库维护。

`dist/`、`tmp/`、构建缓存、`node_modules/` 和密钥已由 Git 忽略，均不属于提交内容。
