window.__ModuleLoader__.load({
	id: 'dsh-webui-oauth',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let react = require('react');

		const inject = ['slots'];

		const CSS = [
			'.wua-section { display: flex; flex-direction: column; gap: 14px; max-width: 560px; padding: 4px 2px; }',
			'.wua-intro { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-row { display: flex; flex-direction: column; gap: 5px; }',
			'.wua-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-input { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; outline: none; }',
			'.wua-input:focus { border-color: var(--dsw-alias-brand-primary, #4a7cf7); }',
			'/* 深色模式下浏览器自动填充会把输入框刷成白色/黄色：inset 大阴影 + text-fill-color 回压为当前主题输入底色 */',
			'.wua-input:-webkit-autofill, .wua-input:-webkit-autofill:hover, .wua-input:-webkit-autofill:focus { -webkit-text-fill-color: var(--dsw-alias-label-primary, #222); -webkit-box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; caret-color: var(--dsw-alias-label-primary, #222); transition: background-color 999999s ease-in-out 0s; }',
			'.wua-input::placeholder { color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-select { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; outline: none; }',
			'.wua-btn { align-self: flex-start; padding: 7px 18px; font-size: 13px; cursor: pointer; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l2, #999); border-radius: 4px; }',
			'.wua-btn:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary, #555); }',
			'.wua-btn:disabled { opacity: 0.55; cursor: default; }',
			'.wua-btn.ghost { background: transparent; border-color: var(--dsw-alias-border-l1, #ccc); }',
			'.wua-btnrow { display: flex; flex-wrap: wrap; gap: 8px; }',
			'.wua-msg { margin: 0; font-size: 12px; color: var(--dsw-alias-state-success-primary, #1a7f37); }',
			'.wua-err { margin: 0; font-size: 12px; color: var(--dsw-alias-state-error-primary, #d1242f); }',
			'.wua-warn { margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-warn-primary, #9a6700); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #9a6700) 10%, transparent); border: 1px solid var(--dsw-alias-state-warn-primary, #9a6700); border-radius: 4px; }',
			'.wua-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); border-top: 1px solid var(--dsw-alias-border-l1, #e5e5e5); padding-top: 10px; }',
			'.wua-audit { display: flex; flex-direction: column; gap: 4px; }',
			'.wua-audit-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; font-size: 12px; line-height: 1.6; }',
			'.wua-audit-time { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-audit-event { color: var(--dsw-alias-label-primary, #222); }',
			'.wua-audit-user { color: var(--dsw-alias-state-business-primary, #4176e6); }',
			'.wua-audit-ip { color: var(--dsw-alias-label-tertiary, #999); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }',
		].join('\n');

		function apply(ctx) {
			const styleEl = document.createElement('style');
			styleEl.setAttribute('data-plugin', 'dsh-webui-oauth');
			styleEl.textContent = CSS;
			document.head.appendChild(styleEl);
			ctx.effect(() => () => {
				if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
			}, 'dsh-webui-oauth: styles');

			// ---------------- 同源 HTTP API（会话 cookie 由浏览器自动携带） ----------------
			function api(path, body) {
				const opts = body === undefined
					? {}
					: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
				return fetch(path, opts).then((r) => {
					if (r.status === 401) {
						// 会话过期或无效：跳回首页，由 HTTP 层重定向到登录页
						location.href = '/';
						return { ok: false, error: 'unauthorized' };
					}
					return r.json();
				});
			}

			// ---------------- 设置页（settings.section） ----------------
			//
			// 变量命名说明：这里**不再**用模块级的"只回填一次"开关。
			// 曾经的写法是 `let loadedOnce = false` 放在模块作用域，配合
			// `if (!loadedOnce) { ...回填... }`。问题在于模块变量只在【整页刷新】
			// 时重置：用户切到别的页面、再切回设置页时，React 会重新挂载组件
			// （局部 state 归零），但 loadedOnce 仍是 true，于是整块回填被跳过，
			// 表现为"切页回来字段全空、手动刷新才正常"。
			//
			// 正确做法：把"是否已回填"放进组件自身的 state 生命周期。
			// 用一个 ref 记录本次挂载是否已灌过值 —— 组件卸载即失效，
			// 下次挂载自然会重新回填；同时它仍然防止轮询（load 定时刷新）
			// 把用户正在编辑的内容冲掉。
			function AuthSettings() {
				const [status, setStatus] = react.useState(null);
				const [username, setUsername] = react.useState('');
				const [password, setPassword] = react.useState('');
				const [confirm, setConfirm] = react.useState('');
				const [current, setCurrent] = react.useState('');
				const [ttl, setTtl] = react.useState('12');
				const [msg, setMsg] = react.useState(null);
				const [busy, setBusy] = react.useState(false);
				const [audit, setAudit] = react.useState(null);
				// OIDC 相关状态
				const [oidcEnabled, setOidcEnabled] = react.useState(false);
				const [oidcIssuer, setOidcIssuer] = react.useState('');
				const [oidcClientId, setOidcClientId] = react.useState('');
				const [oidcClientSecret, setOidcClientSecret] = react.useState('');
				const [oidcScope, setOidcScope] = react.useState('openid profile email');
				const [oidcRedirectBase, setOidcRedirectBase] = react.useState('');
				const [oidcTrustBrowser, setOidcTrustBrowser] = react.useState(true);
				// prompt（可选）。默认留空 = 不发送该参数——不少 IdP 会对不认识的
				// prompt 值直接回 unsupported prompt value requested，导致授权发不出去。
				const [oidcPrompt, setOidcPrompt] = react.useState('');
				// 绑定状态：bound 表示已绑定某个 IdP 身份；boundSubHint 是掩码后的展示值
				// （服务端只回传掩码，前端拿不到 sub 明文，也不应该拿）。
				const [oidcBound, setOidcBound] = react.useState(false);
				const [oidcBoundHint, setOidcBoundHint] = react.useState('');
				const [unbindPw, setUnbindPw] = react.useState('');
				const [bindMsg, setBindMsg] = react.useState(null);
				// 服务端算好的完整回调地址（含 scheme/host/port）。原生 OIDC 要求
				// redirect_uri 与 IdP 登记值精确匹配，少一个字符都会被拒，所以要显示全。
				const [oidcRedirectUri, setOidcRedirectUri] = react.useState('');
				// 本次挂载是否已灌过初始值。放在组件内（而非模块级）：
				// 组件卸载即失效，切页回来会重新回填；同一次挂载内它仍然阻止
				// 轮询把用户正在编辑的内容冲掉。
				const prefilled = react.useRef(false);

				react.useEffect(() => {
					let alive = true;
					const load = () => api('/dsh-webui-oauth/status').then((s) => {
						if (!alive) return;
						if (!s || s.error) return;
						setStatus(s);
						setTtl(String(typeof s.ttl === 'number' ? s.ttl : 12));
						if (!prefilled.current) {
							prefilled.current = true;
							// 回显规则：除了密钥，其余全部预填。
							//   - 用户名、OIDC 入口(issuer)、APP ID(clientId)、Scope、
							//     Redirect Base —— 都是非敏感且用户需要看到当前值的。
							//   - clientSecret 刻意【不】回显：服务端根本不回传它
							//     （见 status 实现），输入框留空即代表"保持不变"。
							setUsername(s.username || '');
							const o = (s && s.oidc) || null;
							setOidcEnabled(!!(o && o.enabled));
							setOidcIssuer((o && o.issuer) || '');
							setOidcTrustBrowser(!o || o.trustBrowserOrigin !== false);
							setOidcClientId((o && o.clientId) || '');
							if (o && o.scope) setOidcScope(o.scope);
							if (o && o.redirectBase) setOidcRedirectBase(o.redirectBase);
							if (o && typeof o.prompt === 'string') setOidcPrompt(o.prompt);
							setOidcBound(!!(o && o.bound));
							setOidcBoundHint((o && o.boundSubHint) || '');
							setOidcRedirectUri((o && o.redirectUri) || '');
						}
					});
					load();
					api('/dsh-webui-oauth/audit?limit=8').then((r) => {
						if (!alive) return;
						if (r && r.ok && Array.isArray(r.entries)) setAudit(r.entries);
					}).catch(() => { /* 审计不可用时静默 */ });
					return () => {
						alive = false;
					};
				}, []);

				// 读取 OIDC 回调带回来的回执。绑定/登录结束后浏览器会被 302 回应用，
				// 结果通过 query 传递（oidcbound=1 / oidcerr=...）：因为是整页跳转，
				// 组件重新挂载时才知道刚才发生了什么。
				react.useEffect(() => {
					let qs = ''
					try { qs = String((location && location.search) || '') } catch (e) { qs = '' }
					if (!qs) return
					const p = new URLSearchParams(qs)
					const bound = p.get('oidcbound')
					const err = p.get('oidcerr')
					if (bound === null && err === null) return
					if (bound !== null) {
						setBindMsg({ kind: 'ok', text: 'OIDC 身份绑定成功。此后只有该身份可通过 SSO 登录。' })
					} else {
						const LABELS = {
							'invalid-state': '授权会话已失效或被中断，请重新发起绑定',
							'not-bound': '尚未绑定任何 OIDC 身份，SSO 登录已被拒绝',
							'sub-mismatch': '该 IdP 身份未被绑定到本 WebUI，登录已被拒绝',
						}
						setBindMsg({ kind: 'err', text: 'OIDC 操作失败：' + (LABELS[err] || err) })
					}
					// 清掉 query：否则用户刷新页面会重复看到这条提示。
					try {
						const clean = location.pathname + location.hash
						history.replaceState(null, '', clean)
					} catch (e) { /* 无 history 时忽略 */ }
				}, []);

				// 与服务端 passwordStrength 一致的同步校验
				const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~]/;
				function checkPassword(p) {
					if (!p || p.length < 8) return { ok: false, text: '密码至少需要 8 位' };
					if (!/[a-z]/.test(p)) return { ok: false, text: '密码必须包含小写字母' };
					if (!/[A-Z]/.test(p)) return { ok: false, text: '密码必须包含大写字母' };
					if (!/[0-9]/.test(p)) return { ok: false, text: '密码必须包含数字' };
					if (!SPECIAL_CHARS.test(p)) return { ok: false, text: '密码必须包含特殊符号（如 !@#$%^&*）' };
					return { ok: true, text: '' };
				}

				const onSave = () => {
					if (busy) return;
					const name = username.trim();
					// 与服务端 usernameError 一致的用户名约束
					if (!/^[A-Za-z0-9_-]{3,32}$/.test(name)) {
						setMsg({ kind: 'err', text: '用户名需为 3-32 位字母、数字、下划线或连字符' });
						return;
					}
					if (!(enabled && !password)) {
						const st = checkPassword(password);
						if (!st.ok) {
							setMsg({ kind: 'err', text: st.text });
							return;
						}
					}
					if (password !== confirm) {
						setMsg({ kind: 'err', text: '两次输入的密码不一致' });
						return;
					}
					if (enabled && !current) {
						setMsg({ kind: 'err', text: '修改认证信息需要输入当前密码' });
						return;
					}
					setBusy(true);
					setMsg(null);
					const oidcPayload = {
					enabled: oidcEnabled,
					issuer: oidcIssuer.trim(),
					clientId: oidcClientId.trim(),
					clientSecret: oidcClientSecret,
					scope: oidcScope.trim(),
					redirectBase: oidcRedirectBase.trim() || null,
					trustBrowserOrigin: oidcTrustBrowser,
					// 留空即不发送 prompt（服务端会存成 undefined）
					prompt: oidcPrompt.trim(),
				};
				api('/dsh-webui-oauth/configure', { username: name, password, current, ttl: Number(ttl), oidc: oidcPayload }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							if (enabled) {
								setMsg({ kind: 'ok', text: '已保存。其他已登录的设备/浏览器会话已全部吊销，当前会话保持有效。' });
							} else {
								setMsg({ kind: 'ok', text: '已保存并启用认证，当前浏览器已登录。' });
							}
							setPassword('');
							setConfirm('');
							setCurrent('');
							api('/dsh-webui-oauth/status').then((s) => {
								if (s && !s.error) setStatus(s);
							});
						} else if (r && r.error === 'current-invalid') {
							setMsg({ kind: 'err', text: '当前密码不正确' });
						} else if (r && r.error === 'weak-password') {
							setMsg({ kind: 'err', text: '密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号' });
						} else if (r && r.error === 'username-invalid') {
							setMsg({ kind: 'err', text: '用户名需为 3-32 位字母、数字、下划线或连字符' });
						} else if (r && r.error === 'legacy-hash') {
							setMsg({ kind: 'err', text: '当前凭据为旧版哈希（0.2.0 起仅支持 scrypt），必须填写新密码才能保存' });
						} else if (r && typeof r.error === 'string') {
							// 服务端 500/未知错误：展示真实信息便于排查
							setMsg({ kind: 'err', text: '保存失败：' + r.error });
						} else {
							setMsg({ kind: 'err', text: '保存失败，请检查输入' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '保存失败：无法连接认证服务' });
					});
				};

				const onDisable = () => {
					if (busy) return;
					if (!current) {
						setMsg({ kind: 'err', text: '请输入当前密码以禁用认证' });
						return;
					}
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-oauth/disable', { current }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已禁用认证，所有会话已注销。刷新页面后不再要求登录。' });
							setCurrent('');
							api('/dsh-webui-oauth/status').then((s) => {
								if (s && !s.error) setStatus(s);
							}).catch(() => {});
						} else {
							setMsg({ kind: 'err', text: '当前密码不正确' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '操作失败：无法连接认证服务' });
					});
				};

				// 绑定：先发起服务端授权往返，IdP 校验通过后由回调把 sub 落库。
				// 这里不直接调 API 拿 sub——那样等于让浏览器自报身份，毫无安全意义。
				const onBind = () => {
					if (busy) return;
					setBindMsg(null);
					// base 用当前页面的 origin：反代部署下浏览器看到的才是对外地址。
					const base = location.origin || '';
					location.href = '/dsh-webui-oauth/oidc/bind' + (base ? '?base=' + encodeURIComponent(base) : '');
				};

				const onUnbind = () => {
					if (busy) return;
					if (!unbindPw) {
						setBindMsg({ kind: 'err', text: '请输入当前密码以解除绑定' });
						return;
					}
					setBusy(true);
					setBindMsg(null);
					api('/dsh-webui-oauth/oidc/unbind', { current: unbindPw }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setUnbindPw('');
							setOidcBound(false);
							setOidcBoundHint('');
							setBindMsg({ kind: 'ok', text: '已解除绑定。此后 OIDC 登录将被拒绝，直到重新绑定。' });
							api('/dsh-webui-oauth/status').then((s) => {
								if (s && !s.error) setStatus(s);
							}).catch(() => {});
						} else if (r && r.error === 'current-invalid') {
							setBindMsg({ kind: 'err', text: '当前密码不正确' });
						} else {
							setBindMsg({ kind: 'err', text: '解绑失败：' + ((r && r.error) || '未知错误') });
						}
					}).catch(() => {
						setBusy(false);
						setBindMsg({ kind: 'err', text: '解绑失败：无法连接认证服务' });
					});
				};

				const onLogout = () => {
					if (busy) return;
					setBusy(true);
					api('/dsh-webui-oauth/logout', {}).then(() => {
						location.href = '/';
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '退出失败：无法连接认证服务' });
					});
				};

				const enabled = Boolean(status && status.enabled);
				const intro = status === null
					? '正在读取认证状态…'
					: (enabled
						? '认证已在 HTTP 层强制执行，当前账号：' + status.username + '。未登录的浏览器无法加载 WebUI 资源、调用接口或建立实时连接。'
						: '当前未启用认证。创建账号密码后，访问 WebUI 将强制要求登录。');

				const patchWarn = (status && status.gate && !status.gate.ok)
					? ('路由闸门不完整：' + (status.gate.problems && status.gate.problems.join('; ') || '未知原因')
						+ '。认证无法启用，直到 /api 与 WebSocket 路由可被保护。')
					: null;
				const persistNote = (status && status.sessionsPersisted === false)
					? '会话持久化写入失败（磁盘权限？）：dsh 重启后已登录设备需要重新登录。'
					: null;

				// 审计事件显示名
				const EVENT_LABELS = {
					login_success: '登录成功',
					login_failure: '登录失败',
					login_rate_limited: '登录被限流',
					setup_success: '初始化成功',
					setup_failure: '初始化失败',
					configure_success: '修改凭据',
					configure_failure: '修改凭据失败',
					disable_success: '禁用认证',
					disable_failure: '禁用认证失败',
					logout: '退出登录',
					oidc_login_success: 'SSO 登录成功',
					oidc_login_failure: 'SSO 登录失败',
					oidc_logout: 'SSO 退出',
					oidc_discovery_failure: 'OIDC 发现失败',
				};
				function fmtTime(ts) {
					if (!ts) return '?';
					const d = new Date(ts);
					if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19).replace('T', ' ');
					const pad = (n) => String(n).padStart(2, '0');
					return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
				}

				return react.createElement('div', { className: 'wua-section' },
					react.createElement('p', { className: 'wua-intro' }, intro),
					patchWarn ? react.createElement('p', { className: 'wua-warn' }, patchWarn) : null,
					persistNote ? react.createElement('p', { className: 'wua-warn' }, persistNote) : null,
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, '用户名（3-32 位字母、数字、下划线或连字符）'),
						react.createElement('input', {
							className: 'wua-input',
							type: 'text',
							value: username,
							spellCheck: false,
							onChange: (e) => setUsername(e.target.value),
						}),
					),
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, enabled ? '新密码（留空表示不修改）' : '密码（至少 8 位，含大小写、数字、特殊符号）'),
						react.createElement('input', {
							className: 'wua-input',
							type: 'password',
							value: password,
							onChange: (e) => setPassword(e.target.value),
						}),
					),
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, '确认密码'),
						react.createElement('input', {
							className: 'wua-input',
							type: 'password',
							value: confirm,
							onChange: (e) => setConfirm(e.target.value),
						}),
					),
					enabled ? react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, '当前密码（修改或禁用认证需验证）'),
						react.createElement('input', {
							className: 'wua-input',
							type: 'password',
							value: current,
							onChange: (e) => setCurrent(e.target.value),
						}),
					) : null,
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, '会话有效期（登录后免登录时长）'),
						react.createElement('select', {
							className: 'wua-select',
							value: ttl,
							disabled: busy || status === null,
							onChange: (e) => setTtl(e.target.value),
						},
							react.createElement('option', { key: '0', value: '0' }, '浏览器会话：关闭浏览器后失效'),
							react.createElement('option', { key: '1', value: '1' }, '1 小时'),
							react.createElement('option', { key: '12', value: '12' }, '12 小时（默认）'),
							react.createElement('option', { key: '24', value: '24' }, '1 天'),
							react.createElement('option', { key: '72', value: '72' }, '3 天'),
						),
					),
					msg ? react.createElement('div', { className: msg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, msg.text) : null,
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, 'OIDC 单点登录'),
						react.createElement('label', { className: 'wua-label' },
							react.createElement('input', {
								type: 'checkbox',
								checked: oidcEnabled,
								onChange: (e) => setOidcEnabled(e.target.checked),
							}),
							' 启用（登录页显示「SSO 单点登录」按钮）'),
					),
					oidcEnabled ? react.createElement('div', { className: 'wua-section' },
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Issuer（IdP 地址，须为 https）'),
							react.createElement('input', { className: 'wua-input', type: 'text', value: oidcIssuer, spellCheck: false, onChange: (e) => setOidcIssuer(e.target.value) }),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Client ID'),
							react.createElement('input', { className: 'wua-input', type: 'text', value: oidcClientId, spellCheck: false, onChange: (e) => setOidcClientId(e.target.value) }),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Client Secret（留空保留原值；机密客户端必填）'),
							react.createElement('input', { className: 'wua-input', type: 'password', value: oidcClientSecret, autoComplete: 'new-password', onChange: (e) => setOidcClientSecret(e.target.value) }),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Scope（空格分隔）'),
							react.createElement('input', { className: 'wua-input', type: 'text', value: oidcScope, spellCheck: false, onChange: (e) => setOidcScope(e.target.value) }),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Redirect Base（可选；反代重写 Host 时必填，如 https://dsh.example.com）'),
							react.createElement('input', { className: 'wua-input', type: 'text', value: oidcRedirectBase, spellCheck: false, onChange: (e) => setOidcRedirectBase(e.target.value) }),
						),
						// 回调地址：给部署者抄进 IdP 的允许列表用。
						// 原生 OIDC 要求精确匹配，必须显示完整地址（含协议与端口）。
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, '回调地址（填入 IdP 的 Redirect URI 允许列表，须精确匹配）'),
							oidcRedirectUri
								? react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0, wordBreak: 'break-all' } },
									react.createElement('code', null, oidcRedirectUri))
								: react.createElement('p', { className: 'wua-warn' },
									'无法确定回调地址：请先填写上方 Redirect Base（或在本插件的 remote-web-ui 设置里配置 publicBaseUrl）。'),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' },
								react.createElement('input', { type: 'checkbox', checked: oidcTrustBrowser, onChange: (e) => setOidcTrustBrowser(e.target.checked) }),
								' 信任浏览器 origin（默认开启；关闭时仅用上方 Redirect Base）'),
						),
						react.createElement('div', { className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, 'Prompt（可选，建议留空）'),
							react.createElement('input', { className: 'wua-input', type: 'text', value: oidcPrompt, spellCheck: false, placeholder: '留空则不发送该参数', onChange: (e) => setOidcPrompt(e.target.value) }),
							react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0 } },
								'多数 IdP 无需该参数。部分 IdP 会对不认识的值直接拒绝授权（提示 unsupported prompt value requested），此时请保持留空。'),
						),
					) : null,
					// ---- OIDC 身份绑定 ----
					// 绑定是访问控制前提：未绑定时任何能通过该 IdP 的人都会被拒，
					// 登录页也不会显示 SSO 按钮。因此这块独立于"是否勾选启用"，
					// 只要 OIDC 已配置就展示当前绑定状态。
					oidcEnabled ? react.createElement('div', { className: 'wua-section' },
						react.createElement('label', { className: 'wua-label' }, 'OIDC 身份绑定'),
						oidcBound
							? react.createElement('p', { className: 'wua-intro' },
								'当前已绑定身份：', react.createElement('code', null, oidcBoundHint || '（已绑定）'),
								'。只有该身份可通过 SSO 登录。')
							: react.createElement('p', { className: 'wua-warn' },
								'尚未绑定任何 OIDC 身份。此时 OIDC 登录一律被拒绝，登录页也不会显示 SSO 按钮。请先保存上方配置，再点击「绑定 OIDC 身份」并完成一次 IdP 登录。'),
						oidcBound
							? react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '当前密码（解除绑定需验证）'),
								react.createElement('input', { className: 'wua-input', type: 'password', value: unbindPw, autoComplete: 'current-password', onChange: (e) => setUnbindPw(e.target.value) }),
							)
							: null,
						react.createElement('div', { className: 'wua-btnrow' },
							oidcBound
								? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onUnbind }, '解除绑定')
								: react.createElement('button', { className: 'wua-btn', disabled: busy || status === null, onClick: onBind }, '绑定 OIDC 身份'),
							oidcBound
								? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onBind }, '重新绑定其他身份')
								: null,
						),
						bindMsg ? react.createElement('p', { className: bindMsg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, bindMsg.text) : null,
					) : null,
					react.createElement('div', { className: 'wua-btnrow' },
						react.createElement('button', { className: 'wua-btn', disabled: busy || status === null, onClick: onSave },
							busy ? '保存中…' : '保存账号密码'),
						enabled ? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onDisable }, '禁用认证') : null,
						enabled ? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onLogout }, '退出登录') : null,
					),
					react.createElement('div', { className: 'wua-row' },
						react.createElement('label', { className: 'wua-label' }, '最近登录记录（完整审计日志可用 node index.js audit 查看）'),
						audit === null
							? react.createElement('p', { className: 'wua-intro' }, '正在读取…')
							: (audit.length === 0
								? react.createElement('p', { className: 'wua-intro' }, '暂无审计记录')
								: react.createElement('div', { className: 'wua-audit' },
									audit.map((entry, i) => react.createElement('div', { key: i, className: 'wua-audit-row' },
										react.createElement('span', { className: 'wua-audit-time' }, fmtTime(entry.ts)),
										react.createElement('span', { className: 'wua-audit-event' }, EVENT_LABELS[entry.event] || entry.event),
										entry.username ? react.createElement('span', { className: 'wua-audit-user' }, entry.username) : null,
										entry.ip ? react.createElement('span', { className: 'wua-audit-ip' }, entry.ip) : null,
									)),
								)),
					),
					react.createElement('p', { className: 'wua-hint' },
						'密码规则：至少 8 位，必须包含大写字母、小写字母、数字和特殊符号（如 !@#$%^&*）。认证在 HTTP/传输层强制执行（WebUI 资源、/api 接口、WebSocket 全部要求有效会话），会话保存在服务端并由 HttpOnly Cookie 携带，修改密码会吊销其他所有会话。凭据以 scrypt 哈希保存在插件目录的 dsh-webui-auth.json（0.2.0 起仅接受 scrypt，旧版 SHA-256 凭据需删除该文件重新创建）；忘记密码时删除该文件并重启 DSH 即可重置。可选用 OIDC 单点登录：配置 issuer/clientId/clientSecret 后登录页出现 SSO 按钮，认证通过后以 IdP 的 sub 作为本地会话用户名，并沿用相同的免登录时长机制。'),
				);
			}

			// ---------------- 注册 ----------------
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'webui-auth',
				order: 30,
				label: '身份认证',
			}, AuthSettings));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
