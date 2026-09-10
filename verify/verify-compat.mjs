const TOKEN = process.argv[2];
if (!TOKEN) { console.error('usage'); process.exit(2); }
process.env.TMPDIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
process.env.XDG_RUNTIME_DIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
Object.defineProperty(process, 'platform', { value: 'linux' });
const t0 = Date.now();
const log = (...a) => console.error(`[vc +${((Date.now()-t0)/1000).toFixed(1)}s]`, ...a);
const mod = await import('/data/data/com.termux/files/home/projects/dsh-agi-harness/plugins/dsh-browser-panel/node_modules/playwright-core/index.mjs');
const chromium = mod.chromium ?? mod.default?.chromium;
const browser = await chromium.launch({ executablePath: '/data/data/com.termux/files/usr/lib/chromium/chrome', headless: true, timeout: 60000, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0,200)); });
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:3080/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-composer-card]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  async function swipe(x1,y1,x2,y2){ const steps=10; await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,radiusX:3,radiusY:3,force:1,id:1}]}); for(let i=1;i<=steps;i++){const x=Math.round(x1+(x2-x1)*i/steps),y=Math.round(y1+(y2-y1)*i/steps); await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,radiusX:3,radiusY:3,force:1,id:1}]}); await page.waitForTimeout(15);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
  const collapsed = () => page.evaluate(() => document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') ?? null);
  async function openDrawer(){ if (await collapsed()) { await swipe(80,420,260,420); await page.waitForTimeout(650); } }
  async function closeDrawer(){ if (!(await collapsed())) { await swipe(300,420,100,420); await page.waitForTimeout(650); } }
  await openDrawer();
  log('drawer open state', await collapsed());
  // --- settings dialog ---
  await page.evaluate(() => { const b=[...document.querySelectorAll('[data-mobile-nav="frame"] > [class*="_sidebarCol"] button')].find(el=>/Settings|设置/.test(el.textContent||'')); b?.click(); });
  await page.waitForSelector('[aria-modal="true"]', { timeout: 8000 });
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => {
    const rct = el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),display:cs.display,position:cs.position,flexDirection:cs.flexDirection,flexWrap:cs.flexWrap,overflowX:cs.overflowX}; };
    const modal = document.querySelector('[aria-modal="true"]');
    const nav = modal?.firstElementChild ?? null;
    const navList = modal?.querySelector('[class$="_navList"]') ?? null;
    const content = modal?.lastElementChild ?? null;
    const row = modal?.querySelector('[class$="_section"] [class$="_row"]') ?? null;
    return {
      modal: rct(modal), nav: rct(nav), navList: navList ? {...rct(navList), scrollWidth: navList.scrollWidth, clientWidth: navList.clientWidth} : null,
      navCells: [...modal.querySelectorAll('[class$="_navCell"]')].slice(0,4).map(el=>({text:(el.textContent||'').trim().slice(0,30), ...rct(el)})),
      content: rct(content), row: rct(row), rowFlexDirection: row ? getComputedStyle(row).flexDirection : null,
    };
  });
  log('settings', JSON.stringify(settings, null, 2));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  // --- open a real session ---
  await openDrawer();
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-mobile-nav="frame"] > [class*="_sidebarCol"] [class*="sessionRow"]')].map(el => (el.textContent||'').trim().slice(0,50)));
  log('rows', JSON.stringify(rows));
  const clicked = await page.evaluate(() => {
    const rows=[...document.querySelectorAll('[data-mobile-nav="frame"] > [class*="_sidebarCol"] [class*="sessionRow"]')];
    const row=rows.find(el=>(el.textContent||'').includes('你好') && !(el.textContent||'').includes('New Session')) || rows.find(el=>!(el.textContent||'').includes('New Session'));
    if (!row) return null; row.click(); return (row.textContent||'').trim().slice(0,60);
  });
  log('clicked', JSON.stringify(clicked));
  await page.waitForFunction(() => {
    const h = document.querySelector('[data-phase] header');
    return h !== null && getComputedStyle(h).display !== 'none';
  }, { timeout: 15000 }).catch(()=>log('wait active header timeout'));
  await page.waitForTimeout(1500);
  const session = await page.evaluate(() => {
    const rct = el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),display:cs.display,overflowX:cs.overflowX,flexWrap:cs.flexWrap,whiteSpace:cs.whiteSpace}; };
    const phase = document.querySelector('[data-phase]');
    const header = phase?.querySelector('header');
    const tabs = header?.querySelector('[class$="_tabs"]');
    const tabItems = tabs ? [...tabs.children] : [];
    const actions = header?.querySelector('[class$="_headerActions"]');
    const seat = document.querySelector('[class$="_composerSeat"]');
    const composer = document.querySelector('[data-composer-card]');
    const input = document.querySelector('[data-composer-input]');
    const statLeaves = seat ? [...seat.querySelectorAll('*')].filter(el => el.children.length===0 && (el.textContent||'').trim().length>0 && el.getBoundingClientRect().width>0).map(el=>({text:(el.textContent||'').trim().slice(0,60), ...rct(el)})).slice(0,14) : [];
    return {
      phase: phase ? { attr: phase.getAttribute('data-phase'), cls: String(phase.className).slice(0,60), r: rct(phase) } : null,
      header: header ? rct(header) : null,
      actions: actions ? {...rct(actions), scrollWidth: actions.scrollWidth, clientWidth: actions.clientWidth} : null,
      tabs: tabs ? {...rct(tabs), scrollWidth: tabs.scrollWidth, clientWidth: tabs.clientWidth, children: tabItems.slice(0,10).map(el=>({text:(el.textContent||'').trim().slice(0,24), ...rct(el)}))} : null,
      bodyScroll: (()=>{ const el=phase?.querySelector('[class$="_scrollBody"]'); return el ? rct(el) : null; })(),
      composer: composer ? rct(composer) : null,
      input: input ? {...rct(input), editable: input.getAttribute('contenteditable'), role: input.getAttribute('role')} : null,
      seat: seat ? rct(seat) : null,
      statLeaves,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      dshPocketStyleRules: (()=>{ const st=document.querySelector('style[data-plugin="dsh-pocket-mobile"]'); const sheet=st?.sheet; return sheet?sheet.cssRules.length:null; })(),
    };
  });
  log('session', JSON.stringify(session, null, 2));
  // --- drawer swipe open/close again ---
  await closeDrawer();
  const closed = await collapsed();
  await openDrawer();
  const opened = await collapsed();
  log('swipe state', JSON.stringify({closed, opened}));
  console.log(JSON.stringify({ errors }, null, 2));
} catch (e) { console.error('VERIFY ERROR', e && e.stack || e); }
finally { log('closing'); await Promise.race([browser.close().catch(()=>{}), new Promise(r=>setTimeout(r,10000))]); log('done'); }
process.exit(0);
