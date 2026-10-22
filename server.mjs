import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curriculum } from './seed.mjs';
import { createWorkspace } from './workspace.mjs';
import { all as queryAll, one as queryOne, run as queryRun, db as postgresDb, isPostgres, databaseContext, closeDatabase } from './database.mjs';
const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data/academy.sqlite');
const db = isPostgres ? postgresDb : (() => {
  mkdirSync(dirname(DB_PATH), {
    recursive: true
  });
  return new DatabaseSync(DB_PATH);
})();
const sqliteSchema = `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')), department TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, level TEXT NOT NULL, duration INTEGER NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL, tagline TEXT NOT NULL, skills TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), position INTEGER NOT NULL, title TEXT NOT NULL, minutes INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(course_id,position));
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), prompt TEXT NOT NULL, options TEXT NOT NULL, correct INTEGER NOT NULL, explanation TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments(user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id), assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,course_id));
CREATE TABLE IF NOT EXISTS completions(user_id INTEGER NOT NULL REFERENCES users(id), lesson_id INTEGER NOT NULL REFERENCES lessons(id), completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,lesson_id));
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id), score INTEGER NOT NULL, passed INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS attempts_user_course ON attempts(user_id,course_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
`;
if (isPostgres) await db.exec(readFileSync(join(ROOT, 'migrations/001_postgres.sql'), 'utf8'));else await db.exec(sqliteSchema);
const all = (sql, ...args) => queryAll(db, sql, ...args);
const one = (sql, ...args) => queryOne(db, sql, ...args);
const run = (sql, ...args) => queryRun(db, sql, ...args);
const hashPassword = password => {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
};
function verifyPassword(password, hash) {
  const [salt, value] = hash.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
await databaseContext(async () => {
if (!(await one('SELECT id FROM users LIMIT 1'))) {
  await db.exec('BEGIN');
  try {
    const users = [['Габидуллина Дилнора Камилжановна', 'student@academy.test', 'student', 'Разработка'], ['Учебный преподаватель', 'teacher@academy.test', 'teacher', 'Учебный центр'], ['Администратор портала', 'admin@academy.test', 'admin', 'Учебный центр'], ['Азиз Каримов', 'aziz@academy.test', 'student', 'Инфраструктура'], ['Марина Соколова', 'marina@academy.test', 'student', 'Поддержка'], ['Тимур Алиев', 'timur@academy.test', 'student', 'Разработка']];
    for (const [name, email, role, dept] of users) await run('INSERT INTO users(name,email,password_hash,role,department) VALUES(?,?,?,?,?)', name, email, hashPassword(role === 'admin' ? 'admin' : 'Academy2026!'), role, dept);
    for (const c of curriculum) {
      const id = Number((await run('INSERT INTO courses(slug,title,description,category,level,duration,color,icon,tagline,skills) VALUES(?,?,?,?,?,?,?,?,?,?)', c.slug, c.title, c.description, c.category, c.level, c.duration, c.color, c.icon, c.tagline, JSON.stringify(c.skills))).lastInsertRowid);
      await Promise.all(c.lessons.map(async (l, i) => await run('INSERT INTO lessons(course_id,position,title,minutes,body) VALUES(?,?,?,?,?)', id, i + 1, l.title, l.minutes, l.body)));
      await Promise.all(c.questions.map(async ([prompt, options, correct, explanation]) => await run('INSERT INTO questions(course_id,prompt,options,correct,explanation) VALUES(?,?,?,?,?)', id, prompt, JSON.stringify(options), correct, explanation)));
    }
    for (const u of await all("SELECT id FROM users WHERE role='student'")) for (const c of [1, 2]) await run('INSERT INTO enrollments(user_id,course_id) VALUES(?,?)', u.id, c);
    // These are deliberately labelled demonstration records, never research data.
    for (const [userId, lessonIds] of [[1, [1]], [4, [1, 2]], [5, [1]], [6, [4]]]) for (const id of lessonIds) await run('INSERT INTO completions(user_id,lesson_id) VALUES(?,?)', userId, id);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

// Enrich only unchanged reference lessons; preserve teacher edits and existing IDs.
for (const c of curriculum) {
  const stored = await one('SELECT id FROM courses WHERE slug=?', c.slug);
  if (stored) await Promise.all(c.lessons.map(async (l, i) => {
    if (l.originalBody) await run('UPDATE lessons SET body=? WHERE course_id=? AND position=? AND title=? AND body=?', l.body, stored.id, i + 1, l.title, l.originalBody);
  }));
}
});
const safeUser = u => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  department: u.department
});
const progress = async (uid, cid) => {
  const total = (await one('SELECT COUNT(*) n FROM lessons WHERE course_id=?', cid)).n;
  const done = (await one('SELECT COUNT(*) n FROM completions x JOIN lessons l ON l.id=x.lesson_id WHERE x.user_id=? AND l.course_id=?', uid, cid)).n;
  const best = (await one('SELECT MAX(score) score FROM attempts WHERE user_id=? AND course_id=?', uid, cid)).score;
  const passed = !!(await one('SELECT id FROM attempts WHERE user_id=? AND course_id=? AND passed=1', uid, cid));
  return {
    total,
    done,
    percent: total ? Math.round(done / total * 100) : 0,
    best,
    passed,
    completed: !!total && done === total && passed
  };
};
async function coursesFor(user) {
  return await Promise.all((await all('SELECT * FROM courses WHERE published=1 ORDER BY id')).map(async c => ({
    ...c,
    skills: JSON.parse(c.skills),
    enrolled: !!(await one('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?', user.id, c.id)),
    progress: await progress(user.id, c.id)
  })));
}
async function reportRows() {
  return await Promise.all((await all("SELECT e.user_id,e.course_id,u.name,u.email,u.department,c.title FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id ORDER BY u.name,c.title")).map(async r => ({
    ...r,
    ...(await progress(r.user_id, r.course_id))
  })));
}
const failures = new Map();
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const requireRole = (u, ...roles) => {
  if (!roles.includes(u.role)) fail(403, 'У вашей роли нет доступа к этому действию.');
};
const idFrom = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail(400, 'Некорректный идентификатор.');
  return n;
};
const text = (value, label, min = 1, max = 200) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label}: от ${min} до ${max} символов.`);
  return value.trim();
};
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const cookieName = process.env.COOKIE_SECURE === '1' ? '__Host-academy' : 'academy';
async function getUser(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token) return null;
  const u = await one('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>?', tokenHash(token), Date.now());
  return u || null;
}
function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) fail(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    fail(400, 'Некорректный JSON.');
  }
}
async function requireCourse(id, user) {
  const c = await one('SELECT * FROM courses WHERE id=? AND published=1', id);
  if (!c) fail(404, 'Курс не найден.');
  if (!(await one('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?', user.id, id))) fail(403, 'Сначала запишитесь на курс.');
  return c;
}
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
const workspace = await databaseContext(() => createWorkspace({
  db,
  all,
  one,
  run,
  json,
  fail,
  requireRole,
  text,
  idFrom,
  body,
  reportRows,
  isPostgres
}));
async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;
  if (method === 'GET' && path === '/api/health') return json(res, 200, {
    status: 'ok',
    mode: 'educational-prototype'
  });
  if (!['GET', 'HEAD'].includes(method)) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Ожидается JSON.');
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    if (origin && origin !== expected) fail(403, 'Недопустимый источник запроса.');
  }
  if (path === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    const history = failures.get(ip) || {
      count: 0,
      until: 0
    };
    if (history.count >= 15 && history.until > Date.now()) fail(429, 'Слишком много попыток. Повторите через 15 минут.');
    const b = await body(req);
    const identifier = text(b.email, 'Почта или логин', 3, 200).toLowerCase();
    const email = identifier === 'admin' ? 'admin@academy.test' : identifier;
    const password = text(b.password, 'Пароль', 1, 200);
    const u = await one('SELECT * FROM users WHERE email=?', email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      const next = history.until > Date.now() ? history : {
        count: 0,
        until: Date.now() + 900000
      };
      next.count++;
      failures.set(ip, next);
      fail(401, 'Неверная почта или пароль.');
    }
    failures.delete(ip);
    await run('DELETE FROM sessions WHERE expires<?', Date.now());
    const token = randomBytes(32).toString('hex');
    await run('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)', tokenHash(token), u.id, Date.now() + 8 * 3600000);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
    return json(res, 200, {
      user: safeUser(u)
    });
  }
  const user = await getUser(req);
  if (!user) fail(401, 'Войдите в учебный портал.');
  if (path.startsWith('/api/workspace/')) return workspace(req, res, url, user);
  if (path === '/api/logout' && method === 'POST') {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (token) await run('DELETE FROM sessions WHERE token_hash=?', tokenHash(token));
    res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
    return json(res, 200, {
      ok: true
    });
  }
  if (path === '/api/bootstrap' && method === 'GET') return json(res, 200, {
    user: safeUser(user),
    courses: await coursesFor(user),
    attempts: await all('SELECT a.id,a.course_id,a.score,a.passed,a.created_at,c.title FROM attempts a JOIN courses c ON a.course_id=c.id WHERE a.user_id=? ORDER BY a.id DESC', user.id),
    activity: await all('SELECT x.completed_at,l.title,c.title course FROM completions x JOIN lessons l ON l.id=x.lesson_id JOIN courses c ON c.id=l.course_id WHERE x.user_id=? ORDER BY x.completed_at DESC LIMIT 6', user.id),
    demo: true
  });
  if (path === '/api/profile' && method === 'PATCH') {
    const b = await body(req);
    const name = text(b.name, 'ФИО', 2, 120);
    const department = text(b.department, 'Подразделение', 2, 80);
    await run('UPDATE users SET name=?,department=? WHERE id=?', name, department, user.id);
    return json(res, 200, {
      user: safeUser(await one('SELECT * FROM users WHERE id=?', user.id))
    });
  }
  if (path === '/api/password' && method === 'POST') {
    const b = await body(req);
    const current = text(b.current, 'Текущий пароль', 1, 200);
    const next = text(b.next, 'Новый пароль', 10, 200);
    if (!verifyPassword(current, user.password_hash)) fail(400, 'Текущий пароль указан неверно.');
    await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(next), user.id);
    await run('DELETE FROM sessions WHERE user_id=?', user.id);
    return json(res, 200, {
      ok: true,
      reauthenticate: true
    });
  }
  let match;
  if ((match = path.match(/^\/api\/courses\/(\d+)$/)) && method === 'GET') {
    const id = idFrom(match[1]);
    const c = await one('SELECT * FROM courses WHERE id=? AND published=1', id);
    if (!c) fail(404, 'Курс не найден.');
    const enrolled = !!(await one('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?', user.id, id));
    const lessons = await Promise.all((await all('SELECT id,position,title,minutes FROM lessons WHERE course_id=? ORDER BY position', id)).map(async l => ({
      ...l,
      done: !!(await one('SELECT 1 FROM completions WHERE user_id=? AND lesson_id=?', user.id, l.id))
    })));
    return json(res, 200, {
      ...c,
      skills: JSON.parse(c.skills),
      enrolled,
      progress: await progress(user.id, id),
      lessons,
      question_count: (await one('SELECT COUNT(*) n FROM questions WHERE course_id=?', id)).n
    });
  }
  if ((match = path.match(/^\/api\/courses\/(\d+)\/enroll$/)) && method === 'POST') {
    const id = idFrom(match[1]);
    if (!(await one('SELECT id FROM courses WHERE id=? AND published=1', id))) fail(404, 'Курс не найден.');
    await run('INSERT OR IGNORE INTO enrollments(user_id,course_id) VALUES(?,?)', user.id, id);
    return json(res, 200, {
      ok: true
    });
  }
  if ((match = path.match(/^\/api\/lessons\/(\d+)$/)) && method === 'GET') {
    const l = await one('SELECT * FROM lessons WHERE id=?', idFrom(match[1]));
    if (!l) fail(404, 'Урок не найден.');
    await requireCourse(l.course_id, user);
    return json(res, 200, {
      ...l,
      done: !!(await one('SELECT 1 FROM completions WHERE user_id=? AND lesson_id=?', user.id, l.id))
    });
  }
  if ((match = path.match(/^\/api\/lessons\/(\d+)\/complete$/)) && method === 'POST') {
    const l = await one('SELECT * FROM lessons WHERE id=?', idFrom(match[1]));
    if (!l) fail(404, 'Урок не найден.');
    await requireCourse(l.course_id, user);
    await run('INSERT OR IGNORE INTO completions(user_id,lesson_id) VALUES(?,?)', user.id, l.id);
    return json(res, 200, {
      ok: true,
      progress: await progress(user.id, l.course_id)
    });
  }
  if ((match = path.match(/^\/api\/courses\/(\d+)\/quiz$/)) && method === 'GET') {
    const id = idFrom(match[1]);
    const c = await requireCourse(id, user);
    if ((await progress(user.id, id)).percent < 100) fail(409, 'Сначала завершите все уроки курса.');
    return json(res, 200, {
      course_id: id,
      title: c.title,
      threshold: 75,
      questions: (await all('SELECT id,prompt,options FROM questions WHERE course_id=? ORDER BY id', id)).map(q => ({
        ...q,
        options: JSON.parse(q.options)
      }))
    });
  }
  if ((match = path.match(/^\/api\/courses\/(\d+)\/quiz$/)) && method === 'POST') {
    const id = idFrom(match[1]);
    await requireCourse(id, user);
    if ((await progress(user.id, id)).percent < 100) fail(409, 'Сначала завершите все уроки курса.');
    const b = await body(req);
    const qs = await all('SELECT * FROM questions WHERE course_id=? ORDER BY id', id);
    if (!qs.length) fail(409, 'В курсе пока нет контрольных вопросов.');
    if (!b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers)) fail(400, 'Передайте ответы на все вопросы.');
    const details = qs.map(q => {
      const selected = b.answers[q.id];
      const options = JSON.parse(q.options);
      if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) fail(400, 'Ответьте на все вопросы.');
      return {
        id: q.id,
        prompt: q.prompt,
        options,
        selected,
        correct: q.correct,
        explanation: q.explanation,
        ok: selected === q.correct
      };
    });
    const score = Math.round(details.filter(x => x.ok).length / qs.length * 100);
    const passed = score >= 75;
    const result = await run('INSERT INTO attempts(user_id,course_id,score,passed,details) VALUES(?,?,?,?,?)', user.id, id, score, Number(passed), JSON.stringify(details));
    return json(res, 200, {
      id: Number(result.lastInsertRowid),
      score,
      passed,
      details
    });
  }
  if ((match = path.match(/^\/api\/attempts\/(\d+)$/)) && method === 'GET') {
    const a = await one('SELECT a.*,c.title FROM attempts a JOIN courses c ON c.id=a.course_id WHERE a.id=? AND a.user_id=?', idFrom(match[1]), user.id);
    if (!a) fail(404, 'Результат не найден.');
    return json(res, 200, {
      ...a,
      details: JSON.parse(a.details)
    });
  }
  if (path === '/api/reports' && method === 'GET') {
    requireRole(user, 'teacher', 'admin');
    return json(res, 200, {
      rows: await reportRows(),
      students: await all("SELECT id,name,email,department FROM users WHERE role='student' ORDER BY name"),
      courses: await all('SELECT id,title FROM courses WHERE published=1 ORDER BY id')
    });
  }
  if (path === '/api/reports.csv' && method === 'GET') {
    requireRole(user, 'teacher', 'admin');
    const rows = [['Сотрудник', 'Подразделение', 'Курс', 'Прогресс, %', 'Лучший результат, %', 'Завершён'], ...(await reportRows()).map(r => [r.name, r.department, r.title, r.percent, r.best ?? '', r.completed ? 'Да' : 'Нет'])];
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="academy-report.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end('\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'));
  }
  if (path === '/api/assign' && method === 'POST') {
    requireRole(user, 'teacher', 'admin');
    const b = await body(req);
    const uid = idFrom(b.user_id),
      cid = idFrom(b.course_id);
    if (!(await one("SELECT id FROM users WHERE id=? AND role='student'", uid)) || !(await one('SELECT id FROM courses WHERE id=? AND published=1', cid))) fail(400, 'Выберите сотрудника и курс.');
    await run('INSERT OR IGNORE INTO enrollments(user_id,course_id) VALUES(?,?)', uid, cid);
    return json(res, 200, {
      ok: true
    });
  }
  if (path === '/api/users' && method === 'GET') {
    requireRole(user, 'admin');
    return json(res, 200, await all('SELECT id,name,email,role,department,created_at FROM users ORDER BY id'));
  }
  if (path === '/api/users' && method === 'POST') {
    requireRole(user, 'admin');
    const b = await body(req);
    const name = text(b.name, 'ФИО', 2, 120),
      email = text(b.email, 'Почта', 5, 200).toLowerCase(),
      department = text(b.department, 'Подразделение', 2, 80),
      password = text(b.password, 'Пароль', 10, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Введите корректную почту.');
    if (!['student', 'teacher', 'admin'].includes(b.role)) fail(400, 'Выберите роль.');
    if (await one('SELECT id FROM users WHERE email=?', email)) fail(409, 'Пользователь с такой почтой уже существует.');
    const result = await run('INSERT INTO users(name,email,password_hash,role,department) VALUES(?,?,?,?,?)', name, email, hashPassword(password), b.role, department);
    return json(res, 201, {
      id: Number(result.lastInsertRowid)
    });
  }
  if ((match = path.match(/^\/api\/manage\/courses\/(\d+)$/)) && method === 'GET') {
    requireRole(user, 'teacher', 'admin');
    const id = idFrom(match[1]);
    const c = await one('SELECT * FROM courses WHERE id=?', id);
    if (!c) fail(404, 'Курс не найден.');
    return json(res, 200, {
      ...c,
      lessons: await all('SELECT * FROM lessons WHERE course_id=? ORDER BY position', id),
      questions: (await all('SELECT * FROM questions WHERE course_id=? ORDER BY id', id)).map(q => ({
        ...q,
        options: JSON.parse(q.options)
      }))
    });
  }
  if ((match = path.match(/^\/api\/manage\/courses\/(\d+)$/)) && method === 'PATCH') {
    requireRole(user, 'teacher', 'admin');
    const id = idFrom(match[1]);
    if (!(await one('SELECT id FROM courses WHERE id=?', id))) fail(404, 'Курс не найден.');
    const b = await body(req);
    const title = text(b.title, 'Название', 4, 160),
      description = text(b.description, 'Описание', 10, 600);
    const lessons = (await all('SELECT id FROM lessons WHERE course_id=?', id)).map(l => ({
      id: l.id,
      title: text(b['title-' + l.id], 'Название урока', 3, 160),
      body: text(b['body-' + l.id], 'Материал урока', 60, 20000)
    }));
    const questions = (await all('SELECT id FROM questions WHERE course_id=?', id)).map(q => {
      const correct = Number(b['correct-' + q.id]);
      if (!Number.isInteger(correct) || correct < 0 || correct > 3) fail(400, 'Укажите правильный ответ.');
      return {
        id: q.id,
        prompt: text(b['prompt-' + q.id], 'Вопрос', 5, 300),
        options: [0, 1, 2, 3].map(i => text(b['option-' + q.id + '-' + i], 'Вариант', 1, 200)),
        correct,
        explanation: text(b['explanation-' + q.id], 'Разбор ответа', 10, 1000)
      };
    });
    await db.exec('BEGIN');
    try {
      await run('UPDATE courses SET title=?,description=? WHERE id=?', title, description, id);
      for (const l of lessons) await run('UPDATE lessons SET title=?,body=? WHERE id=? AND course_id=?', l.title, l.body, l.id, id);
      for (const q of questions) await run('UPDATE questions SET prompt=?,options=?,correct=?,explanation=? WHERE id=? AND course_id=?', q.prompt, JSON.stringify(q.options), q.correct, q.explanation, q.id, id);
      await db.exec('COMMIT');
      return json(res, 200, {
        ok: true
      });
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  if ((match = path.match(/^\/api\/manage\/courses\/(\d+)\/lessons$/)) && method === 'POST') {
    requireRole(user, 'teacher', 'admin');
    const id = idFrom(match[1]);
    if (!(await one('SELECT id FROM courses WHERE id=?', id))) fail(404, 'Курс не найден.');
    const b = await body(req);
    const title = text(b.title, 'Название', 3, 160),
      content = text(b.body, 'Материал', 60, 20000);
    if (!Number.isInteger(b.minutes) || b.minutes < 1 || b.minutes > 180) fail(400, 'Длительность от 1 до 180 минут.');
    const position = (await one('SELECT COALESCE(MAX(position),0)+1 n FROM lessons WHERE course_id=?', id)).n;
    await db.exec('BEGIN');
    try {
      const result = await run('INSERT INTO lessons(course_id,position,title,minutes,body) VALUES(?,?,?,?,?)', id, position, title, b.minutes, content);
      await run('UPDATE courses SET duration=duration+? WHERE id=?', b.minutes, id);
      await db.exec('COMMIT');
      return json(res, 201, {
        id: Number(result.lastInsertRowid)
      });
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  if (path === '/api/courses' && method === 'POST') {
    requireRole(user, 'teacher', 'admin');
    const b = await body(req);
    const title = text(b.title, 'Название', 4, 160),
      description = text(b.description, 'Описание', 10, 600),
      lessonTitle = text(b.lessonTitle, 'Название урока', 3, 160),
      lessonBody = text(b.lessonBody, 'Материал урока', 60, 20000),
      prompt = text(b.question, 'Контрольный вопрос', 5, 300);
    if (!Array.isArray(b.options) || b.options.length !== 4) fail(400, 'Укажите четыре варианта ответа.');
    const options = b.options.map(v => text(v, 'Вариант ответа', 1, 200));
    if (!Number.isInteger(b.correct) || b.correct < 0 || b.correct > 3) fail(400, 'Укажите правильный ответ.');
    const category = text(b.category, 'Категория', 2, 60);
    const level = text(b.level, 'Уровень', 2, 30);
    await db.exec('BEGIN');
    try {
      const id = Number((await run('INSERT INTO courses(slug,title,description,category,level,duration,color,icon,tagline,skills) VALUES(?,?,?,?,?,?,?,?,?,?)', 'course-' + randomBytes(6).toString('hex'), title, description, category, level, 20, 'blue', 'book', title, JSON.stringify([category]))).lastInsertRowid);
      await run('INSERT INTO lessons(course_id,position,title,minutes,body) VALUES(?,?,?,?,?)', id, 1, lessonTitle, 15, lessonBody);
      await run('INSERT INTO questions(course_id,prompt,options,correct,explanation) VALUES(?,?,?,?,?)', id, prompt, JSON.stringify(options), b.correct, 'Правильный ответ указан преподавателем курса.');
      await db.exec('COMMIT');
      return json(res, 201, {
        id
      });
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  if ((match = path.match(/^\/api\/certificates\/(\d+)$/)) && method === 'GET') {
    const id = idFrom(match[1]);
    const c = await requireCourse(id, user);
    if (!(await progress(user.id, id)).completed) fail(403, 'Сертификат доступен после всех уроков и успешного теста.');
    const attempt = await one('SELECT created_at,score FROM attempts WHERE user_id=? AND course_id=? AND passed=1 ORDER BY id LIMIT 1', user.id, id);
    return json(res, 200, {
      number: `TS-A-${String(user.id).padStart(3, '0')}-${String(id).padStart(3, '0')}`,
      name: user.name,
      course: c.title,
      date: attempt.created_at,
      score: attempt.score,
      kind: 'Демонстрационный сертификат учебного прототипа'
    });
  }
  fail(404, 'Запрошенный ресурс не найден.');
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод не поддерживается.');
    const path = resolve(join(ROOT, 'public'), '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const publicRoot = resolve(ROOT, 'public');
    if (path !== publicRoot && !path.startsWith(publicRoot + (process.platform === 'win32' ? '\\' : '/'))) fail(403, 'Доступ запрещён.');
    if (!existsSync(path) || !mime[extname(path)]) fail(404, 'Файл не найден.');
    res.writeHead(200, {
      'Content-Type': mime[extname(path)],
      'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) json(res, error.status || 500, {
      error: error.status ? error.message : 'Ошибка сервера. Повторите попытку.'
    });else res.end();
  }
}
export default function handler(req, res) {
  return databaseContext(() => handleRequest(req, res));
}
const server = process.env.VERCEL ? null : http.createServer(handler);
if (server) server.listen(PORT, HOST, () => console.log(`TELECOM SOFT Academy: http://${HOST}:${PORT}`));
function shutdown() {
  if (!server) return;
  server.close(async () => {
    await closeDatabase(db);
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
