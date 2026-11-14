# VoxChat 设备协议

这是设备端与 VoxChat DSH 插件之间的协议目录。

- [设备接口](api.md)
- [连接与隧道规则](connection.md)
- [错误码](errors.json)
- [NDJSON 事件](events.json)
- [测试样例](fixtures/)

当前协议版本为 `2`，版本号通过服务端响应和 NDJSON 事件中的 `protocol` 字段传递。基础路径为 `<DSH origin>/voxchat/api`。除状态检查和配对外，接口都使用设备 Bearer token。

`api.md` 是面向开发者的完整说明，`errors.json` 和 `events.json` 是客户端校验所用的结构化定义，三者描述同一份协议；修改协议时需要一起更新，并同步 DSH 插件仓库中的 `docs/api.md`。

## 兼容原则

- 设备端以服务端响应为准，不根据本地猜测补全工作区、会话或音色。
- NDJSON 按 UTF-8 增量解码，以换行分帧；网络分块不等于协议帧。
- 未知事件可以忽略，但不能跳过公共 envelope 的校验。
- 已提交的语音轮次不自动重试；重复请求 ID 必须明确提示用户查看历史。
- 破坏性协议变化通过协议版本字段和兼容规则处理，只有确实需要并行维护时才引入新的版本标识。
