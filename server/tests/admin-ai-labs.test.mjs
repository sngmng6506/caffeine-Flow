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
    const reviewService = read('server/src/features/music-labeling/review.service.js');
    const nullableMigration = read('server/src/db/migrations/20260828090000_nullable_music_filter_metadata_sufficient.js');
    expect(app).toContain(`/admin/music-filter-reviews?view=`);
    expect(app).toContain('/admin/cafes/${item.cafe_id}/music-filter-audit/${item.id}/review');
    expect(app).toContain('/admin/music-filter-artist-labels?');
    expect(app).toContain('track_annotation');
    expect(app).toContain('audio_analysis');
    expect(app).toContain('renderAudioAnalysis');
    expect(app).toContain('applyAnalysisSuggestion');
    expect(app).toContain('기존 곡 라벨 불러옴');
    expect(app).toContain(`metadata_sufficient: item.metadata_sufficient ?? null`);
    expect(app).toContain(`setRadio('tempo_class', annotation.tempo_class)`);
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    expect(html).toContain('보컬 유형');
    expect(html).toContain('랩·말하기 위주');
    expect(html).not.toContain('노래와 랩이 섞임');
    expect(html).not.toContain('라벨 확신도');
    expect(html).toContain('Essentia 자동 분석');
    expect(html).not.toContain('콘텐츠 주의 요소');
    expect(html).not.toContain('선택 기준 도움말');
    expect(html).not.toContain('곡 버전');
    expect(html).not.toContain('기본 메타데이터만으로 판단 가능했나요?');
    expect(html).toContain('판단 당시 매장 정책');
    expect(html).toContain('AI 판단 결과');
    expect(html).toContain(`id='existingLabelStatus'`);
    expect(html).toContain('<h1>음악 라벨링</h1>');
    // 재생목록 제외는 라우트가 아니라 라벨링 서비스가 담당한다
    expect(reviewService).toContain(`builder.whereILike('recommendation.title', '%playlist%')`);
    expect(reviewService).toContain(`builder.whereLike('recommendation.title', '%플리%')`);
    expect(adminRoute).toContain(`metadataSufficient !== null`);
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient DROP NOT NULL');
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient SET NOT NULL');
  });

  it('자동 추천값을 폼에 미리 채우되 사람 라벨을 덮지 않는다', () => {
    const app = read('music-labeling-lab/app.js');
    const html = read('music-labeling-lab/index.html');

    // 기존 사람 라벨이 있으면 프리필 대신 그 값을 복원한다.
    expect(app).toContain('사람이 이미 고른 값이 자동 추천보다 우선한다');
    expect(app).toContain('filled = applySuggestion(suggestion)');
    expect(app).toContain('renderAutoBadges');
    // 자동으로 못 채운 칸은 사람이 고르도록 표시한다.
    expect(app).toContain(`badge.textContent = '직접 선택'`);
    expect(html).toContain(`data-auto-badge='vocal_type'`);
    expect(html).toContain(`data-auto-badge='genre_tags'`);
  });

  it('일괄 확정은 곡 라벨만 서버 판정으로 저장한다', () => {
    const app = read('music-labeling-lab/app.js');
    const html = read('music-labeling-lab/index.html');
    const adminRoute = read('server/src/routes/admin.js');
    const reviewService = read('server/src/features/music-labeling/review.service.js');

    expect(app).toContain('/admin/music-filter-reviews/bulk-confirm');
    expect(app).toContain('bulkCandidates');
    expect(html).toContain(`id='bulkPanel'`);
    expect(html).toContain('일괄 확정');

    // 화면 조건은 후보 선별용이고 자격은 서버가 다시 판정한다.
    expect(reviewService).toContain('buildBulkAnnotation');
    expect(reviewService).toContain('AUDIO_BULK_CONFIRM_MIN_CONFIDENCE');
    expect(reviewService).toContain(`reason: 'already_labeled'`);
    // 일괄 확정 경로가 매장 정책 판단을 만들지 않는다는 것은
    // integration.test.mjs가 실제 DB로 확인한다.
    expect(reviewService).toContain('매장 정책 판단(`music_filter_reviews`)은 건드리지 않는다');
    expect(adminRoute).toContain('bulk-confirm');
  });

  it('애매한 순 정렬과 훑기 단축키를 제공한다', () => {
    const app = read('music-labeling-lab/app.js');
    const html = read('music-labeling-lab/index.html');
    const reviewService = read('server/src/features/music-labeling/review.service.js');

    expect(html).toContain(`<option value='ambiguous'>애매한 순</option>`);
    expect(reviewService).toContain("'ambiguous'");
    expect(reviewService).toContain('min_confidence');
    expect(app).toContain(`key === 'j'`);
    expect(app).toContain(`event.key === 'Enter' && event.ctrlKey`);
    // 입력 중에는 단축키가 가로채지 않는다.
    expect(app).toContain(`event.target.closest('input, textarea, select')`);
  });
});
