// 재생 중인 곡을 정리할 때 동시에 확정된 종료 상태를 덮어쓰지 않는지 검사.
//
// clearPlayingRows는 카페 행을 잠그고 playing 곡을 played로 바꾼다. 그런데
// 사장님의 건너뛰기(updateStatus)는 곡 행만 잠그고 카페 행은 잠그지 않는다.
// 둘이 겹치면 clearPlayingRows가 이미 skipped로 확정된 곡을 played로 다시 쓸 수
// 있었다 — 종료 상태를 다시 쓰는 것이고, 통계에서 건너뛴 곡이 재생된 곡이 된다.
//
// 경합을 결정적으로 만든다: 건너뛰기 트랜잭션이 곡 행을 쥔 채로 clearPlaying을
// 시작시키고, clearPlaying이 그 잠금에서 기다리는 동안 건너뛰기를 커밋한다.
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
    .insert({ slug: `race${Date.now()}`.slice(0, 20), name: 'race test', owner_email: 'race@example.test' })
    .returning('*');
});

afterAll(async () => {
  await db('cafes').where({ id: cafe.id }).delete();
  await db.destroy();
});

async function playingTrack() {
  const rec = await recService.add(cafe.id, {
    videoId: crypto.randomUUID().replace(/-/g, '').slice(0, 11),
    title: 'race track', channelTitle: 'artist', platform: 'youtube', requesterIp: '127.0.0.1',
  });
  await recService.setPlaying(cafe.id, rec.id);
  return rec;
}

describe('재생 중 곡 정리와 건너뛰기의 경합', () => {
  it('정리 도중 건너뛰기로 확정된 곡을 played로 덮어쓰지 않는다', async () => {
    const rec = await playingTrack();

    const skip = await db.transaction();
    await skip('recommendations').where({ id: rec.id }).forUpdate().first();
    await skip('recommendations').where({ id: rec.id }).update({ status: REC_STATUS.SKIPPED, played_at: new Date() });

    const clearing = recService.clearPlaying(cafe.id);
    // clearPlaying이 곡 행 잠금에서 기다리게 둔다.
    await new Promise(resolve => setTimeout(resolve, 300));
    await skip.commit();
    await clearing;

    const after = await db('recommendations').where({ id: rec.id }).first();
    expect(after.status).toBe(REC_STATUS.SKIPPED);
  });

  it('곡 행은 댓글을 막지 않는 강도로 잠근다', async () => {
    // FOR UPDATE는 댓글 INSERT의 외래키 확인(KEY SHARE)까지 막는다. 건너뛰기와의
    // 경합을 막는 데는 UPDATE가 어차피 잡는 NO KEY UPDATE로 충분하다.
    await playingTrack();
    const statements = [];
    const capture = query => statements.push(query.sql);
    db.on('query', capture);
    try {
      await recService.clearPlaying(cafe.id);
    } finally {
      db.removeListener('query', capture);
    }

    const playingSelect = statements.find(sql => /from "recommendations"/.test(sql) && /"status" = /.test(sql) && /^select/i.test(sql));
    expect(playingSelect).toMatch(/for no key update$/);
  });

  it('경합이 없으면 재생 중인 곡을 played로 정리한다', async () => {
    const rec = await playingTrack();

    const cleared = await recService.clearPlaying(cafe.id);

    expect(cleared.map(row => row.id)).toEqual([rec.id]);
    const after = await db('recommendations').where({ id: rec.id }).first();
    expect(after.status).toBe(REC_STATUS.PLAYED);
    expect(after.played_at).not.toBeNull();
  });
});
