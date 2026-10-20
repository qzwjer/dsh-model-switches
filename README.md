# dsh-model-switches

为 DeepSeek Harness 的**设置 → 模型**页面增加两级「使能开关」：

1. **厂商级** —— 关闭某个厂商后，它的模型整体不出现在对话框的模型选择器里；
2. **模型级** —— 点开某厂商的「编辑 → 自定义设置 → 模型目录」，可以逐个关闭其中某一个模型，
   该厂商的其它模型不受影响。

> 仓库：<https://github.com/qzwjer/dsh-model-switches>
> 安装：`dsh plugin --profile desktop add D:\path\to\dsh-model-switches-1.0.0.tgz`
> （换机详见 [INSTALL-other-machine.md](./INSTALL-other-machine.md)）

## 它做了什么

| | | |
|---|---|---|
| 厂商开关 | 设置 → 模型：每张厂商卡片右上角，「编辑 / 删除」**同一行**末尾 | 关闭后整个厂商分组消失 |
| 模型开关 | 编辑 → 自定义设置 → 模型目录：每个模型行右侧 | 关闭后仅该模型消失 |
| 作用范围 | **仅影响目录/选择**。已选中该模型、正在运行的会话不会被中断（路由路径不经过目录） |
| 持久化 | 写入当前 profile 的 `cordis.patch.yml`，重启后仍在 |
| 生效时机 | 即时。切换后下一次打开模型选择器即生效，无需重启 dsh |

> **两级是独立的**：厂商开关控制整组，模型开关控制单条。把某厂商的**全部**模型逐个关掉
> 会被 host 忽略（否则厂商会静默变空）——要整组隐藏请用厂商开关。

## 安装

```sh
dsh plugin --profile <profile> add <path-to-tgz>
```

**换到另一台电脑**请照 [`INSTALL-other-machine.md`](./INSTALL-other-machine.md) 做——只需要拷
那一个 `.tgz`，不用带源码或 `node_modules`。

> **必须用 tgz，不要用 `link:`。** `link:` 会让 Node 从被链接的源目录解析依赖，而源目录
> 没有 `@deepseek-ai/schemastery`，插件会在加载时 `ERR_MODULE_NOT_FOUND`。
>
> **`@deepseek-ai/schemastery` 必须是 `dependencies`，不能是 `peerDependencies`。**
> 早期版本把它写成 peer，于是在**干净的 profile**（没装其它 DSH 插件）里 pnpm 不会安装它，
> 插件加载即失败——本机能跑只是因为别的插件恰好把它带了进来。1.0.0 起改为真实依赖，
> 已在空 profile 上验证可独立安装并加载。
>
> **`engines.dsh` 声明了兼容范围**（`>=0.2.0 <0.3.0`）。DSH 版本不匹配时，安装后会被
> profile 启动拒绝并给出提示，而不是静默失效。

## 兼容性

| 项 | 值 |
|---|---|
| `engines.dsh` | `>=0.2.0 <0.3.0` |
| 已在 | `@deepseek-ai/dsh` 0.2.1-rc.2 上验证 |

握手点都来自 DSH 的公开/稳定结构：`settings.describe` / `settings.mutate` 的 RPC 形状、
`settings.models.provider-card` 插槽、`LlmRuntime.listModels`。若未来 DSH 改了这些，
插件会退化为「开关不出现」或「开关无效」，不会损坏数据。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-model-switches
```

`cordis.patch.yml` 里可能残留一行 `model-visibility`，删掉即可。

## 工作原理（一句话版）

Host 侧在 `LlmRuntime.listModels()` 上装一个过滤器：被关闭的 provider 返回 `[]`；
DSH 的 `buildModelCatalog()` 会丢弃空分组，于是两个模型选择入口同时看不到它。
选择校验（`modelAvailable`）同样走 `listModels`，所以被隐藏的模型也无法被新选中。

细节、验证记录与已知限制见 [`NOTES-host.md`](./NOTES-host.md) 与 [`NOTES-client.md`](./NOTES-client.md)。

## 开关的位置是怎么实现的

Models 页只开放三个扩展位（`provider-card` / `sign-in` / `footer`），**没有**操作位插槽，
所以开关无法通过插槽直接排进「编辑 / 删除」那一行。做法是：

1. 组件在插槽里渲染一个 `display:none` 的锚点；
2. `useLayoutEffect` 顺 DOM 结构向上找到卡片的 `<li>`，取其**第一个非插槽子元素**
   （卡片头部行），再取该行的**最后一个元素子节点**——就是「编辑 / 删除」按钮组；
3. 在该按钮组末尾插入 `.dmv_mount`，用 `react-dom` 的 `createPortal` 把开关渲染进去。

不匹配任何 CSS-module 哈希类名（那些会在 DSH 升级后变化），只依赖页面自身定义的
结构关系；找不到就安全回退成原来的一行式布局，不会报错或吞掉开关。

> **踩过的坑**：第一版用 `getComputedStyle(el).marginLeft === 'auto'` 来识别操作行。
> 这在 jsdom 里成立，但**真实浏览器里 `getComputedStyle` 返回的是解析后的像素值**
> （实测 `369.953px`），永远不会等于 `"auto"`，于是线上一直走回退分支——开关留在
> 第二行。定位逻辑因此改为纯结构判断，不再读取计算样式。
>
> 这也说明：**布局类逻辑不能只靠 jsdom 验证**，必须用真实浏览器（本项目用 headless
> Chrome + CDP）确认。

### 模型级开关

「编辑」面板同样**没有**扩展插槽，模型行也是靠结构定位的：找到 `section[aria-label]`
里那些「末尾是按钮、且含文本框」的 `div`，在每个后面挂一个 `.dmv_modelMount`，再 portal 进去。

这里有两个真实的坑：

1. **自我破坏的循环**：挂载点被 append 到行末后，该行的 `lastElementChild` 不再是按钮，
   于是下一轮扫描「认不出」这一行、报告 0 行，把刚建好的开关又拆掉——表现为开关闪一下
   就消失。修法是判定时先剔除 `dmv_modelMount` 再取最后一个真子元素。
2. **网格换行**：模型行是 `grid-template-columns: minmax(0,1.4fr) minmax(0,1fr) auto auto`
   （id / 名称 / 选项 / 删除），挂载点是第 5 个子元素，不加列就会掉到第二行。
   用 `div:has(> .dmv_modelMount)` 补一列即可——但**必须带 `!important`**：最初写成
   `:where(...)`，而 `:where()` 的特异性为 0，被页面自己的 `.hash_modelRow` 压过，规则
   根本没生效。

## 性能与闪烁（0.4.x）

针对「启动后一会儿才显示」「点开关时内容短暂消失」做过三轮处理：

| 处理 | 原因 | 效果 |
|---|---|---|
| 自身写入的 echo 不再重读 | 每次 `settings.mutate` 都会回推 `settings/document-updated`，插件原先会在回推时再 `describe()` 一次并重新发布状态 | 省掉一次往返，且不再多余重渲染 |
| 状态不变则不发布 | 快照内容（hidden / hiddenModels / revision）没变时 `store.set` 直接返回 | 卡片不再因无关刷新而重渲染 |
| 首次读取改为惰性 | 原先在插件激活时就 `describe()`，而 Models 页自己也会 `describe()`；整份设置文档被读两遍 | 不进「设置 → 模型」就完全不发请求 |
| 修正 hook 顺序 | `route === undefined` 的提前 return 曾位于 8 个 hook **之前**，违反 React 规则 | 消除潜在崩溃/错乱渲染 |

实测（headless Chrome + CDP，真实 GUI）：点击一次厂商开关，**0 次** dmv 节点被摘除、
**0 帧**出现卡片为空。

### 「启动后要等一会」主要是核心页面的开销，不是本插件

测量 `/api/session/modelCatalog`：返回 **17 个厂商、645 个模型**，首次约 **385ms**，
之后仍约 200ms；整页加载期该请求出现过两次（约 700ms 那两次是并行发出的）。
本插件**不调用** `modelCatalog`，也不在启动时读设置（0.4.1 起），所以这段等待来自
DSH 自身的目录聚合。插件能做的只是不往里再加一笔。

## 已知限制

关闭某个厂商时，**如果某个会话当前正选着该厂商的模型**，那个会话的输入框会变灰，
直到切换到别的模型。这是过滤目录的固有结果（DSH 客户端用目录成员判断
`routable`），不是本插件的 bug。开关旁的提示文案已说明这一点。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半身：`Config`（`hiddenProviders` + `hiddenModels`，均 volatile）+ `listModels` 过滤器 |
| `client.js` | 浏览器半身：注册到 `settings.models.provider-card`，用 portal 把厂商开关放进操作行、把模型开关放进每个模型行 |
| `cordis.patch.yml` | bundle 补丁，插入 `id: model-visibility` 一行 |
| `package.json` | bundle + `dsh.client` 声明 + `engines.dsh` 兼容范围 |
| `dist/*.tgz` | 分发包（**只把这个拷到别的电脑**） |
| `INSTALL-other-machine.md` | 换机安装步骤 |
| `NOTES-host.md` / `NOTES-client.md` | 两个半身的设计与验证记录 |

## 构建

```powershell
# 在本目录执行
pnpm pack --pack-destination dist
```

产物落在 `dist/`，只有 6 个文件、约 23KB，**不含** `node_modules`。

安装到本机：

```powershell
& 'D:\software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' `
  plugin --profile desktop add 'D:\workspace\dsh-model-switches\dist\dsh-model-switches-1.0.0.tgz'
```

> 升级时把 `package.json` 的 `version` 改掉再重新 `add`。**同版本号重装不会刷新内容**
> （pnpm 会命中缓存），必须升版本。
