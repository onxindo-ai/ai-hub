#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { computeReminders, getStatus } from './hub-ctl.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const includeSoon = args.has('--include-soon');

const status = getStatus();
const allReminders = computeReminders(status.tracks, status.memories);
const urgent = allReminders.filter((r) => {
  if (r.kind === 'overdue' || r.kind === 'due_today' || r.kind === 'stale_track') return true;
  if (includeSoon && r.kind === 'due_soon') return true;
  return false;
});

if (urgent.length === 0) {
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, notified: false, urgentCount: 0, message: '今日无到期或吃灰提醒，保持静默' }, null, 2));
  }
  process.exit(0);
}

const topLines = urgent.slice(0, 3).map((r) => `[${r.badge}] ${r.title.slice(0, 42)}`);
const extra = urgent.length > 3 ? ` 等共 ${urgent.length} 项` : '';
const body = topLines.join('；') + extra;
const title = '多AI中枢 · 防遗忘提醒';

if (dryRun) {
  console.log(JSON.stringify({ ok: true, notified: true, dryRun: true, urgentCount: urgent.length, title, body }, null, 2));
  process.exit(0);
}

if (process.platform === 'darwin') {
  const script = `
on run argv
  set notifTitle to item 1 of argv
  set notifBody to item 2 of argv
  display notification notifBody with title notifTitle sound name "Glass"
end run
`;
  const res = spawnSync('osascript', ['-', title, body], {
    input: script,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error('macOS notification failed:', (res.stderr || '').trim());
    process.exit(1);
  }
} else {
  console.log(`${title}: ${body}`);
}
