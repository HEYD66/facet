'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {normalize,preset,script,DEVICE_TEMPLATES}=require('../src/main/fingerprint.cjs');
const {environment,sanitizeElectronUserAgent}=require('../src/main/environment.cjs');
test('default browser UA removes Electron runtime marker while explicit UA remains unchanged',()=>{
 assert.equal(sanitizeElectronUserAgent('Mozilla/5.0 Chrome/134.0.0.0 Electron/44.4.5 Safari/537.36'),'Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36');
 assert.equal(sanitizeElectronUserAgent('Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36'),'Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36');
 // The application name Electron inserts before Chrome/ (app.setName('千面 Facet')) is a runtime marker too.
 const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.167 Safari/537.36';
 assert.equal(sanitizeElectronUserAgent(chrome.replace('Chrome/','千面Facet/0.2.21 Chrome/').replace(' Safari',' Electron/44.9.3 Safari')),chrome);
 assert.equal(sanitizeElectronUserAgent(chrome),chrome);
});
test('fingerprint defaults are opt-in and disruptive switches remain disabled',()=>{const f=normalize();assert.equal(f.enabled,false);for(const k of ['canvas','audio','rects','webgl'])assert.equal(f[k],false);assert.equal(script(environment()),null);});
test('six reference presets validate with coherent screen and viewport',()=>{assert.equal(DEVICE_TEMPLATES.length,6);for(const t of DEVICE_TEMPLATES){const e=environment(preset(t.id,{language:'ja-JP',timezone:'Asia/Tokyo'},'fixed-seed'));assert.equal(e.language,'ja-JP');assert.equal(e.timezone,'Asia/Tokyo');assert(e.width<=e.fingerprint.screenWidth);assert(e.height<=e.fingerprint.screenHeight);assert.equal(e.fingerprint.canvas,false);assert.equal(e.fingerprint.webgl,false);assert.deepEqual(environment(e),e);}});
test('fixed random seed is reproducible; explicit random action issues fresh seed',()=>{assert.deepEqual(preset('random',{},'seed'),preset('random',{},'seed'));assert.notEqual(preset('random').fingerprint.seed,preset('random').fingerprint.seed);});
test('reject malformed seeds, incoherent screens and invalid hardware fields',()=>{for(const value of [{seed:'<script>'},{memory:3},{screenWidth:-2},{screenHeight:600,availHeight:900},{colorDepth:25},{enabled:true,webgl:true}])assert.throws(()=>normalize(value));assert.throws(()=>environment({width:2000,height:800,fingerprint:{enabled:true,hardware:true,screenWidth:1920}}));});
test('injection compiles, is deterministic, and avoids duplicate native overrides',()=>{const e=environment(preset('random',{},'same-seed'));const s=script(e);new vm.Script(s);assert.equal(s,script(e));assert(!s.includes('setTimezone'));assert(!s.includes('userAgentData'));assert(!s.includes("'webdriver'"));assert(!s.includes('originalToString'));assert(!s.includes('addIceCandidate'));assert(!s.includes('/*__ARENA_FP_PAYLOAD__*/null'));});

test('random preserves viewport, DPR and screen sizes for fixed and adaptive configurations',()=>{for(const patch of [{width:1760,height:920,scale:1.25},{width:0,height:0,scale:0},{width:2560,height:1440,scale:2}]){const base=environment({...patch,fingerprint:{screenWidth:1920,screenHeight:1080,availHeight:1040}});for(let i=0;i<30;i++){const next=environment(preset('random',base,'window-'+i));for(const k of ['width','height','scale'])assert.equal(next[k],base[k]);for(const k of ['screenWidth','screenHeight','availHeight'])assert.equal(next.fingerprint[k],base.fingerprint[k]);}}});

test('one-click random enables Canvas, audio and WebGL even when all were explicitly disabled',()=>{
 for(const enabled of [false,true]){
  const base=environment({language:'ja-JP',timezone:'Asia/Tokyo',fingerprint:{enabled,canvas:false,audio:false,webgl:false,rects:false}});
  const snapshot=JSON.stringify(base),next=environment(preset('random',base,'auto-flags'));
  for(const k of ['enabled','canvas','audio','webgl'])assert.equal(next.fingerprint[k],true,k);
  assert.equal(next.fingerprint.rects,false);assert(next.fingerprint.vendor&&next.fingerprint.renderer);
  assert.equal(next.language,base.language);assert.equal(next.timezone,base.timezone);
  assert.equal(JSON.stringify(base),snapshot,'random only returns a draft');
 }
});
test('random preserves explicit layout choice and a later manual opt-out still saves',()=>{
 const next=environment(preset('random',{fingerprint:{rects:true}},'layout-choice'));
 assert.equal(next.fingerprint.rects,true);
 const edited=environment({...next,fingerprint:{...next.fingerprint,canvas:false,audio:false,webgl:false}});
 for(const k of ['canvas','audio','webgl'])assert.equal(edited.fingerprint[k],false);
});

test('catalog import strips unknown/private fields, rejects incompatible renderers and deduplicates GPU aliases',()=>{
 const {gpuRecord}=require('../scripts/import-fingerprint-catalog.cjs');
 const row={webGLManufacturer:'Google Inc. (NVIDIA)',webGLRender:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, driver.dll-1.2)',token:'private',hostIP:'private'};
 // The PCI device ID in the renderer is kept (normalized), the driver suffix and private fields are not.
 assert.deepEqual(gpuRecord(row),{brand:'NVIDIA',model:'NVIDIA GeForce RTX 3070',id:'0x00002484'});
 assert.deepEqual(gpuRecord({...row,webGLRender:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'}),{brand:'NVIDIA',model:'NVIDIA GeForce RTX 3070'});
 for(const renderer of ['ANGLE (AMD, Radeon Direct3D11 vs_5_0 ps_5_0)','ANGLE (NVIDIA, NVIDIA GeForce GTX 560 Direct3D9Ex vs_3_0 ps_3_0)','ANGLE (NVIDIA, <script> Direct3D11 vs_5_0 ps_5_0)'])assert.equal(gpuRecord({...row,webGLRender:renderer}),null);
 const data=require('../src/main/fingerprint-catalog.json');
 assert.deepEqual(Object.keys(data).sort(),['gpus','schemaVersion','sources']);assert.equal(data.schemaVersion,2);
 assert.equal(new Set(data.gpus.map(g=>g.brand+'|'+g.model.toLowerCase())).size,data.gpus.length);
 for(const gpu of data.gpus){
  assert.deepEqual(Object.keys(gpu).filter(k=>k!=='ids').sort(),['brand','model']);
  if(gpu.ids){assert(gpu.ids.length&&gpu.ids.every(id=>/^0x[0-9A-F]{8}$/.test(id)));assert.deepEqual(gpu.ids,[...new Set(gpu.ids)].sort());}
 }
 assert(data.gpus.filter(g=>g.ids).length>=200,'device IDs for at least 200 models');
});

test('full catalog plans remain coherent over 2000 seeds without mutating input or applying source UA/timezone',()=>{
 const {ID,GPUS,SCREENS,CPUS,CPU_TIERS,MEMORY,MEMORY_TIERS,drivable}=require('../src/main/fingerprint-catalog.cjs'),identity=require('../src/main/gpu-identity.cjs');
 const base=environment({language:'ja-JP',timezone:'Asia/Tokyo',geoEnabled:true,latitude:35,longitude:139});
 const original=JSON.stringify(base),seenGPU=new Set(),seenCPU=new Set(),seenScreen=new Set(),seenMemory=new Set();
 for(let i=0;i<2000;i++){
  const plan=environment(preset(ID,base,'catalog-'+i)),f=plan.fingerprint;
  assert.equal(plan.language,base.language);assert.equal(plan.timezone,base.timezone);assert.equal(plan.longitude,139);
  assert.equal(f.hardware,true);assert.equal(f.touch,0);assert.equal(f.colorDepth,24);
  // Chrome's full renderer format, with a device ID the catalog has seen for that model.
  assert.match(f.renderer,/^ANGLE \((NVIDIA|AMD|Intel), .+ \(0x[0-9A-F]{8}\) Direct3D11 vs_5_0 ps_5_0, D3D11\)$/);
  const parsed=identity.parseRenderer(f.renderer),gpu=GPUS.find(g=>g.vendor===f.vendor&&g.brand===parsed.brand&&g.model===parsed.model);
  assert(gpu&&gpu.ids.includes(parsed.id),f.renderer);assert(CPUS.includes(plan.cpu));
  assert(MEMORY_TIERS[gpu.tier].includes(f.memory),`${f.memory} GB for ${gpu.model} (${gpu.tier})`);
  // The thread count must be plausible for the chosen GPU's tier (no UHD 617 + 24 threads).
  assert(CPU_TIERS[gpu.tier].includes(plan.cpu),`incoherent ${plan.cpu}T for ${gpu.model} (${gpu.tier})`);
  assert(SCREENS.some(s=>s.width===f.screenWidth&&s.height===f.screenHeight&&s.dpr===plan.scale));
  // Without a fixed viewport or display floor, an old/entry GPU never lands on a 4K-class panel.
  assert(drivable(gpu.tier,{width:f.screenWidth,height:f.screenHeight,dpr:plan.scale}),`${gpu.model} (${gpu.tier}) on ${f.screenWidth}x${f.screenHeight}@${plan.scale}`);
  assert.equal(plan.width,0);assert.equal(plan.height,0);assert(plan.width<=f.screenWidth&&plan.height<=f.availHeight);assert(f.memory!==4||plan.cpu<=8);
  assert.deepEqual(environment(plan),plan);assert.deepEqual(preset(ID,base,'catalog-'+i),preset(ID,base,'catalog-'+i));
  seenGPU.add(f.renderer);seenCPU.add(plan.cpu);seenScreen.add([f.screenWidth,f.screenHeight,plan.scale].join(':'));seenMemory.add(f.memory);
 }
 assert(seenGPU.size>200,'renderers seen: '+seenGPU.size);assert.equal(seenCPU.size,CPUS.length);assert.equal(seenScreen.size,SCREENS.length);assert.deepEqual([...seenMemory].sort((a,b)=>a-b),MEMORY);
 // Available height leaves the Windows 11 taskbar.
 for(const s of SCREENS)assert.equal(s.height-s.availHeight,48);
 assert.equal(JSON.stringify(base),original);
});

test('catalog fits explicitly fixed viewports and seed labels do not couple color preference with hardware',()=>{
 const base=environment({width:3000,height:1900});
 for(let i=0;i<30;i++){const plan=environment(preset('library-v1',base,'fixed-'+i));assert.equal(plan.width,3000);assert.equal(plan.height,1900);assert(plan.width<=plan.fingerprint.screenWidth);}
 const pairs=new Map();for(let i=0;i<200;i++){const plan=preset('random',{},'independent-'+i);const set=pairs.get(plan.fingerprint.memory)||new Set();set.add(plan.colorScheme);pairs.set(plan.fingerprint.memory,set);}
 for(const values of pairs.values())assert.equal(values.size,3);
 assert.throws(()=>preset('library-v1',{},'bad seed'));
});

test('generated UA metadata follows current Windows runtime and explicit custom UA stays custom',()=>{
 const {generatedUserAgent,generatedMetadata}=require('../src/main/fingerprint.cjs');
 const plan=environment(preset('library-v1',{},'metadata'));
 const metadata={platform:'Windows',platformVersion:'15.0.0',architecture:'x86',bitness:'64',brands:[{brand:'Chromium',version:'current'}],mobile:false};
 assert.equal(plan.userAgent,generatedUserAgent());assert.deepEqual(generatedMetadata(plan,{metadata}),{...metadata,mobile:false,model:''});
 assert.equal(generatedMetadata({...plan,userAgent:'custom UA'},{metadata}),null);
 assert.equal(generatedMetadata({...plan,platform:'MacIntel'},{metadata}),null);
 assert.equal(generatedMetadata(plan,{metadata:{...metadata,platform:'Linux'}}),null);
});

test('a custom or runtime-drifted Chrome UA derives version-matched brands instead of empty UA-CH',()=>{
 const {customMetadata}=require('../src/main/fingerprint.cjs');
 // Native runtime is Chrome 152.0.7977.167 with a GREASE brand; the instance pinned .130.
 const native={metadata:{platform:'Windows',platformVersion:'19.0.0',architecture:'x86',bitness:'64',mobile:false,
  brands:[{brand:'Not?A_Brand',version:'24'},{brand:'Chromium',version:'152'}],
  fullVersionList:[{brand:'Not?A_Brand',version:'24.0.0.0'},{brand:'Chromium',version:'152.0.7977.167'}]}};
 const drift='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
 const cm=customMetadata({userAgent:drift,platform:'Win32'},native);
 assert.deepEqual(cm.brands,[{brand:'Not?A_Brand',version:'24'},{brand:'Chromium',version:'152'}]);
 assert.deepEqual(cm.fullVersionList,[{brand:'Not?A_Brand',version:'24.0.0.0'},{brand:'Chromium',version:'152.0.7977.130'}]);
 assert.equal(cm.fullVersion,'152.0.7977.130');assert.equal(cm.platform,'Windows');assert.equal(cm.architecture,'x86');
 // An older major version is reflected in the brand version too.
 assert.equal(customMetadata({userAgent:drift.replace('152.0.7977.130','140.0.1.2'),platform:'Win32'},native).brands.find(b=>b.brand==='Chromium').version,'140');
 // Non-Chrome, non-Windows, or missing native metadata keep the previous (empty) policy.
 assert.equal(customMetadata({userAgent:'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0'},native),null);
 assert.equal(customMetadata({userAgent:drift,platform:'MacIntel'},native),null);
 assert.equal(customMetadata({userAgent:drift},{metadata:null}),null);
});

test('library screens are at least as large as the display when the app reports one',()=>{
 const catalog=require('../src/main/fingerprint-catalog.cjs');
 try{
  // A 1280x720 screen on a 2048x1152 desktop leaves a margin around the 1:1 page once maximized.
  catalog.setDisplayProvider(()=>({width:2048,height:1152}));
  for(let i=0;i<300;i++){const {screen}=catalog.generate('floor-'+i,{},true);assert(screen.width>=2048&&screen.height>=1152,`${screen.width}x${screen.height}`);}
  // Fixed viewports still need a screen that contains them.
  for(let i=0;i<50;i++){const {screen}=catalog.generate('floor-fixed-'+i,{width:3000,height:1400},true);assert(screen.width>=3000&&screen.height>=1400);}
  // A display larger than every library screen, or one that cannot be read, keeps the full pool.
  catalog.setDisplayProvider(()=>({width:5120,height:2880}));
  const seen=new Set();for(let i=0;i<300;i++)seen.add(catalog.generate('floor-'+i,{},true).screen.width);assert(seen.size>3);
  catalog.setDisplayProvider(()=>{throw Error('no display');});assert(catalog.generate('floor-x',{},true).screen);
 }finally{catalog.setDisplayProvider(null);}
});

test('new plans report the touch points of the machine Facet runs on',()=>{
 const catalog=require('../src/main/fingerprint-catalog.cjs');
 try{
  // A touchscreen makes Chromium report any-pointer: coarse, which no override can hide; 0 touch points would contradict it.
  catalog.setTouchProvider(()=>10);
  for(const id of ['library-v1','random','win-intel-iris'])assert.equal(environment(preset(id,{},'touch-seed')).fingerprint.touch,10,id);
  for(const bad of [()=>0,()=>-1,()=>11,()=>'x',()=>{throw Error('no window');}]){catalog.setTouchProvider(bad);assert.equal(environment(preset('library-v1',{},'touch-seed')).fingerprint.touch,0);}
 }finally{catalog.setTouchProvider(null);}
 assert.equal(environment(preset('library-v1',{},'touch-seed')).fingerprint.touch,0,'no provider: 0');
});

test('one-click random can also randomize the screen and DPR on request, keeping the viewport',()=>{
 const {SCREENS}=require('../src/main/fingerprint-catalog.cjs');
 for(const patch of [{width:0,height:0,scale:1.25},{width:1760,height:920,scale:1}]){
  const base=environment({...patch,fingerprint:{enabled:true,hardware:false,screenWidth:1920,screenHeight:1080,availHeight:1040}});const seen=new Set();
  for(let i=0;i<60;i++){
   const next=environment(preset('random',base,'screen-'+i,{screen:true})),f=next.fingerprint;
   assert.equal(next.width,base.width);assert.equal(next.height,base.height);
   assert(SCREENS.some(s=>s.width===f.screenWidth&&s.height===f.screenHeight&&s.availHeight===f.availHeight&&s.dpr===next.scale),`${f.screenWidth}x${f.screenHeight}@${next.scale}`);
   assert(f.screenWidth>=base.width&&f.screenHeight>=base.height,'screen still contains a fixed viewport');
   assert.equal(f.hardware,true,'a randomized screen is only reported with the hardware override on');
   seen.add(f.screenWidth+'x'+f.screenHeight+'@'+next.scale);
  }
  assert(seen.size>3,'screens actually vary: '+[...seen].join(','));
 }
 // Without the option the existing behaviour is unchanged (covered above): screen and DPR are kept.
 const base=environment({scale:1.25,fingerprint:{screenWidth:1920,screenHeight:1080,availHeight:1040}}),kept=environment(preset('random',base,'keep'));
 assert.deepEqual([kept.scale,kept.fingerprint.screenWidth,kept.fingerprint.screenHeight],[1.25,1920,1080]);
});
