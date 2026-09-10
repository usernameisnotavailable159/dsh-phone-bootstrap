// Final dsh-pocket mobile-layer regression check on a real DSH session.
const TOKEN = process.argv[2];
if (!TOKEN) { console.error('usage: final-check.mjs <token>'); process.exit(2); }
process.env.TMPDIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
process.env.XDG_RUNTIME_DIR ||= '/data/data/com.termux/files/home/.dsh/browser-panel/tmp';
Object.defineProperty(process, 'platform', { value: 'linux' });
const t0 = Date.now();
const log = (...a) => console.error(`[fc +${((Date.now()-t0)/1000).toFixed(1)}s]`, ...a);
const mod = await import('/data/data/com.termux/files/home/projects/dsh-agi-harness/plugins/dsh-browser-panel/node_modules/playwright-core/index.mjs');
const chromium = mod.chromium ?? mod.default?.chromium;
const browser = await chromium.launch({ executablePath: '/data/data/com.termux/files/usr/lib/chromium/chrome', headless: true, timeout: 60000, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:3080/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-composer-card]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  async function swipe(x1,y1,x2,y2){ const steps=10; await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,radiusX:3,radiusY:3,force:1,id:1}]}); for(let i=1;i<=steps;i++){const x=Math.round(x1+(x2-x1)*i/steps),y=Math.round(y1+(y2-y1)*i/steps); await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,radiusX:3,radiusY:3,force:1,id:1}]}); await page.waitForTimeout(18);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
  // 1) sidebar hidden by default
  const collapsed = await page.evaluate(() => document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') ?? null);
  // 2) swipe right opens left drawer, swipe left closes
  await swipe(80,420,260,420); await page.waitForTimeout(600);
  const leftOpen = await page.evaluate(() => {
    const frame = document.querySelector('[data-mobile-nav="frame"]');
    const d = frame?.firstElementChild?.getBoundingClientRect();
    return { collapsed: frame?.hasAttribute('data-sidebar-collapsed') ?? null, drawerX: d ? Math.round(d.x) : null, drawerW: d ? Math.round(d.width) : null, backdrop: !!document.querySelector('[data-mobile-nav="backdrop"]') };
  });
  await swipe(300,420,100,420); await page.waitForTimeout(600);
  const leftClosed = await page.evaluate(() => document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') ?? null);
  // 3) swipe left opens better-sidebar (right), swipe right closes
  await swipe(300,420,100,420); await page.waitForTimeout(700);
  const rightOpen = await page.evaluate(() => {
    const p = document.querySelector('[data-dsh-panel]');
    return p ? { cls: String(p.className).slice(0,80), visibility: getComputedStyle(p).visibility, x: Math.round(p.getBoundingClientRect().x), w: Math.round(p.getBoundingClientRect().width) } : null;
  });
  await swipe(100,420,280,420); await page.waitForTimeout(600);
  const rightClosed = await page.evaluate(() => { const p = document.querySelector('[data-dsh-panel]'); return p ? getComputedStyle(p).visibility : null; });
  // 4) open a session to exercise official composer/footer baseline
  await swipe(80,420,260,420); await page.waitForTimeout(600);
  await page.evaluate(() => { const rows=[...document.querySelectorAll('[data-mobile-nav="frame"] > :first-child [class*="sessionRow"]')]; const row=rows.find(el=>(el.textContent||'').includes('你好'))||rows[0]; row?.click(); });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(() => {
    const rct = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const composer = document.querySelector('[data-composer-card]');
    const input = document.querySelector('[data-composer-input]');
    const seat = document.querySelector('[class$="_composerSeat"]');
    const seatChildren = seat ? [...seat.querySelectorAll('*')].filter(el => { const t=(el.textContent||'').trim(); return t.length>0 && t.length<80 && el.children.length===0; }).map(el => ({ cls: String(el.className).slice(0,80), text: (el.textContent||'').trim().slice(0,80), r: rct(el) })) : [];
    const statStyle = document.querySelector('style[data-plugin="dsh-pocket-mobile"]');
    const css = statStyle?.textContent ?? '';
    return {
      composer: composer ? rct(composer) : null,
      input: input ? { ...rct(input), editable: input.getAttribute('contenteditable'), role: input.getAttribute('role') } : null,
      seat: seat ? rct(seat) : null,
      seatChildren,
      dshPocketCssBytes: css.length,
      dshPocketForbiddenSelectors: /stats-popup|composerStack|data-mobile-nav="stats"|data-aionui|uV2eYG|hHd-Xa|wSkVaW/i.test(css),
      mobileFrameStylesInjected: !!statStyle,
      oldDshPocketStatsMarkup: document.querySelectorAll('[data-mobile-nav="stats"], [data-mobile-nav="stats-popup"]').length,
      errors: [],
    };
  });
  // 5) input is interactive
  if (result.input) { await page.mouse.click(result.input.x + result.input.w/2, result.input.y + result.input.h/2); await page.waitForTimeout(200); await page.keyboard.type('verify-ok'); await page.waitForTimeout(400); }
  const typed = await page.evaluate(() => document.querySelector('[data-composer-input]')?.textContent || '');
  console.log(JSON.stringify({ checks: { collapsed, leftOpen, leftClosed, rightOpen, rightClosed, typed }, result, errors }, null, 2));
} catch (e) { console.error('FINAL CHECK ERROR', e && e.stack || e); }
finally { log('closing'); await Promise.race([browser.close().catch(()=>{}), new Promise(r=>setTimeout(r,10000))]); log('done'); }
process.exit(0);
