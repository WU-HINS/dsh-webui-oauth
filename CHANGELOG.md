# 变更记录

本文件记录每个版本的**用户可见**变更。破坏性变更与升级动作单独标注。

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
