import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('관리자 AI 랩 정적 계약', () => {
  it('운영자 콘솔에서 두 랩으로 이동한다', () => {
    const html = read('admin/index.html');
    expect(html).toContain(`href='/filter-lab'`);
    expect(html).toContain(`href='/labeling-lab'`);
    expect(html).toContain('필터 테스트');
    expect(html).toContain('음악 라벨링');
  });

  it('필터 테스트는 관리자 세션과 관리자 API만 사용한다', () => {
    const app = read('music-filter-lab/app.js');
    const html = read('music-filter-lab/index.html');
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    expect(app).toContain(`/admin/music-filter/models`);
    expect(app).toContain(`/admin/music-filter/test`);
    expect(app).not.toContain(`localStorage.getItem('token')`);
    expect(html).not.toContain(`id='token'`);
    expect(html).toContain('<h1>필터 테스트</h1>');
  });

  it('음악 라벨링은 통합 큐를 읽고 기존 검수 API로 저장한다', () => {
    const app = read('music-labeling-lab/app.js');
    const html = read('music-labeling-lab/index.html');
    const adminRoute = read('server/src/routes/admin.js');
    const nullableMigration = read('server/src/db/migrations/20260828090000_nullable_music_filter_metadata_sufficient.js');
    expect(app).toContain(`/admin/music-filter-reviews?view=`);
    expect(app).toContain('/admin/cafes/${item.cafe_id}/music-filter-audit/${item.id}/review');
    expect(app).toContain('/admin/music-filter-artist-labels?');
    expect(app).toContain('track_annotation');
    expect(app).toContain('기존 곡 라벨 불러옴');
    expect(app).toContain(`metadata_sufficient: item.metadata_sufficient ?? null`);
    expect(app).toContain(`setRadio('tempo_class', annotation.tempo_class)`);
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    expect(html).toContain('보컬 유형');
    expect(html).toContain('랩·말하기 위주');
    expect(html).not.toContain('노래와 랩이 섞임');
    expect(html).not.toContain('라벨 확신도');
    expect(html).not.toContain('에너지');
    expect(html).not.toContain('콘텐츠 주의 요소');
    expect(html).not.toContain('선택 기준 도움말');
    expect(html).not.toContain('곡 버전');
    expect(html).not.toContain('기본 메타데이터만으로 판단 가능했나요?');
    expect(html).toContain('판단 당시 매장 정책');
    expect(html).toContain('AI 판단 결과');
    expect(html).toContain(`id='existingLabelStatus'`);
    expect(html).toContain('<h1>음악 라벨링</h1>');
    expect(adminRoute).toContain(`builder.whereILike('recommendation.title', '%playlist%')`);
    expect(adminRoute).toContain(`builder.whereLike('recommendation.title', '%플리%')`);
    expect(adminRoute).toContain(`metadataSufficient !== null`);
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient DROP NOT NULL');
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient SET NOT NULL');
  });
});
