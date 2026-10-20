# 发布前先读这里

`dsh-model-switches` 已准备好，**只差两个凭据**（本机没有任何可用的 npm / GitHub 凭据，
命令行拿不到浏览器里的登录状态）。

## 一、npm 发布

```powershell
cd D:\workspace\dsh-model-switches

# 1. 登录（浏览器会弹出授权页；或用 npm login --auth-type=web）
npm login --registry=https://registry.npmjs.org/

# 2. 确认身份
npm whoami --registry=https://registry.npmjs.org/

# 3. 发布（package.json 里已配好 publishConfig.access=public）
npm publish --registry=https://registry.npmjs.org/
```

> **注意**：你本机 `.npmrc` 的默认 registry 是 `registry.npmmirror.com`（镜像）。
> 那是**只读**镜像，不能发布，所以上面每条命令都必须带 `--registry=https://registry.npmjs.org/`。
>
> 如果 npm 报了 `EACCES`/日志写入失败，是因为 `prefix`/`cache` 指向
> `D:\Program Files\nodejs`（需要管理员权限）。加一个可写缓存即可：
> ```powershell
> $env:npm_config_cache = "$env:TEMP\npm-cache"
> ```

发布完成后验证：

```powershell
npm view dsh-model-switches version --registry=https://registry.npmjs.org/
```

发布后的安装方式（给别人用）：

```powershell
dsh plugin --profile desktop add dsh-model-switches
```

## 二、上传到 GitHub —— ✅ 已完成

仓库已创建并推送：<https://github.com/qzwjer/dsh-model-switches>

用的是本机已有的 SSH 密钥（`~/.ssh/id_rsa`），GitHub 已认可，**不需要 token**。
建仓库那一步走了 GitHub API（一次性），之后推送全走 SSH。

以后提交改动只需：

```powershell
cd D:\workspace\dsh-model-switches
git add -A
git commit -m "..."
git push          # SSH，无需认证
```

> 本机 git 直连 GitHub 会被重置，SSH 走的是另一条路所以能通；如果哪天 SSH 也不通，
> 给 git 配本地代理 `127.0.0.1:7897` 即可。

<details>
<summary>（历史记录）当初的建仓库与推送步骤</summary>

```powershell
cd D:\workspace\dsh-model-switches

# 1. 建仓库（两种方式任选）
#    A. 网页手动建：https://github.com/new ，名字填 dsh-model-switches，不要初始化 README
#    B. 有 token 的话用 API：
#       $env:GH_TOKEN = 'ghp_xxx'
#       Invoke-RestMethod -Method Post https://api.github.com/user/repos `
#         -Headers @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'dsh' } `
#         -Body (@{ name = 'dsh-model-switches'; description = 'DeepSeek Harness: per-provider and per-model switches for the model picker'; private = $false } | ConvertTo-Json)

# 2. 关联并推送（走代理）
git remote add origin https://github.com/qzwjer/dsh-model-switches.git
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push -u origin main
```

</details>

## 三、发布后收尾

1. ✅ GitHub 仓库已上线，README 已渲染；
2. 可选：打 tag `git tag v1.0.0 && git push --tags`；
3. 本机安装方式不受影响，仍可直接从 `dist\*.tgz` 装。

## 当前状态

| 项 | 状态 |
|---|---|
| 包名 | `dsh-model-switches`（npm 与 GitHub 均确认未占用） |
| 版本 | 1.0.0 |
| 本地已安装并验证 | 是（settings 命名空间 `model-visibility` 未变，已保存的开关设置保留） |
| git 仓库 | 已初始化，工作区干净 |
| `npm publish --dry-run` | ✅ 通过（7 文件 / 25.1 kB / public） |
| **GitHub 仓库与推送** | ✅ 已完成 → <https://github.com/qzwjer/dsh-model-switches> |
| npm 真实发布 | ⏳ 待你执行 `npm login` 后发布 |
