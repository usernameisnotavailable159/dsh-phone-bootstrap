const TOKEN = process.argv[2];
if (!TOKEN) { console.error('usage'); process.exit(2); }
process.env.TMPDIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
process.env.XDG_RUNTIME_DIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
Object.defineProperty(process, 'platform', { value: 'linux' });
const mod = await import('/data/data/com.termux/files/home/projects/dsh-agi-harness/plugins/dsh-browser-panel/node_modules/playwright-core/index.mjs');
const chromium = mod.chromium ?? mod.default?.chromium;
const browser = await chromium.launch({ executablePath: '/data/data/com.termux/files/usr/lib/chromium/chrome', headless: true, timeout: 60000, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; V2453A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type()==='error') errors.push('console:'+m.text().slice(0,160)); });
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:3080/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-composer-card]', { timeout: 20000 });
  await page.waitForSelector('[data-mobile-nav="frame"]', { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(1000);
  async function swipe(x1,y1,x2,y2){ const steps=10; await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,radiusX:3,radiusY:3,force:1,id:1}]}); for(let i=1;i<=steps;i++){const x=Math.round(x1+(x2-x1)*i/steps),y=Math.round(y1+(y2-y1)*i/steps); await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,radiusX:3,radiusY:3,force:1,id:1}]}); await page.waitForTimeout(20);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
  const collapsed = () => page.evaluate(() => document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') ?? null);
  const closeIfOpen = async () => { if (!(await collapsed())) { await swipe(300,420,100,420); await page.waitForTimeout(700); } };
  await closeIfOpen();
  const normalOpen = {}; await swipe(100,420,300,420); await page.waitForTimeout(800); normalOpen.collapsed = await collapsed(); await closeIfOpen();
  // Simulate a wide message that used to make the outer conversation body scroll horizontally.
  await page.evaluate(() => {
    const body = document.querySelector('[data-phase] [class$="_scrollBody"]');
    const probe = document.createElement('div');
    probe.id = 'dsh-pocket-overflow-probe';
    probe.style.cssText = 'width:2400px;height:600px;flex:none;';
    probe.textContent = 'overflow-probe';
    body.appendChild(probe);
    body.style.setProperty('overflow-x', 'auto', 'important');
  });
  await page.waitForTimeout(250);
  const overflowMetrics = await page.evaluate(() => { const el = document.querySelector('[data-phase] [class$="_scrollBody"]'); const cs = getComputedStyle(el); return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: cs.overflowX }; });
  await swipe(100,420,300,420); await page.waitForTimeout(800);
  const overflowOpen = await collapsed();
  await closeIfOpen();
  await page.evaluate(() => { document.getElementById('dsh-pocket-overflow-probe')?.remove(); const el = document.querySelector('[data-phase] [class$="_scrollBody"]'); el.style.removeProperty('overflow-x'); });
  await page.waitForTimeout(250);
  // Known horizontal control: a table inside an overflow-x:auto wrapper must keep native pan.
  await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.id = 'dsh-pocket-table-probe';
    wrap.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow-x:auto;z-index:9999;background:rgba(255,0,0,.08);touch-action:pan-x pan-y;';
    const table = document.createElement('table');
    table.style.cssText = 'width:2400px;border-collapse:collapse;';
    table.innerHTML = '<tr><td style="width:2400px;height:800px">wide table</td></tr>';
    wrap.appendChild(table);
    document.body.appendChild(wrap);
  });
  await page.waitForTimeout(250);
  const tableHit = await page.evaluate(() => !!document.elementFromPoint(100,420)?.closest('table'));
  await swipe(100,420,300,420); await page.waitForTimeout(800);
  const tableBlocked = await collapsed();
  await page.evaluate(() => { document.getElementById('dsh-pocket-table-probe')?.remove(); });
  await page.waitForTimeout(250);
  await closeIfOpen();
  await swipe(100,420,300,420); await page.waitForTimeout(800);
  const afterCleanupOpen = await collapsed();
  await closeIfOpen();
  console.log(JSON.stringify({ normalOpen, overflowMetrics, overflowOpen, tableHit, tableBlocked, afterCleanupOpen, errors }, null, 2));
} catch(e){ console.error('ERR', e&&e.stack||e); }
finally { await Promise.race([browser.close().catch(()=>{}), new Promise(r=>setTimeout(r,8000))]); }
process.exit(0);
