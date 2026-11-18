import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(path.resolve('frontend/package.json'))('playwright');
const url=process.env.REVIEW_URL||'http://127.0.0.1:8020/';
const output=path.resolve(process.env.REVIEW_EVIDENCE||'report/evidence/review');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1366,height:950}});
page.setDefaultTimeout(180000);
const checks=[],errors=[],crops={};
page.on('pageerror',e=>errors.push(e.message));
const check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(name);};
const ready=()=>page.locator('.calculation-status[data-ready=true]').waitFor();
const tab=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(200);};
async function exported(){
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Результат JSON ↓',exact:true}).click();
 const file=await download;const filePath=path.join(output,'result.json');await file.saveAs(filePath);
 return JSON.parse(await fs.readFile(filePath,'utf8'));
}
async function importConfig(config){
 await page.locator('input[type=file]').setInputFiles({name:'scenario.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config))});
 await page.waitForTimeout(700);await ready();
}
async function showRow(index){
 const row=page.locator('.equation-row').nth(index);
 await row.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-24));
 await page.waitForTimeout(200);return row;
}
async function cropBounds(name,first,last){
 const main=await page.locator('main').boundingBox();
 const a=await first.boundingBox(),b=await last.boundingBox();
 crops[name]=[Math.max(0,Math.floor(Math.min(main.x,a.x)-4)),Math.max(0,Math.floor(a.y-4)),Math.ceil(main.x+main.width),Math.min(page.viewportSize().height,Math.ceil(Math.max(a.y+a.height,b.y+b.height)+4))];
}
try{
 await page.goto(url);await ready();
 const base=await exported();
 check('Default normalization equals the declared radar bounds',JSON.stringify(base.config.scales)===JSON.stringify(base.config.radar_limits));
 const t=base.t,y=base.y,indices=base.profile_indices;
 const values=y.flatMap(r=>indices.map(i=>r[i]));const span=Math.max(...values)-Math.min(...values);
 const deviations=indices.map(i=>Math.max(...t.map((time,j)=>Math.abs(y[j][i]-(y[0][i]+time*(y.at(-1)[i]-y[0][i])))))/span);
 check('All 11 computed curves bend by at least seven percent of the common vertical span',deviations.every(v=>v>.07));
 check('Every state stays positive and below its selected maximum on the whole output grid',y.every(row=>row.every((v,i)=>v>0&&v<base.config.scales[i])));
 const factors=Array.from({length:8},(_,i)=>{
  const f=base.factors.map(row=>row[i]);
  return Math.max(...t.map((time,j)=>Math.abs(f[j]-(f[0]+time*(f.at(-1)-f[0])))))/(Math.max(...f)-Math.min(...f));
 });
 check('All eight cubic factor curves have visible curvature',factors.every(v=>v>.15));
 for(const [width,height] of [[1366,768],[1280,650],[390,900]]){
  await page.setViewportSize({width,height});await tab('Все результаты');
  const row=await showRow(3);const input=row.getByRole('textbox',{name:'Коэффициент a',exact:true}).first();
  await input.click();
  const field=await input.boundingBox();
  if(width>800){
   await page.locator('.overview-mini').waitFor();
   const graph=await page.locator('.overview-mini').boundingBox(),main=await page.locator('main').boundingBox();
   const settings=await page.locator('.sidebar .scope-note').boundingBox();
   check('The preview uses the left column without covering formulas at '+width,graph.x+graph.width<=main.x-8&&graph.y>=0&&graph.y+graph.height<=height&&field.y>=0&&field.y+field.height<=height);
   check('The preview leaves sidebar settings accessible at '+width,graph.y>=settings.y+settings.height);
   check('Focusing X4 highlights its actual curve at '+width,await page.locator('.overview-mini').getAttribute('data-active-state')==='X4'&&(await page.locator('.overview-mini h3').textContent()).startsWith('X4'));
  }else{
   check('Mobile keeps the full height for formulas',await page.locator('.overview-mini').count()===0&&await page.getByRole('button',{name:'График ↗',exact:true}).isVisible());
   await page.getByRole('button',{name:'График ↗',exact:true}).click();
   check('Mobile opens a readable chart on demand',await page.getByRole('dialog').isVisible()&&await page.locator('canvas').count()===1);
   await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  }
  check('Exactly one combined plot at '+width,await page.locator('canvas').count()===1);
  check('No page overflow at '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(output,'sidebar-'+width+'.png')});
 }
 await page.setViewportSize({width:1366,height:950});
 const row=await showRow(3),input=row.getByRole('textbox',{name:'Коэффициент a',exact:true}).first();
 await input.click();await page.locator('.overview-mini').waitFor();
 const before=await page.evaluate(()=>scrollY);
 await page.getByRole('button',{name:'Развернуть',exact:true}).click();
 check('Expanded chart is a modal with one canvas',await page.getByRole('dialog').isVisible()&&await page.locator('canvas').count()===1&&await page.getByRole('dialog').evaluate(el=>el.matches(':modal')));
 await page.screenshot({path:path.join(output,'expanded.png')});
 await page.keyboard.press('Escape');
 await page.getByRole('dialog').waitFor({state:'detached'});
 await page.waitForFunction(()=>document.activeElement?.matches('.overview-mini-actions button:first-child'),null,{timeout:5000});
 check('Closing restores focus and the place in the formulas',await page.getByRole('button',{name:'Развернуть',exact:true}).evaluate(el=>el===document.activeElement)&&Math.abs(await page.evaluate(()=>scrollY)-before)<2);
 await page.getByRole('button',{name:'Скрыть мини-график',exact:true}).click();
 await page.getByRole('button',{name:'Показать график',exact:true}).waitFor();
 check('The preview can be hidden without moving the form',await page.locator('.overview-mini').count()===0&&await page.getByRole('button',{name:'Показать график',exact:true}).isVisible()&&Math.abs(await page.evaluate(()=>scrollY)-before)<2);
 await page.getByRole('button',{name:'Показать график',exact:true}).click();
 await page.locator('.overview-mini').waitFor();
 await input.fill('-');
 await page.getByText('Допишите коэффициент',{exact:true}).last().waitFor();
 check('An unfinished number marks the preview as stale',await page.locator('.overview-mini').getAttribute('data-current')==='false'&&await page.getByRole('button',{name:'Результат JSON ↓',exact:true}).isDisabled());
 await input.fill('19.10');await input.press('Tab');await page.waitForTimeout(900);await ready();
 const edited=await exported();
 check('Editing the visible coefficient runs a new solution',edited.config.plus[3]!==base.config.plus[3]&&edited.y.at(-1)[3]!==base.y.at(-1)[3]);
 await importConfig(base.config);await showRow(3);
 await page.locator('.overview-mini').waitFor();
 check('The left preview works after replacing a scenario',await page.locator('.overview-mini').isVisible());
 await page.locator('.source-equation').nth(1).getByRole('link',{name:'Уравнение X7',exact:true}).click();
 await page.locator('.overview-mini[data-active-state=X7]').waitFor({timeout:5000});
 check('Additional X7 also has an active preview',await page.locator('#definition-X7:focus').count()===1&&await page.locator('.overview-mini').getAttribute('data-active-state')==='X7');
 await page.locator('.source-equation').nth(3).getByRole('link',{name:'Делитель X4',exact:true}).click();
 await page.locator('#divisor-X4:focus').waitFor();
 await page.locator('.overview-mini').waitFor({state:'detached',timeout:5000});
 check('A normalization link still opens its sidebar setting',await page.locator('#divisor-X4').isVisible()&&await page.locator('.overview-mini').count()===0);
 await showRow(3);
 await page.locator('.source-equation').nth(3).getByRole('link',{name:'Внешний фактор F4',exact:true}).click();
 await page.locator('.overview-mini[data-active-state=""]').waitFor({timeout:5000});
 check('Factor navigation returns to the full set of preview curves',await page.locator('#definition-F4:focus').count()===1&&await page.locator('.overview-mini').getAttribute('data-active-state')==='');
 await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);
 const original=await page.locator('.overview-chart').boundingBox(),main=await page.locator('main').boundingBox();
 check('Returning to the top restores the large graph in the main column',await page.locator('.overview-mini').count()===0&&original.x>=main.x&&original.width>700&&await page.locator('canvas').count()===1);
 await showRow(3);await page.locator('.equation-row').nth(3).getByRole('textbox',{name:'Коэффициент a',exact:true}).first().click();
 await page.locator('.overview-mini').waitFor();
 await cropBounds('combined',page.locator('.overview-chart'),page.locator('.equation-row').nth(3));
 await page.screenshot({path:path.join(output,'combined.png')});
 const calc=page.locator('.equation-row').nth(3).locator('.calculation-details');
 await calc.locator('summary').click();await page.setViewportSize({width:1366,height:1700});await showRow(3);
 check('The worked calculation is available under X4',await calc.locator('.calculation-slope').isVisible());
 await page.locator('.equation-row').nth(3).screenshot({path:path.join(output,'calculation.png')});
 await page.setViewportSize({width:1366,height:950});
 await tab('Внешние факторы');
 check('All eight editable factor rows and adjacent plots are present',await page.locator('.factor-equation-row').count()===8&&await page.locator('canvas').count()===8);
 await page.locator('.all-factors').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollTo(0,0));
 await cropBounds('factors',page.locator('.tabs'),page.locator('.factor-equation-row').nth(2));
 await page.screenshot({path:path.join(output,'factors.png')});
 await tab('Лепестковые диаграммы');await page.evaluate(()=>scrollTo(0,0));
 check('Four quarter diagrams use the supplied limits',await page.locator('canvas').count()===4);
 await cropBounds('radars',page.locator('.tabs'),page.locator('.radar-grid'));
 await page.screenshot({path:path.join(output,'radars.png')});
 await page.getByText('Пределы шкал',{exact:true}).click();
 check('Radar limits have their own R labels',await page.locator('.radar-limit-input').count()===11);
 await tab('Все результаты');await page.getByText('Проверка расчёта',{exact:true}).click();
 await page.getByRole('button',{name:'Проверить расчёт',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.verification-result h3')||document.querySelector('main [role=alert]'));
 const alert=await page.locator('main [role=alert]').allTextContents();
 if(alert.length)throw Error('Numerical verification: '+alert.join(' '));
 check('The new default passes all five numerical checks',await page.getByRole('cell',{name:'Пройдена',exact:true}).count()===5);
 await page.locator('.verification-details').scrollIntoViewIfNeeded();
 await page.locator('.verification-details > section').screenshot({path:path.join(output,'verification.png')});
 check('No uncaught browser errors',errors.length===0);
 await fs.writeFile(path.join(output,'metrics.json'),JSON.stringify({state_departures:deviations,factor_departures:factors,crops},null,2));
}catch(e){await page.screenshot({path:path.join(output,'failure.png')});throw e;}
finally{await fs.writeFile(path.join(output,'checks.json'),JSON.stringify({url,checks,errors},null,2));await browser.close();}
console.log(JSON.stringify({passed:checks.length,url}));
