import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from 'playwright';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const RESULTS=join(ROOT,'test-results',new Date().toISOString().replaceAll(':','-'));
const SHOTS=process.env.SCREENSHOT_DIR||join(RESULTS,'screenshots');
mkdirSync(RESULTS,{recursive:true});mkdirSync(SHOTS,{recursive:true});
const PORT=Number(process.env.TEST_PORT||4174),BASE=`http://127.0.0.1:${PORT}`;
const checks=[],screenshots=[],browserErrors=[];
const serverOptions={cwd:ROOT,env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',DB_PATH:join(RESULTS,'test.sqlite')},stdio:['ignore','pipe','pipe']};
let server=spawn(process.execPath,['server.mjs'],serverOptions);
let serverLogs='';server.stdout.on('data',x=>serverLogs+=x);server.stderr.on('data',x=>serverLogs+=x);
let browser;
const check=(name,fn)=>async()=>{await fn();checks.push({name,status:'passed'});console.log('PASS '+name);};
async function request(path,{method='GET',data,cookie,origin}={}){const r=await fetch(BASE+'/api/'+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:data!==undefined?JSON.stringify(data):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function auth(role){const r=await request('login',{method:'POST',data:{email:role==='admin'?'admin':role+'@academy.test',password:role==='admin'?'admin':'Academy2026!'}});assert.equal(r.status,200);assert.ok(r.cookie);return r.cookie;}
async function shot(page,name,route,caption,figure){await page.evaluate(()=>document.querySelector('#toast').className='');await page.screenshot({path:join(SHOTS,name+'.png'),fullPage:true,animations:'disabled'});await page.screenshot({path:join(SHOTS,name+'-viewport.png'),fullPage:false,animations:'disabled'});screenshots.push({file:name+'.png',figure_file:name+'-viewport.png',route,caption,figure,viewport:page.viewportSize(),captured_at:new Date().toISOString(),data_kind:'synthetic educational demonstration',sha256:createHash('sha256').update(readFileSync(join(SHOTS,name+'.png'))).digest('hex')});}
async function route(page,path,selector){await page.goto(BASE+'/#'+path);await page.locator(selector).waitFor();}
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Server did not start: '+serverLogs)),15000);server.stdout.on('data',x=>{if(x.toString().includes('Academy:')){clearTimeout(t);resolve();}});server.on('exit',code=>{clearTimeout(t);reject(new Error('Server exited '+code+serverLogs));});});
  const student=await auth('student'),teacher=await auth('teacher'),admin=await auth('admin');
  await check('Authentication and invalid credentials',async()=>{assert.equal((await request('bootstrap')).status,401);assert.equal((await request('login',{method:'POST',data:{email:'student@academy.test',password:'wrong'}})).status,401);assert.equal((await request('bootstrap',{cookie:student})).body.user.role,'student');})();
  await check('Dilnora username alias preserves the existing student account',async()=>{const r=await request('login',{method:'POST',data:{email:'dilnora',password:'dilnora'}});assert.equal(r.status,200);assert.equal(r.body.user.email,'student@academy.test');assert.equal(r.body.user.role,'student');assert.equal((await request('logout',{method:'POST',cookie:r.cookie,data:{}})).status,200);})();
  await check('Role boundaries enforced by server',async()=>{for(const path of ['users','reports','manage/courses/1'])assert.equal((await request(path,{cookie:student})).status,403);assert.equal((await request('users',{cookie:teacher})).status,403);assert.equal((await request('reports',{cookie:teacher})).status,200);})();
  await check('Quiz locked until lessons completed; no answer leakage',async()=>{assert.equal((await request('courses/1/quiz',{cookie:student})).status,409);assert.equal((await request('courses/1/quiz',{method:'POST',cookie:student,data:{answers:{},score:100}})).status,409);const c=await request('courses/1',{cookie:student});assert.ok(!JSON.stringify(c.body).includes('correct'));})();
  await check('Cross-origin writes rejected',async()=>{assert.equal((await request('profile',{method:'PATCH',cookie:student,origin:'https://attacker.test',data:{name:'Changed Name',department:'Changed'}})).status,403);})();
  await check('Enrollment required; progress is idempotent',async()=>{assert.equal((await request('lessons/7',{cookie:student})).status,403);const before=(await request('courses/1',{cookie:student})).body.progress.done;await request('lessons/1/complete',{method:'POST',cookie:student,data:{}});await request('lessons/1/complete',{method:'POST',cookie:student,data:{}});assert.equal((await request('courses/1',{cookie:student})).body.progress.done,before);})();
  await check('Certificate cannot be obtained before successful completion',async()=>{assert.equal((await request('certificates/1',{cookie:student})).status,403);})();
  await check('Invalid user input and duplicate emails rejected',async()=>{assert.equal((await request('users',{method:'POST',cookie:admin,data:{name:'X'}})).status,400);assert.equal((await request('users',{method:'POST',cookie:admin,data:{name:'Test User',email:'student@academy.test',department:'Development',role:'admin',password:'LongPassword123'}})).status,409);})();

  browser=await chromium.launch({channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Asia/Tashkent'});
  const page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));
  await page.goto(BASE);await page.locator('#login-form').waitFor();await shot(page,'01-login','login','Страница входа и выбор демонстрационной роли','3.2');
  await page.getByRole('button',{name:'Сотрудник',exact:true}).click();await page.getByRole('heading',{name:'Рады видеть вас в Академии'}).waitFor();
  await shot(page,'02-dashboard','dashboard','Обзор сотрудника: назначенные курсы и активность','3.3');
  await route(page,'catalog','#course-search');await shot(page,'03-catalog','catalog','Каталог учебных программ','3.4');
  await page.locator('#course-search').fill('SQL');await page.waitForFunction(()=>document.querySelectorAll('#course-grid .course-card').length===1);assert.equal(await page.locator('#course-grid h3').innerText(),'SQL и работа с данными');await page.locator('#course-search').fill('');
  checks.push({name:'Course catalog search updates actual results',status:'passed'});
  await route(page,'course/1','.course-detail');await shot(page,'04-course','course/1','Программа курса и индивидуальный прогресс','3.5');
  await route(page,'lesson/2','.lesson-article');await shot(page,'05-lesson','lesson/2','Учебный модуль с практическим заданием','3.6');
  await page.getByRole('button',{name:'Урок изучен · продолжить'}).click();await page.getByRole('heading',{name:'Безопасная работа с данными'}).waitFor();
  await page.getByRole('button',{name:'Урок изучен · продолжить'}).click();await page.locator('#quiz-form').waitFor();await shot(page,'06-quiz','quiz/1','Итоговый тест по курсу','3.7');
  const wrong=[0,0,0,0];for(let i=0;i<4;i++)await page.locator('.question').nth(i).locator('input').nth(wrong[i]).check();
  await page.getByRole('button',{name:'Завершить тест'}).click();await page.getByRole('heading',{name:'Закрепите материал и возвращайтесь'}).waitFor();assert.equal(await page.locator('.score-ring').innerText(),'0%');
  await page.getByRole('link',{name:'Повторить тест'}).click();await page.locator('#quiz-form').waitFor();
  const correct=[1,2,1,3];for(let i=0;i<4;i++)await page.locator('.question').nth(i).locator('input').nth(correct[i]).check();
  await page.getByRole('button',{name:'Завершить тест'}).click();await page.getByRole('heading',{name:'Отличная работа!'}).waitFor();assert.equal(await page.locator('.score-ring').innerText(),'100%');await shot(page,'07-result','result/2','Результат и разбор ответов после успешной попытки','3.8');
  checks.push({name:'Browser: lessons → failed quiz → retry → server-graded pass',status:'passed'});
  await page.getByRole('link',{name:'Получить сертификат'}).click();await page.locator('.certificate').waitFor();await shot(page,'08-certificate','certificate/1','Демонстрационный сертификат о прохождении','3.9');
  await page.pdf({path:join(SHOTS,'certificate-example.pdf'),printBackground:true,preferCSSPageSize:true});
  await route(page,'learning','#course-grid');await shot(page,'09-learning','learning','Моё обучение и завершённые программы','3.10');
  await route(page,'profile','#profile-form');assert.ok((await page.locator('#profile-form [name="name"]').inputValue()).includes('Габидуллина'));await shot(page,'10-profile','profile','Профиль демонстрационного аккаунта с персонализацией автора','3.11');
  await page.locator('#profile-form [name="department"]').fill('Разработка и обучение');await page.locator('#profile-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.profile-card').innerText.includes('Разработка и обучение'));
  await page.reload();await page.locator('#profile-form').waitFor();assert.equal(await page.locator('#profile-form [name="department"]').inputValue(),'Разработка и обучение');checks.push({name:'Profile persisted after full page reload',status:'passed'});
  await route(page,'about','.about-grid');await shot(page,'11-about','about','Паспорт учебного проекта и сведения о разработке','3.12');
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();await page.locator('#login-form').waitFor();
  await page.getByRole('button',{name:'Преподаватель',exact:true}).click();await page.locator('.hero').waitFor();
  await route(page,'reports','#report-table');await shot(page,'12-reports','reports','Мониторинг результатов команды преподавателем','3.13');
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Выгрузить CSV'}).click();const csv=await download;await csv.saveAs(join(RESULTS,'report.csv'));assert.ok(readFileSync(join(RESULTS,'report.csv'),'utf8').includes('Информационная безопасность'));
  await page.getByRole('button',{name:'Назначить курс',exact:true}).click();await page.locator('#assign-form').waitFor();await page.locator('#assign-form [name="course_id"]').selectOption('3');await shot(page,'13-assignment','reports#assign','Назначение учебной программы сотруднику','3.14');await page.locator('#assign-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.waitForFunction(()=>document.querySelector('#report-table').innerText.includes('SQL и работа с данными'));
  checks.push({name:'Teacher assigns course and exports actual report CSV',status:'passed'});
  await route(page,'manage','.catalog-grid');await shot(page,'14-course-management','manage','Управление учебными программами','3.15');
  await page.getByRole('button',{name:'Создать курс'}).click();await page.locator('#course-form').waitFor();
  for(const [name,value]of Object.entries({title:'Учебная коммуникация',description:'Курс для проверки полного цикла создания и публикации учебного материала.',lessonTitle:'Понятная обратная связь',lessonBody:'Цель урока\nНаучиться давать содержательную обратную связь по результатам задачи.\n\nПрактика\nСформулируйте наблюдение, ожидаемое поведение и следующий шаг без оценки личности.',question:'Что включает полезная обратная связь?',option0:'Только оценку личности',option1:'Наблюдение и следующий шаг',option2:'Только эмоции',option3:'Случайные цифры'}))await page.locator(`#course-form [name="${name}"]`).fill(value);
  await page.locator('#course-form [name="correct"]').selectOption('1');await page.locator('#course-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.getByRole('heading',{name:'Учебная коммуникация',exact:true}).waitFor();
  const card=page.locator('.catalog-grid>.card').filter({has:page.getByRole('heading',{name:'Учебная коммуникация',exact:true})});await card.getByRole('button',{name:'Редактировать'}).click();await page.locator('#edit-course-form').waitFor();await page.locator('#edit-course-form [name="title"]').fill('Коммуникация и обратная связь');await page.locator('#edit-course-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.getByRole('heading',{name:'Коммуникация и обратная связь',exact:true}).waitFor();
  checks.push({name:'Teacher creates and edits a persisted course through UI',status:'passed'});
  const editedCard=page.locator('.catalog-grid>.card').filter({has:page.getByRole('heading',{name:'Коммуникация и обратная связь',exact:true})});
  await editedCard.getByRole('button',{name:'Редактировать'}).click();await page.locator('#edit-course-form').waitFor();
  await page.locator('#edit-course-form input[name^="prompt-"]').fill('Что делает обратную связь полезной для обучения?');await page.locator('#edit-course-form textarea[name^="explanation-"]').fill('Полезная обратная связь описывает наблюдение и предлагает понятный следующий шаг.');await page.locator('#edit-course-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
  await editedCard.getByRole('button',{name:'Редактировать'}).click();await page.locator('#edit-course-form').waitFor();assert.equal(await page.locator('#edit-course-form input[name^="prompt-"]').inputValue(),'Что делает обратную связь полезной для обучения?');
  await page.getByRole('button',{name:'Добавить урок',exact:true}).click();await page.locator('#lesson-form').waitFor();await page.locator('#lesson-form [name="title"]').fill('Практика обратной связи');await page.locator('#lesson-form [name="body"]').fill('Цель\nЗакрепить навык содержательного описания наблюдений.\n\nЗадание\nНапишите пример обратной связи с наблюдением, ожидаемым результатом и следующим шагом.');await page.locator('#lesson-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await editedCard.getByRole('button',{name:'Редактировать'}).click();await page.locator('#edit-course-form').waitFor();assert.equal(await page.locator('#edit-course-form input[name^="title-"]').count(),2);await page.getByRole('button',{name:'Закрыть',exact:true}).click();checks.push({name:'Course editor persists quiz explanations and adds a new lesson',status:'passed'});
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();await page.locator('#login-form').waitFor();await page.getByRole('button',{name:'Администратор',exact:true}).click();await page.locator('.hero').waitFor();
  await route(page,'team','.table-wrap');await shot(page,'15-users','team','Администрирование пользователей и ролей','3.16');
  await page.getByRole('button',{name:'Добавить сотрудника'}).click();for(const [name,value]of Object.entries({name:'Проверочный сотрудник',email:'qa-user@academy.test',department:'Тестирование',password:'QualityPassword2026!'}))await page.locator(`#user-form [name="${name}"]`).fill(value);await page.locator('#user-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.getByText('qa-user@academy.test',{exact:true}).waitFor();
  checks.push({name:'Administrator creates new account through UI',status:'passed'});

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'ru-RU'});const mp=await mobile.newPage();mp.on('pageerror',x=>browserErrors.push(x.message));
  await mp.goto(BASE);await mp.locator('#login-form').waitFor();await shot(mp,'16-mobile-login','login','Мобильная версия страницы входа',null);await mp.getByRole('button',{name:'Сотрудник',exact:true}).click();await mp.locator('.hero').waitFor();
  await shot(mp,'17-mobile-dashboard','dashboard','Мобильный обзор сотрудника',null);
  await check('Mobile dashboard has no horizontal page overflow',async()=>assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)))();
  await mp.getByRole('button',{name:'Открыть меню'}).click();await mp.locator('.nav-open').waitFor();await mp.getByRole('link',{name:'Каталог курсов',exact:true}).click();await mp.locator('#course-search').waitFor();
  await shot(mp,'18-mobile-catalog','catalog','Мобильный каталог учебных программ',null);
  await check('Mobile catalog navigation and responsive layout',async()=>assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)))();
  await route(mp,'lesson/1','.lesson-article');await shot(mp,'19-mobile-lesson','lesson/1','Чтение учебного модуля на телефоне',null);
  await check('Mobile lesson has no horizontal page overflow',async()=>assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)))();
  await check('No unhandled JavaScript errors in desktop/mobile browser',async()=>assert.deepEqual(browserErrors,[]))();
  const cert=await request('certificates/1',{cookie:student});assert.equal(cert.status,200);assert.equal(cert.body.score,100);assert.equal((await request('bootstrap',{cookie:student})).body.attempts.length,2);
  await request('logout',{method:'POST',cookie:student,data:{}});assert.equal((await request('bootstrap',{cookie:student})).status,401);checks.push({name:'Persistent attempts, guarded certificate, and session revocation',status:'passed'});
  const stopped=once(server,'exit');server.kill();await stopped;server=spawn(process.execPath,['server.mjs'],serverOptions);server.stdout.on('data',x=>serverLogs+=x);server.stderr.on('data',x=>serverLogs+=x);
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Restart timeout')),10000);server.stdout.on('data',x=>{if(x.toString().includes('Academy:')){clearTimeout(timeout);resolve();}});});
  await check('Database survives a complete server restart',async()=>{const cookie=await auth('student');const saved=(await request('bootstrap',{cookie})).body;assert.equal(saved.attempts.length,2);assert.equal(saved.courses.find(c=>c.id===1).progress.completed,true);assert.equal(saved.user.department,'Разработка и обучение');})();
  writeFileSync(join(SHOTS,'manifest.json'),JSON.stringify({application:'TELECOM SOFT Academy',capture_environment:BASE,mode:'synthetic educational demonstration',screenshots},null,2));
  console.log(`Verified ${checks.length} checks; saved ${screenshots.length} screenshots.`);
}catch(error){checks.push({name:'Verification interrupted',status:'failed',error:error.stack});console.error(error);process.exitCode=1;}
finally{
  if(browser)await browser.close();server.kill();
  writeFileSync(join(RESULTS,'verification.json'),JSON.stringify({date:new Date().toISOString(),checks,browserErrors,screenshots:screenshots.length},null,2));
  writeFileSync(join(RESULTS,'server.log'),serverLogs);
  console.log('Results: '+RESULTS);
}
