import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..'),BASE=join(ROOT,'..'),SHOTS=join(BASE,'illustrations/screenshots');
const latest=readdirSync(join(ROOT,'test-results')).filter(x=>/^2026/.test(x)).sort().at(-1);
const server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,DB_PATH:join(ROOT,'test-results',latest,'test.sqlite'),PORT:'4177'},stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Startup timeout')),10000);server.stdout.on('data',x=>{if(x.toString().includes('Academy:')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'});
 await context.request.post('http://127.0.0.1:4177/api/login',{data:{email:'student@academy.test',password:'Academy2026!'}});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4177/#lesson/2');await page.locator('.feedback-box').waitFor();
 const clip=await page.evaluate(()=>{const t=document.querySelector('.feedback-box').getBoundingClientRect(),b=document.querySelector('.lesson-notes').getBoundingClientRect(),w=document.querySelector('.lesson-workspace').getBoundingClientRect();return{x:w.x,y:t.y+scrollY-8,width:w.width,height:b.bottom-t.y+8};});
 await page.screenshot({path:join(SHOTS,'21-practice-viewport.png'),clip,animations:'disabled',fullPage:true});
 const p=join(SHOTS,'manifest.json'),m=JSON.parse(readFileSync(p,'utf8'));const entry=m.screenshots.find(x=>x.file==='21-practice.png');entry.figure_sha256=createHash('sha256').update(readFileSync(join(SHOTS,entry.figure_file))).digest('hex');entry.capture_type='document_fragment: feedback and complete private note';writeFileSync(p,JSON.stringify(m,null,2));console.log('Complete feedback and private note captured.');
}finally{if(browser)await browser.close();const done=once(server,'exit');server.kill();await done;}
