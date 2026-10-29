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
  // Weeks start on Monday (local calendar).
  function weekStart(day) { const wd = fromDay(day).getDay(); return addDays(day, -((wd + 6) % 7)); }
  const weekDays = day => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
  // Goals marked weekly continue into the current week. Unfinished assigned tasks move with them.
  function rollGoals(s, day, idFactory, isDone = () => false, now = Date.now()) {
    if (!s.goals) s.goals = [];
    const week = weekStart(day), latest = new Map();
    for (const g of s.goals) { const old = latest.get(g.seriesId); if (!old || g.week > old.week) latest.set(g.seriesId, g); }
    let changed = false;
    for (const g of latest.values()) {
      if (g.deleted || !g.weekly || g.week >= week) continue;
      const next = { ...g, id: idFactory(), week, createdAt: now, deleted: false };
      s.goals.push(next); changed = true;
      for (const t of s.tasks) if (t.goalId === g.id && !t.deleted && !isDone(t)) t.goalId = next.id;
    }
    return changed;
  }
  // "Skip this time" keeps the series; the next occurrence is still created on its date.
  function skipOccurrence(task) { task.skipped = true; }
  // "Stop repeating" keeps the current occurrence as a one-off and creates no further ones.
  // Only the latest occurrence changes, so older missed occurrences stay hidden as past ones.
  function stopSeries(s, seriesId) {
    const series = s.tasks.filter(t => t.seriesId === seriesId);
    const latest = series.reduce((a, t) => !a || (t.occurrence || t.scheduled) > (a.occurrence || a.scheduled) ? t : a, null);
    if (!latest || latest.repeat === 'none') return false;
    latest.repeat = 'none'; latest.stoppedRepeat = true; return true;
  }
  root.EmberTasks = { addDays, dayDiff, energyFor, recurrence, weekStart, weekDays, rollGoals, skipOccurrence, stopSeries };
})(typeof module === 'object' ? module.exports : window);
