import {chromium} from 'playwright';
import {fileURLToPath} from 'url'; import path from 'path'; import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname,'..','src');
const STORAGE = path.join(__dirname,'storageState.json');
const URL='https://app.todoist.com/app/project/shortcuts-test-6h46w78P7h369Jcx';
const raw=JSON.parse(fs.readFileSync(STORAGE,'utf8'));
const cookies=(raw.cookies||raw).filter(c=>c&&c.name&&typeof c.value==='string').map(c=>({name:c.name,value:c.value,domain:typeof c.domain==='string'&&c.domain?c.domain:'.todoist.com',path:'/',secure:true,sameSite:['Strict','Lax','None'].includes(c.sameSite)?c.sameSite:'Lax'}));
const ctx=await chromium.launchPersistentContext('',{headless:false,args:[`--disable-extensions-except=${SRC}`,`--load-extension=${SRC}`]});
await ctx.addCookies(cookies); const page=ctx.pages()[0]||await ctx.newPage();
const cursoredId=()=>page.evaluate(()=>{for(const el of document.querySelectorAll('li.task_list_item[data-item-id]'))if(getComputedStyle(el).borderLeftColor==='rgb(64, 115, 214)')return el.getAttribute('data-item-id');return null;});
const indById=(id)=>page.evaluate(id=>{const el=document.querySelector(`li[data-item-id="${id}"]`);return el?el.getAttribute('data-item-indent'):null;},id);
async function open(){await page.goto(URL,{waitUntil:'domcontentloaded'});await page.waitForTimeout(5500);await page.waitForSelector('li.task_list_item[data-item-id]',{timeout:15000});for(let i=0;i<6;i++){const b=page.locator('button[aria-label="Expand task"]');if(!(await b.count()))break;await b.first().click().catch(()=>{});await page.waitForTimeout(400);}}
await open();
const list=await page.evaluate(()=>Array.from(document.querySelectorAll('li.task_list_item[data-item-id]')).map(el=>({id:el.getAttribute('data-item-id'),indent:el.getAttribute('data-item-indent'),text:(el.textContent||'').trim().slice(0,20)})));
const t=[...list].reverse().find(x=>Number(x.indent)>=2)||list.find(x=>Number(x.indent)===1);
// cursor to it
await page.locator('body').click({position:{x:5,y:5}}).catch(()=>{});await page.keyboard.press('^');await page.waitForTimeout(400);
for(let i=0;i<40;i++){if(await cursoredId()===t.id)break;await page.keyboard.press('j');await page.waitForTimeout(150);}
const before=await indById(t.id);
const key=Number(before)>=2?'Shift+h':'Shift+l';
await page.keyboard.press(key);await page.waitForTimeout(3000);
const afterOp=await indById(t.id);
await open(); // reload
const afterReload=await indById(t.id);
console.log(`task ${t.id} "${t.text}": indent ${before} --${key}--> ${afterOp}  --reload--> ${afterReload}`);
console.log('PERSISTED:', afterOp===afterReload && afterOp!==before ? 'YES ✓' : (afterOp===before?'op did nothing':'NO ✗'));
await ctx.close();
