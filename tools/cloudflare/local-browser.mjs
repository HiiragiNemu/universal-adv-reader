import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated local browser; never connects to an existing user browser/profile.
export async function localBrowser(output) {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'browser-profile-'));
  const executable = process.env.ADV_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
    '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
    '--autoplay-policy=no-user-gesture-required',
    ...(process.env.ADV_BROWSER_PROXY ? ['--proxy-server=' + process.env.ADV_BROWSER_PROXY, '--proxy-bypass-list=localhost;127.0.0.1;[::1]'] : []),
    'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr = (stderr + b).slice(-20000); });
  let processError; child.on('error', error => { processError = error; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (processError) throw processError;
    const text = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    if (/^\d+\n/.test(text)) { port = Number(text.split('\n')[0]); break; }
    if (child.exitCode !== null) throw Error('Isolated browser exited: ' + stderr);
    await delay(100);
  }
  if (!port) { child.kill(); throw Error('Isolated browser did not expose its local debugging endpoint: ' + stderr); }
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  const target = targets.find(t => t.type === 'page' && t.url === 'about:blank');
  if (!target) { child.kill(); throw Error('No isolated blank page'); }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map(); const events = [];
  socket.addEventListener('message', message => {
    const data = JSON.parse(message.data);
    if (data.id) {
      const wait = pending.get(data.id); if (!wait) return;
      clearTimeout(wait.timer); pending.delete(data.id);
      if (data.error) wait.reject(Error(JSON.stringify(data.error))); else wait.resolve(data.result);
    } else {
      if (events.length < 30000) events.push(data);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error('Condition timeout: ' + expression);
  };
  const click = async selector => {
    await evaluate(`(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden');if(!e)throw Error('Missing visible click target: '+${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});})()`);
    await delay(100);
    const box = await evaluate(`(() => {
      const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';});
      if (!e) throw Error('Missing visible click target: '+${JSON.stringify(selector)});
      e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const r=e.getBoundingClientRect(), point={x:r.left+r.width/2,y:r.top+r.height/2};
      const hit=document.elementFromPoint(point.x,point.y);
      if(!hit||!e.contains(hit))throw Error('Click is occluded: '+${JSON.stringify(selector)}+' by '+hit?.outerHTML.slice(0,350));
      return point;
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 });
    await delay(250);
  };
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
  };
  const close = async () => {
    try { await fs.writeFile(path.join(output, 'browser-stderr.log'), stderr); await send('Browser.close'); } catch {}
    socket.close(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Browser closed')); } pending.clear();
    for (let i=0; i<30 && child.exitCode === null; i++) await delay(100);
    if (child.exitCode === null) child.kill();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(() => {});
  };
  await send('Page.enable'); await send('Page.setLifecycleEventsEnabled',{enabled:true}); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  const navigate=async url=>{
    await send('Page.bringToFront');
    await send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const {loaderId}=await send('Page.navigate',{url});
    if(loaderId){const start=Date.now();while(!events.some(e=>e.method==='Page.lifecycleEvent'&&e.params.loaderId===loaderId&&e.params.name==='load')){if(Date.now()-start>60000)throw Error('Document load timeout: '+url);await delay(100);}}
    await wait(`(()=>{const wanted=new URL(${JSON.stringify(url)}),actual=new URL(location.href);return actual.origin===wanted.origin&&actual.pathname.replace(/\\/$/,'')===wanted.pathname.replace(/\\/$/,'')&&document.readyState==='complete'})()`);
  };
  return { send, evaluate, wait, click, screenshot, close, navigate, events, port, profile };
}
