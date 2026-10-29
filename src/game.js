/* Pure, deterministic game model. No DOM, timers, network or random rewards.
   Every action is replayed so undo also corrects combat, crafting and unlocks. */
(function (root) {
  'use strict';
  const REGIONS = [
    { name: '灰の城門', sub: '第一章', goal: '城門の番人を倒し、最初の烽火を灯せ。', iron: 1,
      encounters: [
        { name: '街道', kind: 'combat', enemy: '灰の斥候', hp: 18 },
        { name: '廃営地', kind: 'cache', enemy: '残された鍛造資材', hp: 0 },
        { name: '城壁', kind: 'combat', enemy: '鉄骸の衛兵', hp: 160 },
        { name: '城門', kind: 'boss', enemy: '城門の番人', hp: 850 }
      ] },
    { name: '沈黙の聖堂', sub: '第二章', goal: '鐘楼の亡霊を倒し、聖堂の鐘を取り戻せ。', iron: 1,
      encounters: [
        { name: '参道', kind: 'combat', enemy: '燭台の影', hp: 130 },
        { name: '書庫', kind: 'cache', enemy: '聖堂の鍛造資材', hp: 0 },
        { name: '回廊', kind: 'combat', enemy: '鎖の修道士', hp: 430 },
        { name: '鐘楼', kind: 'boss', enemy: '鐘楼の亡霊', hp: 1500 }
      ] },
    { name: '黎明の断崖', sub: '第三章', goal: '翼なき王を倒し、夜明けを取り戻せ。', iron: 2,
      encounters: [
        { name: '稜線', kind: 'combat', enemy: '荒野の追放者', hp: 230 },
        { name: '見張り跡', kind: 'cache', enemy: '王国最後の鍛造資材', hp: 0 },
        { name: '断橋', kind: 'combat', enemy: '断崖の守護者', hp: 750 },
        { name: '王座', kind: 'boss', enemy: '翼なき王', hp: 2300 }
      ] }
  ];
  // Two parallel families. A tier has the same total damage in either family.
  const WEAPONS = [
    { id: 'great', name: '大剣', names: ['煤けた大剣', '黒鉄の大剣', '誓火の大剣', '黎明の大剣'],
      hits: 1, description: '短い溜めから、重い一撃を刻む。' },
    { id: 'dual', name: '双剣', names: ['旅人の双剣', '黒鉄の双剣', '誓火の双剣', '黎明の双剣'],
      hits: 3, description: '三つの斬撃で、同じ力をつなぐ。' }
  ];
  const level = xp => 1 + Math.floor(xp / 50);
  const attack = (xp, tier) => 16 + level(xp) * 2 + Math.max(0, tier) * 5;
  const weaponName = (id, tier) => WEAPONS.find(w => w.id === id)?.names[Math.min(3, Math.max(0, tier))] + (tier > 3 ? ' +' + (tier - 3) : '');
  const artWeapon = (id, tier) => id === 'dual' ? 'oath' : tier === 0 ? 'worn' : tier === 1 ? 'iron' : 'dawn';
  function forgeCost(tier) {
    // -1 unlocks the other family at tier 0. No upper limit on either family.
    if (tier < 0) return { iron: 4, ember: 0 };
    return { iron: 12 + tier * 10, ember: tier === 0 ? 0 : tier * 2 };
  }
  function fresh() {
    return { version: 4, tasks: [], events: [], main: {}, region: 0, route: 'story',
      settings: { mute: true, volume: .25, reduced: false }, daily: {}, feedback: [],
      base: { xp: 0, iron: 0, ember: 0, tiers: { great: 0, dual: -1 }, equipped: 'great',
        stages: [0, 0, 0], health: REGIONS.map(r => r.encounters.map(e => e.hp)), unlocked: 0 },
      createdAt: Date.now() };
  }
  function currentEncounter(g, region) {
    const index = g.stages[region];
    if (index >= REGIONS[region].encounters.length) return { index, name: '踏破した道', kind: 'repeat', enemy: '', hp: 0, maxHp: 0 };
    const e = REGIONS[region].encounters[index];
    return { ...e, index, maxHp: e.hp, hp: g.health[region][index] };
  }
  function hitValues(total, family) {
    const n = family === 'dual' ? 3 : 1;
    return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
  }
  function replay(s) {
    const b = s.base;
    const g = { xp: b.xp, iron: b.iron, ember: b.ember, tiers: { ...b.tiers }, equipped: b.equipped,
      stages: [...b.stages], health: b.health.map(a => [...a]), unlocked: b.unlocked,
      done: new Set(), results: [], craftResults: [], invalid: [], mainDays: new Set(b.claimedDays || []), titles: [] };
    for (const a of s.events) {
      if (a.type === 'forge') {
        const tier = g.tiers[a.weapon], cost = forgeCost(tier);
        if ((a.targetTier !== undefined && a.targetTier !== tier + 1) || g.iron < cost.iron || g.ember < cost.ember) { g.invalid.push(a.id); continue; }
        g.iron -= cost.iron; g.ember -= cost.ember; g.tiers[a.weapon]++;
        g.equipped = a.weapon;
        g.craftResults.push({ id: a.id, day: a.day, weapon: a.weapon, tier: g.tiers[a.weapon], name: weaponName(a.weapon, g.tiers[a.weapon]) });
        continue;
      }
      if (a.type === 'equip') {
        if (g.tiers[a.weapon] >= 0) g.equipped = a.weapon;
        continue;
      }
      if (a.type !== 'complete' || g.done.has(a.taskId)) continue;
      g.done.add(a.taskId);
      const region = Math.min(a.region, g.unlocked), encounter = currentEncounter(g, region);
      const isMain = a.main && !g.mainDays.has(a.day);
      if (isMain) g.mainDays.add(a.day);
      const repeat = encounter.kind === 'repeat', cache = encounter.kind === 'cache';
      const energy = a.energy;
      const iron = energy * (a.route === 'materials' ? 2 : 1) + REGIONS[region].iron - 1 + (isMain ? 2 : 0) + (cache ? 2 : 0);
      const xp = energy * (repeat ? 4 : 8);
      let ember = (isMain ? 1 : 0) + (cache ? 1 : 0);
      const power = attack(g.xp, g.tiers[g.equipped]);
      const rawDamage = Math.round(power * energy * (a.route === 'materials' ? .7 : 1));
      const damage = cache || repeat ? 0 : Math.min(encounter.hp, rawDamage);
      if (!cache && !repeat) g.health[region][encounter.index] -= damage;
      const breakthrough = !repeat && (cache || g.health[region][encounter.index] === 0);
      if (breakthrough) g.stages[region]++;
      const victory = breakthrough && g.stages[region] === REGIONS[region].encounters.length;
      if (victory) { ember += 3; g.unlocked = Math.max(g.unlocked, Math.min(2, region + 1)); }
      g.iron += iron; g.ember += ember; g.xp += xp;
      g.results.push({ eventId: a.id, taskId: a.taskId, title: a.title, day: a.day, at: a.at,
        region, encounter: encounter.name, encounterIndex: encounter.index, beforeHp: encounter.hp, maxHp: encounter.maxHp, enemy: encounter.enemy, kind: encounter.kind,
        iron, ember, xp, damage, hits: hitValues(damage, g.equipped), main: isMain, cache,
        victory, breakthrough, repeat, weapon: g.equipped, tier: g.tiers[g.equipped],
        next: currentEncounter(g, region).name, level: level(g.xp) });
    }
    g.level = level(g.xp); g.attack = attack(g.xp, g.tiers[g.equipped]);
    g.cleared = g.stages.map((n, i) => n >= REGIONS[i].encounters.length);
    g.titles = g.cleared.map((yes, i) => yes ? ['城門を開く者', '鐘を継ぐ者', '夜明けを呼ぶ者'][i] : '').filter(Boolean);
    g.projects = [...new Set(s.tasks.filter(t => !t.deleted).map(t => t.project).filter(Boolean))].map(name => {
      const tasks = s.tasks.filter(t => t.project === name && !t.deleted);
      return { name, total: tasks.length, done: tasks.filter(t => t.importedDone || g.done.has(t.id)).length };
    });
    return g;
  }
  function preview(s, task, day) {
    const g = replay(s), evt = { id: '__preview', type: 'complete', taskId: task.id, title: task.title,
      day, at: Date.now(), region: s.region, route: s.route, energy: task.energy, main: s.main[day] === task.id };
    if (g.done.has(task.id) || task.importedDone) return null;
    const after = replay({ ...s, events: [...s.events, evt] });
    const result = after.results.at(-1), cost = forgeCost(g.tiers[g.equipped]);
    return { ...result, willForge: after.iron >= cost.iron && after.ember >= cost.ember,
      needIron: Math.max(0, cost.iron - after.iron), needEmber: Math.max(0, cost.ember - after.ember),
      target: weaponName(g.equipped, g.tiers[g.equipped] + 1) };
  }
  function localDay(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function migrate(old, legacyModel) {
    if (!old) return fresh();
    if (old.version === 4) return validate(old);
    const v3 = old.version === 3 ? legacyModel.validate(structuredClone(old)) : legacyModel.migrate(old);
    const previous = legacyModel.replay(v3), s = fresh();
    s.tasks = v3.tasks.map(t => ({ ...t, importedDone: t.importedDone || previous.done.has(t.id), repeat: 'none', seriesId: t.id, occurrence: t.scheduled || '', autoEnergy: false }));
    s.main = { ...v3.main }; s.settings = { ...v3.settings };
    s.region = Math.min(2, v3.region); s.route = v3.route;
    s.base.xp = previous.xp; s.base.iron = previous.iron; s.base.ember = previous.ember;
    s.base.tiers.great = previous.owned.includes('dawn') ? 3 : previous.owned.includes('iron') ? 1 : 0;
    s.base.tiers.dual = previous.owned.includes('oath') ? 1 : -1;
    s.base.equipped = previous.equipped === 'oath' ? 'dual' : 'great';
    s.base.unlocked = previous.unlocked; s.base.claimedDays = [...previous.mainDays];
    for (let i = 0; i < 3; i++) {
      const cleared = previous.hp[i] <= 0 && previous.progress[i] >= legacyModel.REGIONS[i].distance;
      if (cleared || i < previous.unlocked) {
        s.base.stages[i] = 4; s.base.health[i] = [0, 0, 0, 0];
      } else if (previous.progress[i] > 0 || previous.hp[i] < legacyModel.REGIONS[i].hp) {
        // Convert the prior two-condition region into the boss encounter, preserving its damage ratio.
        s.base.stages[i] = 3; s.base.health[i][0] = 0; s.base.health[i][2] = 0;
        s.base.health[i][3] = Math.max(1, Math.round(REGIONS[i].encounters[3].hp * previous.hp[i] / legacyModel.REGIONS[i].hp));
      }
    }
    s.legacyResults = previous.results;
    s.legacyLogs = v3.legacyLogs || [];
    s.feedback = v3.feedback || [];
    s.migrated = true;
    return s;
  }
  function validate(s) {
    const str = (v, n = 500) => typeof v === 'string' && v.length <= n;
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const date = v => v === '' || (str(v, 10) && /^\d{4}-\d{2}-\d{2}$/.test(v));
    const object = v => v && typeof v === 'object' && !Array.isArray(v);
    if (!s || s.version !== 4 || !Array.isArray(s.tasks) || s.tasks.length > 20000 || !Array.isArray(s.events) || s.events.length > 100000) throw Error('対応するバックアップではありません。');
    const b = s.base;
    if (!object(b) || !int(b.xp, 0, 1e9) || !int(b.iron, 0, 1e9) || !int(b.ember, 0, 1e9) || !int(b.unlocked, 0, 2) || !object(b.tiers) || !int(b.tiers.great, 0, 10000) || !int(b.tiers.dual, -1, 10000) || !['great', 'dual'].includes(b.equipped) || b.tiers[b.equipped] < 0 || !Array.isArray(b.stages) || b.stages.length !== 3 || !b.stages.every(n => int(n, 0, 4)) || !Array.isArray(b.health) || b.health.length !== 3 || !b.health.every((a, i) => Array.isArray(a) && a.length === 4 && a.every((h, j) => int(h, 0, REGIONS[i].encounters[j].hp)))) throw Error('冒険データが壊れています。');
    const ids = new Set();
    for (const t of s.tasks) {
      if (!str(t.id, 100) || !t.id || ids.has(t.id) || !str(t.title, 100) || !t.title.trim() || ![1, 2, 4].includes(t.energy) || !int(t.minutes, 1, 240) || !str(t.condition) || !str(t.step) || !str(t.project, 80) || !date(t.due) || !date(t.scheduled) || !int(t.priority, 1, 3) || !['none', 'daily', 'weekly'].includes(t.repeat) || !str(t.seriesId, 100) || !date(t.occurrence) || !Number.isFinite(t.createdAt)) throw Error('任務データが壊れています。');
      ids.add(t.id);
    }
    const eventIds = new Set();
    for (const a of s.events) {
      if (!str(a.id, 100) || eventIds.has(a.id) || !['complete', 'forge', 'equip'].includes(a.type)) throw Error('履歴が壊れています。');
      eventIds.add(a.id);
      if (a.type === 'complete' && (!ids.has(a.taskId) || ![1, 2, 4].includes(a.energy) || !int(a.region, 0, 2) || !['story', 'materials'].includes(a.route) || !date(a.day) || !a.day || !str(a.title, 100) || !Number.isFinite(a.at))) throw Error('達成履歴が壊れています。');
      if (a.type === 'forge' && (!int(a.targetTier, 0, 10000) || !date(a.day) || !a.day)) throw Error('鍛造履歴が壊れています。');
      if (a.type !== 'complete' && !['great', 'dual'].includes(a.weapon)) throw Error('装備履歴が壊れています。');
    }
    if (!object(s.main) || Object.entries(s.main).some(([d, id]) => !date(d) || !str(id, 100)) || !int(s.region, 0, 2) || !['story', 'materials'].includes(s.route) || !object(s.settings) || typeof s.settings.mute !== 'boolean' || typeof s.settings.reduced !== 'boolean' || !Number.isFinite(s.settings.volume) || s.settings.volume < 0 || s.settings.volume > 1 || !object(s.daily)) throw Error('設定が壊れています。');
    if (Object.entries(s.daily).some(([d, v]) => !date(d) || !object(v) || !str(v.tomorrow) || !str(v.note, 1000))) throw Error('遠征の記録が壊れています。');
    if (s.base.claimedDays && (!Array.isArray(s.base.claimedDays) || !s.base.claimedDays.every(date))) throw Error('日次記録が壊れています。');
    if (s.feedback && (!Array.isArray(s.feedback) || !s.feedback.every(f => object(f) && date(f.day) && int(f.reward, 1, 5) && int(f.entry, 1, 5) && str(f.note, 1000)))) throw Error('振り返りが壊れています。');
    if (s.legacyLogs && (!Array.isArray(s.legacyLogs) || !s.legacyLogs.every(l => str(l, 2000)))) throw Error('過去の記録が壊れています。');
    if (s.legacyResults && (!Array.isArray(s.legacyResults) || !s.legacyResults.every(r => object(r) && str(r.title, 100) && date(r.day) && int(r.region, 0, 2) && int(r.iron, 0, 1e9) && int(r.xp, 0, 1e9)))) throw Error('過去の成果が壊れています。');
    s.feedback = s.feedback || []; s.legacyResults = s.legacyResults || []; s.legacyLogs = s.legacyLogs || [];
    return s;
  }
  root.EmberGame = { REGIONS, WEAPONS, fresh, replay, currentEncounter, attack, weaponName, artWeapon, forgeCost, hitValues, preview, localDay, migrate, validate };
})(typeof module === 'object' ? module.exports : window);
