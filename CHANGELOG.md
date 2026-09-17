# 变更记录

本文件记录每个版本的**用户可见**变更。破坏性变更与升级动作单独标注。

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
