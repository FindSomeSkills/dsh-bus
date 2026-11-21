# dsh-bus

在你自己拥有的几台电脑之间传消息，不需要服务器、不需要账号体系、不需要端口映射。

每一端都是一台跑着 DSH 的机器；消息写进**你自己的一个私有 git 仓库**，另一端用 `git pull` 读。仓库就是信箱，提交就是回执。

```
机器 A  --send-->  [ 私有 git 仓库 ]  --poll-->  机器 B
机器 B  --send-->  [ 私有 git 仓库 ]  --poll-->  机器 A
```

## 它解决什么

- 两台（或 N 台）机器上的 DSH 会话要互相传提示词、传结果、传长文本
- 原来的做法是人肉复制到微信，再粘回来；长代码块会被截断
- 现在一条命令发出去，另一端 `poll` 就能读到原文，字节数与哈希都对得上

## 它不做什么

- 不搬会话文件，不合并会话，不改对端的任何配置
- 不碰 `.credentials.yaml`，不碰 `sessions/`
- 不启动、不重启 DSH 服务

## 装法（每台机器都做一次）

要求：Node.js 20 或更高版本、`git`、一个你自己的私有 git 仓库（GitHub / Gitee / 自建都行）。

三种装法，挑一种：

```bash
# 1) 从 npm 装（推荐，之后 dsh-bus 直接可用）
npm install -g dsh-bus-cli

# 2) 用发布包（不想装全局包时）：下载 dsh-bus-0.3.2.zip 解压，在解压目录里跑
node bin/dsh-bus.mjs init --repo https://github.com/你的用户名/dsh-bus-data.git --device mac-mini

# 3) 从源码
git clone https://github.com/FindSomeSkills/dsh-bus.git
cd dsh-bus
node bin/dsh-bus.mjs init --repo https://github.com/你的用户名/dsh-bus-data.git --device mac-mini
```

`--device` 不填时取主机名。名字只用于区分设备，叫 `home-pc`、`mac-mini`、`office` 都行。

信箱仓库必须私有：消息正文是明文存储。

## 日常用法

```bash
# 发一段文本
node bin/dsh-bus.mjs send --to mac-mini --text "帮我看下这个报错"

# 发一个文件（60 KB 的提示词也没问题，原文不截断）
node bin/dsh-bus.mjs send --to mac-mini --file prompt.md

# 读未读消息（JSON，方便直接被 DSH 会话消费）
node bin/dsh-bus.mjs poll

# 回执
node bin/dsh-bus.mjs ack 01J9K3Q7M2X8

# 上报本机状态
node bin/dsh-bus.mjs heartbeat

# 看两端差异：内核版本、插件版本、bundles、预设
node bin/dsh-bus.mjs diff

# 本机配置与仓库状态
node bin/dsh-bus.mjs status

# 补发离线期间排队的消息
node bin/dsh-bus.mjs flush

# 带附件：默认只记元数据（名字、路径、哈希）
node bin/dsh-bus.mjs send --to mac-mini --text "看这个" --attach ./config-fragment.json

# 需要把文件本身也送过去：256 KB 以内可以内联
node bin/dsh-bus.mjs send --to mac-mini --text "看这个" --attach-blob ./config-fragment.json

# 对端取回内联附件
node bin/dsh-bus.mjs get 01J9K3Q7M2X8 --out ./config-fragment.json
```

所有命令都输出 JSON，`ok` 为 false 时带 `error`。

## 广播

`--to '*'` 发给仓库里所有其他设备。适合「通知所有人我升级了内核」。

## 延迟与离线

- `poll` 是拉取式的，延迟取决于你多久调用一次；配合计划任务每 15 秒跑一次即可
- 发送时如果 push 失败，消息会写进本机 `~/.dsh-bus/outbox/` 并返回 `queued`，下次 `send`、`poll`、`flush` 会自动补发
- 补发按消息 id 去重，不会重复投递

## 目录

```
bin/dsh-bus.mjs        CLI 入口
src/bus/config.mjs     本机配置与游标
src/bus/message.mjs    消息格式、id、完整性校验
src/bus/git.mjs        pull/commit/push、锁、重试
src/bus/transport.mjs  消息读写与队列
src/bus/state.mjs      采集内核、插件、bundles、PID
src/bus/diff.mjs       两端差异
test/bus.test.mjs      合成仓库端到端测试
docs/PROTOCOL.md       消息格式与可靠性约定
```

## 测试

```bash
node --test test/bus.test.mjs
```

用一个临时裸仓库模拟两台设备，覆盖：60 KB 原文、哈希一致、回复、回执、心跳、diff、断网排队与补发去重。

## 许可

MIT

## 仓库历史规则

发布脚本只做「克隆 → 覆盖文件 → 普通 commit → push」，**不 force push、不重建仓库**。远端历史保持线性，任何已经克隆过的机器 `git pull` 都应该快进。

如果你的本地副本因为早期版本被强制推送过而卡在分叉上，对齐一次即可：

```bash
git -C ~/dsh-bus fetch origin
git -C ~/dsh-bus reset --hard origin/main
```
