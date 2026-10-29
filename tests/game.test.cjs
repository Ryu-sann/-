const assert = require('node:assert/strict');
const { EmberGame:G } = require('../src/game.js');
const { EmberLegacy:L } = require('../src/migration-v3.js');
const { EmberTasks:T } = require('../src/tasks.js');
let seq = 0;
const id = () => 'id' + (++seq);
function task(s, options = {}) {
  const identity = id();
  const t = { id:identity, seriesId:identity, title:'実際に進める任務', minutes:25, energy:2, autoEnergy:true,
    repeat:'none', condition:'予定した工程を終える', step:'資料を開く', due:'', scheduled:'2026-10-29', occurrence:'2026-10-29',
    priority:2, project:'ラボ', createdAt:1, importedDone:false, deleted:false, ...options };
  s.tasks.push(t); return t;
}
function complete(s, t, extra = {}) {
  const event = { id:id(), type:'complete', taskId:t.id, title:t.title, energy:t.energy,
    main:false, day:'2026-10-29', at:Date.now(), region:0, route:'story', ...extra };
  s.events.push(event); return event;
}
function forge(s, family) {
  const g = G.replay(s), event = {id:id(),type:'forge',weapon:family,targetTier:g.tiers[family]+1,day:'2026-10-29',at:Date.now()};
  s.events.push(event); return event;
}
// First real task defeats the scout. Exactly one encounter advances per completion.
let s = G.fresh(), t = task(s,{energy:1}); s.main['2026-10-29'] = t.id;
const forecast = G.preview(s,t,'2026-10-29'); assert.equal(forecast.breakthrough,true); assert.equal(s.events.length,0);
const first = complete(s,t,{main:true}); let g = G.replay(s);
assert.equal(g.stages[0],1); assert.equal(g.results[0].damage,18); assert.equal(g.results[0].iron,3);
assert.equal(g.results[0].next,'廃営地'); assert.equal(g.health[0][2],160);
// Supplies are real inventory and no fake battle occurs.
let secondTask = task(s), second = complete(s,secondTask,{main:true}); g=G.replay(s);
assert.equal(g.stages[0],2); assert.equal(g.results[1].cache,true); assert.equal(g.results[1].damage,0);
assert.equal(g.ember,2,'daily main bonus once + cache ember'); assert.equal(g.iron,7);
// Damage to the wall persists, with no movement-distance gate.
complete(s,task(s,{energy:4})); const wall=G.replay(s); assert(wall.health[0][2]<160); assert.equal(wall.stages[0],2);
// Equal-tier parallel families have equal total damage; dual has three actual hit values.
let parallel = G.fresh(); parallel.base.stages[0]=3; parallel.base.health[0][0]=0; parallel.base.health[0][2]=0;
parallel.base.tiers={great:2,dual:2}; const pt=task(parallel,{energy:2}); complete(parallel,pt);
const heavy=G.replay(parallel); parallel.base.equipped='dual'; const light=G.replay(parallel);
assert.equal(heavy.results[0].damage,light.results[0].damage); assert.equal(light.results[0].hits.length,3);
assert.equal(light.results[0].hits.reduce((a,b)=>a+b,0),light.results[0].damage);
// Craft consumes resources and an arbitrary number of tiers is possible.
let crafting=G.fresh(); crafting.base.iron=1000;crafting.base.ember=100;
forge(crafting,'dual');forge(crafting,'dual');forge(crafting,'great');
assert.equal(G.replay(crafting).tiers.dual,1);assert.equal(G.replay(crafting).tiers.great,1);
for(let n=0;n<5;n++)forge(crafting,'great');assert.equal(G.replay(crafting).tiers.great,6);
// Undo must invalidate a dependent forge; no free weapon or negative inventory.
let undo=G.fresh();undo.base.iron=8;let ut=task(undo,{energy:4});const reward=complete(undo,ut,{main:true});forge(undo,'great');
assert.equal(G.replay(undo).tiers.great,1);undo.events=undo.events.filter(e=>e.id!==reward.id);
const ug=G.replay(undo);assert.equal(ug.tiers.great,0);assert(ug.invalid.length);assert.equal(ug.iron,8);assert.equal(ug.stages[0],0);
// Final blow immediately clears the region; no empty-distance padding remains.
let boss=G.fresh();boss.base.stages[0]=3;boss.base.health[0]=[0,0,0,10];
complete(boss,task(boss,{energy:1}));g=G.replay(boss);
assert.equal(g.stages[0],4);assert(g.results[0].victory);assert.equal(g.unlocked,1);
complete(boss,task(boss,{energy:2}));g=G.replay(boss);
assert(g.results[1].repeat);assert.equal(g.results[1].damage,0);assert.equal(g.results[1].xp,8);assert.equal(g.stages[0],4);
// Recurrence: one current occurrence, no backlogs, no duplicates, weekly anchor and DST-safe dates.
let recurring=G.fresh();const daily=task(recurring,{repeat:'daily'}), weekly=task(recurring,{repeat:'weekly'});
assert(T.recurrence(recurring,'2026-11-12',id,2));assert.equal(recurring.tasks.length,4);
assert.equal(recurring.tasks.find(x=>x.id!==daily.id&&x.seriesId===daily.id).scheduled,'2026-11-12');
assert.equal(recurring.tasks.find(x=>x.id!==weekly.id&&x.seriesId===weekly.id).scheduled,'2026-11-12');
assert.equal(T.recurrence(recurring,'2026-11-12',id),false);assert.equal(T.addDays('2026-10-31',2),'2026-11-02');
assert.equal(T.dayDiff('2026-11-02','2026-10-31'),2);
recurring.tasks.filter(x=>x.id!==daily.id&&x.seriesId===daily.id).forEach(x=>x.deleted=true);
T.recurrence(recurring,'2026-11-13',id);assert.equal(recurring.tasks.length,4,'archiving latest stops the series');
// Complete/undo replay, daily summary, tomorrow plan and recurrence survive a backup round trip.
s.daily['2026-10-29']={tomorrow:'考察を一段落書く',note:'予定した工程を進めた',closedAt:1};
assert.equal(G.validate(JSON.parse(JSON.stringify(s))).daily['2026-10-29'].tomorrow,'考察を一段落書く');
assert.throws(()=>G.validate({...s,base:{...s.base,stages:[1,1,99]}}));
assert.throws(()=>G.validate({...s,events:[{id:'bad',type:'complete',taskId:'missing',energy:999}]}));
// Exact v3 resource snapshot is preserved; dual maps to the parallel family.
let old=L.fresh();old.base.xp=95;old.base.iron=23;old.base.ember=4;old.base.owned=['worn','iron','oath'];old.base.equipped='oath';old.base.progress=[12,0,0];old.base.hp=[0,210,360];old.base.unlocked=1;
const migrated=G.migrate(old,L);assert.equal(G.replay(migrated).iron,23);assert.equal(G.replay(migrated).xp,95);
assert.equal(G.replay(migrated).equipped,'dual');assert.equal(migrated.base.stages[0],4);G.validate(migrated);
// Calibration, not a promise: 3 real tasks/day (25m,25m,10m), primary bonus, upgrade as affordable.
let week=G.fresh(),firstForgeDay=null,clearDay=null;
for(let day=1;day<=20&&!clearDay;day++){
  const d=T.addDays('2026-10-29',day-1);
  for(let n=0;n<3;n++){
    const wt=task(week,{energy:n===2?1:2});complete(week,wt,{day:d,main:n===0});
    let wg=G.replay(week),cost=G.forgeCost(wg.tiers.great);
    if(wg.iron>=cost.iron&&wg.ember>=cost.ember){forge(week,'great');firstForgeDay??=day;}
    if(G.replay(week).cleared[0]){clearDay=day;break;}
  }
}
assert(firstForgeDay<=3);assert(clearDay>=5&&clearDay<=10,'first region should last roughly one week in calibration');
console.log('PASS: sequential encounters, balanced weapon families, crafting/undo, backup/migration, daily/weekly recurrence');
console.log(`Calibration: first upgrade day ${firstForgeDay}; first region clear day ${clearDay} (3 tasks/day, not an efficacy claim)`);
