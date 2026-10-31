# dsh-plugin-manager · 插件管理器

DSH 插件管理器。当前提供一项能力：检查本 profile 里从 GitHub 安装的插件有没有新提交，并按 profile 里记录的**原 spec** 重装更新；后续会在同一个插件里增加其他插件管理功能。

DSH 自带的插件页只管组合包的启停与安装，不跟踪第三方 GitHub 依赖的远端变化：`github:` 依赖在锁文件里钉着安装时的 commit，上游 push 之后本地不会跟着变。插件管理器先补上这一段。

## 界面在哪

不新开侧栏入口，全部挂在 DSH 自带**插件**页的插槽上：

| 插槽 | 位置 | 内容 |
| --- | --- | --- |
| `plugins.tab` | 插件页「已安装」后面的**更新**标签页 | 本 profile 里全部 GitHub 来源插件的清单：本地 commit → 远端 commit、状态、检查/更新按钮 |
| `plugins.detail.badge` | 组合包详情页标题旁 | 该包有更新时显示「有更新」，检查失败时显示「检查失败」 |
| `plugins.detail.actions` | 组合包详情页页头 | 「检查 / 更新」按钮 |
| `plugins.detail.section` | 组合包详情页底部 | 来源 spec、本地/远端 commit、最近检查时间与同一组按钮 |

这些插槽是 `@deepseek-ai/dsh-client-ui-plugin-manager` 声明的扩展点：`plugins.tab` 加标签页，`plugins.detail.*` 给「不属于自己的组合包」的详情节页贡献内容。插件页没有「给别人的列表行插按钮」的槽，所以没有往列表行里塞东西。

## 怎么判定有没有更新

1. 从 `pluginManager.listBundles()` 取 profile 里已安装的组合包，只留下来源是 `github:owner/repo`、`git+https://github.com/…`、`https://github.com/…`、`git@github.com:…` 的（本地 `link:`、npm 包、其他 Git 主机不归这里管）。
2. 本地 commit 从 profile 的 `pnpm-lock.yaml` 根 importer 里读：`github:` 来源记成 `https://codeload.github.com/owner/repo/tar.gz/<commit>`。workspace 设了 `packages: ['.']` 时 importer 键会变成相对路径，所以按依赖项解析、不认 importer 的键。
3. 远端 commit 用 `git ls-remote` 取：没带 `#ref` 取 `HEAD`；带分支/标签取对应 ref（附注标签优先取 peel 后的 commit）；带 40 位 commit 的直接钉住、不问网络。
4. 两边不一致就是「有更新」。

## 怎么更新

走 DSH 自己的 `pluginManager`，不自己调 pnpm：

1. `manager.removeBundle(name)` 卸载；
2. `manager.installBundle(原 spec, { enabled: 原启用状态 })` 重装。

不能直接重装已被依赖的同名包：HMR 开启时 `installBundle` 会抛 `already-installed`，所以必须先卸载。兼容性检查、组合包对账、HMR 重组仍由 DSH 负责；返回 `application: 'restart-required'` 时按提示重启。

## 安装

产物已提交，从 GitHub 安装不需要现场构建。macOS / Linux 用 `dsh` 命令（桌面版也可写完整路径）：

```bash
dsh plugin --profile desktop add "github:longyi-0x0/dsh-plugin-manager"
```

Windows 用桌面版自带的 CLI：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "github:longyi-0x0/dsh-plugin-manager"
```

改仓库里的本地副本时用 `link:`：

```bash
dsh plugin --profile desktop add "link:/path/to/dsh-plugin-manager"
```

重启 DSH 后，插件页会出现「更新」标签页，GitHub 来源的组合包详情页会多出按钮与明细。

## 数据接口

宿主半边在 `webServer` 上挂 `/dsh-plugin-manager/api`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/list` | 只读清单（带上一次检查结果），不访问网络 |
| POST | `/check` | 检查远端；体 `{ names?: string[] }`，省略则检查全部 |
| POST | `/update` | 更新一个：体 `{ name: string }` |

接口只接受本机回环 Host 的同源请求（`sec-fetch-site: cross-site` 与异源 Origin 一律 403），变更只接受 POST。远程访问模式（非回环 Host）下界面会显示不可用。

## 限制

- 只认 github.com；gitcode、自建 Git、npm 包与 `link:` 本地依赖不列。
- 检查结果只存在宿主内存里，DSH 重启后需要重新检查。
- 钉死到 40 位 commit 的 spec 显示「钉住 commit」且不提供更新；要换版本得改 spec。
- 插件管理器不更新自己：自己的行只显示「不更新自己」，重装用 `dsh plugin` 命令或安装对话框。
- 卸载成功而安装失败时插件会留在未安装状态，错误信息里写明，再点一次更新可重试。

## 测试

```bash
node --test
```

Node 20+，无第三方依赖。覆盖：spec 解析、`git ls-remote` 结果解析与 ref 解析（注入 git 执行器）、锁文件 commit 读取、检查/更新状态机与串行化（注入假 manager）、HTTP 路由的信任围栏与状态码、浏览器半侧四个插槽的注册。

## 许可

MIT，见 [LICENSE](LICENSE)。
