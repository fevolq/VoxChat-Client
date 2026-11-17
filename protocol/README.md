# 设备接口摘要

基础路径为 `<服务端地址>/voxchat/api`，协议版本为 `2`。除状态检查和配对外，请求均携带 `Authorization: Bearer <token>`。客户端完整字段类型见 `src/core/api/types.ts`，HTTP 实现见 `src/core/api/VoxChatClient.ts`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/status` | 检查协议兼容性和服务状态 |
| POST | `/pair` | 提交 `{code}`，接收设备凭证 |
| GET | `/me` | 读取可用工作区和音色列表，不以服务端保存的选择覆盖本地选择 |
| GET | `/sessions?workspaceId=...` | 指定工作区的会话列表 |
| GET | `/sessions/:id/history?workspaceId=...` | 指定工作区内的会话历史，使用 `before`、`limit` 分页 |
| POST | `/turns?workspaceId=...&sessionId=...&voiceId=...` | 随音频提交本轮选择，读取 NDJSON 响应；会话和音色参数可省略 |
| DELETE | `/turns/:requestId` | 取消本轮 |

配对链接为 `voxchat://pair?server=<编码后的HTTP(S)地址>&code=<六位配对码>`。扫码只填入配对信息，配对接口成功后才保存凭证。工作区、会话和音色选择随配对凭证加密保存在本机，重新打开时恢复。选择会话、音色或点击“新会话”不发网络请求；切换工作区只读取该工作区的会话列表。刷新授权列表保留仍可用的本地选择，不恢复服务端历史选择。

## 每轮选择与服务端对接

已对齐 VoxChat 服务端的按请求选择接口。响应流继续使用 `protocol: 2`；部署时须使用支持下述参数的插件版本。

- 音频保持原始 WAV 请求体，`workspaceId`、`sessionId`、`voiceId` 通过 URL 查询参数随请求传递，使用 URL 编码。
- `workspaceId` 必填，服务端验证设备的工作区授权。
- `sessionId` 有值则续聊；点击“新会话”清空本地 ID，首次发送省略该参数，由服务端创建会话。不能回退到设备之前保存的会话。
- `voiceId` 传音色库的 `id`，不传 TTS 提供方的 `value`。默认音色省略该参数，服务端在 TTS 请求中省略 `voice`，由 TTS 服务使用自身默认音色。
- 响应事件携带实际的 `workspaceId` 和 `sessionId`。客户端从当前请求的响应中记住新建会话 ID，下一轮（包括持续监听）复用。工作区或已有会话不匹配时拒绝处理响应。
- 查询会话和历史时同样显式传 `workspaceId`，服务端不能忽略该参数而使用设备保存的工作区。

客户端不再调用 `PUT /workspace`、`PUT /session`、`PUT /voice` 或 `POST /sessions`。

`/me` 使用 `{protocol, deviceId, name, voices, workspaces}`，工作区项目只依赖 `{id, title, path}`。ID 格式为 `[a-zA-Z0-9_-]{1,128}`；可选参数未选择时完全省略，不传空字符串、文本 `null` 或 `undefined`。刷新后所选音色已不可用时，自动切换默认音色，不提示或阻止录音。

服务端在首个正常帧之前创建会话。收到 ID 后，即使后续 ASR/TTS 失败，客户端也保留该 ID，避免下一次录音重复创建会话。失败、取消或中断均不自动重发。

音频上传使用原始音频请求体和 `X-Request-Id` 请求头。原生模块校验协议版本、请求 ID、连续 `seq`、音频块序号和完成状态；取消或失败不会自动重发。服务端的错误信息保留供界面展示，`401` 会清除失效凭证。

Android 网络读取和请求总超时均为 11 分钟，覆盖服务端最长 10 分钟的单轮处理。原生请求通过失败回调传递错误码，`UNAUTHORIZED` / `DEVICE_REVOKED` 会清除设备凭证。停止期间不允许新建录音或上传，录音线程未退出时明确报告失败。

历史使用当前 DSH 事件结构：用户文字为 `data.content`，助手文字为 `data.message.content`，工具名为 `data.name`；会话标题为字符串 `projections.values.title`，缺少标题保持空白。

`events.json` 与 `fixtures/` 用于 `npm run check` 校验协议样例，不包含真实设备凭证。语音轮次的实际解析、音频缓存和播放位于 `VoiceDeviceModule.kt`，没有另一套 JavaScript 音频流实现。
