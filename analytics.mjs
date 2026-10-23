// Read-only reporting over saved learning records. No generated usage events.
export async function learningAnalytics(all) {
  const timestamp = value => new Date(value instanceof Date ? value : /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ','T')+'Z').getTime();
  const [people, courses, enrollments, completions, attempts] = await Promise.all([
    all("SELECT id,name,department FROM users WHERE role='student' ORDER BY name"),
    all('SELECT c.id,c.title,c.published,COUNT(l.id) lessons FROM courses c LEFT JOIN lessons l ON l.course_id=c.id GROUP BY c.id ORDER BY c.id'),
    all("SELECT e.user_id,e.course_id,e.assigned_at FROM enrollments e JOIN users u ON u.id=e.user_id WHERE u.role='student'"),
    all("SELECT x.user_id,l.course_id,COUNT(*) done,MAX(x.completed_at) last_completed FROM completions x JOIN lessons l ON l.id=x.lesson_id JOIN users u ON u.id=x.user_id WHERE u.role='student' GROUP BY x.user_id,l.course_id"),
    all("SELECT a.id,a.user_id,a.course_id,a.score,a.passed,a.created_at FROM attempts a JOIN users u ON u.id=a.user_id WHERE u.role='student' ORDER BY a.id")
  ]);
  const key = r => `${r.user_id}:${r.course_id}`;
  const completionMap = new Map(completions.map(r => [key(r), r]));
  const courseMap = new Map(courses.map(c => [c.id, c]));
  const personMap = new Map(people.map(p => [p.id, p]));
  const attemptMap = new Map();
  for (const a of attempts) {
    const k = key(a);
    if (!attemptMap.has(k)) attemptMap.set(k, []);
    attemptMap.get(k).push(a);
  }
  const rows = enrollments.map(r => {
    const c = courseMap.get(r.course_id), p = personMap.get(r.user_id);
    const done = Number(completionMap.get(key(r))?.done || 0), list = attemptMap.get(key(r)) || [];
    const firstPass = list.find(a => a.passed), total = Number(c.lessons);
    const completed = total > 0 && done === total && !!firstPass;
    const completionDate = completionMap.get(key(r))?.last_completed;
    const certificateDate = completed ? new Date(Math.max(timestamp(firstPass.created_at), timestamp(completionDate))).toISOString() : null;
    return {...r, name:p.name, department:p.department, title:c.title, total, done,
      percent:total ? Math.round(done / total * 100) : 0,
      attempts:list.length, best:list.length ? Math.max(...list.map(a => a.score)) : null,
      completed, certificate:completed ? `TS-A-${String(p.id).padStart(3,'0')}-${String(c.id).padStart(3,'0')}` : null,
      certificate_date:certificateDate, certificate_score:completed ? firstPass.score : null};
  });
  return {generated_at:new Date().toISOString(), data_kind:'educational-prototype',
    disclosure:'Учебная среда. Отчёт включает смоделированные записи для проверки аналитики. Показатели не подтверждают число реальных сотрудников, внедрение или эффективность обучения на предприятии.',
    people, courses:courses.map(c => ({...c, lessons:Number(c.lessons)})), rows, attempts};
}
