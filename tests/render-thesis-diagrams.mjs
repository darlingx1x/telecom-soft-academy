import {chromium} from 'playwright';
import {readFileSync,readdirSync} from 'node:fs';
const dir='../illustrations/diagrams';const browser=await chromium.launch({channel:'msedge'});
try{const page=await browser.newPage();for(const file of readdirSync(dir).filter(x=>x.endsWith('.svg'))){const svg=readFileSync(dir+'/'+file,'utf8'),width=Number(svg.match(/width="(\d+)"/)[1]),height=Number(svg.match(/height="(\d+)"/)[1]);await page.setViewportSize({width,height});await page.setContent('<style>body{margin:0}</style>'+svg);await page.locator('svg').screenshot({path:dir+'/'+file.replace('.svg','.png')});console.log(file);}}finally{await browser.close();}
