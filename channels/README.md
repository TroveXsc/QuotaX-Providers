# Provider 更新通道

状态：入口规划，尚无可供客户端使用的签名 Catalog。

| 通道 | 预定目录 | 用途 |
| --- | --- | --- |
| stable | `channels/stable/catalog.json` | 通过验收的正式推荐版本 |
| beta | `channels/beta/catalog.json` | 供测试 App 手动检查和应用的候选版本 |

每次 Catalog 都是该来源的完整服务目录。某一服务更新时，其他服务条目保持不变，目录的 `publicationSequence` 按通道递增。

测试通道的发布不能自动改变稳定通道。通道身份与签名信任策略由 App 和受保护的发布配置确定，目录不能自行创建官方身份。

签名 Catalog 正式发布前，客户端必须将入口缺失视为尚未可用，保留随包基线或本地已验证配置。
