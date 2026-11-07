window.__ModuleLoader__.load({
	id: 'dsh-webui-oauth',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let react = require('react');

		const inject = ['slots'];

		const CSS = [
			'.wua-section { display: flex; flex-direction: column; gap: 16px; max-width: 760px; padding: 4px 2px; }',
			'.wua-card { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border: 1px solid var(--dsw-alias-border-l1, #e5e5e5); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #fff); }',
			'.wua-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }',
			'.wua-card-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
			'.wua-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
			'.wua-badge { font-size: 11px; line-height: 1.6; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }',
			'.wua-badge.ok { color: var(--dsw-alias-state-success-primary, #1a7f37); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 10%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 32%, transparent); }',
			'.wua-badge.warn { color: var(--dsw-alias-state-warn-primary, #9a6700); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #9a6700) 10%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #9a6700) 32%, transparent); }',
			'.wua-badge.muted { color: var(--dsw-alias-label-tertiary, #777); background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #777) 8%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-label-tertiary, #777) 22%, transparent); }',
			'.wua-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }',
			'.wua-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
			'.wua-sep { height: 1px; background: var(--dsw-alias-border-l1, #e5e5e5); margin: 2px 0; }',
			'.wua-kv { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
			'.wua-float { position: fixed; right: 24px; bottom: 24px; z-index: 9999; width: min(440px, calc(100vw - 48px)); display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border: 1px solid var(--dsw-alias-border-l2, #999); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 18px 48px rgba(0, 0, 0, .22); }',
			'.wua-float-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }',
			'.wua-float-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
			'.wua-inline-relay { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--dsw-alias-border-l1, #d9d9d9); }',

			'.wua-modal-mask { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, .45); }',
			'.wua-modal { width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 20px 22px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 24px 60px rgba(0, 0, 0, .35); }',
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

			// ---------------- DeepSeek 登录回调：合并进官方「等待登录」对话框 ----------------
			//
			// 官方账号登录是 SignInDialog（另一个插件）渲染的，没有开放插槽；但它等待
			// 浏览器时会显示一段固定文案（"没有自动打开新页面？" / "Page did not open
			// automatically?"）。这里用 MutationObserver 找到那段文案，把回调输入框
			// 插到同一个对话框里——不再单独挂一个悬浮按钮。
			//
			// 这是**尽力而为**的 DOM 适配：官方 UI 改版时最多退化成"不显示输入框"，
			// 不影响登录本身；/dsh-webui-oauth/oauth-relay 端点仍然可用。
			(function mountInlineRelay() {
				if (typeof document === 'undefined' || !document.body) return;
				const PROMPTS = ['没有自动打开新页面', 'Page did not open automatically'];
				const MARK = 'data-dsh-wua-relay-inline';
				let timer = null;
				const injected = new Set();

				const build = () => {
					const box = document.createElement('div');
					box.className = 'wua-inline-relay';
					box.setAttribute(MARK, '1');

					const label = document.createElement('div');
					label.className = 'wua-label';
					label.textContent = '远程访问？把浏览器地址栏里的完整回调 URL 粘贴到这里';

					const row = document.createElement('div');
					row.className = 'wua-actions';
					row.style.alignItems = 'stretch';
					const input = document.createElement('input');
					input.className = 'wua-input';
					input.type = 'text';
					input.placeholder = 'http://127.0.0.1:3080/oauth/callback?code=…&state=…';
					input.style.flex = '1';
					const submit = document.createElement('button');
					submit.type = 'button';
					submit.className = 'wua-btn';
					submit.textContent = '完成登录';
					row.appendChild(input);
					row.appendChild(submit);

					const msg = document.createElement('p');
					msg.style.display = 'none';
					box.appendChild(label);
					box.appendChild(row);
					box.appendChild(msg);

					const show = (text, ok) => {
						msg.textContent = text;
						msg.className = ok ? 'wua-msg' : 'wua-err';
						msg.style.display = 'block';
					};
					submit.addEventListener('click', () => {
						const url = input.value.trim();
						if (!url) { show('请粘贴完整回调地址', false); return; }
						submit.disabled = true;
						fetch('/dsh-webui-oauth/oauth-relay', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ url }),
						}).then((r) => {
							if (r.status === 401) { location.href = '/dsh-webui-oauth/login'; return null; }
							return r.json();
						}).then((res) => {
							submit.disabled = false;
							if (!res) return;
							if (res.ok) { show('已收到回调，正在完成登录…', true); input.value = ''; }
							else show(res.hint || res.reason || res.error || '中转失败', false);
						}).catch(() => { submit.disabled = false; show('无法连接认证服务', false); });
					});
					return box;
				};

				const scan = () => {
					for (const node of injected) {
						const anchor = node.__dshWuaAnchor;
						const stillWaiting = anchor && anchor.isConnected &&
							PROMPTS.some((p) => (anchor.textContent || '').includes(p));
						if (stillWaiting) continue;
						try { node.remove(); } catch (e) { /* ignore */ }
						injected.delete(node);
					}
					const paragraphs = document.querySelectorAll('p');
					for (const el of paragraphs) {
						const text = (el.textContent || '').trim();
						if (!PROMPTS.some((p) => text.includes(p))) continue;
						const host = el.parentElement;
						if (!host || host.querySelector('[' + MARK + ']')) continue;
						const box = build();
						box.__dshWuaAnchor = el;
						host.appendChild(box);
						injected.add(box);
						break;
					}
				};

				const schedule = () => {
					if (timer !== null) return;
					timer = setTimeout(() => {
						timer = null;
						try { scan(); } catch (e) { /* ignore */ }
					}, 200);
				};

				const observer = new MutationObserver(schedule);
				observer.observe(document.body, { childList: true, subtree: true, characterData: true });
				schedule();
				ctx.effect(() => () => {
					observer.disconnect();
					if (timer !== null) clearTimeout(timer);
					for (const node of injected) { try { node.remove(); } catch (e) { /* ignore */ } }
					injected.clear();
				}, 'dsh-webui-oauth: inline relay');
			})();

			// ---------------- 会话失效：统一回登录页 ----------------
			const LOGIN_PATH = '/dsh-webui-oauth/login';

			// 核心的 /api 调用不经过下面的 api() 帮助函数。会话过期后它们只会拿到
			// 401，页面要么显示错误、要么卡在加载态——用户不知道发生了什么。
			// 这里给同源 /api 的 401 补一次"送回登录页"：
			//   - 只认同源 /api（含 /api/xxx），不碰第三方接口与静态资源；
			//   - 已经在登录页就不再跳（防循环）；
			//   - 2 秒节流（并发请求同时 401 时只跳一次）。
			// 用全局标记防止热重载时重复包装；disposer 会把原 fetch 还回去。
			if (typeof window !== 'undefined' && typeof window.fetch === 'function' && window.__dshWuaFetchGuard !== true) {
				window.__dshWuaFetchGuard = true;
				const originalFetch = window.fetch.bind(window);
				let lastRedirectAt = 0;
				const guardedFetch = function (input, init) {
					return originalFetch(input, init).then((response) => {
						try {
							if (response && response.status === 401) {
								const raw = typeof input === 'string' ? input : (input && input.url) || '';
								const url = new URL(raw, location.href);
								const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
								const onLogin = location.pathname === LOGIN_PATH;
								if (url.origin === location.origin && isApi && !onLogin && Date.now() - lastRedirectAt > 2000) {
									lastRedirectAt = Date.now();
									location.href = LOGIN_PATH;
								}
							}
						} catch (e) { /* 解析失败不影响原响应 */ }
						return response;
					});
				};
				window.fetch = guardedFetch;
				ctx.effect(() => () => {
					if (window.fetch === guardedFetch) window.fetch = originalFetch;
					window.__dshWuaFetchGuard = false;
				}, 'dsh-webui-oauth: 401 guard');
			}

			// ---------------- 同源 HTTP API（会话 cookie 由浏览器自动携带） ----------------
			function api(path, body) {
				const opts = body === undefined
					? {}
					: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
				return fetch(path, opts).then((r) => {
					if (r.status === 401) {
						// 会话过期或无效：直接回登录页（不再先跳 '/'，少一次重定向）
						location.href = LOGIN_PATH;
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
				// 「仅允许 SSO」：勾选后未登录访问会自动跳转 SSO，并禁用密码登录接口。
				// 服务端还要求已绑定身份（否则会返回 oidc-sso-only-unbound）。
				const [oidcSsoOnly, setOidcSsoOnly] = react.useState(false);
				// prompt（可选）。默认留空 = 不发送该参数——不少 IdP 会对不认识的
				// prompt 值直接回 unsupported prompt value requested，导致授权发不出去。
				const [oidcPrompt, setOidcPrompt] = react.useState('');
				// 绑定状态：bound 表示已绑定某个 IdP 身份；boundSubHint 是掩码后的展示值
				// （服务端只回传掩码，前端拿不到 sub 明文，也不应该拿）。
				const [oidcBound, setOidcBound] = react.useState(false);
				const [oidcBoundHint, setOidcBoundHint] = react.useState('');
				const [unbindPw, setUnbindPw] = react.useState('');
				const [bindMsg, setBindMsg] = react.useState(null);
				// 敏感操作复验（保存配置 / 禁用 / 解绑）：密码或 SSO 一次性令牌。
				const [saveOpen, setSaveOpen] = react.useState(false);
				const [savePw, setSavePw] = react.useState('');
				const [saveErr, setSaveErr] = react.useState('');
				const [verifyAction, setVerifyAction] = react.useState('save');
				// 远程访问信任开关。
				const [remoteTrustBusy, setRemoteTrustBusy] = react.useState(false);
				const [remoteTrustMsg, setRemoteTrustMsg] = react.useState(null);
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
							setOidcSsoOnly(!!(o && o.ssoOnly));
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
					const reauth = p.get('oidcreauth')
					if (bound === null && err === null && reauth === null) return
					if (reauth !== null) {
						setBindMsg({ kind: 'ok', text: 'SSO 验证成功（2 分钟内有效）。请点击「保存设置」继续。' })
					} else if (bound !== null) {
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

				const onSave = (auth) => {
					if (busy) return;
					const credentials = auth || {};
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
					if (enabled && !credentials.current && !reauthValid) {
						setSaveErr('修改认证信息需要验证：请输入当前密码，或使用 SSO 验证。');
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
					// OIDC 关闭时不能「仅允许 SSO」，否则等于关掉所有登录入口
					ssoOnly: oidcEnabled ? oidcSsoOnly : false,
				};
				api('/dsh-webui-oauth/configure', {
						username: name,
						password,
						current: credentials.current || '',
						ttl: Number(ttl),
						oidc: oidcPayload,
					}).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							if (enabled) {
								setMsg({ kind: 'ok', text: '已保存。其他已登录的设备/浏览器会话已全部吊销，当前会话保持有效。' });
							} else {
								setMsg({ kind: 'ok', text: '已保存并启用认证，当前浏览器已登录。' });
							}
							setPassword('');
							setConfirm('');
							setSaveOpen(false);
							setSavePw('');
							setSaveErr('');
							api('/dsh-webui-oauth/status').then((s) => {
								if (s && !s.error) setStatus(s);
							});
						} else if (r && r.error === 'current-invalid') {
							setSaveErr('当前密码不正确');
							setMsg({ kind: 'err', text: '当前密码不正确' });
						} else if (r && r.error === 'weak-password') {
							const text = '密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号';
							setMsg({ kind: 'err', text }); setSaveErr(text);
						} else if (r && r.error === 'username-invalid') {
							const text = '用户名需为 3-32 位字母、数字、下划线或连字符';
							setMsg({ kind: 'err', text }); setSaveErr(text);
						} else if (r && r.error === 'legacy-hash') {
							const text = '当前凭据为旧版哈希（0.2.0 起仅支持 scrypt），必须填写新密码才能保存';
							setMsg({ kind: 'err', text }); setSaveErr(text);
						} else if (r && (r.error === 'oidc-sso-only-unbound' || r.error === 'oidc-sso-only-invalid')) {
							const text = (r && r.reason) || '无法启用「仅允许 SSO」';
							setMsg({ kind: 'err', text }); setSaveErr(text);
						} else if (r && typeof r.error === 'string') {
							// 服务端 500/未知错误：展示真实信息便于排查
							const text = '保存失败：' + r.error;
							setMsg({ kind: 'err', text }); setSaveErr(text);
						} else {
							const text = '保存失败，请检查输入';
							setMsg({ kind: 'err', text }); setSaveErr(text);
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '保存失败：无法连接认证服务' });
					});
				};

				const doDisable = (auth) => {
					if (busy) return;
					const credentials = auth || {};
					if (!credentials.current && !reauthValid) {
						setSaveErr('禁用认证需要验证：请输入当前密码，或使用 SSO 验证。');
						return;
					}
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-oauth/disable', { current: credentials.current || '' }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已禁用认证，所有会话已注销。刷新页面后不再要求登录。' });
							setSaveOpen(false);
							setSavePw('');
							setSaveErr('');
							api('/dsh-webui-oauth/status').then((s) => {
								if (s && !s.error) setStatus(s);
							}).catch(() => {});
						} else {
							setSaveErr('当前密码不正确');
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
						} else if (r && r.error === 'sso-only-active') {
							setBindMsg({ kind: 'err', text: (r && r.hint) || '请先关闭「仅允许 SSO」再解绑' });
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
				const remoteTrust = Boolean(status && status.remoteTrust);
				const reauthValid = Boolean(status && status.reauthActive);

				// 顶部「保存设置」/「禁用认证」：需要验证时统一打开弹窗（密码或 SSO）。
				const onSaveClick = () => {
					if (!enabled || reauthValid) { onSave({}); return; }
					setVerifyAction('save');
					setSaveErr('');
					setSaveOpen(true);
				};
				const onDisableClick = () => {
					if (!enabled) return;
					if (reauthValid) { doDisable({}); return; }
					setVerifyAction('disable');
					setSaveErr('');
					setSaveOpen(true);
				};
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

				const onToggleRemoteTrust = () => {
					if (remoteTrustBusy) return;
					const next = !remoteTrust;
					setRemoteTrustBusy(true);
					setRemoteTrustMsg(null);
					api('/dsh-webui-oauth/remote-trust', { enabled: next }).then((r) => {
						setRemoteTrustBusy(false);
						if (r && r.ok) {
							setStatus((s) => (s ? { ...s, remoteTrust: !!r.enabled } : s));
							setRemoteTrustMsg({
								kind: 'ok',
								text: r.enabled
									? '已开启远程访问信任。刷新页面后生效（设置 → 模型应可正常加载）。'
									: '已关闭远程访问信任。刷新页面后生效。',
							});
						} else {
							setRemoteTrustMsg({ kind: 'err', text: (r && (r.reason || r.error)) || '操作失败' });
						}
					}).catch(() => {
						setRemoteTrustBusy(false);
						setRemoteTrustMsg({ kind: 'err', text: '无法连接认证服务' });
					});
				};

				// ---- 渲染辅助：卡片 + 徽章，避免重复嵌套 ----
				const badge = (text, kind) => react.createElement('span', { className: 'wua-badge ' + (kind || 'muted') }, text);
				const card = (title, badges, children) => react.createElement('section', { className: 'wua-card' },
					react.createElement('div', { className: 'wua-card-head' },
						react.createElement('h3', { className: 'wua-card-title' }, title),
						react.createElement('div', { className: 'wua-badges' }, ...(badges || []).filter(Boolean))),
					...(children || []));

				return react.createElement('div', { className: 'wua-section' },
					card('概览', [
						enabled ? badge('认证已启用', 'ok') : badge('认证未启用', 'muted'),
						oidcEnabled ? badge('OIDC 已启用', 'ok') : badge('OIDC 未启用', 'muted'),
						oidcEnabled ? (oidcBound ? badge('身份已绑定', 'ok') : badge('身份未绑定', 'warn')) : null,
						(status && status.oidc && status.oidc.ssoOnlyActive) ? badge('仅允许 SSO', 'ok') : null,
						remoteTrust ? badge('远程信任已开启', 'ok') : null,
					], [
						react.createElement('p', { className: 'wua-intro' }, intro),
						patchWarn ? react.createElement('p', { className: 'wua-warn' }, patchWarn) : null,
						persistNote ? react.createElement('p', { className: 'wua-warn' }, persistNote) : null,
						react.createElement('div', { className: 'wua-actions' },
							react.createElement('button', { className: 'wua-btn', disabled: busy || status === null, onClick: onSaveClick }, busy ? '保存中…' : '保存设置'),
							enabled ? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onLogout }, '退出登录') : null,
							enabled ? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onDisableClick }, '禁用认证') : null,
						),
					]),
					card('账号与密码', [], [
						react.createElement('div', { className: 'wua-grid' },
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '用户名（3-32 位字母、数字、下划线或连字符）'),
								react.createElement('input', { className: 'wua-input', type: 'text', value: username, spellCheck: false, onChange: (e) => setUsername(e.target.value) }),
							),
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '会话有效期（登录后免登录时长）'),
								react.createElement('select', { className: 'wua-select', value: ttl, disabled: busy || status === null, onChange: (e) => setTtl(e.target.value) },
									react.createElement('option', { key: '0', value: '0' }, '浏览器会话：关闭浏览器后失效'),
									react.createElement('option', { key: '1', value: '1' }, '1 小时'),
									react.createElement('option', { key: '12', value: '12' }, '12 小时（默认）'),
									react.createElement('option', { key: '24', value: '24' }, '1 天'),
									react.createElement('option', { key: '72', value: '72' }, '3 天'),
								),
							),
						),
						react.createElement('div', { className: 'wua-grid' },
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, enabled ? '新密码（留空表示不修改）' : '密码（至少 8 位，含大小写、数字、特殊符号）'),
								react.createElement('input', { className: 'wua-input', type: 'password', value: password, onChange: (e) => setPassword(e.target.value) }),
							),
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '确认密码'),
								react.createElement('input', { className: 'wua-input', type: 'password', value: confirm, onChange: (e) => setConfirm(e.target.value) }),
							),
						),
						msg ? react.createElement('div', { className: msg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, msg.text) : null,
					]),
					card('OIDC 单点登录', [
						oidcEnabled ? badge('已启用', 'ok') : badge('未启用', 'muted'),
						(oidcEnabled && oidcBound) ? badge('身份已绑定', 'ok') : null,
					], [
						react.createElement('label', { className: 'wua-label' },
							react.createElement('input', { type: 'checkbox', checked: oidcEnabled, onChange: (e) => setOidcEnabled(e.target.checked) }),
							' 启用（登录页显示「SSO 单点登录」按钮）'),
						oidcEnabled ? react.createElement('div', { className: 'wua-section', style: { gap: '12px' } },
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' },
									react.createElement('input', { type: 'checkbox', checked: oidcSsoOnly, onChange: (e) => setOidcSsoOnly(e.target.checked) }),
									' 仅允许 SSO（未登录时自动跳转到 SSO，并禁用密码登录）'),
								react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0 } },
									oidcBound
										? '启用后密码登录接口会被拒绝，未登录访问一律跳转 SSO。请确认 IdP 可用，否则将无法登录；如被锁在门外，可手工把 dsh-webui-oauth.json 里的 ssoOnly 改回 false。'
										: '尚未绑定 OIDC 身份，无法启用：请先在下方完成「绑定 OIDC 身份」。'),
							),
							react.createElement('div', { className: 'wua-grid' },
								react.createElement('div', { className: 'wua-row' },
									react.createElement('label', { className: 'wua-label' }, 'Issuer（IdP 地址，须为 https）'),
									react.createElement('input', { className: 'wua-input', type: 'text', value: oidcIssuer, spellCheck: false, onChange: (e) => setOidcIssuer(e.target.value) }),
								),
								react.createElement('div', { className: 'wua-row' },
									react.createElement('label', { className: 'wua-label' }, 'Client ID'),
									react.createElement('input', { className: 'wua-input', type: 'text', value: oidcClientId, spellCheck: false, onChange: (e) => setOidcClientId(e.target.value) }),
								),
							),
							react.createElement('div', { className: 'wua-grid' },
								react.createElement('div', { className: 'wua-row' },
									react.createElement('label', { className: 'wua-label' }, 'Client Secret（留空保留原值；机密客户端必填）'),
									react.createElement('input', { className: 'wua-input', type: 'password', value: oidcClientSecret, autoComplete: 'new-password', onChange: (e) => setOidcClientSecret(e.target.value) }),
								),
								react.createElement('div', { className: 'wua-row' },
									react.createElement('label', { className: 'wua-label' }, 'Scope（空格分隔）'),
									react.createElement('input', { className: 'wua-input', type: 'text', value: oidcScope, spellCheck: false, onChange: (e) => setOidcScope(e.target.value) }),
								),
							),
							react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, 'Redirect Base（可选；反代重写 Host 时必填，如 https://dsh.example.com）'),
								react.createElement('input', { className: 'wua-input', type: 'text', value: oidcRedirectBase, spellCheck: false, onChange: (e) => setOidcRedirectBase(e.target.value) }),
							),
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
					]),
					oidcEnabled ? card('OIDC 身份绑定', [
						oidcBound ? badge('已绑定', 'ok') : badge('未绑定', 'warn'),
					], [
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
						react.createElement('div', { className: 'wua-actions' },
							oidcBound
								? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onUnbind }, '解除绑定')
								: react.createElement('button', { className: 'wua-btn', disabled: busy || status === null, onClick: onBind }, '绑定 OIDC 身份'),
							oidcBound
								? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onBind }, '重新绑定其他身份')
								: null,
						),
						bindMsg ? react.createElement('p', { className: bindMsg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, bindMsg.text) : null,
					]) : null,
					card('远程访问', [
						remoteTrust ? badge('远程信任已开启', 'ok') : badge('远程信任未开启', 'muted'),
					], [
						react.createElement('p', { className: 'wua-intro' },
							remoteTrust
								? '已通过 index.html 注入 __DSH_TRANSPORT__.ownsHost = true，反代域名下「设置 → 模型」可正常读取。刷新页面后生效。'
								: '若经域名反代访问时「设置 → 模型」报 settings are unavailable in this browser，可开启远程访问信任。'),
						react.createElement('div', { className: 'wua-actions' },
							react.createElement('button', {
								className: 'wua-btn',
								disabled: remoteTrustBusy || status === null,
								onClick: onToggleRemoteTrust,
							}, remoteTrustBusy ? '处理中…' : (remoteTrust ? '关闭远程访问信任' : '开启远程访问信任')),
						),
						remoteTrustMsg ? react.createElement('p', { className: remoteTrustMsg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, remoteTrustMsg.text) : null,
						react.createElement('div', { className: 'wua-sep' }),
						react.createElement('h4', { className: 'wua-card-title' }, 'DeepSeek 官方账号登录（远程回调）'),
						react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0 } },
							'在「设置 → 账号」点击 DeepSeek 登录后，浏览器会跳到 127.0.0.1 的回调地址（远程机器上通常打不开）。官方「等待登录」窗口里会直接出现一个粘贴框：把地址栏里的完整 URL 粘进去即可。'),
					]),
					card('最近登录记录', [], [
						react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0 } },
							'完整审计日志可用 node index.js audit 查看。'),
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
					]),
					saveOpen ? react.createElement('div', { className: 'wua-modal-mask' },
						react.createElement('div', { className: 'wua-modal' },
							react.createElement('h4', { className: 'wua-card-title' }, verifyAction === 'disable' ? '验证后禁用' : '验证后保存'),
							react.createElement('p', { className: 'wua-hint', style: { borderTop: 'none', paddingTop: 0 } },
								reauthValid
									? '已通过 SSO 验证（2 分钟内有效），可直接继续。'
									: '该操作需要验证当前身份：输入当前密码，或使用 SSO 验证。'),
							reauthValid ? null : react.createElement('div', { className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '当前密码'),
								react.createElement('input', { className: 'wua-input', type: 'password', value: savePw, autoComplete: 'current-password', onChange: (e) => setSavePw(e.target.value) }),
							),
							saveErr ? react.createElement('p', { className: 'wua-err' }, saveErr) : null,
							react.createElement('div', { className: 'wua-actions' },
								react.createElement('button', { className: 'wua-btn', disabled: busy, onClick: () => {
									if (!reauthValid && !savePw) { setSaveErr('请输入当前密码'); return; }
									const auth = reauthValid ? {} : { current: savePw };
									if (verifyAction === 'disable') doDisable(auth); else onSave(auth);
								} }, busy ? '处理中…' : (verifyAction === 'disable' ? '验证并禁用' : '验证并保存')),
								react.createElement('button', { className: 'wua-btn ghost', disabled: busy, onClick: () => setSaveOpen(false) }, '取消'),
							),
							(status && status.oidc && status.oidc.enabled && status.oidc.bound)
								? react.createElement('button', { className: 'wua-btn ghost', disabled: busy, onClick: () => {
									location.href = '/dsh-webui-oauth/oidc/reauth?base=' + encodeURIComponent(location.origin || '');
								} }, '使用 SSO 验证')
								: null,
						),
					) : null,
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
