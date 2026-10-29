/* Deterministic game model. Replaying the journal makes undo safe for rewards,
   boss damage, upgrades and unlocks. No reward depends on animation timers. */
(function(root){
'use strict';
const REGIONS=[
 {name:'灰の城門',sub:'第一章',enemy:'城門の番人',goal:'閉ざされた門を開き、最初の烽火を灯せ。',distance:12,hp:100,iron:1,x:0},
 {name:'沈黙の聖堂',sub:'第二章',enemy:'鐘楼の亡霊',goal:'崩れた聖堂に響く、最後の鐘を取り戻せ。',distance:18,hp:210,iron:1,x:1},
 {name:'黎明の断崖',sub:'第三章',enemy:'翼なき王',goal:'夜の果てで、失われた夜明けを取り戻せ。',distance:24,hp:360,iron:2,x:2}
];
const WEAPONS=[
 {id:'worn',name:'煤けた大剣',power:0,cost:0,ember:0,shape:0,description:'傷はある。まだ、折れてはいない。'},
 {id:'iron',name:'黒鉄の大剣',power:9,cost:8,ember:0,shape:1,description:'幾度もの行動を、一振りの鋼に。'},
 {id:'oath',name:'誓火の双剣',power:16,cost:18,ember:3,shape:2,description:'一歩を重ねる者の、二つの誓い。'},
 {id:'dawn',name:'黎明の断剣',power:28,cost:30,ember:6,shape:3,description:'砕けた世界にも、朝は来る。'}
];
function fresh(){return {version:3,tasks:[],events:[],main:{},route:'story',region:0,view:'tasks',focus:null,settings:{mute:true,volume:.25,reduced:false},base:{xp:0,iron:0,ember:0,unlocked:0,progress:[0,0,0],hp:[100,210,360],owned:['worn'],equipped:'worn'},createdAt:Date.now()}}
function replay(s){
 const b=s.base,g={xp:b.xp||0,iron:b.iron||0,ember:b.ember||0,progress:[...b.progress],hp:[...b.hp],unlocked:b.unlocked||0,owned:[...b.owned],equipped:b.equipped||'worn',done:new Set(),results:[],invalid:[],mainDays:new Set(),titles:[],forged:0};
 for(const a of s.events){
 if(a.type==='forge'){const w=WEAPONS.find(w=>w.id===a.weapon);if(w&&!g.owned.includes(w.id)&&g.iron>=w.cost&&g.ember>=w.ember){g.iron-=w.cost;g.ember-=w.ember;g.owned.push(w.id);g.equipped=w.id;g.forged++}else g.invalid.push(a.id);continue}
 if(a.type==='equip'){if(g.owned.includes(a.weapon))g.equipped=a.weapon;continue}
 if(a.type!=='complete'||g.done.has(a.taskId))continue;
 g.done.add(a.taskId);let region=Math.min(a.region,g.unlocked,2),r=REGIONS[region],cleared=g.hp[region]<=0&&g.progress[region]>=r.distance,level=1+Math.floor(g.xp/40),w=WEAPONS.find(w=>w.id===g.equipped)||WEAPONS[0];
 let main=a.main&&!g.mainDays.has(a.day);if(main)g.mainDays.add(a.day);
 const energy=a.energy,iron=energy*(a.route==='materials'?2:1)+r.iron-1+(main?2:0),xp=energy*(cleared?4:8),ember=main?1:0;
 const damage=cleared?0:Math.round((12+level*3+w.power)*energy*(a.route==='materials'?.65:1));
 let actual=Math.min(g.hp[region],damage);g.hp[region]=Math.max(0,g.hp[region]-damage);let before=g.progress[region];g.progress[region]=Math.min(r.distance,before+(a.route==='materials'?Math.max(1,Math.floor(energy/2)):energy));
 let cache=before<6&&g.progress[region]>=6&&!cleared;g.iron+=iron+(cache?2:0);g.ember+=ember;g.xp+=xp;
 let victory=!cleared&&g.hp[region]===0&&g.progress[region]>=r.distance;
 if(victory){g.ember+=2;g.unlocked=Math.max(g.unlocked,Math.min(2,region+1));g.titles.push(['城門を開く者','鐘を継ぐ者','夜明けを呼ぶ者'][region])}
 g.results.push({eventId:a.id,taskId:a.taskId,title:a.title,day:a.day,at:a.at,region,route:a.route,iron:iron+(cache?2:0),ember:ember+(victory?2:0),xp,damage:actual,main,cache,victory,repeat:cleared,weapon:w.id,level:1+Math.floor(g.xp/40)});
 }
 g.level=1+Math.floor(g.xp/40);g.attack=12+g.level*3+(WEAPONS.find(w=>w.id===g.equipped)||WEAPONS[0]).power;
 g.projects=[...new Set(s.tasks.map(t=>t.project).filter(Boolean))].map(name=>{const ts=s.tasks.filter(t=>t.project===name&&!t.deleted);return {name,total:ts.length,done:ts.filter(t=>t.importedDone||g.done.has(t.id)).length}}).filter(p=>p.total);
 return g;
}
function migrate(old){const s=fresh();if(!old||!Array.isArray(old.tasks))return s;s.tasks=old.tasks.map(t=>({id:String(t.id),title:String(t.title).slice(0,100),energy:[1,2,4].includes(Number(t.size))?Number(t.size):2,condition:'',step:'',minutes:25,due:'',scheduled:t.done?(t.date||''):localDay(),priority:2,project:'',createdAt:Date.now(),importedDone:!!t.done,deleted:false}));s.base.xp=Math.max(0,Number(old.xp)||0);s.base.iron=Math.max(0,Number(old.total)||0);s.base.unlocked=Math.min(2,Math.max(0,(old.regions?.length||1)-1));s.region=Math.min(old.region||0,s.base.unlocked);if(old.weapon>0){s.base.owned.push('iron');s.base.equipped='iron'};old.regions?.slice(0,3).forEach((r,i)=>{s.base.progress[i]=Math.min(REGIONS[i].distance,Math.round(Math.min(r.p,10)*REGIONS[i].distance/10));s.base.hp[i]=r.hp<=0?0:Math.round(REGIONS[i].hp*Math.min(20,r.hp)/20)});s.legacyLogs=Array.isArray(old.logs)?old.logs.slice(0,40).map(String):[];if(old.pending?.energy>0){s.base.xp+=old.pending.energy*5;s.base.iron+=old.pending.energy;}s.migrated=true;return s}
function localDay(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function validate(s){
 if(!s||s.version!==3||!Array.isArray(s.tasks)||!Array.isArray(s.events)||s.tasks.length>10000||s.events.length>50000)throw Error('対応するバックアップではありません。');
 const str=(v,n=500)=>typeof v==='string'&&v.length<=n,num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
 if(!s.base||!Array.isArray(s.base.progress)||s.base.progress.length!==3||!Array.isArray(s.base.hp)||s.base.hp.length!==3||!Array.isArray(s.base.owned)||!s.base.owned.every(w=>WEAPONS.some(x=>x.id===w))||!num(s.base.xp,0,1e9)||!num(s.base.iron,0,1e9)||!num(s.base.ember,0,1e9)||(!num(s.base.unlocked,0,2)||!Number.isInteger(s.base.unlocked))||!s.base.progress.every((p,i)=>num(p,0,REGIONS[i].distance))||!s.base.hp.every((p,i)=>num(p,0,REGIONS[i].hp)))throw Error('成長データが壊れています。');
 if(!s.base.owned.includes('worn')||!s.base.owned.includes(s.base.equipped))throw Error('装備データが壊れています。');
 const ids=new Set();for(const t of s.tasks){if(!str(t.id,100)||ids.has(t.id)||!str(t.title,100)||!t.title.trim()||![1,2,4].includes(t.energy)||!str(t.condition)||!str(t.step)||!str(t.due,10)||!str(t.scheduled,10)||!str(t.project,80)||!num(t.minutes,1,240)||![1,2,3].includes(t.priority)||!num(t.createdAt,0,1e14))throw Error('任務データが壊れています。');ids.add(t.id)}
 for(const a of s.events){if(!str(a.id,100)||!['complete','forge','equip'].includes(a.type))throw Error('履歴データが壊れています。');if(a.type==='complete'&&(!ids.has(a.taskId)||![1,2,4].includes(a.energy)||(!num(a.region,0,2)||!Number.isInteger(a.region))||!['story','materials'].includes(a.route)||!str(a.title,100)||!str(a.day,10)||!num(a.at,0,1e14)))throw Error('達成履歴が壊れています。');if(a.type!=='complete'&&!WEAPONS.some(w=>w.id===a.weapon))throw Error('装備データが壊れています。')}
 if(!s.main||typeof s.main!=='object'||Array.isArray(s.main)||!s.settings||typeof s.settings.mute!=='boolean'||typeof s.settings.reduced!=='boolean'||!num(s.settings.volume,0,1)||(!num(s.region,0,2)||!Number.isInteger(s.region))||!['story','materials'].includes(s.route))throw Error('設定データが壊れています。');
 if(s.feedback!==undefined&&(!Array.isArray(s.feedback)||s.feedback.length>10000||!s.feedback.every(f=>str(f.day,10)&&num(f.reward,1,5)&&num(f.entry,1,5)&&str(f.note,1000))))throw Error('振り返りデータが壊れています。');
 if(s.legacyLogs!==undefined&&(!Array.isArray(s.legacyLogs)||!s.legacyLogs.every(l=>str(l,2000))))throw Error('以前の記録が壊れています。');
 s.focus=null;s.view='tasks';return s
}
root.EmberLegacy={REGIONS,WEAPONS,fresh,replay,migrate,localDay,validate};
})(typeof module==='object'?module.exports:window);
