# Client Tests

测试按协议和业务边界分层：

- `protocol`：fixtures、错误映射、NDJSON 帧解析。
- `core`：配对、选择、语音轮次和取消状态机。
- `platform`：录音、播放、扫码、安全存储和生命周期适配。
- `e2e`：连接真实或隔离的 VoxChat 插件，验证 v2 兼容性。

平台测试不应重复协议 fixtures；协议 fixtures 由 `protocol/` 统一维护。
