export function createAnalyticsUI(ctx) {
  const {api,e,icon,heading,stat,progressBar,shell,empty} = ctx;
  let data;
  const date = value => value ? new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ','T')+'Z').toLocaleDateString('ru-RU',{timeZone:'Asia/Tashkent'}) : '—';
  const unique = rows => new Set(rows.map(r => r.user_id)).size;
  const average = rows => rows.length ? Math.round(rows.reduce((n,r) => n+r.score,0)/rows.length) : null;
  async function page(serial) {
    data = await api('workspace/analytics');
    if (!ctx.current(serial)) return;
    shell(heading('Аналитика обучения','Участники, прохождение программ и достижения в одном отчёте.',
      '<button class="btn secondary" data-analytics="export">'+icon('download')+'Скачать CSV</button>','Учебный центр')+
      `<div class="analytics-disclosure">${icon('info')}<p>${e(data.disclosure)}</p></div>
      <section class="card analytics-toolbar" aria-label="Фильтры аналитики">
        <label class="field">Программа<select id="analytics-course"><option value="">Все курсы</option>${data.courses.map(c=>`<option value="${c.id}">${e(c.title)}${c.published?'':' · архив'}</option>`).join('')}</select></label>
        <label class="field">Подразделение<select id="analytics-department"><option value="">Все подразделения</option>${[...new Set(data.people.map(p=>p.department))].sort().map(d=>`<option>${e(d)}</option>`).join('')}</select></label>
        <div class="analytics-updated"><span class="dot"></span>Срез базы на ${date(data.generated_at)}<small>Фильтры применяются ко всему отчёту</small></div>
      </section><div id="analytics-content" aria-live="polite"></div>`,'analytics');
    paint();
  }
  function selected() {
    const course = document.querySelector('#analytics-course')?.value;
    const department = document.querySelector('#analytics-department')?.value;
    const rows = data.rows.filter(r=>(!course||String(r.course_id)===course)&&(!department||r.department===department));
    const ids = new Set(rows.map(r=>`${r.user_id}:${r.course_id}`));
    const attempts = data.attempts.filter(a=>ids.has(`${a.user_id}:${a.course_id}`));
    const people = data.people.filter(p=>(!department||p.department===department)&&(!course||rows.some(r=>r.user_id===p.id)));
    return {rows,attempts,people,course};
  }
  function paint() {
    if (!document.querySelector('#analytics-content')) return;
    const {rows,attempts,people,course}=selected(), certificates=rows.filter(r=>r.completed);
    const started=rows.filter(r=>r.done>0||r.attempts>0), passed=attempts.filter(a=>a.passed), avg=average(attempts);
    const buckets=[['Назначено',rows.length],['Начали обучение',started.length],['Изучили все уроки',rows.filter(r=>r.total>0&&r.done===r.total).length],['Получили сертификат',certificates.length]];
    const courseRows=data.courses.filter(c=>!course||String(c.id)===course).map(c=>{
      const own=rows.filter(r=>r.course_id===c.id), tests=attempts.filter(a=>a.course_id===c.id);
      return {...c,assigned:own.length,completed:own.filter(r=>r.completed).length,average:average(tests)};
    });
    const participantRows=people.map(p=>{
      const own=rows.filter(r=>r.user_id===p.id), tests=attempts.filter(a=>a.user_id===p.id);
      return {...p,assigned:own.length,completed:own.filter(r=>r.completed).length,done:own.reduce((n,r)=>n+r.done,0),average:average(tests)};
    });
    const groups=Array.from({length:7},(_,i)=>{const d=new Date(data.generated_at);d.setUTCDate(d.getUTCDate()-6+i);return {day:d.toISOString().slice(0,10),attempts:0,certificates:0};});
    for(const g of groups){g.attempts=attempts.filter(a=>String(a.created_at).slice(0,10)===g.day).length;g.certificates=certificates.filter(r=>r.certificate_date.slice(0,10)===g.day).length;}
    const maxDay=Math.max(1,...groups.map(g=>Math.max(g.attempts,g.certificates)));
    document.querySelector('#analytics-content').innerHTML=`
      <div class="stats analytics-stats">${stat(unique(rows),'Участников курсов','users',people.length+' учебных аккаунтов в выборке')}${stat(unique(started),'Начали обучение','play','Есть изученный урок или попытка теста')}${stat(certificates.length,'Сертификатов','award','Все уроки и успешный итоговый тест')}${stat(avg===null?'—':avg+'%','Средний результат','chart',attempts.length+' попыток тестирования')}</div>
      <div class="analytics-grid"><section class="card card-pad"><div class="analytics-section"><div><span class="eyebrow">ОТ НАЗНАЧЕНИЯ К РЕЗУЛЬТАТУ</span><h2>Путь прохождения</h2></div><span class="badge outline">Назначения курсов</span></div><div class="analytics-funnel">${buckets.map(([label,n])=>`<div><div class="flex between"><span>${label}</span><b>${n}</b></div>${progressBar(rows.length?n/rows.length*100:0)}</div>`).join('')}</div><p class="muted small">Один участник может проходить несколько программ. Успешных попыток: ${passed.length} из ${attempts.length}. Повторный тест не создаёт второй сертификат.</p></section>
      <section class="card card-pad"><div class="analytics-section"><div><span class="eyebrow">ПОСЛЕДНИЕ 7 ДНЕЙ · UTC</span><h2>Активность по дням</h2></div></div><div class="analytics-chart" role="img" aria-label="${e(groups.map(g=>date(g.day+'T00:00:00Z')+': попыток '+g.attempts+', сертификатов '+g.certificates).join('; '))}">${groups.map(g=>`<div class="analytics-day"><div class="analytics-bars"><div class="analytics-column tests" style="height:${g.attempts/maxDay*100}%"><span>${g.attempts}</span></div><div class="analytics-column awards" style="height:${g.certificates/maxDay*100}%"><span>${g.certificates}</span></div></div><small>${g.day.slice(8)}.${g.day.slice(5,7)}</small></div>`).join('')}</div><div class="analytics-legend"><span><i class="tests"></i>Попытки теста</span><span><i class="awards"></i>Сертификаты</span></div></section></div>
      <section class="card card-pad analytics-block"><div class="analytics-section"><div><span class="eyebrow">ПРОГРАММЫ</span><h2>Результаты по курсам</h2></div><span class="badge outline">${rows.length} назначений</span></div><div class="table-wrap"><table><thead><tr><th>Программа</th><th>Участников</th><th>Завершили</th><th>Доля завершений</th><th>Средний тест</th></tr></thead><tbody>${courseRows.map(c=>`<tr><td><strong>${e(c.title)}</strong></td><td>${c.assigned}</td><td>${c.completed}</td><td><div class="analytics-progress">${progressBar(c.assigned?c.completed/c.assigned*100:0)}<span>${c.assigned?Math.round(c.completed/c.assigned*100):0}%</span></div></td><td>${c.average===null?'—':c.average+'%'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card card-pad analytics-block"><div class="analytics-section"><div><span class="eyebrow">УЧАСТНИКИ</span><h2>Кто и как проходит обучение</h2></div><label class="search-box">${icon('search')}<input id="analytics-search" type="search" placeholder="Найти участника" aria-label="Поиск участников аналитики"></label></div><div class="table-wrap"><table id="analytics-people"><thead><tr><th>Участник / подразделение</th><th>Курсов</th><th>Уроков изучено</th><th>Сертификатов</th><th>Средний тест</th></tr></thead><tbody>${participantRows.map(p=>`<tr><td><strong>${e(p.name)}</strong><small class="block muted">${e(p.department)}</small></td><td>${p.assigned}</td><td>${p.done}</td><td>${p.completed}</td><td>${p.average===null?'—':p.average+'%'}</td></tr>`).join('')}</tbody></table></div><p id="analytics-search-empty" class="muted" hidden>Участники не найдены.</p></section>
      <section class="card card-pad analytics-block"><div class="analytics-section"><div><span class="eyebrow">ДОСТИЖЕНИЯ</span><h2>Реестр сертификатов</h2></div><span class="badge green">${certificates.length} доступно</span></div>${certificates.length?`<div class="table-wrap"><table id="analytics-certificates"><thead><tr><th>Номер / дата</th><th>Получатель</th><th>Программа</th><th>Результат</th></tr></thead><tbody>${certificates.sort((a,b)=>b.certificate_date.localeCompare(a.certificate_date)).map(r=>`<tr><td><strong class="analytics-cert-number">${e(r.certificate)}</strong><small class="block muted">${date(r.certificate_date)}</small></td><td>${e(r.name)}</td><td>${e(r.title)}</td><td><span class="badge green">${r.certificate_score}%</span></td></tr>`).join('')}</tbody></table></div>`:empty('Сертификатов пока нет','Записи появятся после завершения всех уроков и успешного теста.','reports','К результатам команды')}</section>
      <p class="muted small analytics-method">Как считаем: участники — уникальные учебные аккаунты с назначениями; начало — хотя бы один изученный урок или тест; завершение — все уроки и тест от 75%. Сертификат учитывается один раз на пару «участник — курс». Реестр показывает доступность сертификата, скачивание PDF отдельно не отслеживается. Посещения и уникальные посетители сайта не измеряются.</p>`;
  }
  document.addEventListener('change',event=>{if(['analytics-course','analytics-department'].includes(event.target.id))paint();});
  document.addEventListener('input',event=>{
    if(event.target.id!=='analytics-search')return;
    const q=event.target.value.toLocaleLowerCase('ru');let shown=0;
    document.querySelectorAll('#analytics-people tbody tr').forEach(r=>{r.hidden=!r.textContent.toLocaleLowerCase('ru').includes(q);if(!r.hidden)shown++;});
    document.querySelector('#analytics-search-empty').hidden=shown>0;
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('[data-analytics="export"]'))return;
    const {rows}=selected();
    const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
    const values=[['Учебная среда: демонстрационные аккаунты'],['Сотрудник','Подразделение','Курс','Уроков','Всего уроков','Прогресс, %','Попыток','Лучший тест, %','Сертификат','Доступен с'],...rows.map(r=>[r.name,r.department,r.title,r.done,r.total,r.percent,r.attempts,r.best,r.certificate,r.certificate_date])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+values.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='academy-analytics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  return {page};
}
