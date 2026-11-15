# VoxChat Client

VoxChat 的设备端仓库，面向 Android 手机与平板、iPhone 与 iPad 等客户端。

当前仓库采用 React Native + TypeScript。Android 和 iOS 共用同一套协议、请求状态和语音流程；平台目录只负责系统能力和界面适配，手机和平板通过响应式布局共用应用工程。

当前技术基线为 React Native 0.88.1、React 19.3 和 TypeScript 6。Community CLI 及 Android/iOS 平台 CLI 已列入开发依赖。

## 目录

```text
protocol/          设备接口协议、连接规则、错误码、事件定义和测试样例
src/core/          共享网络、协议模型、流解析、语音轮次和平台接口
src/screens/       React Native 界面
android/           Android 原生工程入口（手机和平板共用）
ios/               iOS 原生工程入口（iPhone 和 iPad 共用）
tools/             不依赖平台 SDK 的协议校验工具
docs/              客户端整体架构和开发约束
```

## 设备端职责

设备端负责：

- 扫描或输入配对链接，完成一次性配对并安全保存设备凭证。
- 管理当前设备的工作区、会话和音色选择。
- 录音、上传语音、解析 NDJSON 流并播放音频。
- 展示 ASR 转写、DSH 可见事件、完整回复、播报稿和错误状态。
- 处理断线、取消、凭证失效、工作区授权变化和协议版本不兼容。

DSH 插件负责设备授权、模型调用、会话写入和音频生成。设备端不能写入管理配置，也不能绕过 DSH 的会话和权限机制。

## 开发入口

协议目录可以独立校验，不需要安装 Android 或 iOS 工具链：

```powershell
npm run check
```

安装依赖后可以运行类型检查：

```powershell
npm install
npm run typecheck
```

Android 工程使用 React Native 的标准结构，构建时使用 JDK 17、Android SDK API 37 和 Gradle Wrapper；本机 SDK 路径、`local.properties`、签名文件等环境文件不进入仓库。共享实现放在 `src/core`，不改变 `protocol/` 的公开边界。

启动 Android 调试流程：

```powershell
npm start
adb reverse tcp:8081 tcp:8081
cd android
.\gradlew.bat :app:assembleDebug
```

iOS 原生工程与 CocoaPods 配置在 macOS 环境下补齐，业务核心和协议目录不按平台复制。

## 兼容关系

当前客户端协议使用协议字段中的版本号 `2`，对应 DSH 插件仓库中的 `VoxChat/docs/api.md`。协议目录不按版本拆分；协议变更先更新字段定义、兼容规则和 fixtures。
