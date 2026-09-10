const TOKEN = process.argv[2];
process.env.TMPDIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
process.env.XDG_RUNTIME_DIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
Object.defineProperty(process, 'platform', { value: 'linux' });
const mod = await import('/data/data/com.termux/files/home/projects/dsh-agi-harness/plugins/dsh-browser-panel/node_modules/playwright-core/index.mjs');
const chromium = mod.chromium ?? mod.default?.chromium;
const browser = await chromium.launch({ executablePath: '/data/data/com.termux/files/usr/lib/chromium/chrome', headless: true, timeout: 60000, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type()==='error') errors.push('console:'+m.text().slice(0,200)); });
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:3080/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-composer-card]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  async function swipe(x1,y1,x2,y2){ const steps=10; await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,radiusX:3,radiusY:3,force:1,id:1}]}); for(let i=1;i<=steps;i++){const x=Math.round(x1+(x2-x1)*i/steps),y=Math.round(y1+(y2-y1)*i/steps); await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,radiusX:3,radiusY:3,force:1,id:1}]}); await page.waitForTimeout(15);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
  const collapsed = () => page.evaluate(() => document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') ?? null);
  if (await collapsed()) { await swipe(80,420,260,420); await page.waitForTimeout(650); }
  await page.evaluate(() => { const b=[...document.querySelectorAll('[data-mobile-nav="frame"] > [class*="_sidebarCol"] button')].find(el=>/Settings|设置/.test(el.textContent||'')); b?.click(); });
  await page.waitForSelector('[aria-modal="true"]', { timeout: 8000 });
  await page.waitForTimeout(800);
  const settingsBase = await page.evaluate(() => {
    const m=document.querySelector('[aria-modal="true"]'); const r=m.getBoundingClientRect(); const nl=m.querySelector('[class$="_navList"]');
    return { rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}, navOverflow:nl?getComputedStyle(nl).overflowX:null, navScrollWidth:nl?.scrollWidth, navClientWidth:nl?.clientWidth };
  });
  const ccClicked = await page.evaluate(() => { const b=[...document.querySelectorAll('[aria-modal="true"] [class$="_navCell"]')].find(el=>/Command Code/i.test(el.textContent||'')); if(!b) return false; b.click(); return true; });
  await page.waitForTimeout(2200);
  const ccPanel = await page.evaluate(() => {
    const m=document.querySelector('[aria-modal="true"]'); if(!m) return null; const text=(m.lastElementChild?.innerText||'').replace(/\s+/g,' ').trim().slice(0,700);
    return { text, hasError:/rpc.*(fail|error)|failed|不可用|error/i.test(text) };
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  const rightUi = await page.evaluate(() => {
    const d=el=>{ if(!el) return 'missing'; const cs=getComputedStyle(el); return {display:cs.display,visibility:cs.visibility,w:Math.round(el.getBoundingClientRect().width)}; };
    return { officialExpand:d(document.querySelector('[data-sidebar-right-expand]')), officialCol:d(document.querySelector('[data-rightbar-col]')), betterPanel:d(document.querySelector('[data-dsh-panel]')) };
  });
  if (!(await collapsed())) { await swipe(300,420,100,420); await page.waitForTimeout(700); }
  await swipe(300,420,100,420); await page.waitForTimeout(800);
  const betterOpen = await page.evaluate(() => { const p=document.querySelector('[data-dsh-panel]'); if(!p) return null; const cs=getComputedStyle(p); const r=p.getBoundingClientRect(); return {visibility:cs.visibility,x:Math.round(r.x),w:Math.round(r.width)}; });
  await swipe(100,420,300,420); await page.waitForTimeout(700);
  const betterClosed = await page.evaluate(() => { const p=document.querySelector('[data-dsh-panel]'); return p?getComputedStyle(p).visibility:null; });
  console.log(JSON.stringify({ settingsBase, ccClicked, ccPanel, rightUi, betterOpen, betterClosed, errors }, null, 2));
} catch(e){ console.error('ERR', e&&e.stack||e); }
finally { await Promise.race([browser.close().catch(()=>{}), new Promise(r=>setTimeout(r,8000))]); }
process.exit(0);
