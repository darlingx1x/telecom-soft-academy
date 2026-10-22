import { articles, practiceBriefs, defaultBrief } from './learning-content.mjs';
export async function createWorkspace({
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
  isPostgres = false
}) {
  if (!isPostgres) await db.exec(`CREATE TABLE IF NOT EXISTS lesson_notes(user_id INTEGER NOT NULL REFERENCES users(id),lesson_id INTEGER NOT NULL REFERENCES lessons(id),body TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,lesson_id));
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),lesson_id INTEGER NOT NULL REFERENCES lessons(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','submitted','reviewed')),score INTEGER,feedback TEXT NOT NULL DEFAULT '',reviewer_id INTEGER REFERENCES users(id),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,UNIQUE(user_id,lesson_id));
CREATE TABLE IF NOT EXISTS bookmarks(user_id INTEGER NOT NULL REFERENCES users(id),article_id TEXT NOT NULL,PRIMARY KEY(user_id,article_id));
CREATE TABLE IF NOT EXISTS notification_reads(user_id INTEGER NOT NULL REFERENCES users(id),item_key TEXT NOT NULL,PRIMARY KEY(user_id,item_key));
CREATE INDEX IF NOT EXISTS submissions_status ON submissions(status,updated_at);`);
  const lesson = async (id, u) => {
    const l = await one('SELECT l.*,c.slug,c.title course FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND c.published=1', id);
    if (!l) fail(404, 'Урок не найден.');
    if (!(await one('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?', u.id, l.course_id))) fail(403, 'Сначала запишитесь на курс.');
    return l;
  };
  async function notifications(u) {
    const items = (await all('SELECT c.id,c.title,e.assigned_at FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=? ORDER BY e.assigned_at DESC,c.id DESC', u.id)).map(c => ({
      key: 'course-' + c.id,
      title: 'Курс в вашем обучении',
      description: c.title,
      route: 'course/' + c.id,
      date: c.assigned_at,
      icon: 'book'
    }));
    for (const s of await all("SELECT s.id,s.score,s.reviewed_at,l.title,l.id lesson_id FROM submissions s JOIN lessons l ON l.id=s.lesson_id WHERE s.user_id=? AND s.status='reviewed'", u.id)) items.push({
      key: 'review-' + s.id + '-' + s.reviewed_at,
      title: 'Преподаватель проверил работу',
      description: s.title + ' · ' + s.score + '/100',
      route: 'lesson/' + s.lesson_id,
      date: s.reviewed_at,
      icon: 'check'
    });
    items.push({
      key: 'welcome',
      title: 'Добро пожаловать в Академию',
      description: 'Короткий путеводитель по обучению и практике.',
      route: 'article/first-week',
      date: u.created_at,
      icon: 'spark'
    });
    const read = new Set((await all('SELECT item_key FROM notification_reads WHERE user_id=?', u.id)).map(x => x.item_key));
    return items.map(x => ({
      ...x,
      read: read.has(x.key)
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  return async function (req, res, url, u) {
    const p = url.pathname.slice('/api/workspace/'.length),
      m = req.method;
    let match;
    if (p === 'overview' && m === 'GET') {
      const staff = u.role !== 'student';
      const rows = staff ? await reportRows() : [];
      const submissions = staff ? await all("SELECT s.id,s.status,s.updated_at,s.score,u.name,l.title,c.title course,l.id lesson_id FROM submissions s JOIN users u ON u.id=s.user_id JOIN lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id WHERE s.status!='draft' ORDER BY s.updated_at DESC LIMIT 8") : await all('SELECT s.id,s.status,s.updated_at,s.score,l.title,c.title course,l.id lesson_id FROM submissions s JOIN lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id WHERE s.user_id=? ORDER BY s.updated_at DESC LIMIT 8', u.id);
      return json(res, 200, {
        students: staff ? (await one("SELECT COUNT(*) n FROM users WHERE role='student'")).n : 0,
        assignments: rows.length,
        completed: rows.filter(x => x.completed).length,
        average: rows.length ? Math.round(rows.reduce((s, x) => s + x.percent, 0) / rows.length) : 0,
        rows,
        courses: await all('SELECT c.id,c.title,c.color,c.icon,COUNT(DISTINCT e.user_id) assigned FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id WHERE c.published=1 GROUP BY c.id ORDER BY c.id'),
        recent: staff ? await all('SELECT a.score,a.passed,a.created_at,u.name,c.title FROM attempts a JOIN users u ON u.id=a.user_id JOIN courses c ON c.id=a.course_id ORDER BY a.id DESC LIMIT 5') : [],
        submissions,
        pending: staff ? (await one("SELECT COUNT(*) n FROM submissions WHERE status='submitted'")).n : 0,
        unread: (await notifications(u)).filter(x => !x.read).length,
        bookmarks: (await one('SELECT COUNT(*) n FROM bookmarks WHERE user_id=?', u.id)).n
      });
    }
    if (p === 'library' && m === 'GET') {
      const saved = new Set((await all('SELECT article_id FROM bookmarks WHERE user_id=?', u.id)).map(x => x.article_id));
      return json(res, 200, articles.map(({
        sections,
        ...a
      }) => ({
        ...a,
        saved: saved.has(a.id)
      })));
    }
    if ((match = p.match(/^library\/([a-z-]+)$/)) && m === 'GET') {
      const a = articles.find(x => x.id === match[1]);
      if (!a) fail(404, 'Статья не найдена.');
      return json(res, 200, {
        ...a,
        saved: !!(await one('SELECT 1 FROM bookmarks WHERE user_id=? AND article_id=?', u.id, a.id))
      });
    }
    if ((match = p.match(/^bookmarks\/([a-z-]+)$/)) && m === 'PUT') {
      const id = match[1];
      if (!articles.some(x => x.id === id)) fail(404, 'Статья не найдена.');
      const b = await body(req);
      if (typeof b.saved !== 'boolean') fail(400, 'Укажите состояние закладки.');
      if (b.saved) await run('INSERT OR IGNORE INTO bookmarks VALUES(?,?)', u.id, id);else await run('DELETE FROM bookmarks WHERE user_id=? AND article_id=?', u.id, id);
      return json(res, 200, {
        saved: b.saved
      });
    }
    if ((match = p.match(/^lessons\/(\d+)$/)) && m === 'GET') {
      const id = idFrom(match[1]),
        l = await lesson(id, u);
      return json(res, 200, {
        note: (await one('SELECT body,updated_at FROM lesson_notes WHERE user_id=? AND lesson_id=?', u.id, id)) || null,
        submission: (await one('SELECT s.*,u.name reviewer FROM submissions s LEFT JOIN users u ON u.id=s.reviewer_id WHERE s.user_id=? AND s.lesson_id=?', u.id, id)) || null,
        brief: practiceBriefs[l.slug] || defaultBrief
      });
    }
    if ((match = p.match(/^lessons\/(\d+)\/note$/)) && m === 'PUT') {
      const id = idFrom(match[1]);
      await lesson(id, u);
      const b = await body(req);
      if (typeof b.body !== 'string' || b.body.length > 6000) fail(400, 'Заметка: не более 6000 символов.');
      await run('INSERT INTO lesson_notes(user_id,lesson_id,body) VALUES(?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET body=excluded.body,updated_at=CURRENT_TIMESTAMP', u.id, id, b.body.trim());
      return json(res, 200, {
        ok: true
      });
    }
    if ((match = p.match(/^lessons\/(\d+)\/submission$/)) && m === 'PUT') {
      const id = idFrom(match[1]);
      await lesson(id, u);
      const b = await body(req);
      const content = text(b.body, 'Ответ', b.submit ? 60 : 1, 12000);
      const existing = await one('SELECT * FROM submissions WHERE user_id=? AND lesson_id=?', u.id, id);
      if (existing && existing.status !== 'draft') fail(409, 'Работа уже отправлена. Обратная связь сохраняется в истории урока.');
      await run("INSERT INTO submissions(user_id,lesson_id,body,status) VALUES(?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET body=excluded.body,status=excluded.status,updated_at=CURRENT_TIMESTAMP", u.id, id, content, b.submit ? 'submitted' : 'draft');
      return json(res, 200, {
        ok: true
      });
    }
    if (p === 'reviews' && m === 'GET') {
      requireRole(u, 'teacher', 'admin');
      return json(res, 200, (await all("SELECT s.*,u.name,u.department,l.title,l.id lesson_id,c.title course,c.slug FROM submissions s JOIN users u ON u.id=s.user_id JOIN lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id WHERE s.status!='draft' ORDER BY CASE s.status WHEN 'submitted' THEN 0 ELSE 1 END,s.updated_at DESC")).map(s => ({
        ...s,
        brief: practiceBriefs[s.slug] || defaultBrief
      })));
    }
    if ((match = p.match(/^reviews\/(\d+)$/)) && m === 'PATCH') {
      requireRole(u, 'teacher', 'admin');
      const id = idFrom(match[1]);
      const s = await one('SELECT * FROM submissions WHERE id=?', id);
      if (!s || s.status === 'draft') fail(404, 'Работа не найдена.');
      if (s.user_id === u.id) fail(403, 'Нельзя оценивать собственную работу.');
      if (s.status === 'reviewed') fail(409, 'Работа уже проверена. Обновите страницу.');
      const b = await body(req),
        feedback = text(b.feedback, 'Обратная связь', 10, 4000);
      if (!Number.isInteger(b.score) || b.score < 0 || b.score > 100) fail(400, 'Оценка должна быть целым числом от 0 до 100.');
      await run("UPDATE submissions SET status='reviewed',score=?,feedback=?,reviewer_id=?,reviewed_at=strftime('%Y-%m-%d %H:%M:%f','now'),updated_at=CURRENT_TIMESTAMP WHERE id=?", b.score, feedback, u.id, id);
      return json(res, 200, {
        ok: true
      });
    }
    if (p === 'notifications' && m === 'GET') return json(res, 200, await notifications(u));
    if (p === 'notifications/read' && m === 'POST') {
      const b = await body(req);
      const keys = (await notifications(u)).map(x => x.key);
      const selected = b.all === true ? keys : Array.isArray(b.keys) ? b.keys : [];
      if (selected.length > 200) fail(400, 'Слишком много уведомлений.');
      for (const key of selected) {
        if (!keys.includes(key)) fail(400, 'Неизвестное уведомление.');
        await run('INSERT OR IGNORE INTO notification_reads VALUES(?,?)', u.id, key);
      }
      return json(res, 200, {
        ok: true
      });
    }
    fail(404, 'Раздел не найден.');
  };
}
