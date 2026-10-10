// 실제 PostgreSQL 잠금 대기를 확인해 취소와 재생의 실행 순서를 고정한다.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const db = require('../src/db/knex');
const recService = require('../src/services/recommendation.service');
const { REC_STATUS } = require('../src/constants/recommendation-status');
const { app } = require('../app');
const visitorId = 'cancel-race-visitor';
let cafe;
let otherCafe;
const emit = vi.fn();
const originalIo = app.get('io');

beforeAll(async () => {
  [cafe, otherCafe] = await db('cafes').insert([0, 1].map(index => ({
    slug: `cancel${index}${Date.now()}`, name: '취소 경합 테스트',
    owner_email: `cancel${index}@example.test`,
  }))).returning('*');
  app.set('io', { of: () => ({ to: () => ({ emit }) }) });
});

afterAll(async () => {
  app.set('io', originalIo);
  await db('cafes').whereIn('id', [cafe.id, otherCafe.id]).delete();
  await db.destroy();
});

function add(status = REC_STATUS.ACCEPTED) {
  return recService.add(cafe.id, {
    videoId: crypto.randomUUID().replace(/-/g, '').slice(0, 11),
    title: '취소 테스트 곡', requesterIp: '127.0.0.1', visitorId, status,
  });
}

function cancelRequest(rec) {
  return request(app)
    .delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`)
    .set('x-visitor-id', visitorId);
}

async function waitForBlockedQuery(blockerPid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const { rows } = await db.raw(
      'SELECT 1 FROM pg_stat_activity WHERE ?::int = ANY(pg_blocking_pids(pid))',
      [blockerPid],
    );
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('취소 요청이 PostgreSQL 잠금 대기에 도달하지 않음');
}

describe('손님 취소와 재생 경합', () => {
  it('재생 전환 커밋을 기다린 취소는 409이고 재생곡·이력을 보존한다', async () => {
    const rec = await add();
    const holder = await db.transaction();
    let response;
    try {
      const { rows: [{ pid }] } = await holder.raw('SELECT pg_backend_pid() AS pid');
      await holder('cafes').where({ id: cafe.id }).forUpdate().first();
      // setPlaying의 미커밋 구간: 다른 연결에서는 아직 accepted로 보인다.
      await holder('recommendations').where({ id: rec.id }).update({
        status: REC_STATUS.PLAYING, playing_started_at: new Date(),
      });
      emit.mockClear();
      response = cancelRequest(rec).then(result => result);
      await waitForBlockedQuery(pid);
      await holder.commit();
      expect((await response).status).toBe(409);
      expect(emit).not.toHaveBeenCalled();
      expect((await recService.findByIdForCafe(cafe.id, rec.id)).status).toBe(REC_STATUS.PLAYING);
      const ended = await recService.updateStatus(cafe.id, rec.id, REC_STATUS.PLAYED);
      expect(ended.played_at).toBeTruthy();
    } finally {
      if (!holder.isCompleted()) await holder.rollback();
      if (response) await response;
    }
  });

  it('취소가 먼저 끝나면 재생 전환은 404이며 기존 재생곡은 유지한다', async () => {
    const playing = await add();
    await recService.setPlaying(cafe.id, playing.id);
    const cancelled = await add();
    emit.mockClear();
    expect((await cancelRequest(cancelled)).status).toBe(200);
    expect(emit).toHaveBeenCalledWith('recommendations_update', { action: 'delete', id: cancelled.id });
    await expect(recService.setPlaying(cafe.id, cancelled.id)).rejects.toMatchObject({ status: 404 });
    expect(await recService.findByIdForCafe(cafe.id, cancelled.id)).toBeUndefined();
    expect((await recService.findByIdForCafe(cafe.id, playing.id)).status).toBe(REC_STATUS.PLAYING);
    await recService.updateStatus(cafe.id, playing.id, REC_STATUS.PLAYED);
  });

  it('서비스를 직접 호출해도 카페 범위와 visitor 소유권을 강제한다', async () => {
    const rec = await add(REC_STATUS.PENDING);
    await expect(recService.cancel(otherCafe.id, rec.id, visitorId)).rejects.toMatchObject({ status: 404 });
    for (const visitor of [null, '', 'other-visitor']) {
      await expect(recService.cancel(cafe.id, rec.id, visitor)).rejects.toMatchObject({ status: 403 });
    }
    expect(await recService.cancel(cafe.id, rec.id, visitorId)).toBe(1);
  });

  it.each([REC_STATUS.PLAYING, REC_STATUS.PLAYED, REC_STATUS.SKIPPED, REC_STATUS.REJECTED])(
    '%s 상태는 본인도 취소할 수 없다', async status => {
      const rec = await add(status);
      expect((await cancelRequest(rec)).status).toBe(409);
      expect((await recService.findByIdForCafe(cafe.id, rec.id)).status).toBe(status);
    },
  );
});
