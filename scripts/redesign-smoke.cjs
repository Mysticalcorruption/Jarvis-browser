const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
(async () => {
  const root = path.resolve(__dirname, '..'), profile = path.join(root, 'artifacts', `redesign-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  const school = path.join(profile, 'cloud'); fs.mkdirSync(school);
  const source = path.join(profile, 'Biology lesson.txt'); fs.writeFileSync(source, 'Cell structure: the nucleus holds genetic information and the membrane controls movement of substances.');
  const server = http.createServer((req, res) => res.end('<html><title>Study test</title><main>Cells are the basic unit of life. This is a test page.</main></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app;
  const errors = [];
  try {
    const env = { ...process.env, JARVIS_TEST: '1', JARVIS_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
    // Packaged executables also need Playwright's ready-event instrumentation.
    const launchOptions = { args: process.env.JARVIS_PACKAGED_PATH ? ['-r', path.join(root, 'node_modules/playwright-core/lib/server/electron/loader.js')] : [root], env, timeout: 30000, ...(process.env.JARVIS_PACKAGED_PATH ? { executablePath: process.env.JARVIS_PACKAGED_PATH } : {}) };
    app = await electron.launch(launchOptions);
    async function mainPage(application) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const page = application.context().pages().find(page => /\/index\.html$/.test(page.url()));
        if (page) return page;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Main browser page was not available.');
    }
    const page = await mainPage(app); page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector('#greeting')?.textContent.includes('Max'));
    assert.equal(await page.locator('[data-panel="builder"]').count(), 0);
    assert.equal(await page.locator('.suggestion,.start-here').count(), 0);
    assert.ok((await page.locator('#tabs').boundingBox()).y < (await page.locator('#address').boundingBox()).y);
    await page.screenshot({ path: path.join(root, 'artifacts/jarvis-redesign-home.png') });
    await page.locator('#new-tab').click();
    await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    await page.locator('#address').fill(`http://127.0.0.1:${server.address().port}`); await page.locator('#address').press('Enter');
    await page.waitForFunction(() => document.querySelector('.tab.active').textContent.includes('Study test'));
    const isolation = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(w => w.getTitle() === 'Study test').executeJavaScript('({bridge: typeof window.jarvis, node: typeof process})'));
    assert.deepEqual(isolation, { bridge: 'undefined', node: 'undefined' });
    await page.locator('#home-button').click();
    await page.locator('#chat-input').fill('new tab'); await page.locator('#chat-input').press('Enter');
    await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('fresh tab'));
    assert.equal((await page.evaluate(() => window.jarvis.invoke('chat-memory'))).count, 2);
    await page.locator('.sidebar [data-panel="school"]').click();
    await page.waitForSelector('[data-library="folder"]');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, school);
    await page.locator('[data-library="folder"]').click();
    await page.waitForFunction(() => document.querySelector('.cloud-connection').textContent.includes('connected'));
    await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, source);
    await page.locator('[data-library="import"]').click();
    await page.waitForSelector('[data-field="subject"]');
    await page.locator('[data-field="subject"]').fill('Biology');
    await page.locator('[data-field="topic"]').fill('Cell structure');
    await page.screenshot({ path: path.join(root, 'artifacts/jarvis-school-review.png') });
    await page.locator('[data-library="file"]').click();
    await page.waitForSelector('.document-row');
    assert.ok(fs.existsSync(path.join(school, 'JARVIS School/Biology/Cell structure/Biology lesson.txt')));
    assert.ok(fs.existsSync(source));
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [path.join(root, 'tests/fixtures/biology.pdf'), path.join(root, 'tests/fixtures/biology.docx')]);
    await page.locator('[data-library="import"]').click();
    await page.waitForFunction(async () => {
      const state = await window.jarvis.invoke('library-state');
      return !state.busy && state.pending.length === 2;
    }, null, { timeout: 60000 });
    const parsed = await page.evaluate(() => window.jarvis.invoke('library-state'));
    assert.ok(parsed.pending.every(d => d.characters > 40), JSON.stringify(parsed.pending));
    for (const item of parsed.pending) await page.evaluate(id => window.jarvis.invoke('library-dismiss', { id }), item.id);
    await page.locator('#modal-close').click();
    await page.locator('.sidebar [data-panel="school"]').click();
    await page.locator('#document-search').fill('Biology');
    assert.match(await page.locator('.document-list').innerText(), /Cell structure/);
    await page.screenshot({ path: path.join(root, 'artifacts/jarvis-school-library.png') });
    await page.locator('#modal-close').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
    await page.waitForFunction(() => window.innerWidth <= 1100);
    await page.screenshot({ path: path.join(root, 'artifacts/jarvis-redesign-compact.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await app.close(); app = null;
    app = await electron.launch(launchOptions);
    const reopened = await mainPage(app);
    await reopened.waitForFunction(() => document.querySelector('#messages')?.textContent.includes('fresh tab'));
    const library = await reopened.evaluate(() => window.jarvis.invoke('library-state'));
    assert.equal(library.documents.length, 1); assert.equal(library.folder, school);
    console.log('PASS: top tabs, removed prompts, browsing isolation, chat restart, school import/review/file/search/restart, compact layout.');
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
