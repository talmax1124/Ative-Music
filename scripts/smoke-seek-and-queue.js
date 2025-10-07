// Lightweight smoke test for MusicManager seek/shuffle/repeat without network
const { PassThrough } = require('stream');
const MusicManager = require('../src/MusicManager.js');

function createStubStream(durationMs = 1500) {
  const stream = new PassThrough();
  let sent = 0;
  const interval = setInterval(() => {
    // push some dummy bytes periodically
    stream.write(Buffer.alloc(1024, 0));
    sent += 100;
    if (sent >= durationMs) {
      clearInterval(interval);
      stream.end();
    }
  }, 10);
  return stream;
}

async function main() {
  // Stub source handlers to avoid network
  const sourceHandlers = {
    getStream: async (_track, options = {}) => {
      // Honor seekSeconds argument presence
      if (typeof options.seekSeconds === 'number') {
        console.log(`[TEST] getStream called with seekSeconds=${options.seekSeconds}`);
      }
      return createStubStream();
    }
  };

  const mm = new MusicManager('guild-test', 'channel-test', sourceHandlers);

  // Attach basic event logs
  mm.onTrackStart = (t) => console.log('[TEST] onTrackStart:', t?.title);
  mm.onTrackEnd = (t) => console.log('[TEST] onTrackEnd:', t?.title);

  // Seed a fake track and queue
  const track = {
    title: 'Test Track',
    author: 'Tester',
    url: 'https://example.com/test',
    duration: '3:00',
    durationMS: 180000,
    source: 'youtube'
  };
  mm.queue = [track];
  mm.currentTrackIndex = 0;
  mm.currentTrack = track;

  // Exercise toggles
  console.log('[TEST] toggleShuffle ->', mm.toggleShuffle());
  console.log('[TEST] toggleRepeat ->', mm.toggleRepeat());

  // Exercise seek (should not require a voice connection)
  const ok = await mm.seek(42); // jump to 42s
  console.log('[TEST] seek returned', ok);
  console.log('[TEST] isPlaying', mm.isPlaying, 'isPaused', mm.isPaused);

  // Let player spin briefly
  await new Promise((r) => setTimeout(r, 1000));

  // Exercise queue info snapshot
  const info = mm.getQueueInfo();
  console.log('[TEST] queueLength', info.queueLength, 'currentIndex', info.currentIndex);

  // Stop player
  mm.stop(true);
  console.log('[TEST] Stopped. Done.');
  // Force exit to avoid lingering timers/handles
  setTimeout(() => process.exit(0), 250);
}

main().catch((e) => {
  console.error('Smoke test error:', e);
  process.exit(1);
});
