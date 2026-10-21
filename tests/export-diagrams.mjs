import {chromium} from 'playwright';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const directory=join(root,'..','illustrations','diagrams');
const browser=await chromium.launch({channel:'msedge'});
try{
  const context=await browser.newContext({deviceScaleFactor:2});
  const page=await context.newPage();
  for(const filename of readdirSync(directory).filter(x=>x.endsWith('.svg'))){
    const svg=readFileSync(join(directory,filename),'utf8');
    const width=Number(svg.match(/width="(\d+)"/)[1]),height=Number(svg.match(/height="(\d+)"/)[1]);
    await page.setViewportSize({width,height});await page.goto(pathToFileURL(join(directory,filename)).href);
    await page.locator('svg').screenshot({path:join(directory,filename.replace('.svg','.png'))});
  }
}finally{await browser.close();}
const files=['server.mjs','seed.mjs','public/index.html','public/app.js','public/styles.css','package.json','package-lock.json'];
const hashes=files.map(file=>({file,sha256:createHash('sha256').update(readFileSync(join(root,file))).digest('hex')}));
const version=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
writeFileSync(join(root,'..','source-version.json'),JSON.stringify({captured_at:new Date().toISOString(),version,files:hashes},null,2));
const manifestPath=join(root,'..','illustrations','screenshots','manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.source_version=version;
writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
console.log('Diagram PNGs and source version saved.');
