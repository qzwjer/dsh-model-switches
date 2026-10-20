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

## 二、上传到 GitHub

本机 git 直连 GitHub 会被重置，需要经本地代理 `127.0.0.1:7897`。

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

推送时会要求认证：用 **Personal Access Token**（Settings → Developer settings →
Personal access tokens → Fine-grained tokens，勾 `Contents: Read and write`）
作为密码，用户名填 `qzwjer`。

想避免每次输入：

```powershell
git config --global credential.helper manager   # Git Credential Manager，会弹登录窗口
```

## 三、发布后收尾

1. 在 GitHub 仓库页面确认 README 渲染正常；
2. 可选：`gh release create v1.0.0` 打 tag；
3. 本机安装方式不受影响，仍可直接从 `dist\*.tgz` 装。

## 当前状态

| 项 | 状态 |
|---|---|
| 包名 | `dsh-model-switches`（npm 与 GitHub 均确认未占用） |
| 版本 | 1.0.0 |
| 本地已安装并验证 | 是（settings 命名空间 `model-visibility` 未变，已保存的开关设置保留） |
| git 仓库 | 已初始化，2 个提交，工作区干净 |
| `npm publish --dry-run` | 通过（7 文件 / 25.1 kB / public） |
| npm 真实发布 | **待你登录** |
| GitHub 推送 | **待你建仓库 + token** |
