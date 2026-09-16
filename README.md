# dsh-webui-oauth

[English](README.en.md) | 中文

DSH WebUI 身份认证插件（持久化插件）。在「设置 → 身份认证」或首次访问登录页创建账号密码后，**未认证的浏览器无法加载 WebUI 的任何资源、调用任何接口或建立任何实时连接**——认证在 HTTP/传输层强制执行，不可通过浏览器开发者工具绕过。支持本地账号密码与 **OIDC/SSO 单点登录**两种方式。

> **本插件是 [Yuuz12/dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth) 的增强替代版**（新增 OIDC SSO 等）。若两者同时安装，**本插件启动时会主动停用原版**（见「与原版的关系」），不会出现双闸门；凭据与数据目录沿用原版位置，**原有账号与登录会话继续有效**。

## 与原版的关系（自动顶掉原版）

原版 `dsh-webui-auth` 与本插件都通过运行时包装 `webServer` 路由实现认证。若两套闸门同时存活，同一请求会被两套会话各校验一次，且登录态互不相认（在一个闸门登录后，另一个仍返回 302/401），表现为「登录后反复跳转」。

因此本插件在启动时（安装自己的闸门之前）会遍历 cordis 插件注册表，按插件名找到已加载的原版并 **dispose 掉它的全部 fiber**。原版自身是可逆设计，卸载后其路由包装与端点注册会被完整撤销，随后由本插件接管全部闸门。宿主日志会出现：

```
[dsh-webui-oauth] displaced original plugin(s): dsh-webui-auth — this plugin takes over the auth gate; credentials/data directory are shared.
```

- **只按插件名匹配**，不会影响任何其他插件；找不到原版时静默继续。
- **数据无缝衔接**：数据目录（`.dsh-webui-auth/`）与凭据文件（`dsh-webui-auth.json`）**刻意沿用原名**，原版创建的账号无需迁移即可登录。
- **接管原版数据目录**：当本插件自身尚无凭据时，会依次查找含凭据的原版数据目录并**直接复用**（不是复制——复制会产生两份凭据，改密码只改一边而分叉）：
  1. 同级目录 `../dsh-webui-auth/`（源码 / `link:` 安装最常见）；
  2. `$DSH_HOME/dsh-webui-auth/`（原版的兜底位置）。
  两处都没有则用自己的目录（全新安装，走 setup token）。**自身已有凭据时一律不接管**，避免覆盖你已在新插件里建立的数据。
- **OIDC 配置独立存放**：账号凭据留在 `dsh-webui-auth.json`，OIDC 配置（含 `clientSecret`）写入本插件自己的 `dsh-webui-oauth.json`；旧版曾把 `oidc` 段写在凭据文件里，读取时自动回落、保存时自动迁移。
- 卸载原版、只留本插件同样正常工作。

## 架构

认证由四层组成，全部通过**运行时包装 webServer 路由**实现，**不改动任何 DSH 核心包源码**：

| 层 | 机制 | 未认证行为 |
|---|---|---|
| WebUI 资源（index.html、/assets/*、SPA 路由） | 插件注册 `prefix ''` 兜底路由，校验会话后转交 frontend-static | 302 → 登录页 |
| 插件 bundle（/plugins/*） | 运行时包装 `/plugins` 前缀路由 handler | 401 |
| /api RPC 接口 | 运行时包装 `/api` 前缀路由 handler | 401 |
| WebSocket（`/api/remote.mux`；旧核心 `/api/events.mux`、`/api/events.host`） | 运行时包装 upgrade 路由 handler | 401 拒绝升级 |

- **不修改核心包**：dsh 升级不会覆盖补丁、不会产生「升级后 /api 裸奔」的窗口。插件每次启动对路由表重做包装，并用 2s→10s 重扫捕获晚注册路由。**v0.1.2-alpha.2 及更新核心的事件流 WebSocket 位于 `/api/remote.mux`（由 dsh-api-gateway 注册），候选列表自动适配，不再误报「upgrade 路由缺失」。**
- **fail-closed**：若预期路由缺失（dsh 内部结构变化导致包装不上），`setup`/`configure` 会**拒绝启用认证**，并在宿主日志与设置页同时报错——宁可不可用，不可「开了登录却裸奔 /api」。
- **与核心自带浏览器认证（v0.1.2-alpha.2+）协作**：该版本核心自带 launch-token 交换的签名 Cookie（`dsh-auth-*`）认证 `/` 与 `/api`。插件登录成功后自动把浏览器引导到核心的带 token 根 URL 完成核心 Cookie 交换；`/api` 请求在插件会话校验后**原样转交**给核心（不再改写 Host/Origin，避免破坏核心 Cookie 与 Host 绑定）。两者叠加：浏览器须同时持有插件会话 Cookie 与核心 Cookie。
- **反代/局域网旧核心下的特权方法**（≤alpha.1）：已认证请求由插件在会话校验后以「回环形状」转交核心，使核心中**回环钉死的特权方法**（settings/credentials/agentPreset/llm.discoverModels）在反代部署下可用——会话 Cookie 闸门是比 Host 启发式更强的身份证明。
- **WebSocket 与 trustedHosts**：WS 升级握手仍受核心自身 `requestRejection` / `isTrustedApiRequest` 限制，因此**反代/局域网（非回环 Host）部署下，WS 下行需要同时在 dsh 配置中把对外域名加入 `client-connection.trustedHosts`**，否则即使已登录也会被拒绝升级。
- **跳转目标：动态 vs 绝对（统一开关，0.4.1）**：有两处跳转会用到**请求方（浏览器）提供的 origin**——① OIDC 回调 base（登录页上报 `location.origin`）；② 登录成功后交给核心的 token 跳转（authority 取自请求 `Host`）。两处**共用同一个开关**，配置在 dsh settings 的 `remote-web-ui` 段（部署级）：
  ```yaml
  remote-web-ui:
    publicBaseUrl: 'https://dsh.example.com'   # 绝对跳转的目标（可选）
    trustBrowserOrigin: true                   # 省略即按 true：动态跳转
  ```
  - **`trustBrowserOrigin: true`（默认）= 动态跳转**：跳转目标随本次请求的实际地址走（反代透传的 Host，或反代下发的 `X-Forwarded-Host`）。适配「同一份配置服务多个入口」。
  - **`trustBrowserOrigin: false` = 绝对跳转**：一律用 `publicBaseUrl`，忽略请求里的地址。
  - 旧配置 `oidc.trustBrowserOrigin` 仍被接受：settings 段未显式配置时回退它，便于已有部署平滑升级。

  **判定顺序（重要：回环兜底会绕过开关）**：

  | 序 | 条件 | 结果 |
  |---|---|---|
  | 1 | 反代下发了原始主机头（`X-Forwarded-Host` / `Forwarded: host=`） | **按开关**：开 → 用该头；关 → 用 `publicBaseUrl` |
  | 2 | 否则 Host 是回环/本机（`127.0.0.1`、`::1`、`localhost`、`0.0.0.0`） | **恒用 `publicBaseUrl`（不听开关）** |
  | 3 | 否则（Host 已透传真实地址） | **按开关**：开 → 用请求 Host；关 → 用 `publicBaseUrl` |

  第 2 行是**动态跳转不可用时的兜底**，不是第二个开关：Host 被改写成回环时，服务端从请求里**拿不到**任何浏览器侧地址，开关即使开着也没有可用值，只能回退 `publicBaseUrl`（该值来自 `settings.yaml`，运维可控、非攻击者可控，不构成开放重定向）。

  **端口规则**：端口**只来自被选中那一方的字面**，不做任何补全。
  - 动态路径：端口取自 Host / 原始主机头。不带端口就不带（浏览器按 scheme 推 443）。
  - 绝对路径：端口取自 `publicBaseUrl`。**CDN 仅在 443 对外时应写不带端口**（`https://dsh.example.com`）；写成 `:8443` 会让浏览器去撞 8443。
  - `publicBaseUrl` 里的端口**只参与同源比对**（见下条），不会被注入到动态路径的跳转目标里。

  **已知取舍**：本机浏览器直连 `http://127.0.0.1:3080` 也落进第 2 行，于是开关开着也会跳 `publicBaseUrl`。要同时支持本机直连，只能让反代下发 `X-Forwarded-Host`（走第 1 行）。
- **登录后跳转的协议自适应（0.3.3，修 #6 / #7）**：插件登录成功后要把浏览器引导到核心的带 token 根地址，其 **authority 取自本次请求的 Host**（不再写死 `127.0.0.1`），**scheme 按请求实际协议解析**，优先级：① 操作者显式声明 `remote-web-ui.publicBaseUrl`（**仅当其 host/port 与本次请求 Host 一致时**采信——否则局域网直连会被重定向到公网地址、跨源丢掉刚下发的会话 Cookie）；② 标准代理头 `X-Forwarded-Proto`（取最左值）或 RFC 7239 `Forwarded: proto=`；③ socket 自身是 TLS（插件直接终结 TLS）；④ 兜底 `http`。**刻意不做「非 IP 域名即 https」的猜测**——那会把纯 http 的内网域名访问（`http://nas.local:3080`）打成 https 死链。前端登录页另有一层单向兜底：页面在 https 下收到**同源** `http://` 跳转时自动升级为 `https://`（反向不降级、异源不改写）。
- **可选 OIDC 单点登录（0.4.0）**：标准 OIDC 授权码 + PKCE（机密客户端，须 `client_secret`），以 Logto 为安全基准。配置后登录页出现「SSO 单点登录」按钮，认证通过后以 IdP 的 `sub` 建立本地会话（沿用会话有效期与持久化）。**redirect_uri 的 base 由 `oidc.redirectBase` 决定；默认交由浏览器处理（采信前端 `location.origin`，反代重写 Host 时浏览器看到的公网地址即正确），受上面统一开关约束；关闭时仅用配置的 `redirectBase`；两者都不可用则 fail-closed 报错。** 支持 RSA/EC/EdDSA 签名的 id_token 验证（JWKS + iss/aud/exp/iat/nbf/nonce 校验），简单版登出（仅清本地会话）。

会话为**服务端会话，持久化到磁盘**（`sessions.jsonl`，重启 DSH 不掉线，到期自动失效），由 `HttpOnly; SameSite=Lax` Cookie（`dsh_wua_session`）携带，JS 无法读取；修改密码会**吊销所有其他会话**。

## 安装

本插件是标准**组合包（bundle）**，推荐用 DSH 官方 `plugin` 命令安装；手动方式保留作备用。前提：机器上有 pnpm（Node 自带 corepack，执行 `corepack enable pnpm` 即可启用）。

### 方式一：GitHub 安装（推荐）

```sh
npx @deepseek-ai/dsh plugin --profile web add github:WU-HINS/dsh-webui-oauth
```

拉取仓库源码（纯 JS 包，直接可用，无需构建步骤）。

### 方式二：npm 安装

> 需要该包已发布到 npm registry。若 `dsh-webui-oauth` 尚未发布，请使用方式一。

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-webui-oauth
```

从 npm registry 拉取，加入依赖并追加到 `dsh.profile.bundles` 列表，插件行随组合包层自动插入。

> 若你此前装的是原版 `github:Yuuz12/dsh-webui-auth`，可以直接改装本仓库——本插件会自动顶掉原版并沿用原数据目录，账号无需重建。

### 方式三：手动（备用）

1. 将 `dsh-webui-oauth` 目录放入 `profiles/web/node_modules/`
2. 在 `profiles/web/cordis.patch.yml` 的 `insert` 列表中加一行：

```yaml
    - id: dsh-webui-oauth
      name: 'dsh-webui-oauth'
```

> 维护者开发模式：在本地源码目录使用 `dsh plugin --profile web add ./dsh-webui-oauth`（`link:` 安装），改代码 → 重启 DSH 即生效，无需重新安装。

### 所有方式通用

安装后**无需任何核心包补丁**（无 `[dsh-webui-auth patch]` 标记、不改 `node_modules`），重启 DSH 即生效。插件启动时在宿主日志打印 `[dsh-webui-oauth] started, credentials file: ...`；若路由包装不完整会打印 `ROUTE GATE INCOMPLETE`，此时认证无法启用（fail-closed）。

## 卸载

### 方式一：`dsh plugin` 命令（对应方式一安装）

1. `npx @deepseek-ai/dsh plugin --profile web remove dsh-webui-oauth`（同时移除依赖与组合包层）
2. 重启 DSH

### 方式二：手动（对应方式二安装）

1. 删除插件目录 `profiles/web/node_modules/dsh-webui-oauth/`（0.3.1 起运行数据在包外，删它不影响账号；如需连账号一起清除，另删数据目录 `.dsh-webui-auth/`，见「数据文件位置」）
2. 从 `profiles/web/cordis.patch.yml` 移除挂载行：

```yaml
    - id: dsh-webui-oauth
      name: 'dsh-webui-oauth'
```

   此步必须做，否则重启时加载器找不到插件包会报错
3. 重启 DSH

两种方式重启后认证门禁完全关闭（**无需恢复任何核心包源码**——插件从未修改核心文件）。如需清除持久化会话，删除数据目录中的 `sessions.jsonl` 即可；如曾用旧版插件，可清除浏览器 localStorage 中的 `dsh-webui-auth.session` 残留（无害）。

## 使用

- **首次启用（需 setup token）**：未配置凭据时认证自动关闭（所有请求放行），但创建管理员账号需要**本次启动生成的 setup token**——打开 WebUI → 设置 → 身份认证，或访问 `/dsh-webui-oauth/login`，输入启动日志中打印的 `[dsh-webui-oauth] setup token (...)`（或数据目录 `setup-token` 文件内容，0600）后创建账号密码（≥8 位，含大小写字母、数字、特殊符号）。token 每次启动重新生成、创建成功后即删除，防止「先暴露、后配置」窗口内被他人抢先注册。
- **用户名规则**：3-32 位字母、数字、下划线或连字符（新建/修改时强制；旧账号不受影响，仍可正常登录）。
- **之后**：未登录访问任意路径 → 跳转登录页；登录后按「会话有效期」免登录（浏览器会话 / 1 小时 / 12 小时（默认）/ 1 天 / 3 天），服务端按到期时间强制失效。**会话持久化到磁盘，重启 DSH 后已登录设备无需重新登录**（到期时间仍生效）。「浏览器会话」模式：活跃使用期间自动续期（30 分钟窗口），关闭浏览器即失效。
- **修改 / 禁用 / 退出**：设置 → 身份认证（均需当前密码）；修改密码会吊销其他所有已登录会话。
- **忘记密码**：删除数据目录的 `dsh-webui-auth.json` 即可——后台每分钟自动检测，最多 1 分钟内认证自动关闭（无需重启），之后用新的 setup token 重新创建账号即可。
- **OIDC 单点登录（可选）**：设置 → 身份认证 → 勾选「启用 OIDC 单点登录」，填写 Issuer（IdP 地址，须 https）、Client ID、Client Secret（机密客户端必填）、Scope、Redirect Base（可选）。保存后登录页出现「SSO 单点登录」按钮：点按后跳转 IdP 授权，回调中插件验证 state/nonce/PKCE/签名后建立本地会话（用户名 = IdP `sub`）。**redirect_uri 的 base**：`trustBrowserOrigin` 默认开启时采信浏览器 `location.origin`（反代重写 Host 时正确）；关闭时仅用 `redirectBase`；两者皆无则报错不跳转。**反代重写 Host 场景请配置 `redirectBase`**（部署者已知对外真实地址，是唯一不受反代影响的确定性答案）。登出为简单版：仅清本地会话，不调 IdP 单点登出。

## 数据文件位置（按安装方式区分）

凭据与安全数据存放在**运行时数据目录**，按安装方式自动选择：

- **npm / GitHub / tarball 安装**：插件包体位于 `node_modules` 内，会随升级、重装、清理被整目录替换——数据因此存放在**该 `node_modules` 的上级目录**下的 `.dsh-webui-auth/`（通常即 profile 根，如 `~/.dsh/profiles/web/.dsh-webui-auth/`）。升级插件、`pnpm clean`、重装 DSH 都不会丢失账号密码与登录会话。
- **本地 link / 源码安装**：为插件源码目录（随仓库管理、已被 `.gitignore` 排除出 git；删除整个源码目录才会连数据一起清除）。
- **兜底**：以上位置均不可写时回退到 `$DSH_HOME/dsh-webui-auth/`（默认 `~/.dsh/dsh-webui-auth/`）。

从 0.3.x 升级：运行数据**不自动迁移**。若旧位置（包内目录或 `~/.dsh/dsh-webui-auth/`）的数据还在，可把下表中的 `dsh-webui-auth.json`、`sessions.jsonl`、`audit-hmac-key`、`audit.jsonl` 手动拷入新数据目录（npm / GitHub / tarball 安装即 `node_modules` 上级的 `.dsh-webui-auth/`）；否则按「忘记密码」流程用新 setup token 重建账号即可。

目录内文件：

| 文件 | 用途 | 权限 |
|---|---|---|
| `dsh-webui-auth.json` | **账号凭据**（scrypt 哈希，v3 格式；0.2.x 的 v2 凭据仍可正常登录校验）。文件名沿用原版，保证升级不丢账号 | — |
| `dsh-webui-oauth.json` | **本插件独有配置**（OIDC 段：`issuer` / `clientId` / `clientSecret` / `scope` / `redirectBase` / `trustBrowserOrigin`）。独立成文件，避免 OIDC 密钥与账号凭据混在一起 | — |
| `audit.jsonl` | 审计日志（IP 已假名化，见「审计日志」节） | — |
| `sessions.jsonl` | 持久化会话（重启恢复用） | 0600 |
| `audit-hmac-key` | 审计 IP 假名化的 HMAC 密钥（首次自动生成） | 0600 |
| `setup-token` | 首次初始化的 setup token（创建成功后删除） | 0600 |

数据目录由安装方式决定（npm / GitHub / tarball → `node_modules` 上级的 `.dsh-webui-auth/`；link / 源码 → 插件源码目录；兜底 `$DSH_HOME/dsh-webui-auth/`），忘记密码、审计、会话路径均指该目录。也可用环境变量 `DSH_WEBUI_AUTH_DATA_DIR` 显式指定数据目录（容器 / 只读包体等部署适用）。

> **从旧版升级（OIDC 配置布局变更）**：早期版本把 `oidc` 段写在 `dsh-webui-auth.json` 里，现在改由 `dsh-webui-oauth.json` 承载。读取时**仍会回落到旧位置**（无感升级），并在你下次于设置页保存时自动迁移到新文件、同时从凭据文件剥离旧字段。

## 审计日志

登录成功/失败/限流、初始化、修改凭据、禁用、退出等安全事件**追加写入数据目录的 `audit.jsonl`**（JSONL 格式，含时间、用户名、IP、UA、详情）。**客户端 IP 以 HMAC-SHA256 假名化存储**（形如 `hmac:5151e752|203.0.113.0/24`，附 /24（IPv4）或 /64（IPv6）网络前缀用于聚合分析），原始 IP 不落盘。两种查看方式：

- **CLI**（推荐）：运行 `node index.js audit [--limit N]`（默认最近 20 条，从模块所在路径运行即可）：
  ```sh
  node index.js audit --limit 50
  ```
- **设置页**：设置 → 身份认证 → 「最近登录记录」展示最近 8 条。

审计写入失败不影响认证主流程（仅记宿主日志）。

## 外观

登录页与「设置 → 身份认证」设置页都跟随 DSH **自带的外观设置**（设置 → 通用 → 外观：浅色 / 深色 / 跟随系统），不提供独立的外观开关。设置页运行在 WebUI 内，直接消费 DSH 的主题 token，天然随明暗切换；登录页是独立页面，由服务端读取当前外观偏好（settings `ui-theme.preference`）注入页面，并复刻 DSH 的 boot 逻辑：`跟随系统` 时按 `prefers-color-scheme` 解析、系统明暗切换时实时变化。登录页响应带 `cache-control: no-store`，外观变更后刷新即可生效。

## 升级 DSH 后的操作流程

**无需任何操作**：插件不修改核心包，dsh 升级后启动时自动重做路由包装。**v0.1.2-alpha.2 及更新核心**：插件自动适配 `/api/remote.mux` 事件流路由，并与核心自带浏览器认证（launch-token ↔ 签名 Cookie）协作——登录插件后浏览器会被自动引导完成核心认证，随后 WebUI 正常使用。若包装不完整（dsh 内部结构变化），宿主日志输出 `ROUTE GATE INCOMPLETE`、设置页显示红色警告，且 `setup`/`configure` 拒绝启用认证（fail-closed）。

> **注意（v0.1.2-alpha.2+）**：核心自带浏览器认证要求浏览器先通过 launch-token 换取核心 Cookie（`dsh web` / DSH Desktop 打印的带 `?token=` 的地址）。插件已自动处理该交换；如浏览器此前从未访问过该地址，请使用 DSH 启动时打印的完整 URL 打开一次（或从插件登录页登录，流程会自动完成交换）。

## 数据与安全

- 密码以 **scrypt**（Node 内置内存硬 KDF，抗 GPU/ASIC 爆破，零依赖）哈希保存在数据目录的 `dsh-webui-auth.json`，明文不落盘。凭据格式 v3（与 v2 同为 scrypt 编码，仅版本标记与字段语义不同）；0.2.x 的 v2 凭据仍可校验登录。**0.1.x 的 SHA-256 凭据自 0.2.0 起不再可校验**，需删除凭据文件后重新创建账号（见「忘记密码」）。
- 登录失败限流：**按客户端 IP** 每分钟最多 5 次——单个攻击者无法锁死其他用户（操作者）。反代场景下客户端 IP 取自 `CF-Connecting-IP` / `X-Forwarded-For` 最左侧，且**仅当对端 socket 是回环**（本机 caddy/cloudflared）时才信任代理头，远程无法伪造；校验失败时还会空跑一次 scrypt，抹平「账号不存在=响应快」的用户名枚举时序差异。
- 首次初始化需要每启动生成的 **setup token**（128-bit，打印到宿主日志并写入数据目录 `setup-token`，0600），防止「先暴露、后配置」被抢占。
- 审计日志：`audit.jsonl`，客户端 IP 以 HMAC 假名化存储（见「审计日志」节）。
- 会话持久化：`sessions.jsonl`（0600），重启恢复；写失败时认证不受影响，设置页提示重启后需重新登录。
- 登录页与 API 响应均带安全头：严格 CSP、`nosniff`、`DENY` 防嵌框、`no-referrer`、`noindex`、`no-store`。
- Cookie `HttpOnly + SameSite=Lax`：JS 不可读、跨站请求不携带。
- 登录/初始化端点本身公开（认证的必然入口）：`/dsh-webui-oauth/login`、`/dsh-webui-oauth/setup`（后者受 setup token 保护）。
- **OIDC 单点登录**：authorization_code + PKCE + client_secret（机密客户端，不做纯 PKCE public client）；state 防 CSRF、nonce 防重放、redirect_uri 精确匹配（base + 固定路径）、id_token 经 JWKS 验签并校验 iss/aud/azp/exp/iat/nbf/nonce、仅接受 HTTPS 端点；审计只记录经 `sanitizeSub` 过滤的 `sub`。OIDC 客户端配置（含 secret）存于数据目录的 `dsh-webui-oauth.json`，与账号凭据分离。

## 已知边界

- **运行时包装的固有窗口**：路由对象被替换（服务热重载）到下一次重扫之间（≤10s）存在未保护窗口；启用认证时的 fail-closed 已挡住「初始裸奔」，此窗口仅影响运行中的热重载场景。
- **WS 与 trustedHosts**：反代/局域网（非回环 Host）下，WS 下行需在 dsh 配置 `client-connection.trustedHosts` 中加入对外域名（见「架构」节）。
- **反代不同机**：若反代与 DSH 不在同一台机器（对端非回环），代理头不被信任，限流将按代理 IP 聚合（退化为全局桶）。
- **HTTPS 反代且未下发协议头**：登录后跳转的 scheme 依赖 ①`remote-web-ui.publicBaseUrl` 或 ②反代下发的 `X-Forwarded-Proto`/`Forwarded`。两者都没有时只能兜底 `http`（此时 https 端口会握手失败、页面「点了没反应」）。请二选一：在 `settings.yaml` 声明对外地址，或让反代 `proxy_set_header X-Forwarded-Proto $scheme;`。注意 `publicBaseUrl` 仅在与请求 Host 一致时生效，用来避免把局域网直连改写到公网。
- **`--trusted-host` 不能省**：桌面浏览器用密码登录后**直连 `/api`** 的请求依赖 `--trusted-host <对外域名:端口>`；而 remote-web-ui 的配对流（`/remote` 通道）不需要它。删掉该参数会导致 `/api` 全 403。
- **审计假名化的边界**：HMAC 密钥与审计日志同目录（0600），能读取密钥文件的本地攻击者可对 IP 空间暴力还原；假名化防的是「日志明文落盘」，不是防有文件权限的攻击者。
- 会话存于数据目录 `sessions.jsonl`：重启后仍生效（到期时间不变）；关闭/卸载插件不影响凭据。
- 威胁模型为「浏览器/网络客户端」：能直接读写宿主进程内存或文件的本地进程不在防护范围内。
