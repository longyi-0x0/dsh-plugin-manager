# dsh-plugin-manager · 插件管理器

DSH 插件管理器，只做增量：原生插件页、原生「添加插件」对话框和内置插件配置都不动。安装 GitHub 插件继续用原生入口；本插件在「添加插件」下拉菜单里加一个「GitHub 插件更新」入口，打开弹层做「全部检测 / 全部更新」。组合包详情页会显示单个插件的检查/更新，也提供「全部 GitHub 插件」入口；本插件自己也在可更新之列。

DSH 自带的插件页只管组合包的启停与安装，不跟踪第三方 GitHub 依赖的远端变化：`github:` 依赖在锁文件里钉着安装时的 commit，上游 push 之后本地不会跟着变。插件管理器只补这一段，不接管原生页。

## 界面在哪

全部挂在 DSH 自带插件页的插槽上，**不注册 `plugins.tab`**：

| 插槽 | 位置 | 内容 |
| --- | --- | --- |
| `plugins.add.actions` | 插件页「添加插件」下拉菜单 | 「GitHub 插件更新」入口；有更新时显示数量，点开弹层 |
| `shell.overlay` | 全局浮层 | 更新弹层：摘要、「全部检测」「全部更新」、GitHub 来源插件列表、逐项操作、关闭 |
| `plugins.detail.badge` | 组合包详情页标题旁 | 有更新或检测失败时显示状态 |
| `plugins.detail.actions` | 组合包详情页页头 | 「检查 / 更新」按钮 |
| `plugins.detail.section` | 组合包详情页底部 | 来源 spec、本地/远端 commit、最近检查时间、单项按钮与「全部 GitHub 插件」入口 |

这些插槽是 `@deepseek-ai/dsh-client-ui-plugin-manager` 声明的扩展点。原生页的「内置插件配置」「实验性插件」「已安装插件」始终保留；本插件不再用页签替换主列表。

## 从 GitHub 安装

安装仍用插件页原生的「添加插件」，它本来就接受 Git 地址，例如：

- `github:owner/repo`，可带 `#分支或标签`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/<分支或标签>`
- `git@github.com:owner/repo.git`

包检查、pnpm 下载、构建脚本审批、兼容性检查和失败恢复都由原生安装对话框完成。插件管理器不重复实现安装表单，也不改安装流程。

「添加插件」旁边的箭头菜单里，「GitHub 插件更新」是**更新**入口，不是安装入口。

## 扫描更新

打开「添加插件」下拉菜单，选「GitHub 插件更新」；也可以从任意组合包详情页底部的「全部 GitHub 插件」打开同一个弹层。弹层第一次打开时自动做一次全部检测：读锁文件里的本地 commit，用 `git ls-remote` 取远端，不一致就是有更新。

- 「全部检测」：重扫全部 GitHub 来源插件。
- 「全部更新」：把已检出有更新的项逐个更新；本插件自己排在最后，避免自更新重载打断其他项。
- 单行「检查 / 更新」仍然可用。

检测只读远端，不改任何文件。结果只存在宿主内存里，DSH 重启后需要重新检测。关闭弹层不会影响原生插件页。

## 怎么判定有没有更新

1. 从 `pluginManager.listBundles()` 取 profile 里已安装的组合包，只留下来源是 `github:owner/repo`、`git+https://github.com/…`、`https://github.com/…`、`git@github.com:…` 的（本地 `link:`、npm 包、其他 Git 主机不归这里管）。
2. 本地 commit 从 profile 的 `pnpm-lock.yaml` 根 importer 里读：`github:` 来源记成 `https://codeload.github.com/owner/repo/tar.gz/<commit>`。workspace 设了 `packages: ['.']` 时 importer 键会变成相对路径，所以按依赖项解析、不认 importer 的键。
3. 远端 commit 用 `git ls-remote` 取：没带 `#ref` 取 `HEAD`；带分支/标签取对应 ref（附注标签优先取 peel 后的 commit）；带 40 位 commit 的直接钉住、不问网络。
4. 两边不一致就是「有更新」。

## 怎么更新

走 DSH 自己的 `pluginManager`，不自己调 pnpm：

1. `manager.removeBundle(name)` 卸载；
2. `manager.installBundle(原 spec, { enabled: 原启用状态 })` 重装。

不能直接重装已被依赖的同名包：HMR 开启时 `installBundle` 会抛 `already-installed`，所以必须先卸载。兼容性检查、组合包对账、HMR 重组仍由 DSH 负责；返回 `application: 'restart-required'` 时按提示重启。更新结束后弹层会重新读取列表，行上或弹层顶部会写明成功、需要重启或失败原因。

## 自更新

本插件自己的行也有「检查 / 更新」按钮。自更新不能先卸载更新器，所以走另一条路：

1. 检查远端默认分支 `HEAD`；
2. 用 `github:owner/repo#<remote commit>` 调 `installBundle`，不 `removeBundle`；
3. DSH 在 pnpm 之后用 HMR 替换运行中的插件。

profile 里的 spec 会因此变成 pinned commit；之后自己的检查仍然跟远端 `HEAD` 比对。请求会先返回，安装继续在宿主里跑；DSH 可能重载。若没有变化，重启 DSH；失败原因在宿主日志里，可再点一次或改用 `dsh plugin` 重装。

## 安装这个插件

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

重启 DSH 后，「添加插件」下拉菜单会出现「GitHub 插件更新」，GitHub 来源的组合包详情页会多出更新状态与操作；原生插件页本身不变。

## 数据接口

宿主半边在 `webServer` 上挂 `/dsh-plugin-manager/api`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/list` | 只读清单（带上一次检查结果），不访问网络 |
| POST | `/check` | 检查远端；体 `{ names?: string[] }`，省略则检查全部 |
| POST | `/update` | 更新一个：体 `{ name: string }` |

接口只接受本机回环 Host 的同源请求（`sec-fetch-site: cross-site` 与异源 Origin 一律 403），变更只接受 POST。远程访问模式（非回环 Host）下界面会显示不可用。

## 限制

- 只列已安装、来源是 github.com 的插件；gitcode、自建 Git、npm 包与 `link:` 本地依赖不列。
- 安装由原生「添加插件」负责；本插件没有自己的安装表单。
- 不使用 `plugins.tab`，所以没有常驻在原生主列表里的内联区块；全局列表和「全部检测 / 全部更新」在「添加插件」菜单打开的弹层里，组合包详情页也有「全部 GitHub 插件」入口。这是为了不替换原生页。
- 在无 profile 管理的 guest/二级窗口里，原生页自己会显示「本部署没有可管理的 profile」，本插件的接口也不可用；请在主 DSH 窗口使用。
- 检查结果只存在宿主内存里，DSH 重启后需要重新检查。
- 钉死到 40 位 commit 的 spec 显示「钉住 commit」且不提供更新；本插件自己的行例外：自更新后 spec 会变成 pinned，但仍跟远端 HEAD 检查。
- 自更新会改写本插件的 profile spec 为 pinned commit；没有 HMR 或重载后没变化时重启 DSH。失败原因在宿主日志里，可再点一次或改用 `dsh plugin` 重装。
- 卸载成功而安装失败时插件会留在未安装状态；弹层顶部会保留错误和原 spec，可用原生「添加插件」重新安装。

## 实现备注

bundle patch 的行 id 必须是 `dsh-plugin-manager`，不能写成 `plugin-manager`。基础包用 `id: plugin-manager` 挂 `@deepseek-ai/dsh-plugin-manager`（profile 管理服务）；同名 `insert` 会把它顶掉，插件页会显示「本部署没有可管理的 profile」。`test/manifest.test.mjs` 守住这条。

## 测试

```bash
node --test
```

Node 20+，无第三方依赖。覆盖：spec 解析、`git ls-remote` 结果解析与 ref 解析（注入 git 执行器）、锁文件 commit 读取、检查/更新状态机与串行化（注入假 manager）、HTTP 路由的信任围栏与状态码、浏览器半侧注册添加菜单/详情贡献/弹层，且不注册 `plugins.tab`。

## 许可

MIT，见 [LICENSE](LICENSE)。
