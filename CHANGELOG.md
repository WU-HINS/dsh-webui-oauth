# 变更记录

本文件记录每个版本的**用户可见**变更。破坏性变更与升级动作单独标注。

## 0.7.9

「概览」卡片新增**「吊销所有浏览器会话」**按钮。

### 新增：吊销所有其他浏览器会话

- 位置：设置 → 身份认证 → 概览（与保存/退出/禁用并列）；
- 与保存/禁用共用验证弹窗：当前密码，或 2 分钟内的 SSO 复验；
- 服务端端点 `POST /dsh-webui-oauth/sessions/revoke`（要求会话）：
  - 校验通过后调用 `deleteAllExcept(当前会话)`；
  - **保留发起请求的当前会话**，避免点一下把自己踢回登录页；
  - 返回被吊销的会话数，审计记录 `sessions_revoked`；
  - 成功后清除会话复验时间戳（一次性）；
- 想连当前会话一起退出，用「退出登录」。

### 测试

- `test/lifecycle.test.mjs` 新增 6 项：错误密码拒绝、吊销成功且
  `revoked >= 1`、其他会话 401、当前会话仍 200；
- 全量 23 个测试文件、629 项断言通过。

## 0.7.8

SSO 复验改为**新窗口 + 等待状态**；设置页做了一轮视觉打磨。

### 调整：SSO 验证另开窗口，设置页显示「等待验证」

- 弹窗里的「使用 SSO 验证」不再整页跳转，改为 `window.open` 打开独立窗口
  （`/dsh-webui-oauth/oidc/reauth?popup=1`）；设置页保持打开并显示
  「等待验证…请在打开的窗口中完成 SSO 登录」；
- 复验回调（仍走统一的 `/oidc/callback`）在弹窗模式下返回一个
  **自我关闭的 HTML 页**：`postMessage({type:'dsh-wua-reauth'})` 通知设置页，
  随后 `window.close()`，不把整个应用加载进小窗口；
- 设置页同时监听 message 并每 2 秒轮询 `status.reauthActive` 兜底；
  验证成功后弹窗内即可直接保存；
- 弹窗被浏览器拦截时自动回退为整页跳转（原行为）。

### 视觉打磨

- 卡片：更大圆角、轻投影、hover 边框高亮、标题前品牌色竖条；
- 输入框/下拉：统一 36px 高度、聚焦光环、hover 边框；
- 按钮：主按钮填充色 + 阴影、ghost 描边、active 微下沉、disabled 降透明度；
- 提示条：成功/错误/警告统一为左侧色条 + 浅色底；
- 审计列表：行内 hover、圆角、等宽时间；
- 弹窗：背景模糊、入场动画、更大圆角；
- 窄屏（≤640px）单列布局。

### 测试

- `oidc-bind` 新增 5 项：弹窗复验回调返回 HTML、通知 opener、自我关闭、
  会话标记生效；
- **新增 `test/lifecycle.test.mjs`（19 项）**：从零凭据首次启动 → setup token
  初始化 → 密码登录 → 改配置/TTL → 禁用 → 重新启用 → 退出，完整生命周期；
- 全量 23 个测试文件、623 项断言通过。

## 0.7.7

设置页再收敛：移除冗余密码框、保存按钮移到顶部、SSO 复验改为会话级。

### 调整：账号卡片不再有「当前密码」输入框

保存/禁用已经统一走验证弹窗，账号卡片里的「当前密码」输入框是冗余的，已移除。
禁用认证改为与保存一致的流程：顶部按钮 → 弹窗验证（密码或 SSO）。

### 调整：「保存设置」从右下角悬浮改为顶部卡片按钮

- 移除右下角悬浮的「保存设置」按钮；
- 保存按钮放到「概览」卡片的操作区（与退出登录、禁用认证并列）；
- 首次初始化（未启用认证）直接保存，无需验证；
- 已启用时点击弹窗验证：当前密码，或 SSO 验证。

### 调整：SSO 复验改为**会话级**，不再签发独立令牌

- 复验回调仍走统一的 `/dsh-webui-oauth/oidc/callback`；
- 发起复验时把当前会话 token 记进 OIDC state（服务端）；
- 回调校验 sub 通过后，直接给该会话写 `reauthAt = now`（2 分钟有效），
  **不再生成令牌、也不再往 URL 里放令牌**；
- `configure` / `disable` / `oidc/unbind` 通过 `sessionReauthOk(req)` 判断；
  成功后清除 `reauthAt`（一次性）；
- `status` 回显 `reauthActive`，前端据此显示「已通过 SSO 验证」；
- 回调回执只保留 `oidcreauth=1` 状态标记。

### 测试

- `test/oidc-bind.test.mjs` 的复验用例改为会话级断言（回调只带状态标记、
  同会话无密码保存成功、复验不可重放）；
- 全量 22 个测试文件、599 项断言通过。

## 0.7.6

把 DeepSeek 登录回调输入**合并进官方「等待登录」对话框**，不再单独占一个悬浮入口。

### 调整：回调粘贴框内联到等待登录窗口

- 官方账号登录的 `SignInDialog` 在等待浏览器时显示固定文案
  （「没有自动打开新页面？」/「Page did not open automatically?」）；
- 插件用 `MutationObserver` 找到这段文案，把「粘贴回调 URL」输入框注入到
  **同一个对话框**里，文案变化/对话框关闭时自动移除；
- 移除 0.7.5 的独立「DeepSeek 登录回调」悬浮按钮；
- 这是尽力而为的 DOM 适配：官方 UI 改版时最多退化成"不显示输入框"，
  不影响登录本身；`POST /dsh-webui-oauth/oauth-relay` 端点保持可用，
  也可以从控制台/其他入口调用。

### 保持不变

- 回调仍然**不公开**，中转端点要求会话；
- 输入 URL 只接受本机端口的 `/oauth/callback` + 单个 `code`/`state`；
- state/PKCE 由账号平台校验。

### 测试

- 客户端源码/回填测试通过；全量 22 个测试文件、599 项断言通过。

## 0.7.5

设置页交互修正：登录回调改成全局悬浮窗、远程信任可一键开关、保存改为右下角悬浮按钮 + 二次验证。

### 修复：登录回调中转

- **输入框缺失**：旧实现把中转窗渲染在设置页组件内部，受容器布局影响显示不全；
  现在改为在客户端插件 `apply()` 里挂**全局**悬浮组件（原生 DOM，不依赖 slot），
  输入框、按钮、提示都完整可见。
- **不再放在设置页**：右下角常驻「DeepSeek 登录回调」悬浮按钮，任何页面都能打开；
  设置页只保留说明文字。

### 新增：远程访问信任开关（不再只靠改 YAML）

- 设置 → 身份认证 → 远程访问，新增「开启 / 关闭远程访问信任」按钮；
- 新增 `POST /dsh-webui-oauth/remote-trust`（要求会话）：写入插件配置
  `dsh-webui-oauth.json` 的 `remoteTrust`，并**动态**安装/移除 index tap；
- 配置合并写入，不会覆盖 OIDC 段；
- `webServer.tapIndex` 不可用时返回 `tap-index-unavailable`，不假装成功；
- 仍兼容 settings 的 `remote-web-ui.trustRemoteHost`（手工配置优先级的兜底）。

### 新增：设置保存改为悬浮按钮 + 二次验证

- 账号卡片里的「保存账号密码」按钮已移除；
- 插件设置子页右下角常驻「保存设置」悬浮按钮；
- 点击后弹窗验证身份，再真正保存：
  - **当前密码**；或
  - **SSO 验证**：`GET /dsh-webui-oauth/oidc/reauth` 走一次 IdP 授权，
    回调签发**一次性、2 分钟**的复验令牌（不新建会话），客户端存在
    sessionStorage 并在保存时提交；
- `configure` / `disable` / `oidc/unbind` 均接受 `reauthToken` 替代密码；
- 令牌一次性、不可重放；密码路径保持不变。

### 测试

- `test/oidc-bind.test.mjs` 新增 9 项：SSO 复验全链路（发起 → 回调令牌 →
  无密码保存 → 令牌不可重放）、远程信任端点（未登录 401 / 类型校验 / tapIndex 缺失降级）；
- 全量 22 个测试文件、599 项断言通过。

## 0.7.4

修正 0.7.3 对官方 DeepSeek 登录的处理：`/oauth/callback` **不再公开**，改为
「回环回调 + 用户粘贴 + 服务端内部重放」；设置页改为卡片式布局并加入回调中转悬浮窗。

### 安全修正：/oauth/callback 不再放行匿名访问

0.7.3 把它加进公开白名单是错的：任何能访问该端点的人都可以触发一次换 token
尝试（虽然 state/PKCE 会挡，但没有必要暴露）。现在：

- `/oauth/callback` **不在** `PUBLIC_EXACT_PATHS`，仍受会话闸门保护；
- 它由账号平台在登录开始时动态注册，晚注册同样会被闸门包装（回归断言）；
- 闸门包装时把原始 handler 挂到 `__dshWuaOriginal`，仅供服务端内部重放使用。

### 新增：官方 DeepSeek 登录的远程回调中转

- **劫持 callbackOrigin**：包装 `deepseekAccount.startSignIn`，把域名 origin 改写成
  `http://127.0.0.1:<本机端口>`（上游 `loginOrigin()` 只接受回环）；
  本地回环访问保留原 origin（cookie 同 host，回调直接命中）。
- **悬浮中转窗**：设置 → 身份认证 → 远程访问 →「打开回调中转窗口」，
  把浏览器地址栏里的完整回调 URL 粘贴进去。
- **服务端内部重放**：`POST /dsh-webui-oauth/oauth-relay`（要求会话）校验 URL
  只为本机端口的 `/oauth/callback` + 单个 `code`/`state`，然后直接调用账号平台
  注册的原始 handler；state/PKCE 仍由平台校验。防 SSRF / 开放重定向。
- 版本兼容：`deepseekAccount` 服务不存在或方法变化时静默跳过；
  `startSignIn` 重复安装不会二次包装。

### 设置页重构（美化 + 优化）

- 由一整列平铺表单改为 6 张卡片：概览 / 账号与密码 / OIDC 单点登录 /
  OIDC 身份绑定 / 远程访问 / 最近登录记录；
- 顶部徽章直接显示：认证、OIDC、绑定、仅允许 SSO、远程信任；
- 字段按两列自适应网格排列，主操作收敛到卡片底部；
- 新增「远程访问」卡片（远程信任状态 + 官方登录回调中转悬浮窗）；
- 保持所有既有字段、回填规则（除密钥外全部预填）与错误提示不变。

### 测试

- 新增 `test/oauth-relay.test.mjs`（29 项）：回环 origin 判定、回调 URL 校验
  （端口/host/路径/重复参数/hash）、startSignIn 桥接与防重复包装；
- `test/gate-default-deny.test.mjs` 改为断言 `/oauth/callback` **匿名 401**、
  带会话 200、原始 handler 可被中转调用；
- 全量 22 个测试文件、587 项断言通过。

## 0.7.3

整合 `dsh-remote-trust`，并确认与官方 DeepSeek 账号登录（0.2.1+）的兼容边界。

### 新增：远程访问信任（可选内置，原 `dsh-remote-trust`）

经域名反代访问时，客户端把页面判为"非 loopback"，设置 → 模型报
`settings are unavailable in this browser`。开启：

```yaml
remote-web-ui:
  trustRemoteHost: true
```

- 通过官方 `webServer.tapIndex` 注入 `__DSH_TRANSPORT__.ownsHost = true`；
- 注入**幂等**：与 `dsh-remote-trust` 同时安装不会重复；
- `tapIndex` 不存在时只记一条 warn 并返回 false，插件其余功能照常（版本兼容）；
- `status` 回显 `remoteTrust`；
- 安全边界：只应在页面已由本插件保护时启用；不改变服务端信任护栏，
  仍需 `--trusted-host <对外域名>`。

### 兼容：官方 DeepSeek 账号登录（0.2.1+）

- `/oauth/callback` 保持公开，包括**登录开始时才动态注册**的那一次（新增回归断言）；
- 上游 `deepseek-account-platform` 的 `loginOrigin()` 只接受
  `http://localhost|127.0.0.1|[::1]:<port>`，**不支持反代域名**——这是上游设计限制，
  与插件无关；
- 文档补充：本机 `http://127.0.0.1:3080` 完成一次登录后，账号 token 保存在 Host
  凭证里，之后经域名访问仍然有效；
- 刻意不 monkey-patch 核心内部函数（升级即碎），需要域名直登请推动上游放宽。

### 测试

- 新增 `test/remote-trust.test.mjs`（21 项）：注入幂等、配置读取、`tapIndex` 缺失降级、
  与 `dsh-remote-trust` 共存；
- `test/gate-default-deny.test.mjs` 新增 2 项：晚注册的 `/oauth/callback` 仍保持公开；
- 全量 21 个测试文件、558 项断言通过。

## 0.7.2

合并上游（Yuuz12/dsh-webui-auth）0.3.5–0.3.7 中**可安全合并**的部分；
宿主载体桥 / 桌面端锁因会绕过现有门禁，未合并。

### 合并：DSH Desktop 标记透传（upstream 0.3.5 / #8）

- 新增 `lib/desktop-adapter.js`（自包含、可整体摘除）；
- 渲染器加载时把 `dsh-desktop-*` 标记写入 HttpOnly Cookie（`dsh_wua_desktop`，12h）；
- 之后落到干净 `/` 时 302 回带标记的 URL，修复桌面端 advanced/extended 模式下
  12 个 layout 依赖插件停在 pending 的问题。
- **不影响门禁**：`remember()` 在认证判定之前调用但只写 Cookie；`restore()` 只在
  `checkRequest()` 通过之后调用。未登录请求带标记仍然去登录页。
- 已加 9 项集成断言（oidc-bind 1f）+ 24 项纯函数断言。

### 合并：审计日志 null/boolean 不再被字符串化（upstream 0.3.6）

`auditLog` 原先把非 string/number 一律 `String()`，导致日志里出现字符串
`"null"` / `"true"`。现在 null 与 boolean 原样保留。

### 合并：fallback 诊断增强（upstream 0.3.7）

我们在 0.7.1 已独立修复 `{ resource }` 兼容；本次补上可观测性：

- `status` 新增 `fallback: 'handler' | 'resource' | 'absent' | 'unknown'`；
- 启动日志输出 `core fallback seat: handler/resource`，unknown 时 error；
- 形态不认识时输出**一次性**诊断，并返回带说明的 404（不再是空 body）。

### 未合并（有意）

- **宿主载体桥（0.3.6 C6）**：其 `isLoopbackPeer()` 只看 socket 地址。
  本部署是 nginx 同机反代，所有请求的 socket 都是 127.0.0.1，等于"持有核心
  Cookie 即可绕过插件会话/SSO"，与「仅允许 SSO」直接冲突。
- **桌面端锁（0.3.6 C8）**：UI 级锁，对 Web 部署无价值。
- **exact 路由覆盖（0.3.6 C7）**：我们的 deny-by-default 已覆盖全部 exact
  （实测 `/plugins/events` 匿名 401），无需合并。

### 测试

- 新增 `test/desktop-marker.test.mjs`（24 项）、`test/audit-null.test.mjs`（7 项）；
  `test/fallback-shape.test.mjs` 增加 7 项形状判定；`test/oidc-bind.test.mjs`
  增加 9 项"桌面标记不影响门禁"集成断言。
- 全量 20 个测试文件、535 项断言通过。

## 0.7.1

兼容 dsh **0.2.2-rc.1**：`webServer.fallback` 从函数改成了 `{ resource }`。

### 修复：访问 `/` 返回 500 空响应（nginx 日志 `500 0`）

- **现象**：升级到 dsh 0.2.2-rc.1 后，访问 `/` 在完成核心 token 交换后返回
  `500`，body 为空；nginx 访问日志表现为 `500 0`。
- **原因**：0.2.2-rc.1 起 `webServer.fallback` 不再一定是函数——
  `dsh-host-frontend-static` 注册的是 `{ resource }`（Fetch 风格
  `resource(request, peer) -> Response`）。插件仍按 `await fallback(req, res)`
  调用，抛 `TypeError: fallback is not a function`，被外层 `catch` 兜成
  `500` + 空 body。
- **修复**：新增 `serveFallback()` 统一分派三种形状：
  1. 函数（旧核心）；
  2. `{ resource }` + `webServer.serveResource`（0.2.2-rc.1+）；
  3. `{ handler }`（部分中间版本）。
  没有 fallback 时返回 `false`，由调用方 404——不再把"形状不匹配"误报成 500。

### 安全：资源型 fallback 也必须上闸门

此前 `wrapExistingFallback` 只处理 `typeof === 'function'`，遇到 `{ resource }`
直接跳过，等于把兜底入口留给匿名请求。现在：

- `resource(request, peer)` 会被包装：从 Fetch Request 的 `cookie` 头取会话，
  未登录返回 `401 Response`，已登录原样放行；
- `registerFallback` 注册时的三种形状都会在注册那一刻上闸门；
- `undo` 会把 `resource` / `handler` 原样还原。

### 测试

- 新增 `test/fallback-shape.test.mjs`（19 项）：三种形状分派、无 fallback /
  未知形状 / 缺 `serveResource` 均不抛异常、资源型 fallback 的匿名拒绝与
  登录放行、`undo` 还原。
- 全量 18 个测试文件、488 项断言通过。

## 0.7.0

新增**「仅允许 SSO」**开关；同时修复一个会把 OIDC 绑定悄悄弄丢的老问题。

### 新增：仅允许 SSO（设置 → 身份认证 → OIDC）

勾选后：

- **未登录访问 WebUI** 一律 `302` 到 SSO 入口（`/dsh-webui-oauth/oidc/login`），
  不再显示密码表单；跳转自动带上浏览器侧 origin，兼容 `trustBrowserOrigin` 部署。
- **密码登录接口被禁用**：`POST /dsh-webui-oauth/login` 返回 `403`
  `{"ok":false,"error":"sso-only"}`，并记一条 `login_failure` 审计
  （detail 标明"已启用仅允许 SSO"）。
- 登录页本身也做了兜底：即使页面被缓存/手动回退，也只显示 SSO 按钮。

**防锁死校验**（服务端强制，不只是前端）：

| 条件 | 结果 |
|---|---|
| 未启用 OIDC | 拒绝保存 |
| Issuer / Client ID / Client Secret 不全 | 拒绝保存 |
| 尚未绑定 OIDC 身份 | 拒绝保存（`oidc-sso-only-unbound`） |
| 已启用「仅允许 SSO」时解绑 | 拒绝（`sso-only-active`），要求先关开关 |

运行时生效值还要求"OIDC 已启用 **且** 已绑定"：若绑定因任何原因消失（手工改文件、
旧数据），自动退回密码登录，不会把唯一入口切成必然失败的跳转。

**被锁在门外怎么恢复**：编辑数据目录的 `dsh-webui-oauth.json`，把
`"ssoOnly": true` 改为 `false`。后台定时器每 60 秒重读一次配置，无需重启；
也可以直接重启。

### 修复：保存设置会把 OIDC 绑定弄丢

`configure` 重建凭据对象时只写了 `{ v, username, hash, ttl }`，把 `boundSub`
一并丢掉——等于"每次保存设置都静默解绑"。这个问题在启用「仅允许 SSO」时会
直接导致开关失效（保存后绑定没了 → 自动退回密码登录）。现在原样保留 `boundSub`，
并加回归断言锁住。

### 测试

- `test/oidc-bind.test.mjs` 新增 17 项：未绑定拒绝启用、已绑定可启用、
  `boundSub` 不丢、status 回显、登录页 302 + base、密码登录 403、
  禁止解绑、关闭后全部恢复。
- 全量 17 个测试文件、469 项断言通过。

## 0.6.9

会话体验补齐：**已登录访问登录页直接回首页**；**会话失效时页面跳登录、接口返回 401 并由前端跳登录**。

### 新增：已登录访问登录页 → 直接回首页

- 以前：已登录用户打开 `/dsh-webui-oauth/login` 仍会看到登录表单，容易误以为掉登录。
- 现在：认证已启用且会话有效时，直接 `302` 到应用根，并带上核心的 launch token
  （顺带完成核心 token→cookie 交换，避免"刚回来又被核心踢一次"）。
- 首次初始化（尚未启用认证）不受影响，仍显示创建账号页。

### 新增：未认证时的响应按客户端类型区分

| 请求类型 | 行为 |
|---|---|
| 浏览器直接导航（GET/HEAD 且 `Accept: text/html`） | `302` → `/dsh-webui-oauth/login` |
| `fetch`/XHR 接口（JSON） | `401`（保持原样，避免前端把 302 后的 HTML 当 JSON 解析） |
| WebSocket upgrade | 401 拒绝升级 |

第三方插件的面板页（如 `/dsh-market/...`）未登录直接打开时，不再是一页写着
`unauthorized` 的裸文本，而是回到登录页。

### 新增：客户端拦截 401 → 回登录页

核心的 `/api` 调用不经过插件自己的 API 帮助函数，会话过期时只会拿到 401，
页面卡在错误态。客户端插件现在包装了一层同源 `fetch`：

- 只处理**同源 `/api`** 的 401（不碰第三方接口与静态资源）；
- 已在登录页则不跳（防循环）；
- 2 秒节流（并发请求同时 401 只跳一次）；
- 热重载时通过全局标记避免重复包装，disposer 会把原 `fetch` 还原。

插件自身的 `/dsh-webui-oauth/*` 调用仍走原来的 `api()` 帮助函数，401 时
**直接**跳 `/dsh-webui-oauth/login`（不再先跳 `/`，少一次重定向）。

### 测试

- `test/gate-default-deny.test.mjs` 新增 3 项：面板导航 302、接口 401。
- `test/oidc-bind.test.mjs` 新增 4 项：有会话访问登录页 302（带 token）、无会话仍渲染登录页。
- 全量 17 个测试文件、452 项断言通过。

## 0.6.8

修复 0.6.7 引入的回归：**登录成功后 `/api` 恒 401**。

### 修复：/api 的 loopback 伪装在包装时被固化

- **现象**：升级到 0.6.7 后可以正常登录、页面也能打开，但所有 `/api` 请求一律 401；
  回退到 0.6.6 立即恢复。
- **原因**：0.6.7 为了让新装的插件"注册即上闸门"，接管了 webServer 三张路由表的
  `set`。这改变了包装时机——`/api` 可能在 `client-connection` 服务对本插件上下文
  **尚不可见**时就被包装。旧代码在**包装那一刻**判定一次 `coreHasRequestGate`，
  于是把"这是旧核心"永久固化下来，之后每个 `/api` 请求都走 loopback 伪装：
  `Host` 被改写成 `127.0.0.1`、`Origin` 被删除。
  而 alpha.2+ 核心的浏览器 Cookie **按 Host authority 绑定**，改写后查不到对应
  Cookie，核心随即 401。登录与页面走的是 `/`，不经过这段伪装，所以"能登录、只有
  `/api` 坏"。
- **修复**：把判定改为**每次请求现查** `ctx.get('connection').requestRejection`，
  不再在包装时定死。路由注册的先后顺序、服务就绪的时序都不再影响结果。
  旧核心（始终没有 `requestRejection`）仍保留 loopback 伪装，行为不变。

### 测试

- `test/gate-default-deny.test.mjs` 新增 6 项：
  - 安装时 `connection` 不可见、之后才就绪 → `/api` 的 `Host`/`Origin` 必须保持原样；
  - 旧核心（始终无 `requestRejection`）→ 仍然改写 Host / 删除 Origin，确保修复没误伤。
- 全量 17 个测试文件、444 项断言通过。

## 0.6.7

安全修复：路由闸门由**黑名单**改为**默认拒绝的白名单**。此前只包 `/api` 与
`/plugins`，第三方插件注册的读接口完全裸奔。

### 修复：未登录可读任意第三方插件的路由

- **现象（实测）**：未登录、不带任何 Cookie，以下端点直接 200：
  - `/dsh-550c-boot/update` —— 版本 / 镜像指纹
  - `/dsh-any-background/font` —— 用户上传字体（12,079,480 B）
  - `/dsh-any-background/wallpaper` —— 用户壁纸
  与此同时写端点（`/font/upload` 等）因为走 connection RPC 通道反而 401。
  即典型的「**写保护、读裸奔**」。
- **原因**：webServer 的匹配顺序是「exact 优先，其次最长前缀」。闸门原来只包装
  `/api` 与 `/plugins` 两条前缀，第三方插件注册的 `/dsh-any-background`、
  `/dsh-550c-boot/update` 等比本插件的 `""` 前缀更具体，会抢在闸门之前命中，
  于是完全绕过鉴权。黑名单永远追不上「下一个装上的插件」。
- **修复**：改为**默认拒绝**。安装闸门时枚举并包装 webServer 上的**全部**路由：
  - 所有 `exact` 路由 → 401（白名单/自管端点除外）
  - 所有 `prefix` 路由 → 401（仅本插件自己的 `""` 传输闸门除外，它负责 302 到登录页）
  - **所有** WebSocket upgrade → 一律拒绝（不再只认 `/api/remote.mux`）
  - `fallback` 处理器 → 同样要求会话
  - 并且接管 `exact/prefixes/upgrades` 三张路由表的 `set`，**注册那一刻就上闸门**，
    消除「新装插件到下一次重扫（最长 10s）之间」的裸奔窗口。

### 公开白名单（能匿名访问的全部路径）

`/dsh-webui-oauth/login`、`/setup`、`/oidc/login`、`/oidc/callback`、
`/oauth/callback`（账号平台 OAuth 回跳，自带 state 常量时间比对）。

其余 `/dsh-webui-oauth/*` 端点（status / audit / configure / disable / logout /
oidc/bind / oidc/unbind / oidc/logout）保持「各 handler 自己 checkRequest」，
不套通用闸门，避免改变其 JSON 错误语义。

### 新增：部署方可追加公开路径

机器调用的端点（例如签名校验的 GitHub webhook）需要匿名可达。在 dsh settings 里声明：

```yaml
remote-web-ui:
  publicPaths:
    - /api/webhooks/github      # 精确路径
    - /api/webhooks/*           # 前缀（结尾 /*）
```

未声明的路径一律拒绝。配置热更新后下一次扫描（≤10s）生效，无需重启。

### 可观测性

`/dsh-webui-oauth/status` 的 `gate` 现在回显实际保护范围，便于运维核对，
而不是只看到一句「闸门已开」：

```json
{
  "gate": {
    "ok": true,
    "mode": "deny-by-default",
    "stats": {
      "wrappedExact": 8, "wrappedPrefix": 8,
      "wrappedUpgrade": 1, "wrappedFallback": 1,
      "publicPaths": ["/dsh-webui-oauth/login", "..."],
      "exemptSelfGated": ["/dsh-webui-oauth/status", "..."]
    }
  }
}
```

### 升级注意

- 升级后**第三方插件的所有路由默认需要登录**。如果某个端点确实要匿名可达
  （webhook、回调），请按上面的 `publicPaths` 显式声明，否则会 401。
- 登录页、OIDC 往返、应用根的行为不变；实测登录 → 进应用 → 各插件功能均正常。

### 测试

- 新增 `test/gate-default-deny.test.mjs`（53 项）：锁定默认拒绝、白名单例外、
  晚注册路由无窗口期、upgrade 与 fallback 覆盖、`undo` 完全可逆。
- 真实实例端到端验证（dsh + `dsh-550c-boot` + `dsh-any-background` + 本插件）：
  匿名访问上述三个端点由 200 变为 **401**，登录后仍 200/404（正常业务语义）。
- 全量 17 个测试文件、434 项断言通过。

## 0.6.6

对 **OIDC 授权跳转**做一次全量验证（固定路径 / 反代 / 浏览器动态三路），
并把结论固化成回归测试。本版**没有行为变更**，只补测试与文档。

### 验证：三条跳转路径在真实服务器上全部走通

用一台真实 IdP（HTTPS + 自签 CA）、一台反向代理（复刻 Caddy 的两种 Host 改写模式）
和一个真实 dsh 实例，端到端跑完「发起授权 → IdP → 回调 → 换 token → 建会话 → 跳回应用」，
共 56 项断言：

- **固定路径跳转**（配置 `redirectBase`，20 项）：`redirect_uri` 恒为
  `redirectBase + /dsh-webui-oauth/oidc/callback`。浏览器上报异源 origin、
  base 里夹带路径、反代改写 Host 都带不偏它。绑定与登录两条路径结束时均为 302，
  回执分别是 `oidcbound=1` 与 launch token。
- **反代跳转**（17 项）：`X-Forwarded-Host` / RFC 7239 `Forwarded: host=` 优先于
  被改写的 Host；反代什么都不下发时按回环判定，回退配置的确定性 origin，
  回跳**绝不指向内部上游地址**；https 对外地址不被降级为 http。
- **浏览器动态跳转**（19 项）：`redirectBase` 留空时采信登录页上报的
  `location.origin`；经直通反代时端到端回到浏览器看到的地址（含会话不丢）。
  开关关闭或两者皆缺时 **fail-closed**。非法值全部被拒：
  `javascript:`、带 path/query/hash/userinfo、以及含 CRLF 的注入尝试。

### 澄清：绑定路径为什么不下发新会话 Cookie

绑定流程结束时只清一次性 state Cookie、**不再下发会话 Cookie**——这是刻意的：
绑定发生在管理员已登录之后，用的是同一个会话；重新下发会话等于无谓地轮换凭据。
登录路径则相反，必须下发新会话。两者的差异在测试里显式锁定，避免被"顺手统一"掉。

### 修复：测试偶发失败（曾导致 v0.6.6 发布中断）

- **现象**：`test/oidc.test.mjs` 的「坏签名」用例偶发 FAIL
  （`got null want "bad-signature"`），本地约 2% 概率触发，表现为 CI 上
  "Verify tests pass before publish" 失败、npm publish 被跳过。
- **原因**：该用例用 `token.slice(0,-2) + 'aa'` 篡改签名末两位。但 RS256 签名是
  256 字节，base64url 编码后 342 字符 = 2052 bit，而数据只需 2048 bit——
  **末位字符的低 4 位是填充位，解码时被丢弃**。于是当末位落在 `{A,Q,g,w}` 时
  （实测撞到 `aQ` → `aa`），解码出的签名字节与原值**完全一致**，签名压根没被改动，
  验签自然通过。这是测试的前提错误，不是验签逻辑的问题。
- **修复**：改为翻转末位字符，并**校验解码后的字节确实发生变化**，否则换下一个候选；
  另加一条断言锁死"篡改必须改变字节"，防止该用例退化成假阳性。
  修后连续 400 次运行零失败（修前约 2% 失败率）。

### 测试

- 新增 `test/oidc-redirect-matrix.test.mjs`（37 项）：把上述三路决策固化为
  无需外部依赖的单元回归。已确认能抓出回归——去掉 `isValidOrigin` 的路径校验后
  有 2 项立刻 FAIL。
- 全量 16 个测试文件、381 项断言通过。

## 0.6.5

补全 0.6.4 遗漏的路径：**SSO 登录成功后同样停在 JSON 页面上**。

### 修复：SSO 登录成功也改为 302 跳转

- **现象**：用 SSO 登录成功后，浏览器停在
  `{"ok":true,"redirect":"http://…/?token=…"}` 上，不会自动进入应用。
  （0.6.4 只改了绑定路径与失败路径，登录成功这条漏了。）
- **原因**：同一类问题——回调端点把跳转目标放在 JSON 的 `redirect` 字段里，
  指望前端去跳。但 OIDC 回调是浏览器主导的顶层导航，此时页面上并没有插件的 JS
  在运行（用户是从登录页点 SSO 被 302 到 IdP、再 302 回来的），没人会去读那个字段。
- **修复**：直接 `302` 到目标地址，并一次带两条 `Set-Cookie`（会话 + 清除一次性
  state Cookie）。

### 说明：登录页表单仍返回 JSON（这是对的）

密码登录与首次初始化是登录页用 `fetch` 发起的，页面上有 JS 在跑并由它负责跳转，
因此这两处继续返回 `{"ok":true,"redirect":…}` 是正确设计，不在本次修改范围内。

### 测试

- `test/oidc-integration.test.mjs` 与 `test/oidc-bind.test.mjs` 中"回调成功"的断言
  改为校验 302 + `Location` 带 launch token，而非 JSON 字段。
- 全量 343 项断言通过。

## 0.6.4

修复 OIDC 回调结束后浏览器**停在 JSON 页面上**、需要手动回退的问题。

### 修复：绑定/登录结束后自动回到应用并给出提示

- **现象**：点「绑定 OIDC 身份」完成 IdP 往返后，浏览器停在一段 JSON 上
  （如 `{"ok":true,"bound":true,"sub":"..."}`），必须手动按后退键回到设置页；
  失败时同样如此（例如 `{"ok":false,"error":"oidc-authorize-failed",...}`）。
- **原因**：回调端点直接 `sendJson` 渲染结果。但 OIDC 回调是**浏览器主导的顶层导航**
  （用户点按钮 → 302 到 IdP → 302 回回调），渲染 JSON 等于把用户丢在一个死页面上，
  而且看不出操作到底成没成功。
- **修复**：成功与失败都 **302 回应用**，并带一个回执参数由前端提示：
  - 成功：`?oidcbound=1` → 设置页提示「OIDC 身份绑定成功」；
  - 失败：`?oidcerr=<原因>` → 按原因给出可读提示（授权失效 / 未绑定 / 身份不匹配）。
  回跳复用 `postLoginRedirect()`，顺带完成核心的 launch-token → cookie 交换，
  否则回到首页仍会被核心 401 拦住。前端读取回执后会用 `history.replaceState`
  清掉 query，避免刷新时重复提示。

### 安全

- 回执里**不含** sub 等敏感值（只有 `oidcbound=1` / `oidcerr=原因码`），
  避免把身份标识写进浏览器历史与访问日志。

### 测试

- `test/oidc-bind.test.mjs` 新增「绑定成功后必须回到应用」用例，并把失败路径断言
  改为校验 302 + 回执；`test/oidc-integration.test.mjs` 的状态校验用例同步更新。
- 已确认能抓出修复前的行为（回退成 sendJson 时 2 项 FAIL）。
- 全量 342 项断言通过。

## 0.6.3

修复部分 IdP 下**绑定 OIDC 立即失败**的问题（点「绑定 OIDC 身份」后立刻收到
`oidc-authorize-failed / invalid_request`）。

### 修复：授权请求携带了 IdP 不支持的 prompt 参数

- **现象**：点绑定后浏览器被 IdP 打回，回调形如
  `.../oidc/callback?error=invalid_request&error_description=unsupported+prompt+value+requested`，
  界面显示 `{"ok":false,"error":"oidc-authorize-failed","detail":"invalid_request"}`。
- **原因**：插件在授权请求里**硬编码**了 `prompt=select_account`。该参数是 OIDC 的
  可选扩展，不同 IdP 支持度差异极大；不支持的 IdP 会直接拒绝整个授权请求，
  于是授权根本发不出去。
- **修复**：默认**不发送** `prompt`。需要"强制选择账号"行为的部署可在设置页
  **Prompt（可选）** 里显式填写（如 `select_account`），留空即不携带该参数。

### 建议

- 若你此前被此问题挡住，升级后**重新点一次绑定**即可，无需改动其它配置。
- 多数 IdP 的登录页本来就会让用户选择账号，因此该参数通常不必填。

### 测试

- `test/oidc-integration.test.mjs` 增加两条断言：默认不携带 `prompt`、
  显式配置时如实携带。已确认能抓出修复前的行为（回退硬编码时 2 项 FAIL）。
- 另在隔离实例上用**会拒绝 prompt 的 IdP**（复刻同类行为）做了端到端对照：
  带 `prompt` 复现出完全相同的错误；去掉后绑定成功、随后 SSO 登录成功。
- 全量 337 项断言通过。

## 0.6.2

修复设置页在**切走再切回**时不回显已有配置的问题。

### 修复：切页返回后配置项全空，须手动刷新才显示

- **现象**：在 WebUI 里切到别的页面、再切回设置 → 身份认证，用户名、OIDC 入口、
  APP ID 等输入框全部为空；手动刷新整页才恢复正常。
- **原因**：回填逻辑被一个**模块级**变量 `loadedOnce` 包着（"只回填一次"）。
  模块变量只在整页刷新时重置；而 SPA 内切换页面时组件会重新挂载（局部 state 归零）
  却不会复位该变量，于是整块回填被跳过。
- **修复**：改为组件内的 `useRef` 记录"本次挂载是否已回填"。组件卸载即失效，
  切回来会重新回填；同一次挂载内它仍能阻止轮询把用户正在编辑的内容冲掉。

### 回显规则（明确化）

除**密钥**外一律预填：

| 字段 | 是否回显 |
| --- | --- |
| 用户名 | ✅ |
| OIDC 入口（issuer） | ✅ |
| OIDC APP ID（clientId） | ✅ |
| Scope | ✅ |
| Redirect Base | ✅ |
| 完整回调地址 | ✅（0.6.1 起） |
| **Client Secret** | ❌ **永不回显**（服务端不返回；输入框留空 = 保持不变） |

### 测试

- 新增 `test/client-prefill.test.mjs`（11 项）：用一个还原了关键 React 语义
  （尤其是 `useRef` 在同一挂载期内返回同一对象、卸载后换新对象）的替身直接驱动
  真实组件源码，覆盖首次进入、切走切回、连续三次切换、clientSecret 永不回显。
- 已确认这些用例能抓出修复前的行为（回退旧写法时 4 项 FAIL）。
- 全量 335 项断言通过。

## 0.6.1

修复 OIDC 配置保存被误拒、以及设置页看不到回调地址的问题。

### 修复：再次保存 OIDC 配置总是失败

- **现象**：改完 issuer / scope / Redirect Base 点保存，返回
  `{"ok":false,"error":"oidc-invalid","reason":"clientSecret 须为非空字符串"}`，配置存不下去。
- **原因**：设置页的 clientSecret 输入框每次打开都是空的（密钥不回传前端，这是有意的），
  而服务端把"空串"也当成非法值拒掉——与它自己「留空保留原值」的语义、以及界面提示直接矛盾。
- **修复**：空串/全空白按"未提供"处理，保留原值；只有**类型不对**才拒绝。
  同时补上真正的边界：**首次启用**（此前没有 secret）时留空仍然拒绝并说明原因，
  避免存下一个没有 secret 的配置、之后表现为莫名其妙的 `oidc-not-configured`。

### 新增：设置页显示回调地址

- 原生 OIDC 要求 `redirect_uri` 与 IdP 登记值**精确匹配**，少一个字符都会被拒。
  此前界面只给路径常量，部署者得自己拼出完整地址（含 scheme/host/port）才能登记。
- 现在设置页在 Redirect Base 下方直接给出**完整回调地址**（如
  `https://dsh.example.com/dsh-webui-oauth/oidc/callback`），可原样抄进 IdP；
  未填 Redirect Base 也无 `publicBaseUrl` 时，明确提示"无法确定"而不是猜一个错的。
- `/status` 新增 `oidc.redirectUri` 与 `oidc.callbackPath`。

### 测试

- `test/oidc-bind.test.mjs` 扩充到 35 项：覆盖"首次启用须填 secret"、"再次保存留空被接受
  且保留原值"、"留空不得清成空串"、"secret 类型错误仍拒绝"、"回调地址为完整 URL"、
  "无法确定时返回 null 不猜"。
- 全量 324 项断言通过。

## 0.6.0

新增 **OIDC 身份绑定**：配置 OIDC 不再等于谁都能登录，必须显式绑定一个 IdP 身份。

### 新增：OIDC 绑定 / 解绑（访问控制）

- **绑定前，OIDC 登录一律拒绝**。此前只要配置了 OIDC，任何能通过该 IdP 验证的人都能进入
  WebUI——IdP 侧的任何账号都成为本 WebUI 的入口。现在未绑定时 `/oidc/login` 直接返回
  `oidc-not-bound`，登录页也不显示 SSO 按钮。
- **绑定**：本地账号登录后，在**设置 → 身份认证 → OIDC 身份绑定**点「绑定 OIDC 身份」，
  走一次 IdP 授权，回调里校验通过的 `sub` 会存入凭据文件（`boundSub`）。此后**只有该
  身份**能通过 SSO 登录。
- **解绑**：点「解除绑定」（需当前密码），清空 `boundSub`，SSO 登录立即恢复为「一律拒绝」。
- 绑定状态在设置页可见；服务端只回传**掩码后**的 sub（如 `su*****ce`），不把原始标识
  发给浏览器。
- 新增端点：`GET /dsh-webui-oauth/oidc/bind`（需已登录会话）、
  `POST /dsh-webui-oauth/oidc/unbind`（需当前密码）。
- 审计新增 `oidc_bind_success` / `oidc_unbind_success` / `oidc_unbind_failure`。

### 兼容性

- 旧凭据文件没有 `boundSub` 字段 → 视为**未绑定**，OIDC 登录被拒。这是安全方向：
  升级不会因为"多出"一个 OIDC 入口而放开访问。需要 OIDC 登录的部署升级后请重新绑定一次。
- 「禁用认证」会重置凭据文件，绑定关系一并清除；重新启用后需重新绑定。

### 修复

- 登录页 `GET /login` 在拼接 SSO 按钮状态时引用了未定义变量（写作 `creds` 而非
  `credsNow`），导致登录页直接 500、整个 WebUI 无法登录。已修复并补回归测试
  （该分支只在浏览器 GET 时走到，纯 JSON 用例覆盖不到）。

### 测试

- 新增 `test/oidc-bind.test.mjs`（25 项）：未绑定拒登、绑定端点鉴权、sub 不匹配拒登
  （不发会话）、匹配 sub 可登录、解绑需密码、解绑后拒登、旧凭据兼容、登录页渲染。
- 全量 314 项断言通过。

## 0.5.1

修复 OIDC 密钥轮换后长时间无法登录的问题。**使用 OIDC/SSO 的部署建议升级。**

### 修复：IdP 轮换签名密钥后，最长 1 小时内无法登录

- **现象**：IdP 轮换签名密钥（换 `kid` 或换算法，如 RS256 → ES256）后，所有 OIDC 登录
  持续失败，审计记录 `id_token 验证失败: no-signing-key`；重启 dsh 才恢复。
- **原因**：discovery + JWKS 有 1 小时内存缓存，而缓存命中时不校验"当前 token 的 kid
  是否还在缓存里"。轮换后缓存里那把旧 key 永远匹配不上，且代码不做任何刷新。
- **修复**：验签失败且错误属于签名类（`no-signing-key` / `bad-signature`）时，绕过缓存
  强制重取一次 JWKS 再验；成功后回写缓存，并在审计里记一条 `oidc_jwks_refreshed`，
  便于运维确认确实发生了密钥轮换。正常路径仍走缓存，不会被架空。
- **实测**：先在 RS256 IdP 登录（建立缓存），仅把 IdP 换成 ES256，同一 dsh 进程内再登录——
  修复前必失败，修复后自动恢复。

### 其他

- `makeDiscoveryCache(fetchImpl)` / `fetchOidcDiscovery(issuer, { fetchImpl })` 新增可选的
  fetch 注入点，仅供测试使用（可在无网络、无 TLS 的环境下完整测试缓存与刷新逻辑）。
- 新增 `test/jwks-refresh.test.mjs`（14 项）：缓存命中、密钥轮换、refresh 失败不污染缓存、
  跨源 `jwks_uri` 仍被拒。全量 288 项断言通过。

## 0.5.0

安全加固与正确性修复。**建议所有用户升级**，其中「原版共存」与「算法绑定」两项在特定部署下会导致严重问题。

### 破坏性：与原版 `dsh-webui-auth` 双装将拒绝启动

- 本插件**不再**在运行时接管原版。两者抢占同一批 `webServer` 路由，运行时无法安全共存：
  实测三种做法（dispose fiber / disable 条目 / 放任共存）分别导致**进程启动失败**或
  **本插件静默失效（端点全 404）**。
- 现在检测到原版仍启用时，插件**直接拒绝启动**（dsh 退出码 1）并打印修复指令，而不是降级运行——
  避免"以为上了锁、实际没生效"这种最难排查的形态。
- **升级动作**：把原版从 profile 的 `dsh.profile.bundles` 与 `dependencies` 中移除，
  或在其补丁层写 `disabled: true`。详见 README「与原版的关系」。
- 注意：0.4.x 曾用「自动停用原版」实现接管，该机制已被证明不可行并**完全移除**。

### 安全：id_token 验签算法绑定

- **修复算法混淆（中危）**：验签算法此前取自 `(jwk.alg || header.alg)`，而 IdP 几乎都会在
  JWKS 写 `alg`，等价于让 `jwk.alg` 覆盖 `header.alg`。后果是用 P-256 密钥真实签名后，
  仅把头部改成 `ES384`/`ES512` 就能通过验证（"自称 ES512、实为 P-256"）。
  现以 `header.alg` 为唯一真源，与 `jwk.alg` 冲突即拒。
- 算法名改为**显式白名单**（原 `startsWith` 前缀匹配会让 `ES999`/`RS999` 命中对应 kty 的 key）。
- 校验 JWKS 的 `use` / `key_ops`，加密专用 key 不再被选中验签。

### 修复：client bundle 注册 id 不匹配

- `lib/client.js` 以 `id: 'dsh-webui-auth'` 注册，而 bundle 注入的行名是 `dsh-webui-oauth`，
  导致设置页插件面板报 `loaded without registering "dsh-webui-oauth" via __ModuleLoader__.load`。
  现已对齐。新增 `test/client-bundle-id.test.mjs` 防回归。

### 修复：bundle 说明过期

- `cordis.patch.yml` 的注释仍在描述已被移除的"自动顶掉原版"行为，现更正为 fail-fast 语义。

### 测试

- 新增 `test/oidc-ec.test.mjs`（31 项）：ES256/384/512 真实签名验签、alg 绑定、算法名白名单、
  `use`/`key_ops`、算法混淆。其中 alg 绑定与前缀匹配的用例已确认能在修复前版本上失败。
- 新增 `test/client-bundle-id.test.mjs`（5 项）。
- 全量 274 项断言通过。

### 文档

- 新增「签名算法支持」章节（EC 实测证据）与「全流程实测结果」章节（本地账号 / OIDC / 反代改写 Host 三种场景）。
- 修正一处不实注释：原称"ES256 因曲线小偶尔误中"，实测 DER 模式验 raw 签名 300 次零误中。

## 0.4.x 及更早

早期版本的变更（OIDC SSO 引入、数据目录迁移、跳转 scheme 修正等）见文末「相关」与 git 历史。
