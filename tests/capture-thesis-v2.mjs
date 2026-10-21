import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..'),BASE=join(ROOT,'..'),SHOTS=join(BASE,'illustrations/screenshots');
const latest=readdirSync(join(ROOT,'test-results')).filter(x=>/^2026/.test(x)).sort().at(-1);
const db=join(ROOT,'test-results',latest,'test.sqlite'),PORT=4177,URL='http://127.0.0.1:'+PORT;
const server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,DB_PATH:db,PORT:String(PORT),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let browser,logs='';const errors=[];
server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
const manifest=JSON.parse(readFileSync(join(SHOTS,'manifest.json'),'utf8'));
async function shot(page,name,route,caption,element){
  await page.evaluate(()=>document.querySelector('#toast').className='');
  await page.screenshot({path:join(SHOTS,name+'.png'),fullPage:true,animations:'disabled'});
  if(element)await page.locator(element).screenshot({path:join(SHOTS,name+'-viewport.png'),animations:'disabled'});
  else await page.screenshot({path:join(SHOTS,name+'-viewport.png'),fullPage:false,animations:'disabled'});
  const record={file:name+'.png',figure_file:name+'-viewport.png',route,caption,figure:null,viewport:page.viewportSize(),captured_at:new Date().toISOString(),capture_environment:URL,capture_type:element?'element':'viewport',data_kind:'synthetic educational demonstration',sha256:createHash('sha256').update(readFileSync(join(SHOTS,name+'.png'))).digest('hex')};
  const idx=manifest.screenshots.findIndex(x=>x.file===record.file);if(idx<0)manifest.screenshots.push(record);else manifest.screenshots[idx]=record;
}
async function route(p,r,selector){await p.goto(URL+'/#'+r);await p.locator(selector).first().waitFor();}
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Startup timeout '+logs)),10000);server.once('error',reject);server.stdout.on('data',x=>{if(x.toString().includes('Academy:')){clearTimeout(t);resolve();}});});
  browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Asia/Tashkent'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(URL);await page.locator('#login-form').waitFor();await page.getByRole('button',{name:'Сотрудник',exact:true}).click();await page.locator('.portal-hero').waitFor();
  await route(page,'lesson/2','.practice-form');await page.locator('.practice-form textarea').fill('Я проверю полный адрес отправителя и домен ссылки. Срочность и просьба сообщить код MFA — признаки риска. Не перейду по ссылке и не сообщу код. Проверю запрос через известный контакт, сохраню сообщение и передам ответственному специалисту сведения о времени и своих действиях.');await page.getByRole('button',{name:'Отправить на проверку',exact:true}).click();await page.locator('.submitted-answer').waitFor();
  const note='Главное: не подтверждать неожиданный вход, а проверять запрос независимо от сообщения. Для разбора фиксировать наблюдения без паролей и кодов.';await page.locator('[data-portal-form="note"] textarea').fill(note);await page.getByRole('button',{name:'Сохранить заметку',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-portal-form="note"] small.muted').textContent.startsWith('Сохранено'));
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();await page.getByRole('button',{name:'Преподаватель',exact:true}).click();await page.locator('.portal-hero').waitFor();await route(page,'reviews','.review-card');await shot(page,'23-reviews','reviews','Очередь практических работ и критерии проверки преподавателем','.review-list');
  await page.getByRole('button',{name:'Дать обратную связь'}).click();await page.locator('[name="score"]').fill('95');await page.locator('[name="feedback"]').fill('Признаки риска и независимая проверка описаны верно. Для полного решения добавьте порядок действий, если учётные данные уже были введены: смена пароля через известный адрес и проверка активных сессий.');await page.getByRole('button',{name:'Отправить обратную связь'}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('.feedback-box').waitFor();
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();await page.getByRole('button',{name:'Сотрудник',exact:true}).click();await page.locator('.portal-hero').waitFor();await route(page,'lesson/2','.feedback-box');await shot(page,'21-practice','lesson/2','Проверенная практическая работа и личная заметка сотрудника','.lesson-workspace');
  // A second image includes both the feedback and the personal note, as shown in the live page.
  const clip=await page.evaluate(()=>{const top=document.querySelector('.feedback-box').getBoundingClientRect(),bottom=document.querySelector('.lesson-notes').getBoundingClientRect(),width=document.querySelector('.lesson-workspace').getBoundingClientRect();return{x:width.x,y:top.y+scrollY-8,width:width.width,height:bottom.bottom-top.y+8};});
  await page.screenshot({path:join(SHOTS,'21-practice-viewport.png'),clip,animations:'disabled',fullPage:true});
  await route(page,'library','#library-grid');await shot(page,'20-library','library','База знаний с поиском и сохранёнными памятками');
  await route(page,'notifications','.notifications-list');await shot(page,'22-notifications','notifications','Уведомления о назначениях и обратной связи','.notifications-list');
  await route(page,'certificate/1','.certificate-v2');await shot(page,'08-certificate','certificate/1','Демонстрационный сертификат о прохождении курса','.certificate-v2');await page.pdf({path:join(SHOTS,'certificate-example.pdf'),printBackground:true,preferCSSPageSize:true});
  assert.deepEqual(errors,[]);
  const version=JSON.parse(readFileSync(join(BASE,'verification/site-v2/source-version.json'),'utf8'));
  manifest.source_version=version.sha256;manifest.application_version=version.version;manifest.date=new Date().toISOString();manifest.mode='synthetic educational demonstration';manifest.used_in_thesis=[];
  for(const f of readdirSync(join(BASE,'draft')).filter(x=>x.endsWith('.txt'))){const text=readFileSync(join(BASE,'draft',f),'utf8');for(const match of text.matchAll(/^@SCREEN ([^|]+)\|([^|]+)\|(.+)$/gm)){const entry=manifest.screenshots.find(x=>x.file===match[1]+'.png');assert.ok(entry,'Missing screen '+match[1]);entry.figure=match[2];entry.caption=match[3];manifest.used_in_thesis.push(entry.file);}}
  for(const entry of manifest.screenshots){entry.source_version=version.sha256;entry.sha256=createHash('sha256').update(readFileSync(join(SHOTS,entry.file))).digest('hex');entry.figure_sha256=createHash('sha256').update(readFileSync(join(SHOTS,entry.figure_file))).digest('hex');}
  writeFileSync(join(SHOTS,'manifest.json'),JSON.stringify(manifest,null,2));
  console.log('Updated screenshots:',manifest.screenshots.length,'used in thesis:',manifest.used_in_thesis.length,'source:',version.sha256);
}finally{if(browser)await browser.close();const done=once(server,'exit');server.kill();await done;}
