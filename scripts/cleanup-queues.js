#!/usr/bin/env node
/*
 One-time cleanup script to purge duplicate tracks from stored queues in Firestore.

 Usage:
  - Dry run (default): node scripts/cleanup-queues.js
  - Apply changes:     node scripts/cleanup-queues.js --apply
*/

const path = require('path');
const chalk = require('chalk');

function normalize(str) {
  try {
    return String(str)
      .toLowerCase()
      .replace(/\([^\)]*\)|\[[^\]]*\]/g, '') // remove parentheses/brackets
      .replace(/official|mv|video|audio|lyrics|lyric|remastered|hd|4k/gi, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  } catch { return ''; }
}

function trackKey(t) {
  if (!t) return '';
  const title = normalize(t.title || '');
  const author = normalize(t.author || '');
  const id = t.id || t.videoId || '';
  const urlId = (t.url || '').replace(/^https?:\/\//, '');
  return `${title}::${author}::${id}::${urlId}`;
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  console.log(chalk.cyan('🔍 Queue cleanup starting... ') + (APPLY ? chalk.green('(apply mode)') : chalk.yellow('(dry run)')));

  // Initialize Firebase via existing service
  const fb = require(path.join('..', 'src', 'FirebaseService.js'));
  if (!fb.initialized) fb.initialize();
  const db = fb.db;

  const snap = await db.collection('queues').get();
  if (snap.empty) {
    console.log(chalk.yellow('No queue documents found.'));
    return;
  }

  let totalDocs = 0; let changedDocs = 0; let totalRemoved = 0;
  for (const doc of snap.docs) {
    totalDocs++;
    const data = doc.data() || {};
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const seen = new Set();
    const deduped = [];
    let removed = 0;
    for (const item of queue) {
      const key = trackKey(item);
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      } else {
        removed++;
      }
    }
    if (removed > 0) {
      changedDocs++;
      totalRemoved += removed;
      console.log(`${chalk.blue(doc.id)}: removed ${chalk.red(removed)} duplicate(s), new length ${chalk.green(deduped.length)} (was ${queue.length})`);
      if (APPLY) {
        await doc.ref.set({ ...data, queue: deduped }, { merge: true });
      }
    }
  }

  console.log(chalk.cyan(`\n✅ Cleanup complete. Reviewed ${totalDocs} doc(s).`));
  if (changedDocs === 0) console.log(chalk.green('No duplicates found.'));
  else console.log(chalk.green(`Updated ${changedDocs} doc(s); removed ${totalRemoved} duplicate item(s).`));
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});

