import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=process.env.PLAYWRIGHT_MODULE?await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href):createRequire(path.resolve('frontend/package.json'))('playwright');
const url=process.env.PAGES_URL||'http://127.0.0.1:8002/pages-dist/';
const output=path.resolve(process.env.PAGES_EVIDENCE||'report/evidence/pages');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1366,height:1000},deviceScaleFactor:1});
const page=await context.newPage();page.setDefaultTimeout(180000);
const checks=[],errors=[],requests=[];let environment={},loadMs=0,largestDifference=0;
page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>requests.push(r.url()));
const check=(name,condition)=>{checks.push({name,passed:!!condition});if(!condition)throw Error(name);};
const tab=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(150);};
const run=async()=>{await page.getByRole('button',{name:'Рассчитать',exact:true}).click();await page.locator('button.calculate:not([disabled])').waitFor();};
const exportResult=async()=>{
 const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Результат JSON ↓',exact:true}).click();
 const file=await wait;const filePath=path.join(output,'last-result.json');await file.saveAs(filePath);return JSON.parse(await fs.readFile(filePath,'utf8'));
};
const importConfig=async c=>{
 await page.locator('input[type=file]').setInputFiles({name:'scenario.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(c))});
 await page.locator('.result-line').filter({hasText:c.name}).waitFor();await page.locator('button.calculate:not([disabled])').waitFor();
};
try{
 const start=performance.now();await page.goto(url);
 await page.getByRole('heading',{name:'Временной профиль',exact:true}).waitFor();loadMs=performance.now()-start;
 check('Static site starts a real Python computation',await page.getByText('В браузере',{exact:false}).count()>0);
 await page.screenshot({path:path.join(output,'pages-dynamics.png')});
 const native=JSON.parse(await fs.readFile('report/evidence/experiments.json','utf8'));
 const browserResults=[];
 for(let i=0;i<4;i++){
  if(i){await page.getByLabel('Модельный пример',{exact:true}).selectOption(String(i));await run();}
  const result=await exportResult();browserResults.push(result);
  const sameGrid=result.t.length===native[i].t.length&&result.t.every((v,j)=>Math.abs(v-native[i].t[j])<1e-14);
  const error=sameGrid?Math.max(...result.y.flatMap((row,j)=>row.map((v,k)=>Math.abs(v-native[i].y[j][k])/(1+Math.abs(native[i].y[j][k]))))):Infinity;
  largestDifference=Math.max(largestDifference,error);
  check('Scenario '+(i+1)+' matches native Python on the full grid',sameGrid&&error<1e-9&&result.fingerprint===native[i].fingerprint);
 }
 const baseline=browserResults[0];await importConfig(baseline.config);
 await tab('Все графики');check('Eleven state charts are available',await page.locator('canvas').count()===11);
 await tab('Внешние факторы');check('Seven factor equations and charts are available',await page.locator('canvas').count()===7&&await page.getByLabel(/Формула F/).count()===7);
 await tab('Модель');check('Twenty-two editable functions and eleven rendered equations',await page.getByLabel(/Функция (плюс|минус) X/).count()===22&&await page.locator('.equation .katex').count()===11&&await page.locator('.katex-error').count()===0);
 await tab('Срезы');check('Four quarter radars are computed',await page.locator('canvas').count()===4&&baseline.quarters.every((q,i)=>q.t===(i+1)/4));
 await page.screenshot({path:path.join(output,'pages-quarters.png')});
 await tab('Проверка');await page.getByRole('button',{name:'Проверить расчёт',exact:true}).click();
 await page.getByRole('heading',{name:'Все численные критерии выполнены',exact:true}).waitFor();
 check('All five numerical checks run in browser Python',await page.getByRole('cell',{name:'Пройдена',exact:true}).count()===5);
 await page.screenshot({path:path.join(output,'pages-verification.png')});
 const analytic=structuredClone(baseline.config);analytic.name='Аналитический тест WebAssembly';
 analytic.initial=Array(11).fill(1);analytic.scales=Array(11).fill(1);analytic.plus=Array(11).fill('0');analytic.minus=Array(11).fill('0');analytic.minus[0]='0.7*X1';
 await importConfig(analytic);const computed=await exportResult();
 check('Arbitrary imported equations are actually integrated',Math.abs(computed.y.at(-1)[0]-Math.exp(-0.7))<1e-8&&computed.y.at(-1).slice(1).every(v=>v===1));
 await tab('Модель');await page.getByLabel('Функция плюс X1',{exact:true}).fill("__import__('os')");await run();
 check('Unsafe expressions are refused by the browser Python model',await page.getByRole('alert').isVisible());
 await importConfig(baseline.config);await tab('Внешние факторы');await page.getByLabel('Формула F5',{exact:true}).fill('0');await run();
 check('Zero denominator is refused without hidden epsilon',await page.getByRole('alert').isVisible());
 await importConfig(baseline.config);
 for(const kind of ['docx','pdf']){
  const href=await page.getByRole('link',{name:kind==='docx'?'Отчёт DOCX ↓':'PDF ↓',exact:true}).getAttribute('href');
  const response=await context.request.get(href);const bytes=await response.body();
  const file=await fs.readFile('report/Практическая_работа_2_Химический_выброс.'+kind);
  check('Published '+kind+' is exactly the final report',response.ok()&&createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(file).digest('hex'));
 }
 const manifest=await(await context.request.get(new URL('runtime-manifest.json',url).href)).json();
 for(const [name,hash] of Object.entries(manifest.python_sources_sha256)){
  const source=(await fs.readFile('backend/'+name,'utf8')).replaceAll('\r\n','\n');
  check('Published Python source matches repository: '+name,createHash('sha256').update(source).digest('hex')===hash);
 }
 // A fresh instance of the same production worker reports its actual interpreter.
 const workerURL=page.workers()[0].url();
 environment=await page.evaluate(async({workerURL,baseURL})=>{
  const worker=new Worker(workerURL,{type:'module'});
  try{return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Runtime inspection timeout')),180000);
   worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
   worker.onmessage=({data})=>{if(data.id!==1)return;clearTimeout(timer);data.ok?resolve(data.result):reject(Error(data.error));};
   worker.postMessage({id:1,operation:'environment',payload:'{}',baseURL});
  });}finally{worker.terminate();}
 },{workerURL,baseURL:new URL('.',url).href});
 check('Actual WebAssembly interpreter and SciPy are present',environment.platform==='emscripten'&&environment.scipy===manifest.packages.scipy);
 await tab('Динамика');
 const csvWait=page.waitForEvent('download');await page.getByRole('button',{name:'CSV ↓',exact:true}).click();
 const csv=await csvWait;await csv.saveAs(path.join(output,'pages-export.csv'));
 const csvText=await fs.readFile(path.join(output,'pages-export.csv'),'utf8');
 check('CSV includes full output grid and all 19 columns',csvText.trim().split('\n').length===402&&csvText.trim().split('\n')[0].split(';').length===19);
 for(const width of [1280,800,390]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
  check('Page fits width '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await page.screenshot({path:path.join(output,'pages-mobile.png'),fullPage:true});
 check('No API server is used',requests.every(u=>!new URL(u).pathname.includes('/api/')));
 check('All browser assets are self-hosted',requests.filter(u=>u.startsWith('http')).every(u=>new URL(u).origin===new URL(url).origin));
 check('No uncaught JavaScript errors',errors.length===0);
}catch(e){await page.screenshot({path:path.join(output,'pages-failure.png'),fullPage:true});throw e;}
finally{
 await fs.writeFile(path.join(output,'checks.json'),JSON.stringify({url,checks,errors,environment,load_ms:loadMs,max_scaled_difference:largestDifference},null,2));
 await browser.close();
}
console.log(JSON.stringify({passed:checks.length,load_ms:loadMs,max_scaled_difference:largestDifference,environment},null,2));
