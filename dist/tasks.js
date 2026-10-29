/* Task scheduling and recurrence use local calendar dates (DST-safe).
   Recurrence creates the current occurrence only; missed days never pile up. */
(function (root) {
  'use strict';
  const fromDay = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const dayString = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function addDays(day, n) { const d = fromDay(day); d.setDate(d.getDate() + n); return dayString(d); }
  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(...[pa[0], pa[1] - 1, pa[2]]) - Date.UTC(...[pb[0], pb[1] - 1, pb[2]])) / 86400000);
  }
  const energyFor = minutes => minutes <= 10 ? 1 : minutes <= 40 ? 2 : 4;
  function recurrence(s, day, idFactory, now = Date.now()) {
    const latest = new Map();
    for (const t of s.tasks) {
      if (!t.seriesId) continue;
      const old = latest.get(t.seriesId);
      if (!old || (t.occurrence || t.scheduled) > (old.occurrence || old.scheduled) || (t.occurrence === old.occurrence && t.createdAt > old.createdAt)) latest.set(t.seriesId, t);
    }
    let changed = false;
    for (const t of latest.values()) {
      if (t.deleted || t.repeat === 'none') continue;
      const anchor = t.occurrence || t.scheduled;
      if (!anchor || anchor >= day) continue;
      const interval = t.repeat === 'weekly' ? 7 : 1, diff = dayDiff(day, anchor);
      const periods = Math.floor(diff / interval);
      if (periods < 1) continue;
      const next = addDays(anchor, periods * interval);
      if (s.tasks.some(x => x.seriesId === t.seriesId && x.occurrence === next)) continue;
      s.tasks.push({ ...t, id: idFactory(), occurrence: next, scheduled: next,
        due: t.due ? addDays(t.due, periods * interval) : '', createdAt: now, firstStart: null,
        importedDone: false, deleted: false });
      changed = true;
    }
    return changed;
  }
  root.EmberTasks = { addDays, dayDiff, energyFor, recurrence };
})(typeof module === 'object' ? module.exports : window);
