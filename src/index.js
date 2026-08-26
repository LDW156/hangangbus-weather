const COOKIE_NAME = 'hb_portal_session';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/auth/bootstrap/status' && request.method === 'GET') {
      return bootstrapStatus(env);
    }
    if (path === '/api/auth/bootstrap' && request.method === 'POST') {
      return bootstrapAdmin(request, env);
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      return login(request, env);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return logout(request, env);
    }
    if (path === '/logout' && request.method === 'GET') {
      return logoutRedirect(request, env);
    }
    if (path === '/api/auth/me' && request.method === 'GET') {
      return me(request, env);
    }
    if (path === '/api/auth/change-password' && request.method === 'POST') {
      return changePassword(request, env);
    }
    if (path.startsWith('/api/history/')) {
      return proxyHistoryApi(request, env);
    }

    if (path === '/api/admin/users' && request.method === 'GET') {
      return adminListUsers(request, env);
    }
    if (path === '/api/admin/users' && request.method === 'POST') {
      return adminCreateUser(request, env);
    }
    if (path.startsWith('/api/admin/users/') && request.method === 'PATCH') {
      return adminUpdateUser(request, env);
    }
    if (path.endsWith('/reset-password') && path.startsWith('/api/admin/users/') && request.method === 'POST') {
      return adminResetPassword(request, env);
    }
    if (path.startsWith('/api/admin/users/') && request.method === 'DELETE') {
      return adminDeleteUser(request, env);
    }
    if (path === '/api/admin/audit' && request.method === 'GET') {
      return adminAudit(request, env);
    }

    if (path === '/setup') {
      const count = await userCount(env);
      if (count > 0) return Response.redirect(new URL('/home.html', url), 302);
      return noStoreAsset(await env.ASSETS.fetch(assetRequest(request, '/setup.html')));
    }

    const publicAsset = isPublicAsset(path);
    if (publicAsset) {
      if (path === '/' || path === '') {
        return noStoreAsset(await env.ASSETS.fetch(assetRequest(request, '/home.html')));
      }
      const response = await env.ASSETS.fetch(request);
      return (path === '/home.html' || path === '/setup.html') ? noStoreAsset(response) : response;
    }

    const isNavigation = request.headers.get('sec-fetch-mode') === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html');
    const auth = await authenticate(request, env, { checkDb: isNavigation || path === '/admin-users.html' });

    if (!auth.ok) {
      if (isNavigation) {
        const home = new URL('/home.html', url);
        home.searchParams.set('return', path + url.search);
        return Response.redirect(home, 302);
      }
      return json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    }

    if (path === '/admin-users.html' && auth.user.role !== 'admin') {
      return htmlError(403, '접근 권한이 없습니다.', '관리자 권한이 필요한 화면입니다.');
    }

    const response = await env.ASSETS.fetch(request);
    return isNavigation ? noStoreAsset(response) : response;
  }
};


async function proxyHistoryApi(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { 'Allow': 'GET, HEAD' });
  }

  const auth = await authenticate(request, env, { checkDb: true });
  if (!auth.ok) {
    return json({ ok: false, error: 'AUTH_REQUIRED' }, 401, {
      'Set-Cookie': clearCookie(),
      'Cache-Control': 'no-store, private'
    });
  }

  if (!env.HISTORY_API || typeof env.HISTORY_API.fetch !== 'function') {
    return json({ ok: false, error: 'HISTORY_SERVICE_UNAVAILABLE' }, 503);
  }

  const incoming = new URL(request.url);
  const upstreamUrl = new URL(request.url);
  upstreamUrl.pathname = incoming.pathname.replace(/^\/api\/history/, '') || '/';

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete('cookie');
  upstreamHeaders.delete('authorization');
  upstreamHeaders.delete('cf-connecting-ip');
  upstreamHeaders.delete('x-forwarded-for');
  upstreamHeaders.set('x-hangang-portal-user', auth.user.user_id);
  upstreamHeaders.set('x-hangang-portal-role', auth.user.role);

  const upstreamRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual'
  });

  try {
    const upstream = await env.HISTORY_API.fetch(upstreamRequest);
    const headers = new Headers(upstream.headers);
    headers.delete('access-control-allow-origin');
    headers.delete('access-control-allow-credentials');
    headers.delete('access-control-allow-headers');
    headers.delete('access-control-allow-methods');
    headers.set('Cache-Control', 'no-store, private');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  } catch (error) {
    return json({
      ok: false,
      error: 'HISTORY_PROXY_FAILED',
      message: String(error?.message || error || 'history proxy failed').slice(0, 180)
    }, 502);
  }
}

function isPublicAsset(path) {
  return path === '/' || path === '/home.html' || path === '/setup.html' ||
    path === '/favicon.ico' || path === '/assets/hangangbus-logo.png' ||
    path === '/assets/icon-192.png' || path === '/assets/icon-512.png';
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function bootstrapStatus(env) {
  const count = await userCount(env);
  return json({ ok: true, needsBootstrap: count === 0 });
}

async function bootstrapAdmin(request, env) {
  const count = await userCount(env);
  if (count > 0) return json({ ok: false, error: 'BOOTSTRAP_CLOSED' }, 409);
  if (!env.BOOTSTRAP_TOKEN) return json({ ok: false, error: 'BOOTSTRAP_SECRET_MISSING' }, 503);
  const token = request.headers.get('x-bootstrap-token') || '';
  if (!constantTimeStringEqual(token, env.BOOTSTRAP_TOKEN)) {
    await audit(env, request, null, 'bootstrap_failed', false, { reason: 'bad_token' });
    return json({ ok: false, error: 'INVALID_BOOTSTRAP_TOKEN' }, 403);
  }

  const body = await readJson(request);
  const valid = validateUserPayload(body, true);
  if (!valid.ok) return json(valid, 400);
  if (!valid.password || valid.password.length < 10) {
    return json({ ok: false, error: 'PASSWORD_TOO_SHORT', message: '비밀번호는 10자 이상이어야 합니다.' }, 400);
  }

  const now = new Date().toISOString();
  const password = await makePassword(valid.password, valid.userId, env);
  await env.DB.prepare(`
    INSERT INTO users (
      user_id, display_name, email, organization, position, role, status,
      password_salt, password_hash, password_iterations, must_change_password,
      created_at, updated_at, approved_at, approved_by
    ) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?, 0, ?, ?, ?, NULL)
  `).bind(
    valid.userId, valid.displayName, valid.email, valid.organization, valid.position,
    password.salt, password.hash, password.iterations, now, now, now
  ).run();

  await audit(env, request, valid.userId, 'bootstrap_admin_created', true, { email: valid.email });
  return json({ ok: true, userId: valid.userId, message: '최초 관리자 계정이 생성되었습니다.' }, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const userId = normalizeUserId(body?.userId);
  const password = String(body?.password || '');
  if (!userId || !password) return json({ ok: false, error: 'INVALID_INPUT' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
  if (!user) {
    await audit(env, request, userId, 'login_failed', false, { reason: 'not_found' });
    return loginError();
  }
  if (user.status !== 'active') {
    await audit(env, request, userId, 'login_failed', false, { reason: 'inactive', status: user.status });
    return json({ ok: false, error: 'ACCOUNT_INACTIVE', message: '승인 또는 활성화되지 않은 계정입니다.' }, 403);
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await audit(env, request, userId, 'login_failed', false, { reason: 'locked' });
    return json({ ok: false, error: 'ACCOUNT_TEMP_LOCKED', message: '로그인 실패가 반복되어 잠시 잠겼습니다.' }, 429);
  }

  const verified = await verifyPassword(password, user.user_id, user.password_salt, user.password_hash, Number(user.password_iterations || 210000), env);
  if (!verified) {
    const failed = Number(user.failed_login_count || 0) + 1;
    const lockedUntil = failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE user_id = ?')
      .bind(failed >= 5 ? 0 : failed, lockedUntil, new Date().toISOString(), userId).run();
    await audit(env, request, userId, 'login_failed', false, { reason: 'bad_password', locked: !!lockedUntil });
    return loginError();
  }

  const sessionHours = clamp(Number(env.SESSION_HOURS || 8), 1, 24);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionHours * 3600 * 1000);
  const sid = randomToken(32);
  const sessionHash = await sha256Base64Url(sid);
  const authToken = await signSession({ sid, userId, role: user.role, exp: Math.floor(expiresAt.getTime() / 1000) }, env);
  const ipPrefix = getIpPrefix(request);
  const ua = (request.headers.get('user-agent') || '').slice(0, 300);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (session_hash, user_id, created_at, expires_at, last_seen_at, ip_prefix, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(sessionHash, userId, createdAt.toISOString(), expiresAt.toISOString(), createdAt.toISOString(), ipPrefix, ua),
    env.DB.prepare(`UPDATE users SET last_login_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`)
      .bind(createdAt.toISOString(), createdAt.toISOString(), userId)
  ]);

  await audit(env, request, userId, 'login_success', true, { role: user.role });
  return json({
    ok: true,
    user: publicUser(user),
    mustChangePassword: !!user.must_change_password
  }, 200, {
    'Set-Cookie': makeCookie(authToken, sessionHours * 3600)
  });
}

async function cleanupLogoutSession(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return;
  try {
    const parsed = await verifySignedSession(token, env);
    if (!parsed?.sid) return;
    const hash = await sha256Base64Url(parsed.sid);
    try {
      await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(hash).run();
    } catch {}
    await audit(env, request, parsed.userId || null, 'logout', true, null);
  } catch {}
}

async function logout(request, env) {
  await cleanupLogoutSession(request, env);
  return json({ ok: true }, 200, {
    'Set-Cookie': clearCookie(),
    'Cache-Control': 'no-store, private'
  });
}

async function logoutRedirect(request, env) {
  await cleanupLogoutSession(request, env);
  const target = new URL('/home.html?loggedout=1', request.url);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': target.toString(),
      'Set-Cookie': clearCookie(),
      'Cache-Control': 'no-store, private',
      'Pragma': 'no-cache'
    }
  });
}

async function me(request, env) {
  const auth = await authenticate(request, env, { checkDb: true });
  if (!auth.ok) return json({ ok: false, error: 'AUTH_REQUIRED' }, 401, { 'Set-Cookie': clearCookie() });
  return json({ ok: true, user: publicUser(auth.user), mustChangePassword: !!auth.user.must_change_password });
}

async function changePassword(request, env) {
  const auth = await authenticate(request, env, { checkDb: true });
  if (!auth.ok) return json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
  const body = await readJson(request);
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (newPassword.length < 10) return json({ ok: false, error: 'PASSWORD_TOO_SHORT' }, 400);
  const ok = await verifyPassword(currentPassword, auth.user.user_id, auth.user.password_salt, auth.user.password_hash, Number(auth.user.password_iterations || 210000), env);
  if (!ok) return json({ ok: false, error: 'CURRENT_PASSWORD_INVALID' }, 403);
  const next = await makePassword(newPassword, auth.user.user_id, env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_salt=?, password_hash=?, password_iterations=?, must_change_password=0, updated_at=? WHERE user_id=?`)
      .bind(next.salt, next.hash, next.iterations, now, auth.user.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND session_hash<>?')
      .bind(auth.user.user_id, await sha256Base64Url(auth.session.sid))
  ]);
  await audit(env, request, auth.user.user_id, 'password_changed', true, null);
  return json({ ok: true });
}

async function adminListUsers(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const result = await env.DB.prepare(`SELECT user_id, display_name, email, organization, position, role, status,
      must_change_password, created_at, approved_at, last_login_at
      FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC`).all();
  return json({ ok: true, users: result.results || [] });
}

async function adminCreateUser(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const valid = validateUserPayload(body, false);
  if (!valid.ok) return json(valid, 400);
  const passwordText = String(body?.tempPassword || '');
  if (passwordText.length < 10) return json({ ok: false, error: 'PASSWORD_TOO_SHORT' }, 400);
  const role = ['admin','operator','viewer'].includes(body?.role) ? body.role : 'viewer';
  const status = ['active','pending','disabled'].includes(body?.status) ? body.status : 'pending';
  const pass = await makePassword(passwordText, valid.userId, env);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO users (
      user_id, display_name, email, organization, position, role, status,
      password_salt, password_hash, password_iterations, must_change_password,
      created_at, updated_at, approved_at, approved_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(valid.userId, valid.displayName, valid.email, valid.organization, valid.position,
        role, status, pass.salt, pass.hash, pass.iterations, now, now,
        status === 'active' ? now : null, status === 'active' ? auth.user.user_id : null).run();
  } catch (error) {
    return json({ ok: false, error: 'USER_CREATE_FAILED', message: safeDbMessage(error) }, 409);
  }
  await audit(env, request, auth.user.user_id, 'admin_user_created', true, { target: valid.userId, role, status });
  return json({ ok: true, userId: valid.userId }, 201);
}

async function adminUpdateUser(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const targetId = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
  const existing = await env.DB.prepare('SELECT * FROM users WHERE user_id=?').bind(targetId).first();
  if (!existing) return json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
  const body = await readJson(request);
  const displayName = cleanText(body?.displayName, 80) ?? existing.display_name;
  const email = cleanEmail(body?.email) ?? existing.email;
  const organization = cleanText(body?.organization, 120) ?? existing.organization;
  const position = cleanText(body?.position, 120) ?? existing.position;
  const role = ['admin','operator','viewer'].includes(body?.role) ? body.role : existing.role;
  const status = ['active','pending','disabled'].includes(body?.status) ? body.status : existing.status;

  if (targetId === auth.user.user_id && (role !== 'admin' || status !== 'active')) {
    return json({ ok: false, error: 'CANNOT_DEMOTE_SELF' }, 400);
  }
  const now = new Date().toISOString();
  const approvedAt = status === 'active' && existing.status !== 'active' ? now : existing.approved_at;
  const approvedBy = status === 'active' && existing.status !== 'active' ? auth.user.user_id : existing.approved_by;
  await env.DB.prepare(`UPDATE users SET display_name=?, email=?, organization=?, position=?, role=?, status=?,
    updated_at=?, approved_at=?, approved_by=? WHERE user_id=?`)
    .bind(displayName, email, organization, position, role, status, now, approvedAt, approvedBy, targetId).run();
  if (status !== 'active') await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(targetId).run();
  await audit(env, request, auth.user.user_id, 'admin_user_updated', true, { target: targetId, role, status });
  return json({ ok: true });
}

async function adminResetPassword(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const parts = new URL(request.url).pathname.split('/');
  const targetId = decodeURIComponent(parts[parts.length - 2]);
  const body = await readJson(request);
  const tempPassword = String(body?.tempPassword || '');
  if (tempPassword.length < 10) return json({ ok: false, error: 'PASSWORD_TOO_SHORT' }, 400);
  const existing = await env.DB.prepare('SELECT user_id FROM users WHERE user_id=?').bind(targetId).first();
  if (!existing) return json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
  const pass = await makePassword(tempPassword, targetId, env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_salt=?, password_hash=?, password_iterations=?, must_change_password=1, updated_at=? WHERE user_id=?`)
      .bind(pass.salt, pass.hash, pass.iterations, now, targetId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(targetId)
  ]);
  await audit(env, request, auth.user.user_id, 'admin_password_reset', true, { target: targetId });
  return json({ ok: true });
}

async function adminDeleteUser(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const targetId = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
  if (targetId === auth.user.user_id) return json({ ok: false, error: 'CANNOT_DELETE_SELF' }, 400);
  const existing = await env.DB.prepare('SELECT user_id, role FROM users WHERE user_id=?').bind(targetId).first();
  if (!existing) return json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(targetId),
    env.DB.prepare('DELETE FROM users WHERE user_id=?').bind(targetId)
  ]);
  await audit(env, request, auth.user.user_id, 'admin_user_deleted', true, { target: targetId, role: existing.role });
  return json({ ok: true });
}

async function adminAudit(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const limit = clamp(Number(new URL(request.url).searchParams.get('limit') || 100), 1, 500);
  const result = await env.DB.prepare(`SELECT id, user_id, event_type, success, ip_prefix, detail_json, created_at
    FROM audit_logs ORDER BY id DESC LIMIT ?`).bind(limit).all();
  return json({ ok: true, logs: result.results || [] });
}

async function requireAdmin(request, env) {
  const auth = await authenticate(request, env, { checkDb: true });
  if (!auth.ok) return { response: json({ ok: false, error: 'AUTH_REQUIRED' }, 401) };
  if (auth.user.role !== 'admin') return { response: json({ ok: false, error: 'ADMIN_REQUIRED' }, 403) };
  return auth;
}

async function authenticate(request, env, { checkDb = true } = {}) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return { ok: false };
  const session = await verifySignedSession(token, env);
  if (!session || !session.sid || !session.userId || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false };
  }
  if (!checkDb) {
    return { ok: true, session, user: { user_id: session.userId, role: session.role, status: 'active' } };
  }
  const hash = await sha256Base64Url(session.sid);
  const row = await env.DB.prepare(`SELECT u.*, s.expires_at AS session_expires_at
    FROM sessions s JOIN users u ON u.user_id=s.user_id
    WHERE s.session_hash=?`).bind(hash).first();
  if (!row || row.status !== 'active' || new Date(row.session_expires_at).getTime() <= Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(hash).run();
    return { ok: false };
  }
  return { ok: true, session, user: row };
}

async function signSession(payload, env) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured');
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifySignedSession(token, env) {
  if (!env.SESSION_SECRET) return null;
  const [payloadPart, sigPart] = String(token).split('.');
  if (!payloadPart || !sigPart) return null;
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sigPart), encoder.encode(payloadPart));
    if (!ok) return null;
    return JSON.parse(decoder.decode(base64UrlDecode(payloadPart)));
  } catch {
    return null;
  }
}

async function makePassword(password, userId, env) {
  if (!env.PASSWORD_PEPPER) throw new Error('PASSWORD_PEPPER is not configured');
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = base64UrlEncode(saltBytes);
  const hash = await passwordPepperHash(password, userId, salt, env);
  // password_iterations=1 marks the Free-plan-safe peppered HMAC scheme.
  return { salt, hash: base64UrlEncode(hash), iterations: 1 };
}

async function verifyPassword(password, userId, saltText, expectedHashText, iterations, env) {
  try {
    const expected = base64UrlDecode(expectedHashText);

    // v1.7+: fast keyed password verifier for Workers Free 10ms CPU limit.
    if (Number(iterations) === 1) {
      if (!env.PASSWORD_PEPPER) return false;
      const actual = await passwordPepperHash(password, userId, saltText, env);
      return constantTimeBytesEqual(actual, expected);
    }

    // Legacy fallback only. There are no legacy users at the time v1.7 is introduced.
    const actual = await derivePasswordLegacy(password, base64UrlDecode(saltText), iterations);
    return constantTimeBytesEqual(actual, expected);
  } catch {
    return false;
  }
}

async function passwordPepperHash(password, userId, saltText, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.PASSWORD_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const material = `hangangbus-password-v1\n${String(userId)}\n${String(saltText)}\n${String(password)}`;
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(material));
  return new Uint8Array(mac);
}

async function derivePasswordLegacy(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: Number(iterations || 210000) },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function audit(env, request, userId, eventType, success, detail) {
  try {
    await env.DB.prepare(`INSERT INTO audit_logs (user_id,event_type,success,ip_prefix,user_agent,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
        userId || null, eventType, success ? 1 : 0, getIpPrefix(request),
        (request.headers.get('user-agent') || '').slice(0, 300), detail ? JSON.stringify(detail) : null,
        new Date().toISOString()
      ).run();
  } catch {}
}

async function userCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  return Number(row?.count || 0);
}

function validateUserPayload(body, includePassword) {
  const userId = normalizeUserId(body?.userId);
  const displayName = cleanText(body?.displayName, 80);
  const email = cleanEmail(body?.email);
  const organization = cleanText(body?.organization, 120) || '';
  const position = cleanText(body?.position, 120) || '';
  const password = includePassword ? String(body?.password || '') : undefined;
  if (!userId || !displayName || !email) return { ok: false, error: 'INVALID_USER_DATA', message: 'ID, 이름, 이메일을 확인하십시오.' };
  return { ok: true, userId, displayName, email, organization, position, password };
}

function normalizeUserId(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(v) ? v : null;
}
function cleanEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 180 ? v : null;
}
function cleanText(value, max) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v && v.length <= max ? v : null;
}
function publicUser(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    organization: row.organization || '',
    position: row.position || '',
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at || null
  };
}

function loginError() {
  return json({ ok: false, error: 'LOGIN_FAILED', message: 'ID 또는 비밀번호를 확인하십시오.' }, 401);
}
function safeDbMessage(error) {
  const text = String(error?.message || error || '');
  if (text.includes('UNIQUE')) return '이미 사용 중인 ID 또는 이메일입니다.';
  return '사용자 저장 중 오류가 발생했습니다.';
}

function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
function makeCookie(value, maxAge) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function noStoreAsset(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function getIpPrefix(request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip.includes('.')) {
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : '';
  }
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::/64';
  return '';
}
function randomToken(bytes) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return base64UrlEncode(new Uint8Array(digest));
}
function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlDecode(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function constantTimeBytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function constantTimeStringEqual(a, b) {
  const aa = encoder.encode(String(a));
  const bb = encoder.encode(String(b));
  return constantTimeBytesEqual(aa, bb);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}
function htmlError(status, title, message) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;background:#eef4f7;color:#173d52;display:grid;place-items:center;height:100vh;margin:0}.c{background:#fff;border:1px solid #d4e1e8;border-radius:16px;padding:34px;max-width:520px}h1{margin:0 0 10px;font-size:24px}p{margin:0;color:#67808d}</style><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
