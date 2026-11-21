# 给另一台机器的安装提示词

把下面整段发给那台机器上的 DSH 会话。它照着做，装完会贴回 JSON。

```text
在这台机器上装 dsh-bus，用来和我的其他电脑互相发消息。全程不要重启任何 DSH 服务。

一、环境确认（只读）
1. node -v                    # 需要 20 或更高
2. git --version
3. gh auth status             # 需要已登录，能访问我的私有信箱仓库

二、安装（三选一）
A. npm install -g dsh-bus
B. 从 https://github.com/FindSomeSkills/dsh-bus/releases 下载 dsh-bus-0.2.0.zip，解压后用 node bin/dsh-bus.mjs
C. git clone https://github.com/FindSomeSkills/dsh-bus.git ~/dsh-bus && cd ~/dsh-bus

三、接入信箱
dsh-bus init --repo <我的私有信箱仓库地址> --device <这台机器的名字>
dsh-bus heartbeat
dsh-bus poll

四、边界（不得越界）
- 不要动 ~/.dsh/profiles、不要改 profile 的 package.json、不要装任何客户端插件
- 不要停止、重启、拉起 DSH；本工具不需要 DSH 在跑
- 不要把这台机器的任何文件推到公开仓库；信箱仓库必须私有
- 只写 ~/.dsh-bus/（配置、游标、待发队列）

五、回报
把下面三段的原始 JSON 贴回来：status、devices、heartbeat 的 state 字段。
```

## 装完应该看到什么

- `status` 里有 `device`、`repo`、`head`
- `devices` 里能看到其他机器最近一次心跳时间
- `heartbeat` 的 `state.service.pid` 与这台机器上监听 2081 的进程一致（没开网页服务时为 null）
