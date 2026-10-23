import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import {seedAnalyticsDemo} from '../scripts/seed-analytics-demo.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const out=join(root,'test-results','analytics-'+new Date().toISOString().replaceAll(':','-'));
mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4178',checks=[],errors=[];
const env={...process.env,PORT:'4178',HOST:'127.0.0.1',DB_PATH:join(out,'academy.sqlite')};delete env.DATABASE_URL;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let logs='',browser,store;
server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
async function check(name,fn){await fn();checks.push({name,status:'passed'});console.log('PASS '+name);}
async function req(path,cookie,method='GET',data){const r=await fetch(base+'/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function auth(email,password){const r=await req('login',null,'POST',{email,password});assert.equal(r.status,200);return r.cookie;}
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Startup timeout')),12000);server.once('exit',code=>reject(new Error('Server exit '+code)));server.stdout.on('data',x=>{if(String(x).includes('Academy:')){clearTimeout(t);resolve();}});});
  store=new DatabaseSync(env.DB_PATH);
  const admin=await auth('admin','admin'),student=await auth('student@academy.test','Academy2026!'),teacher=await auth('teacher@academy.test','Academy2026!');
  await check('Analytics is private to staff and never includes credentials or quiz answers',async()=>{
    assert.equal((await req('workspace/analytics')).status,401);assert.equal((await req('workspace/analytics',student)).status,403);assert.equal((await req('workspace/analytics',teacher)).status,200);
    const r=await req('workspace/analytics',admin);assert.equal(r.status,200);assert.ok(!/password_hash|correct|details|token_hash/.test(JSON.stringify(r.body)));assert.equal(r.body.rows.filter(r=>r.completed).length,0);
  });
  let cohort;
  await check('Educational cohort is explicit, idempotent and preserves existing records',async()=>{
    const before=store.prepare('SELECT * FROM completions ORDER BY user_id,lesson_id').all();cohort=await seedAnalyticsDemo(store);
    assert.equal(cohort.created_users,24);assert.ok(cohort.eligible_certificates>10);const again=await seedAnalyticsDemo(store);assert.equal(again.created_users,0);assert.equal(again.skipped_users,24);
    assert.deepEqual(store.prepare('SELECT * FROM completions WHERE user_id IN (1,4,5,6) ORDER BY user_id,lesson_id').all(),before);
  });
  let snapshot;
  await check('Saved lessons, tests and certificates reconcile; retries do not inflate achievements',async()=>{
    snapshot=(await req('workspace/analytics',admin)).body;
    assert.equal(snapshot.people.length,28);assert.equal(snapshot.rows.filter(r=>r.completed).length,cohort.eligible_certificates);
    assert.equal(snapshot.rows.length,cohort.enrollments+8);assert.equal(snapshot.attempts.length,cohort.attempts);
    assert.ok(snapshot.rows.some(r=>r.attempts>1&&r.completed));assert.ok(snapshot.rows.some(r=>r.done===r.total&&!r.completed));
    assert.equal(new Set(snapshot.rows.filter(r=>r.completed).map(r=>r.certificate)).size,cohort.eligible_certificates);
    for(const r of snapshot.rows.filter(r=>r.completed)){assert.equal(r.done,r.total);assert.ok(r.certificate_score>=75);assert.ok(r.certificate_date);}
  });
  browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'ru-RU'});
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=500)errors.push(r.status()+' '+r.url());});
  await page.goto(base);await page.locator('#login-form').waitFor();await page.getByRole('button',{name:'Администратор',exact:true}).click();await page.locator('.portal-hero').waitFor();
  await check('Analytics opens from navigation and direct reload with disclosure visible',async()=>{
    await page.locator('.sidebar a[href="#analytics"]').click();await page.locator('#analytics-certificates').waitFor();await page.reload();await page.locator('#analytics-certificates').waitFor();
    assert.ok((await page.locator('.analytics-disclosure').innerText()).includes('смоделированные'));assert.equal(await page.locator('#analytics-people tbody tr').count(),28);
    assert.equal(await page.locator('#analytics-certificates tbody tr').count(),cohort.eligible_certificates);
    await page.screenshot({path:join(out,'analytics-desktop.png'),fullPage:true});
  });
  await check('Course and department filters recalculate all metrics and the certificate register',async()=>{
    await page.locator('#analytics-course').selectOption('1');await page.locator('#analytics-department').selectOption('Разработка');
    const expected=snapshot.rows.filter(r=>r.course_id===1&&r.department==='Разработка');
    assert.equal(Number(await page.locator('.analytics-stats .stat-value').nth(0).innerText()),new Set(expected.map(r=>r.user_id)).size);
    assert.equal(Number(await page.locator('.analytics-stats .stat-value').nth(2).innerText()),expected.filter(r=>r.completed).length);
    await page.locator('#analytics-search').fill('zzzz');assert.equal(await page.locator('#analytics-people tbody tr:visible').count(),0);assert.equal(await page.locator('#analytics-search-empty').isVisible(),true);
  });
  await check('CSV reflects filters, includes data provenance, and is a real downloadable file',async()=>{
    const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать CSV',exact:true}).click();const file=await wait;await file.saveAs(join(out,'analytics.csv'));
    const content=readFileSync(join(out,'analytics.csv'),'utf8');assert.ok(content.includes('демонстрационные'));assert.ok(content.includes('Разработка'));assert.ok(!content.includes('Инфраструктура'));
  });
  await check('Desktop, tablet and mobile layouts fit; charts and tables remain usable',async()=>{
    await page.locator('#analytics-course').selectOption('');await page.locator('#analytics-department').selectOption('');
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px overflow');await page.screenshot({path:join(out,'analytics-'+width+'.png'),fullPage:true});}
  });
  await check('No uncaught browser errors or failed server responses',async()=>assert.deepEqual(errors,[]));
  writeFileSync(join(out,'snapshot.json'),JSON.stringify(snapshot,null,2));
}catch(error){checks.push({name:'Analytics verification',status:'failed',error:error.stack});console.error(error);process.exitCode=1;}
finally{store?.close();if(browser)await browser.close();if(server.exitCode===null){const done=once(server,'exit');server.kill();await done;}writeFileSync(join(out,'verification.json'),JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));writeFileSync(join(out,'server.log'),logs);console.log('Results: '+out);}
