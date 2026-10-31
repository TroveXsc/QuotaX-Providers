# Provider 更新通道

状态：正式和测试目录均已发布。它们是当前测试版 App 的推荐配置来源，不能代替真实服务账号或真机验收。

| 通道 | 预定目录 | 用途 |
| --- | --- | --- |
| stable | [`channels/stable/catalog.json`](stable/catalog.json) | 当前默认推荐配置 |
| beta | [`channels/beta/catalog.json`](beta/catalog.json) | 供测试 App 手动检查和应用的候选版本 |

每次 Catalog 都是该来源的完整服务目录。某一服务更新时，其他服务条目保持不变，目录的 `publicationSequence` 按通道递增。

测试通道的发布不能自动改变稳定通道。通道身份与签名信任策略由 App 和受保护的发布配置确定，目录不能自行创建官方身份。

目录缺失、过期、验签或网络失败时，客户端保留随包基线或本地已验证配置。发布回执保存在 `receipts/`，既有 Release 附件保持不可变。
