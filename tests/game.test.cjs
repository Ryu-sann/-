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
// Supplies are collected on the way; the attack continues to the wall.
let secondTask = task(s), second = complete(s,secondTask,{main:true}); g=G.replay(s);
assert.equal(g.stages[0],2); assert.equal(g.results[1].cache,true); assert.equal(g.results[1].damage,36);
assert.deepEqual(g.results[1].segments.map(x=>x.kind),['cache','combat']); assert.equal(g.health[0][2],124);
assert.equal(g.ember,2,'daily main bonus once + cache ember'); assert.equal(g.iron,7);
// Damage to the wall persists, with no movement-distance gate.
complete(s,task(s,{energy:4})); const wall=G.replay(s); assert(wall.health[0][2]<124); assert.equal(wall.stages[0],2);
// Excess damage carries over: a big task does not end on the weak scout.
let over=G.fresh(); complete(over,task(over,{energy:4})); g=G.replay(over);
assert.equal(g.results[0].damage,72); assert.deepEqual(g.results[0].segments.map(x=>[x.kind,x.damage]),[['combat',18],['cache',0],['combat',54]]);
assert.equal(g.stages[0],2); assert.equal(g.health[0][2],106); assert(g.results[0].overflow); assert.deepEqual(g.results[0].broken,['灰の斥候']);
assert.equal(g.iron,4+2,'energy 4 + one cache'); assert.equal(g.ember,1);
// Overflow can break several encounters and reach the boss; leftover beyond the region is not counted.
let chain=G.fresh(); chain.base.xp=5000; complete(chain,task(chain,{energy:4})); g=G.replay(chain);
assert.equal(g.results[0].damage,Math.min(G.attack(5000,0)*4,18+160+850)); assert(g.results[0].broken.includes('鉄骸の衛兵'));
// Boss phases change at 2/3 and 1/3 HP.
assert.deepEqual([850,567,566,284,283,1,0].map(h=>G.bossPhase(h,850)),[0,0,1,1,2,2,3]);
let phased=G.fresh(); phased.base.stages[0]=3; phased.base.health[0]=[0,0,0,600]; phased.base.xp=500;
complete(phased,task(phased,{energy:2})); g=G.replay(phased); const bossHit=g.results[0].segments[0];
assert.equal(bossHit.kind,'boss'); assert.equal(bossHit.phaseBefore,0); assert.equal(bossHit.phaseAfter,1); assert.equal(g.results[0].phaseShift,1);
// Visual milestones: blade, cape and glow change at fixed tiers.
assert.deepEqual(G.gearLook(0),{blade:0,cape:0,glow:0}); assert.deepEqual(G.gearLook(2),{blade:2,cape:1,glow:0});
assert.deepEqual(G.gearLook(5),{blade:3,cape:2,glow:1}); assert.deepEqual(G.gearLook(10),{blade:3,cape:2,glow:3});
assert.equal(G.nextMilestone(3).tier,5); assert.equal(G.nextMilestone(10),null);
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
// Weekly goals: completions of linked tasks count; reaching the target gives one bonus.
let wg=G.fresh(); wg.base.stages[0]=4; wg.base.health[0]=[0,0,0,0]; wg.goals.push({id:'g1',seriesId:'g1',title:'運動',target:2,week:'2026-10-26',weekly:true,minutes:25,createdAt:1});
const g1a=task(wg,{goalId:'g1',energy:1}), g1b=task(wg,{goalId:'g1',energy:1});
complete(wg,g1a); g=G.replay(wg); assert.equal(g.goalCounts.g1,1); assert.equal(g.results[0].goalDone,null);
complete(wg,g1b); g=G.replay(wg); assert.equal(g.goalCounts.g1,2); assert.equal(g.results[1].goalDone,'運動');
assert.equal(g.results[1].iron-g.results[0].iron,3,'goal bonus iron'); G.validate(JSON.parse(JSON.stringify(wg)));
assert.throws(()=>G.validate({...wg,goals:[{id:'x',title:'',target:9}]}));
assert.equal(T.weekStart('2026-10-29'),'2026-10-26'); assert.equal(T.weekStart('2026-11-01'),'2026-10-26'); assert.equal(T.weekStart('2026-11-02'),'2026-11-02');
assert.equal(T.weekDays('2026-10-29').length,7);
// Weekly goal continues next week; unfinished assigned tasks move to the new goal, finished ones stay.
const g1c=task(wg,{goalId:'g1'}); const doneSet=G.replay(wg).done;
assert(T.rollGoals(wg,'2026-11-03',id,t=>doneSet.has(t.id))); assert.equal(wg.goals.length,2);
const nextGoal=wg.goals[1]; assert.equal(nextGoal.week,'2026-11-02'); assert.equal(g1c.goalId,nextGoal.id); assert.equal(g1a.goalId,'g1');
assert.equal(T.rollGoals(wg,'2026-11-04',id),false,'no duplicate goal in the same week');
assert.equal(G.replay(wg).goalCounts.g1,2,'last week count is unchanged');
// Skip this time vs stop repeating.
let rep=G.fresh(); const sk=task(rep,{repeat:'daily'}); T.skipOccurrence(sk); assert.equal(sk.skipped,true);
assert(T.recurrence(rep,'2026-10-30',id),'skipping keeps the series'); assert.equal(rep.tasks.length,2);
const latestRep=rep.tasks[1]; assert(T.stopSeries(rep,sk.seriesId)); assert.equal(latestRep.repeat,'none'); assert.equal(sk.repeat,'daily','older occurrence stays hidden as a past one');
assert.equal(T.recurrence(rep,'2026-11-05',id),false,'stopped series creates nothing'); assert.equal(rep.tasks.length,2);
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
console.log('PASS: sequential encounters, overflow damage, boss phases, visual milestones, weekly goals, skip/stop, balanced weapon families, crafting/undo, backup/migration, daily/weekly recurrence');
console.log(`Calibration: first upgrade day ${firstForgeDay}; first region clear day ${clearDay} (3 tasks/day, not an efficacy claim)`);
