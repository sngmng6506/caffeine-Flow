// 한 카페의 신청곡을 바꾸는 쓰기가 모두 카페 행 잠금(withCafeQueue)을 거치는지 검사.
//
// 한 카페의 활성 큐는 함께 맞아야 하는 묶음이다 — playing은 한 곡뿐, 큐 한도,
// 같은 곡 중복 금지는 곡 하나만 봐서는 지킬 수 없다. 그래서 그 묶음을 바꾸는
// 입구를 카페 행 잠금 하나로 둔다. 한 경로라도 곡 행만 잡고 들어오면, 카페 행을
// 잡은 다른 작업과 동시에 같은 곡을 바꿀 수 있다. 1872792의 경합(건너뛴 곡이
// played로 덮어써짐)이 updateStatus가 그렇게 들어와서 났다.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
// 서비스가 require하는 것과 같은 knex 인스턴스여야 쿼리를 관찰할 수 있다.
const require = createRequire(import.meta.url);
const db = require('../src/db/knex');
const recService = require('../src/services/recommendation.service');
const { REC_STATUS } = require('../src/constants/recommendation-status');

let cafe;

beforeAll(async () => {
  [cafe] = await db('cafes')
    .insert({ slug: `root${Date.now()}`.slice(0, 20), name: 'root test', owner_email: 'root@example.test' })
    .returning('*');
});

afterAll(async () => {
  await db('cafes').where({ id: cafe.id }).delete();
  await db.destroy();
});

const newVideoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 11);
const payload = () => ({
  videoId: newVideoId(), title: 'root track', channelTitle: 'artist', platform: 'youtube', requesterIp: '127.0.0.1',
});

/** 실행하는 동안 나간 SQL 중 처음으로 행을 잠근 문장을 돌려준다. */
async function firstLock(run) {
  const statements = [];
  const capture = query => statements.push(query.sql);
  db.on('query', capture);
  try {
    await run();
  } finally {
    db.removeListener('query', capture);
  }
  return statements.find(sql => /\bfor (no key )?update\b|\bfor (key )?share\b/i.test(sql));
}

describe('카페 큐의 입구', () => {
  it('상태를 바꾸는 모든 경로가 카페 행을 가장 먼저 잠근다', async () => {
    const rec = await recService.add(cafe.id, payload());
    const voted = await recService.add(cafe.id, payload());
    const cancellable = await recService.add(cafe.id, { ...payload(), visitorId: 'root-visitor' });
    const trackKey = voted.video_id;

    const paths = {
      addWithinQueueLimit: () => recService.addWithinQueueLimit(cafe.id, payload(), 50),
      updateStatus: () => recService.updateStatus(cafe.id, rec.id, REC_STATUS.ACCEPTED),
      setPlaying: () => recService.setPlaying(cafe.id, rec.id),
      clearPlaying: () => recService.clearPlaying(cafe.id),
      cancel: () => recService.cancel(cafe.id, cancellable.id, 'root-visitor'),
      voteSong: () => recService.voteSong(cafe.id, trackKey, '127.0.0.1', 'root-visitor'),
      unvoteSong: () => recService.unvoteSong(cafe.id, trackKey, '127.0.0.1', 'root-visitor'),
    };

    const offenders = [];
    for (const [name, run] of Object.entries(paths)) {
      const sql = await firstLock(run);
      if (!/from "cafes"/.test(sql || '')) offenders.push(`${name}: ${sql || '잠금 없음'}`);
    }
    expect(offenders, '카페 행을 먼저 잠그지 않는 경로').toEqual([]);
  });

  it('다른 작업이 카페 큐를 잡고 있으면 상태 변경은 기다린다', async () => {
    const rec = await recService.add(cafe.id, payload());

    const holder = await db.transaction();
    await holder('cafes').where({ id: cafe.id }).forUpdate().first();

    const update = recService.updateStatus(cafe.id, rec.id, REC_STATUS.ACCEPTED);
    const outcome = await Promise.race([
      update.then(() => 'done'),
      new Promise(resolve => setTimeout(() => resolve('waiting'), 300)),
    ]);
    await holder.commit();
    const updated = await update;

    expect(outcome).toBe('waiting');
    expect(updated.status).toBe(REC_STATUS.ACCEPTED);
  });
});
