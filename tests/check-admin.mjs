import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge'});
try{
  const manual=await browser.newContext();const p=await manual.newPage();
  await p.goto('http://127.0.0.1:4173');await p.locator('#login-form').waitFor();
  await p.locator('[name="email"]').fill('admin');await p.locator('[name="password"]').fill('admin');await p.locator('#login-form button[type="submit"]').click();await p.locator('.hero').waitFor();
  assert.equal((await p.evaluate(async()=>fetch('/api/bootstrap').then(r=>r.json()))).user.role,'admin');
  console.log('PASS manual admin login');
  const demo=await browser.newContext();const q=await demo.newPage();await q.goto('http://127.0.0.1:4173');await q.getByRole('button',{name:'Администратор',exact:true}).click();await q.locator('.hero').waitFor();
  assert.equal((await q.evaluate(async()=>fetch('/api/bootstrap').then(r=>r.json()))).user.role,'admin');console.log('PASS administrator demo button');
}finally{await browser.close();}
