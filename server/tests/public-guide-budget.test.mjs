import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';
import appModule from '../app.js';
import db from '../src/db/knex.js';
import budget from '../src/features/music-filter/public-guide-budget.js';
import { PUBLIC_GUIDE_LIMIT } from '../src/constants/limits.js';

const { app } = appModule;
const require = createRequire(import.meta.url);
let cafe, token;
const generator = vi.fn(async () => ({ notice: '차분한 음악을 신청해 주세요.', model: 'test-model' }));
const save = prompt => request(app).put('/api/v1/cafes/me/music-filter')
  .set('Authorization', `Bearer ${token}`).send({ enabled: true, prompt });

beforeAll(async () => {
  [cafe] = await db('cafes').insert({ name: '예산 테스트', slug: 'guidebudget', owner_email: 'budget@test.invalid' }).returning('*');
  token = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, process.env.JWT_SECRET);
});
beforeEach(async () => {
  await db('public_guide_usage').del();
  await db('cafes').where({ id: cafe.id }).update({ music_filter_prompt: '기존 설명', music_filter_public_notice: '기존 안내' });
  generator.mockClear();
  app.set('publicMusicGuideGenerator', generator);
});
afterEach(() => app.set('publicMusicGuideGenerator', null));
afterAll(async () => {
  await db('public_guide_usage').del();
  await db('cafes').where({ id: cafe.id }).del();
  await db.destroy();
});

describe('AI 안내 생성 영속 예산', () => {
  it('한도 이후 유료 호출과 설정 변경을 막고, 기존 설정·직접 편집은 허용한다', async () => {
    for (let i = 0; i < PUBLIC_GUIDE_LIMIT.cafeDaily; i++) {
      expect((await save(`설명 ${i}`)).status).toBe(200);
    }
    expect((await save('초과 요청')).status).toBe(429);
    expect(generator).toHaveBeenCalledTimes(PUBLIC_GUIDE_LIMIT.cafeDaily);
    const saved = await db('cafes').where({ id: cafe.id }).first();
    expect(saved.music_filter_prompt).toBe(`설명 ${PUBLIC_GUIDE_LIMIT.cafeDaily - 1}`);
    expect((await request(app).put('/api/v1/cafes/me/music-filter').set('Authorization', `Bearer ${token}`)
      .send({ enabled: false, prompt: saved.music_filter_prompt })).status).toBe(200);
    expect((await request(app).put('/api/v1/cafes/me/music-filter/public-notice').set('Authorization', `Bearer ${token}`)
      .send({ notice: '직접 쓴 안내' })).status).toBe(200);
    expect(generator).toHaveBeenCalledTimes(PUBLIC_GUIDE_LIMIT.cafeDaily);
  });

  it('동시 예약은 카페당 하나만 허용하며 다른 요청은 예산을 소비하지 않는다', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => budget.reserve(cafe.id)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 409)).toBe(true);
    expect((await db('public_guide_usage').where({ scope: 'global' }).first()).attempts).toBe(1);
    await budget.release(results.find(r => r.status === 'fulfilled').value);
  });

  it('생성 실패도 예산에 포함하고 설정을 보존하며 다음 호출의 잠금은 해제한다', async () => {
    generator.mockRejectedValueOnce(new Error('local simulated failure'));
    expect((await save('실패 설명')).status).toBe(503);
    expect((await db('cafes').where({ id: cafe.id }).first()).music_filter_prompt).toBe('기존 설명');
    expect((await db('public_guide_usage').where({ scope: `cafe:${cafe.id}` }).first()).attempts).toBe(1);
    expect((await save('재시도 설명')).status).toBe(200);
  });

  it('전체 한도에 도달하면 새 카페도 유료 호출을 시작하지 않는다', async () => {
    const ticket = await budget.reserve(cafe.id);
    await budget.release(ticket);
    await db('public_guide_usage').where({ scope: 'global' }).update({ attempts: PUBLIC_GUIDE_LIMIT.globalDaily });
    expect((await save('전체 초과')).status).toBe(429);
    expect(generator).not.toHaveBeenCalled();
    await expect(budget.reserve('33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({ status: 429 });
  });

  it('모듈 재시작으로 예산이 초기화되지 않고 KST 날짜가 바뀌면 재사용한다', async () => {
    const ticket = await budget.reserve(cafe.id);
    await budget.release(ticket);
    await db('public_guide_usage').where({ scope: `cafe:${cafe.id}` }).update({ attempts: PUBLIC_GUIDE_LIMIT.cafeDaily });
    const modulePath = require.resolve('../src/features/music-filter/public-guide-budget.js');
    delete require.cache[modulePath];
    const restarted = require(modulePath);
    await expect(restarted.reserve(cafe.id)).rejects.toMatchObject({ status: 429 });
    await db('public_guide_usage').update({ usage_date: '2000-01-01' });
    const next = await restarted.reserve(cafe.id);
    expect((await db('public_guide_usage').where({ scope: `cafe:${cafe.id}` }).first()).attempts).toBe(1);
    await restarted.release(next);
  });

  it('중단된 작업의 lease는 만료 후 회수하고 옛 해제 요청은 새 잠금을 건드리지 않는다', async () => {
    const old = await budget.reserve(cafe.id);
    await db('public_guide_usage').where({ scope: old.scope }).update({ lease_until: '2000-01-01' });
    const fresh = await budget.reserve(cafe.id);
    await budget.release(old);
    expect((await db('public_guide_usage').where({ scope: fresh.scope }).first()).lease_token).toBe(fresh.token);
    await budget.release(fresh);
  });
});
