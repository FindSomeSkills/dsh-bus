# dsh-bus 协议 v1

## 1. 传输：一个 git 仓库

```
bus/<from>/<时间>-<id>.json     消息，只增不改
ack/<设备>/<消息id>.json         回执，收到即写
state/<设备>/heartbeat.json     本机状态，每次覆盖
```

- 按发送方分目录：两端同时发消息不会改同一个文件
- 回执单独放 `ack/`：能算出「谁收到了哪条」「对端最后在线」
- 本机游标只存在本地 `~/.dsh-bus/cursor.json`，不进仓库，避免互相污染

## 2. 消息格式

```json
{
  "schema": 1,
  "id": "01J9K3Q7M2X8ABCD",
  "from": "office-pc",
  "to": "mac-mini",
  "kind": "prompt",
  "created_at": "2026-11-21T07:30:12.480Z",
  "body": "原文，不做转义或压缩",
  "body_bytes": 61440,
  "body_sha256": "9f2c…",
  "attachments": [
    { "name": "prompt.md", "path_hint": "C:/work/prompt.md", "sha256": "…", "size": 61440 }
  ],
  "reply_to": null,
  "expires_at": null,
  "host": { "dsh": "0.2.2-rc.5", "node": "v24.19.0", "os": "win32" }
}
```

规则：

- `schema` 固定为 1；不认识的版本按「跳过并报告」处理，不猜测字段含义
- `id` 是时间前缀 + 随机，文件名按时间自然排序
- `body_bytes` 与 `body_sha256` 由发送方计算，接收方校验；不一致就报错，不展示
- `kind`：`prompt` 请求、`reply` 回复、`status` 状态通告、`ack` 回执
- `to: "*"` 表示广播，接收方仍要写自己的回执
- `attachments` 只记路径与哈希，**不把文件内容写进仓库**

## 3. 完整性

- 发送方：`body_bytes = byteLength(body)`，`body_sha256 = sha256(body)`
- 接收方：两条都重算，不一致则整条拒收并报告
- 60 KB 以上的正文按 UTF-8 原样写入，不改行尾、不加转义

## 4. 可靠性与去重

```
send   写本地 → pull --rebase → commit → push（重试 3 次：1s/3s/9s）
       仍失败 → 写 ~/.dsh-bus/outbox/<id>.json，返回 queued
flush  把 outbox 里的消息写进仓库再 push；成功后删除本地副本
poll   先 flush，再拉取；按 id 去重，只输出未读
```

- 同一 id 无论出现几次，接收方只输出一次
- 冲突不 force push；rebase 失败时保留本地提交并报错，由人处理
- 写操作加文件锁，避免两个 dsh-bus 进程同时 commit

## 5. 心跳字段

```json
{
  "device": "office-pc",
  "at": "2026-11-21T07:31:00.000Z",
  "host": { "os": "win32", "arch": "x64", "hostname": "…", "node": "v24.19.0", "dsh": "0.2.2-rc.5" },
  "profile": { "name": "web", "plugins": { "@liustack/modlens": "3.27.5" }, "bundles": ["..."] },
  "preset": { "permission": "danger-full-access", "preset": "unrestricted" },
  "service": { "pid": 20364, "startedAt": "2026-11-21T07:19:06", "port": 2081, "source": "netstat+powershell" },
  "dshHome": "C:/Users/…/.dsh"
}
```

采不到就写 `null`，不猜。`service` 用系统命令探测监听端口的进程，不会重启任何东西。

## 6. 差异输出

`diff` 只比较：内核版本、Node 版本、插件名与版本、bundles 顺序、预设与权限档位。输出差异项与建议，不写任何配置。

## 7. 安全边界

- 仓库必须私有：消息正文是明文
- 凭据不进仓库、不进消息；用本机已有的 git 凭据
- 附件只记路径与哈希，避免把本机文件内容意外推上远端
- 任何需要重启 DSH 的动作都不在本工具范围内
