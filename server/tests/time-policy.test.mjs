import { describe, it, expect } from 'vitest';
import {
  TIMEZONE,
  KST_OFFSET_HOURS,
  MS_PER_DAY,
  KST_OFFSET_MS,
  ACTIVE_QUEUE_LOOKBACK_DAYS,
  MUSIC_FILTER_STATS_LOOKBACK_DAYS,
  STATS_PATTERN_LOOKBACK_DAYS,
} from '../src/constants/time-policy.js';
import {
  CANONICAL_VIDEO_ID_SQL,
  KST_HOUR_SQL,
  KST_DOW_SQL,
  KST_VISIT_DATE_SQL,
  kstDatePartSql,
} from '../src/db/sql-fragments.js';

describe('KST 시간 정책 계약', () => {
  it('서비스 시간대는 Asia/Seoul이다', () => {
    expect(TIMEZONE).toBe('Asia/Seoul');
    expect(KST_OFFSET_HOURS).toBe(9);
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000);
  });

  it('최근 7일 계열 정책은 오늘 포함 6일 전 KST 자정부터 시작한다', () => {
    expect(ACTIVE_QUEUE_LOOKBACK_DAYS).toBe(6);
    expect(MUSIC_FILTER_STATS_LOOKBACK_DAYS).toBe(6);
  });

  it('시간대/요일 패턴 통계는 기존 동작대로 30일 전 KST 자정부터 집계한다', () => {
    expect(STATS_PATTERN_LOOKBACK_DAYS).toBe(30);
  });
});

describe('DB SQL fragment 계약', () => {
  it('canonical video id SQL은 Knex ? placeholder를 피하기 위해 chr(63)을 사용한다', () => {
    expect(CANONICAL_VIDEO_ID_SQL).toBe('split_part(video_id, chr(63), 1)');
    expect(CANONICAL_VIDEO_ID_SQL).not.toContain("'?' ");
  });

  it('KST date_part SQL은 Asia/Seoul 기준이다', () => {
    expect(KST_HOUR_SQL).toBe("date_part('hour', requested_at AT TIME ZONE 'Asia/Seoul')::int");
    expect(KST_DOW_SQL).toBe("date_part('dow', requested_at AT TIME ZONE 'Asia/Seoul')::int");
    expect(KST_VISIT_DATE_SQL).toBe("(now() AT TIME ZONE 'Asia/Seoul')::date");
  });

  it('지원하지 않는 date_part는 허용하지 않는다', () => {
    expect(() => kstDatePartSql('month')).toThrow();
  });
});
