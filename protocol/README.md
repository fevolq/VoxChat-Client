# 设备接口摘要

基础路径为 `<服务端地址>/voxchat/api`，协议版本为 `2`。除状态检查和配对外，请求均携带 `Authorization: Bearer <token>`。客户端完整字段类型见 `src/core/api/types.ts`，HTTP 实现见 `src/core/api/VoxChatClient.ts`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/status` | 检查协议兼容性和服务状态 |
| POST | `/pair` | 提交 `{code}`，接收设备凭证 |
| GET | `/me` | 读取已保存的选择、工作区和音色列表 |
| PUT | `/workspace` | 保存 `{workspaceId}` |
| GET | `/sessions` | 当前工作区会话列表 |
| POST | `/sessions` | 创建并选中新会话 |
| PUT | `/session` | 保存 `{sessionId}` |
| PUT | `/voice` | 保存 `{voiceId}`；`null` 清空指定音色 |
| GET | `/sessions/:id/history` | 使用 `before`、`limit` 分页读取历史 |
| POST | `/turns` | 上传音频，读取 NDJSON 响应 |
| DELETE | `/turns/:requestId` | 取消本轮 |

配对链接为 `voxchat://pair?server=<编码后的HTTP(S)地址>&code=<六位配对码>`。扫码只填入配对信息，配对接口成功后才保存凭证。工作区、会话和音色选择由服务端持久化，语音请求根据服务端存储的选择运行；客户端不在音频请求中重复携带这些配置。

音频上传使用原始音频请求体和 `X-Request-Id` 请求头。原生模块校验协议版本、请求 ID、连续 `seq`、音频块序号和完成状态；取消或失败不会自动重发。服务端的错误信息保留供界面展示，`401` 会清除失效凭证。

`events.json` 与 `fixtures/` 用于 `npm run check` 校验协议样例，不包含真实设备凭证。语音轮次的实际解析、音频缓存和播放位于 `VoiceDeviceModule.kt`，没有另一套 JavaScript 音频流实现。
