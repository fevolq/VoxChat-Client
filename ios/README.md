# iOS 原生工程

这里放 React Native 的 iOS 原生工程。iPhone 和 iPad 共用同一套工程和业务代码。

平台层需要实现共享核心定义的系统适配：Keychain、相机扫码、录音、音频播放、网络权限、Universal Links/URL Scheme 和前后台生命周期。高吞吐音频播放必要时通过原生模块接入，不把音频缓冲逻辑复制到界面层。
