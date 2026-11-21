# dsh-bus 验收报告（2026-11-21）

六条来自需求第 5 节。每条给命令与实测输出；没验到的写明没验。

## 1. 60 KB 提示词完整到达

```
发送：node bin/dsh-bus.mjs send --to mac-mini --file prompt.md
接收：node bin/dsh-bus.mjs poll
结果：body_bytes 61451，body_sha256 与发送端一致，正文逐字节相同
```

测试脚本 `test/bus.test.mjs` 用例「两台设备：60KB 消息、回复、回执、心跳、diff、断网补送」覆盖同一断言，通过。

## 2. 回复在 30 秒内读到

```
真机往返：windows-pc 发 → mac-mini poll 读到 → mac-mini 回复 → windows-pc poll 读到
耗时：单次 send+poll 合计约 2–4 秒（含 git push/pull）
```

延迟上限取决于对端多久 poll 一次。工具本身不常驻；两边都按 15 秒计划任务轮询时，30 秒要求满足。**没有做 15 秒定时任务的连续 24 小时跑测**，这一项在真机上是手动触发的。

## 3. 断网 5 分钟补送且不重复

```
把 remote 指向不存在路径 → send 返回 {"status":"queued"}
恢复 remote → flush → {"pushed":true}
对端 poll --all：同一条消息只出现 1 次
```

用例「两台设备：…断网补送」覆盖。真机上没有拔网线实测，用的是无效 remote 模拟 push 失败。

## 4. diff 指到包名与版本

```
把 mac-mini 心跳里 dsh-ops 改成 0.5.4，本机 0.5.5
diff 输出：{"area":"plugin","name":"dsh-ops","local":"0.5.5","peer":"0.5.4"}
```

真机 2026-11-21 的实际 diff 还报出 `profile.bundles` 差异（Mac 缺 `@anysearch/anysearch-dsh`）与 Node 版本差异。

## 5. 心跳 PID 与启动时间与实际一致

```
mac-mini   heartbeat.service.pid     12428
mac-mini   lsof -iTCP:2081 -sTCP:LISTEN -t  12428      ← 一致
mac-mini   startedAt                 Sat Nov 21 07:06:21 2026
windows-pc heartbeat.service.pid     20364
windows-pc Get-NetTCPConnection :2081 → 20364          ← 一致
```

两台都对得上，这一条闭环。

## 6. 服务重启期间不阻塞

bus 是独立命令行进程，不依赖 DSH 服务：send / poll / heartbeat 只读写 `~/.dsh-bus` 与 git 仓库。测试全程没有启动、停止或重启任何 DSH 进程。

`heartbeat` 在服务不在时把 `service.pid` 写为 null，不会报错。**没有做「DSH 正在重启的瞬间发送」的实测**，因为会话内不允许重启服务。

## 已知差异与风险（真机 2026-11-21）

| 项 | Windows | Mac | 判断 |
| --- | --- | --- | --- |
| node | v24.19.0 | v22.23.5 | DSH 0.2.2-rc.5 声明 engines ≥ 24.9.0，Mac 低于要求，建议升级 |
| bundles | 9 项，含 `@anysearch/anysearch-dsh` | 8 项，装了包但没进 bundles | 插件不生效，需要把包名加进 `dsh.profile.bundles` 后重启（由用户执行） |
| preset | danger-full-access / unrestricted | 同 | 一致 |
| 内核 | 0.2.2-rc.5 | 0.2.2-rc.5 | 一致 |

## 环境

```
windows-pc  Win32 x64  node v24.19.0  dsh 0.2.2-rc.5  pid 20364
mac-mini    darwin x64 node v22.23.5  dsh 0.2.2-rc.5  pid 12428
信箱        https://github.com/FindSomeSkills/dsh-bus-data（私有）
工具        0.2.2
```
