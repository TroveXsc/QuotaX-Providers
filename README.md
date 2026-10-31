# QuotaX Providers

QuotaX 官方 Provider 配置的公开分发仓库，用于发布版本化的服务定义、签名发布清单，以及稳定和测试通道的更新目录。

当前状态：发布工具与工作流已接入，首轮签名 Provider 和通道目录待发布。文件发布、原生激活与真实服务验收分别记录。

## 仓库职责

Provider 原始定义、维护说明与合成测试在维护者的私有源仓库中统一管理。本仓库只接收经过校验、签名的生成产物，不作为第二个手工编辑入口，也不发布主体 App 代码或私有开发历史。`tools/` 是生成的独立发布工具与共享合同校验器，`metadata/` 和 `receipts/` 保存签名产物及发布回执。

## 发布文件

| 文件 | 用途 |
| --- | --- |
| `provider.json` | 单个服务的完整 OpenAPI 3.1＋x-quotax v3 定义，包括鉴权、接口、工作流、指标、转换与共享卡片引用 |
| `release-manifest.json` | 该服务的发布身份、版本、文件摘要、长度、兼容要求与官方签名 |
| `catalog.json` | 某一通道的完整服务目录，列出推荐版本、Manifest 地址及摘要 |

单个 Provider 的发布示意：

```text
Release: codex-v1.0.2-r1
  provider.json
  release-manifest.json
```

稳定和测试目录分别为 `channels/stable/catalog.json` 与 `channels/beta/catalog.json`。目录由发布流水线生成；首轮发布前不放置空目录或假签名文件。Tag 的 `rN` 是签名发布序列，可在正文准确字节不变时续签，既有附件保持不可变。

## 下载与信任

正式发布的文件公开下载，无需用户提供 GitHub Token。App 在启用前验证内置信任来源、签名、SHA256、版本顺序、有效期、Schema、引用和原生能力。

目录签名或下载失败时，App 应继续使用本机已验证版本。配置发布成功、下载成功、激活成功和真实服务验收是不同结果，分别记录。

维护方式见[发布流程](docs/publishing.md)，通道状态见[通道说明](channels/README.md)。
