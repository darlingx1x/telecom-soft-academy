import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const dir='../verification/site-v2/preview';mkdirSync(dir,{recursive:true});
const errors=[],checks=[];const browser=await chromium.launch({channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ru-RU'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173');await page.locator('#login-form').waitFor();
  await page.locator('[name="email"]').fill('admin');await page.locator('[name="password"]').fill('admin');
  await page.locator('#login-form button[type="submit"]').click();await page.locator('.portal-hero').waitFor();
  assert.ok((await page.locator('.page-footer').innerText()).includes('TELECOM SOFT Academy · Габидуллина Дилнора Камилжановна'));
  checks.push('Manual admin/admin on current preview; author in shared footer');
  for(const [route,selector]of [['dashboard','.portal-hero'],['catalog','#course-grid'],['library','#library-grid'],['certificate-preview','.certificate-v2']]){
    await page.goto('http://127.0.0.1:4173/#'+route);await page.locator(selector).waitFor();
    await page.screenshot({path:dir+'/'+route+'.png',fullPage:true,animations:'disabled'});
  }
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:4173/#dashboard');await page.locator('.portal-hero').waitFor();
    const footer=page.locator('.page-footer');await footer.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await footer.isVisible());assert.ok((await footer.innerText()).includes('Камилжановна'));
    if(width===390)await page.screenshot({path:dir+'/mobile-author-footer.png'});
  }
  checks.push('Author footer fits 320/390/768 px without horizontal overflow');assert.deepEqual(errors,[]);
  checks.push('Current preview has no uncaught JavaScript errors');
  writeFileSync(dir+'/verification.json',JSON.stringify({date:new Date().toISOString(),url:'http://127.0.0.1:4173',checks,errors},null,2));
  console.log(checks.join('\n'));
}finally{await browser.close();}
