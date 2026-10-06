// 대기열 순서가 서버·사장님 화면·손님 화면에서 같은지 검사.
//
// 순서 규칙(좋아요 많은 순, 같으면 먼저 신청한 순)이 세 곳에 따로 있다.
// - 서버 getRecommendations: SQL ORDER BY
// - 사장님 화면 byPriority: 다음에 틀 곡과 자동수락할 곡을 실제로 고른다
// - 손님 화면 byQueuePriority: "N번째"로 보여 준다
// 손님·사장님 화면은 별도 빌드라 코드를 공유하지 않는다. 한쪽만 바뀌면 손님에게
// "1번째"로 보이는 곡이 실제로는 다른 순서로 재생된다.
//
// 실제 DB에서 서버 순서를 받아, 두 화면의 비교 함수로 섞은 목록을 다시 정렬한
// 결과와 맞춰 본다.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { byPriority } from '../../owner/src/pages/dashboard/queuePolicy.js';
import { byQueuePriority } from '../../customer/src/queueOrder.js';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const db = require('../src/db/knex');
const recService = require('../src/services/recommendation.service');
const { REC_STATUS } = require('../src/constants/recommendation-status');

let cafe;

beforeAll(async () => {
  [cafe] = await db('cafes')
    .insert({ slug: `order${Date.now()}`.slice(0, 20), name: 'order test', owner_email: 'order@example.test' })
    .returning('*');
});

afterAll(async () => {
  await db('cafes').where({ id: cafe.id }).delete();
  await db.destroy();
});

const base = new Date('2026-10-06T10:00:00.000Z').getTime();

// 좋아요 동점과 신청 시각 앞뒤가 섞이게 둔다. 좋아요만 보는 실수, 시각 방향을
// 뒤집는 실수 모두 순서가 달라지도록 고른 값이다. 시각이 완전히 같은 쌍은 두지
// 않는다 — 그때의 순서는 세 곳 모두 규칙이 정하지 않는다.
const rows = [
  { label: 'A', vote_count: 2, offsetSec: 0 },
  { label: 'B', vote_count: 2, offsetSec: 1 },
  { label: 'C', vote_count: 5, offsetSec: 2 },
  { label: 'D', vote_count: 0, offsetSec: -1 },
  { label: 'E', vote_count: 2, offsetSec: -1 },
  { label: 'F', vote_count: 5, offsetSec: -3 },
];
const expected = ['F', 'C', 'E', 'A', 'B', 'D'];

/** 같은 입력에 대해 늘 같은 순서로 섞는다(실패를 재현할 수 있게). */
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (i * 7 + 3) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe('대기열 순서', () => {
  it('서버·사장님 화면·손님 화면이 같은 순서를 낸다', async () => {
    const inserted = await db('recommendations').insert(rows.map((row, index) => ({
      cafe_id: cafe.id,
      video_id: crypto.randomUUID().replace(/-/g, '').slice(0, 11),
      title: row.label,
      platform: 'youtube',
      status: index % 2 ? REC_STATUS.PENDING : REC_STATUS.ACCEPTED,
      vote_count: row.vote_count,
      requested_at: new Date(base + row.offsetSec * 1000),
    }))).returning('id');
    expect(inserted).toHaveLength(rows.length);

    // 화면이 받는 것과 같게 API 응답처럼 직렬화한다(requested_at이 문자열로 간다).
    const fromServer = JSON.parse(JSON.stringify(await recService.getRecommendations(cafe.id)));
    const labels = list => list.map(rec => rec.title);

    expect(labels(fromServer)).toEqual(expected);
    expect(labels(shuffled(fromServer).sort(byPriority))).toEqual(expected);
    expect(labels(shuffled(fromServer).sort(byQueuePriority))).toEqual(expected);
  });
});
