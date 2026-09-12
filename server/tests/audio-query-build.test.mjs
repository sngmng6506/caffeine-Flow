// 실제 코드가 만드는 쿼리를 DB 없이 검사한다.
// 잘못된 빌더 호출(Knex 3에 없는 .of 등)은 통합 테스트에서만 드러나는데, 그건
// Postgres가 있어야 돌아 로컬에서 건너뛰기 쉽다. 그 사이에 배포까지 간 적이 있다.
import { describe, it, expect } from 'vitest';
import Knex from 'knex';
import { readFileSync } from 'node:fs';
process.env.NODE_ENV = 'test';
const jobs = (await import('../src/features/audio-analysis/jobs.js')).default;
const runs = (await import('../src/features/audio-analysis/runs.js')).default;
const normalization = (await import('../src/features/audio-analysis/normalization.js')).default;
const contract = (await import('../src/constants/audio-pipeline.json', { with: { type: 'json' } })).default;
const metadata = (await import('../src/constants/maest-metadata.json', { with: { type: 'json' } })).default;
const { DISCOVERY_SOURCES: sources } = (await import('../src/constants/audio-discovery.js')).default;

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

// 길이 검사는 통합 테스트에서만 돌아 픽스처를 잘못 흔들어도 로컬에서 드러나지 않는다.
// 원본 검증은 DB를 쓰지 않으므로 여기서 직접 부른다.
describe('두 디코더가 잰 길이의 허용 오차', () => {
  const count = 3, duration = count * 15.008;
  const scores = Array(519).fill(0.3);
  const classes = metadata.classes;
  const build = () => ({
    result: { model_name: 'essentia-maest', model_version: `test+${contract.model_version}`,
      source_reference: 'https://www.youtube.com/watch?v=abcdefghijk',
      features: { duration_seconds: duration, sample_rate: 16000 } },
    run: { schema_version: 1, pipeline_mode: 'MAEST_ONLY', sources_used: ['discogs-maest-30s-pw-519l-2'],
      maest_model_version: 'discogs-maest-30s-pw-519l-2', model_sha256: contract.model_sha256,
      audio_source_url: 'https://www.youtube.com/watch?v=abcdefghijk', audio_local_path: null,
      audio_sha256: 'b'.repeat(64), audio_duration_sec: duration, audio_sample_rate: 16000,
      audio_llm_raw: null, normalized: normalization.normalize({ classes, mean: scores }),
      maest_raw: { classes, mean: scores, max: scores, essentia_version: 'test',
        segments: Array.from({ length: count }, (_, i) => ({ start_sec: i * 15.008,
          end_sec: Math.min(duration, (i + 2) * 15.008), scores })),
        settings: { sample_rate: 16000, patch_size: 1876, patch_hop_size: 938, frame_hop: 256,
          last_patch_mode: 'repeat', resample_quality: 4, output: 'PartitionedCall/Identity_13', batch_size: 1 } } },
  });
  const verdict = (mutate) => {
    const body = build();
    mutate(body);
    return runs.validateRun(body.run, body.result).error ? 'reject' : 'accept';
  };

  it('그대로면 통과한다', () => {
    expect(verdict(() => {})).toBe('accept');
  });

  it('Essentia가 다시 잰 값이 몇 밀리초 어긋나도 받는다', () => {
    // 리샘플러가 꼬리에 몇 샘플을 더한다. 실측 2.93ms 차이로 정상 결과가 거절된 적이 있다.
    expect(verdict((b) => { b.result.features.duration_seconds += 0.003; })).toBe('accept');
  });

  it('길이가 통째로 다르면 거절한다', () => {
    expect(verdict((b) => { b.result.features.duration_seconds += 5; })).toBe('reject');
  });

  it('구간 경계의 기준인 audio_duration_sec을 흔들면 거절한다', () => {
    // 구간 end_sec이 이 값으로 계산되므로 여기를 바꾸면 구간 검사가 깨진다.
    // 픽스처를 흔들 때 이쪽을 건드리면 안 된다는 것을 고정해 둔다.
    expect(verdict((b) => { b.run.audio_duration_sec += 0.003; })).toBe('reject');
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

// 소스 이름을 바꿀 때마다 쓰는 곳을 하나씩 빠뜨렸다. 통합 테스트와 Lab은 Postgres나
// 브라우저가 있어야 돌아 로컬에서 건너뛰기 쉬운데, 이름이 안 맞으면 서버가 400을
// 내고 그때서야 드러난다. 이름 대조는 DB 없이 할 수 있다.
describe('수집 소스 이름', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

  it('Lab 드롭다운이 상수와 같은 값을 쓴다', () => {
    const html = read('music-labeling-lab/index.html');
    const picked = [...html.matchAll(/<option value='([a-z_]+)'>/g)].map((m) => m[1]);
    const collect = picked.filter((v) => sources.includes(v) || v.includes('_'));
    for (const source of sources) {
      expect(collect, `${source}가 Lab에 없다`).toContain(source);
    }
  });

  it('워커가 모든 소스를 처리한다', () => {
    const worker = read('audio-analysis-worker/discover.py');
    for (const source of sources) {
      expect(worker, `discover.py가 ${source}를 모른다`).toContain(`'${source}'`);
    }
  });

  it('통합 테스트가 상수에 없는 소스로 성공을 기대하지 않는다', () => {
    // 이름을 바꾸면 validateRequest가 400을 내고, 그 실패는 Postgres가 있어야
    // 드러난다. 400을 기대하는 줄은 일부러 잘못된 이름을 쓰므로 뺀다.
    const integration = read('server/tests/audio-discovery.test.mjs');
    const happy = integration.split('\n')
      .filter((line) => !line.includes('toBe(400)'))
      .flatMap((line) => [...line.matchAll(/source: '([a-z_]+)'/g)].map((m) => m[1]));
    for (const source of new Set(happy)) {
      expect(sources, `${source}는 DISCOVERY_SOURCES에 없다`).toContain(source);
    }
  });
});
