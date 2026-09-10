// 실제 코드가 만드는 쿼리를 DB 없이 검사한다.
// 잘못된 빌더 호출(Knex 3에 없는 .of 등)은 통합 테스트에서만 드러나는데, 그건
// Postgres가 있어야 돌아 로컬에서 건너뛰기 쉽다. 그 사이에 배포까지 간 적이 있다.
import { describe, it, expect } from 'vitest';
import Knex from 'knex';
import { readFileSync } from 'node:fs';
process.env.NODE_ENV = 'test';
const jobs = (await import('../src/features/audio-analysis/jobs.js')).default;

const knex = Knex({ client: 'pg' });
const sql = () => jobs.rejectedJobsQuery(knex).toString();

describe('일괄 재분석 쿼리', () => {
  it('조립에 성공한다', () => {
    // .of('job')처럼 없는 메서드를 부르면 여기서 TypeError로 터진다.
    expect(() => sql()).not.toThrow();
  });

  it('작업 행만 잠근다', () => {
    // 인자를 빼면 조인한 라벨 행까지 잠겨, 재분석이 도는 동안 사람 판정 저장이 막힌다.
    expect(sql()).toContain('for update of "job"');
  });

  it('사람이 보증하지 않은 곡만, 처리 중이 아닌 것만 고른다', () => {
    const text = sql();
    expect(text).toContain(`in ('inaccurate', 'unclear')`);
    expect(text).toContain(`not "job"."status" = 'processing'`);
    expect(text).toContain(`in ('youtube', 'soundcloud')`);
    expect(text).toContain('"music_track_annotations"');
  });
});

describe('음향 분석 조회', () => {
  it('커넥션을 더 잡는 취소 방식을 쓰지 않는다', () => {
    // cancel: true는 취소 질의용 커넥션을 하나 더 요구한다. 풀이 붐비면 타임아웃
    // 처리 자체가 막혀, 막으려던 지연을 도리어 만든다.
    const source = readFileSync(new URL('../src/features/music-filter/track-analysis.js', import.meta.url), 'utf8');
    expect(source).toContain('.timeout(LOOKUP_TIMEOUT_MS)');
    expect(source).not.toContain('cancel: true');
  });
});
