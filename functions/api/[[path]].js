function uuid() { return crypto.randomUUID(); }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nowJST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T');
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM sessions WHERE token = ? AND created_at > datetime('now', '-24 hours')"
  ).bind(token).first();
  return !!row;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  // ── 公開 API ─────────────────────────────────────────────

  if (method === 'GET' && path === '/users') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, leave FROM users WHERE active = 1 ORDER BY rowid'
    ).all();
    return json(results);
  }

  if (method === 'GET' && path === '/sites') {
    const { results } = await env.DB.prepare(
      'SELECT name FROM sites WHERE active = 1 ORDER BY rowid'
    ).all();
    return json(results.map(r => r.name));
  }

  if (method === 'GET' && path === '/record') {
    const name = url.searchParams.get('name');
    const date = url.searchParams.get('date');
    if (!name || !date) return json(null);
    const row = await env.DB.prepare(
      'SELECT * FROM records WHERE user_name = ? AND date = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(name, date).first();
    if (!row) return json(null);
    return json({
      id: row.id,
      attendance: row.attendance,
      siteMode: row.site_mode,
      site: row.site,
      overtime: row.overtime,
      otStart: row.overtime_start,
      otEnd: row.overtime_end,
      stay: row.stay,
      meal: row.meal,
      carType: row.car_type,
      commuteGenba: row.commute_genba,
      commuteShugo: row.commute_shugo,
      driver: row.driver,
      passengers: row.passengers,
    });
  }

  if (method === 'POST' && path === '/record') {
    const d = await request.json();
    const id = uuid().slice(0, 8);
    await env.DB.prepare(`
      INSERT INTO records
        (id, created_at, date, user_name, attendance, site_mode, site, work_days,
         overtime, overtime_start, overtime_end, stay, meal, car_type,
         commute_genba, commute_shugo, driver, passengers)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, nowJST(), d.date, d.userName, d.attendance,
      d.siteMode || '', d.site || '', d.workDays || 0,
      d.overtime || '', d.overtimeStart || '', d.overtimeEnd || '',
      d.stay || '', d.meal || '', d.carType || '',
      d.commuteGenba || '', d.commuteShugo || '',
      d.driver || '', (d.passengers || []).join('、')
    ).run();
    return json({ ok: true, id });
  }

  if (method === 'PUT' && path.startsWith('/record/')) {
    const id = path.slice(8);
    const d = await request.json();
    await env.DB.prepare(`
      UPDATE records SET
        created_at=?, date=?, user_name=?, attendance=?, site_mode=?, site=?, work_days=?,
        overtime=?, overtime_start=?, overtime_end=?, stay=?, meal=?, car_type=?,
        commute_genba=?, commute_shugo=?, driver=?, passengers=?
      WHERE id=?
    `).bind(
      nowJST(), d.date, d.userName, d.attendance,
      d.siteMode || '', d.site || '', d.workDays || 0,
      d.overtime || '', d.overtimeStart || '', d.overtimeEnd || '',
      d.stay || '', d.meal || '', d.carType || '',
      d.commuteGenba || '', d.commuteShugo || '',
      d.driver || '', (d.passengers || []).join('、'),
      id
    ).run();
    return json({ ok: true, id });
  }

  // ── 管理者ログイン ────────────────────────────────────────

  if (method === 'POST' && path === '/admin/login') {
    const { id, pass } = await request.json();
    const row = await env.DB.prepare(
      'SELECT 1 FROM admins WHERE login_id = ? AND password = ?'
    ).bind(id, pass).first();
    if (!row) return json({ ok: false });
    const token = uuid();
    await env.DB.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)')
      .bind(token, nowJST()).run();
    return json({ ok: true, token });
  }

  // ── 管理者 API（認証必須）────────────────────────────────

  if (!(await requireAdmin(request, env))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (method === 'GET' && path === '/admin/users') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, leave, active FROM users ORDER BY rowid'
    ).all();
    return json(results.map(r => ({ ...r, active: r.active === 1 })));
  }

  if (method === 'POST' && path === '/admin/users') {
    const { name, leave } = await request.json();
    const id = 'U' + uuid().replace(/-/g, '').slice(0, 6);
    await env.DB.prepare('INSERT INTO users (id, name, leave, active) VALUES (?,?,?,1)')
      .bind(id, name, Number(leave) || 0).run();
    return json({ ok: true });
  }

  const userLeaveMatch = path.match(/^\/admin\/users\/([^/]+)\/leave$/);
  if (method === 'PUT' && userLeaveMatch) {
    const { leave } = await request.json();
    await env.DB.prepare('UPDATE users SET leave = ? WHERE id = ?')
      .bind(Number(leave) || 0, userLeaveMatch[1]).run();
    return json({ ok: true });
  }

  const userActiveMatch = path.match(/^\/admin\/users\/([^/]+)\/active$/);
  if (method === 'PUT' && userActiveMatch) {
    const { active } = await request.json();
    await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?')
      .bind(active ? 1 : 0, userActiveMatch[1]).run();
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/admin/sites') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, active FROM sites ORDER BY rowid'
    ).all();
    return json(results.map(r => ({ ...r, active: r.active === 1 })));
  }

  if (method === 'POST' && path === '/admin/sites') {
    const { name } = await request.json();
    const id = 'S' + uuid().replace(/-/g, '').slice(0, 6);
    await env.DB.prepare('INSERT INTO sites (id, name, active) VALUES (?,?,1)')
      .bind(id, name).run();
    return json({ ok: true });
  }

  const siteActiveMatch = path.match(/^\/admin\/sites\/([^/]+)\/active$/);
  if (method === 'PUT' && siteActiveMatch) {
    const { active } = await request.json();
    await env.DB.prepare('UPDATE sites SET active = ? WHERE id = ?')
      .bind(active ? 1 : 0, siteActiveMatch[1]).run();
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/admin/records') {
    const name = url.searchParams.get('name') || '';
    const from = url.searchParams.get('from') || '';
    const to   = url.searchParams.get('to')   || '';
    let q = 'SELECT * FROM records WHERE 1=1';
    const binds = [];
    if (name) { q += ' AND user_name = ?'; binds.push(name); }
    if (from) { q += ' AND date >= ?';     binds.push(from); }
    if (to)   { q += ' AND date <= ?';     binds.push(to); }
    q += ' ORDER BY date DESC, created_at DESC LIMIT 500';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json(results.map(r => ({
      id: r.id,
      created: r.created_at,
      date: r.date,
      name: r.user_name,
      attendance: r.attendance,
      siteMode: r.site_mode,
      site: r.site,
      workDays: r.work_days,
      overtime: r.overtime,
      otStart: r.overtime_start,
      otEnd: r.overtime_end,
      stay: r.stay,
      meal: r.meal,
      carType: r.car_type,
      commuteGenba: r.commute_genba,
      commuteShugo: r.commute_shugo,
      driver: r.driver,
      passengers: r.passengers,
    })));
  }

  return json({ error: 'Not found' }, 404);
}
