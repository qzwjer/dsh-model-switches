# 在另一台电脑上安装 dsh-model-switches

## 前提

目标电脑需满足：

| 项 | 要求 |
|---|---|
| DeepSeek Harness 桌面版 | **0.2.x**（本插件用 `engines.dsh: >=0.2.0 <0.3.0` 声明） |
| 已至少启动过一次 | 否则 profile 目录还不存在，CLI 会报 `Open DeepSeek Harness Desktop once to initialize its profile` |

版本不匹配时，装进去也会被 profile 启动时拒绝（**不会**静默失效），提示里会给出
`dsh plugin allow-version` 的授权方式。建议先升级/降级 DSH，而不是强行授权。

## 一、把插件包拷过去

只有一个文件需要传：

```
dsh-model-switches-1.0.0.tgz
```

下载链接（本机路径）：`D:\workspace\dsh-model-switches\dist\dsh-model-switches-1.0.0.tgz`

用 U 盘、网盘、`scp`、微信传文件都可以。**不需要**拷整个源码目录，也不需要 `node_modules`。

## 二、装进 desktop profile

先在目标电脑上**完全退出** DeepSeek Harness（托盘图标也要退），然后在该电脑上执行：

**方式 A：用应用自带的 CLI（推荐）**

```powershell
& 'D:\software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' `
  plugin --profile desktop add 'C:\path\to\dsh-model-switches-1.0.0.tgz'
```

把 `D:\software\...` 换成目标机上的实际安装路径（默认在同名目录），
`C:\path\to\...` 换成你放 tgz 的位置。

**方式 B：如果 `dsh` 已在 PATH 里**

```powershell
dsh plugin --profile desktop add 'C:\path\to\dsh-model-switches-1.0.0.tgz'
```

成功时会看到：

```
+ dsh-model-switches 1.0.0
```

## 三、启动应用并确认

重新打开 DeepSeek Harness，然后：

1. **设置 → 模型**：每张厂商卡片右上角的「编辑 / 删除」同一行，最右边应有开关；
2. 点某厂商的「**编辑**」→ 展开「**自定义设置**」→ 看到「模型目录」，每行右侧应有开关。

如果两个位置都没有开关，**先按 `Ctrl+R` 刷新页面**（客户端 bundle 需要重新加载）。

## 四、验证真的生效

在设置 → 模型里关掉某个厂商，然后点输入框旁的模型选择器 —— 它应该消失了。
再打开就回来。

## 常见问题

**`error: profile "desktop" is managed exclusively by the Electron application`**

你用的是系统里另一个 `dsh`（比如源码仓库里的），而不是桌面版自带的那个。
改用「方式 A」里的完整路径。

**`Open DeepSeek Harness Desktop once to initialize its profile`**

这台电脑还没启动过应用，先打开一次，再完全退出，然后重试。

**装好了但设置页没变化**

1. 确认应用**完全重启**过（不是最小化再打开）；
2. 浏览器层按 `Ctrl+R`；
3. 用下面的命令确认依赖已登记：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Raw | Select-String 'dsh-model-switches'
```

**想卸载**

```powershell
& 'D:\software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop remove dsh-model-switches
```

## 技术说明（为什么只拷一个 tgz 就够）

插件是**自包含**的两段代码：

- `index.js` — 宿主侧（Node ESM），只 import `@deepseek-ai/schemastery`，该包由应用自身提供；
- `client.js` — 浏览器侧，**无需构建**，运行时通过平台的 seed map 取 `react` / `react-dom` /
  `@deepseek-ai/dsh-client-ui-primitives`，这些都由应用自带。

所以 tgz 里只有 5 个文件（`index.js`、`client.js`、`cordis.patch.yml`、`package.json`、`README.md`），
不含任何 `node_modules`。

> **不要用 `link:` 安装。** `link:` 会让 Node 从被链接的源目录解析依赖，而源目录没有
> `@deepseek-ai/schemastery`，插件会在加载时 `ERR_MODULE_NOT_FOUND`。必须用 tgz。
