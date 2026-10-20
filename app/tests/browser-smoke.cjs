const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp, parseLinks } = require('../server');
const root = path.resolve(__dirname,'../..');
const fixtureRoot = fs.mkdtempSync(path.join(root,'.tools','web-check-'));
for (const folder of ['downloads','logs','chrome-extension']) fs.mkdirSync(path.join(fixtureRoot,folder));
const calls = [], jobs = [];
const active = new Set(['queued','starting','downloading','merging','retrying']);
const manager = {
  jobs, logsDirectory:path.join(fixtureRoot,'logs'),
  add(links, quality, format) {
    const urls = parseLinks(links); calls.push({type:'download',urls,quality,format});
    const ids = urls.map((url,index)=>`job-${jobs.length+index}`);
    urls.forEach((url,index)=>jobs.push({id:ids[index],url,quality:format==='mp3'?'192':quality,format,title:'Your next favourite video',status:'queued',progress:0,message:'Waiting in the queue',attempt:0,maxAttempts:4}));
    return ids;
  },
  cancel(id) { calls.push({type:'cancel',id}); const job=jobs.find(j=>j.id===id); if(job) job.status='cancelled'; return !!job; },
  clear() { for(let i=jobs.length-1;i>=0;i--) if(!active.has(jobs[i].status)) jobs.splice(i,1); }
};
const server = createApp(manager,path.join(fixtureRoot,'downloads'),{appRoot:fixtureRoot,launch:async(command,args)=>calls.push({command,args})});
(async()=> {
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const baseUrl=`http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(baseUrl);
    await page.getByText('App connected',{exact:true}).waitFor();
    assert.equal(calls.length,0,'Opening app must not start download');
    await page.screenshot({path:path.join(root,'.tools','browser-window-preview.png'),fullPage:true});
    await page.locator('#audio-choice').click();
    assert.equal(await page.locator('#video-quality').isVisible(),false);
    assert.equal(await page.locator('#audio-quality').isVisible(),true);
    await page.locator('#links').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.locator('#download').click();
    await page.getByText('1 MP3 added.',{exact:false}).waitFor();
    assert.equal(calls[0].format,'mp3'); assert.equal(jobs.length,1);
    assert.equal(await page.locator('#links').inputValue(),'');
    await page.locator('#jobs .job-action').click();
    await page.locator('#jobs .status').filter({hasText:'Cancelled'}).waitFor();
    assert.equal(calls[1].type,'cancel');
    jobs[0].status='completed'; jobs[0].filename='My audio.mp3'; jobs[0].title='<script>bad()</script>';
    await page.locator('#jobs .status').filter({hasText:'Saved'}).waitFor();
    assert.equal(await page.locator('#saved-count').textContent(),'1');
    assert.equal(await page.locator('#jobs h3').textContent(),'<script>bad()</script>');
    await page.locator('[data-filter="active"]').click();
    assert.equal(await page.locator('#empty-title').textContent(),'Nothing downloading right now');
    assert.equal(await page.locator('#jobs .job').isVisible(),false);
    await page.locator('[data-filter="completed"]').click();
    assert.equal(await page.locator('#jobs .job').isVisible(),true);
    await page.locator('#setup-extension').click();
    assert.equal(await page.locator('#extension-dialog').isVisible(),true);
    assert.match(await page.locator('#pairing-code').textContent(),/^[A-F0-9]{8}$/);
    assert.equal(await page.locator('#app-address').textContent(),baseUrl);
    await page.keyboard.press('Escape');
    await page.locator('#clear').click();
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='0');
    await page.locator('#links').fill('https://example.com/not-youtube');
    await page.locator('#download').click();
    await page.locator('#form-message').filter({hasText:'Please use'}).waitFor();
    assert.equal(jobs.length,0,'Invalid URL must not queue a download');
    await page.locator('#links').fill('');
    await page.reload();
    await page.getByText('App connected',{exact:true}).waitFor();
    assert.equal(await page.locator('#audio-choice').getAttribute('aria-pressed'),'true','Format preference persists');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile layout has no horizontal overflow');
    await page.screenshot({path:path.join(root,'.tools','browser-window-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[],'No browser runtime errors');
    process.stdout.write('Browser checks passed: format, download, validation, cancel, filters, clearing, pairing setup, preferences, safe titles, mobile layout.\n');
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    if(path.dirname(fixtureRoot)!==path.join(root,'.tools')||!path.basename(fixtureRoot).startsWith('web-check-')) throw new Error('Unexpected test fixture path');
    fs.rmSync(fixtureRoot,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
