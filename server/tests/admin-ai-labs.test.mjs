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
  });

  it('필터 실험실은 관리자 세션과 관리자 API만 사용한다', () => {
    const app = read('music-filter-lab/app.js');
    const html = read('music-filter-lab/index.html');
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    expect(app).toContain(`/admin/music-filter/models`);
    expect(app).toContain(`/admin/music-filter/test`);
    expect(app).not.toContain(`localStorage.getItem('token')`);
    expect(html).not.toContain(`id='token'`);
  });

  it('라벨링 랩은 통합 큐를 읽고 기존 검수 API로 저장한다', () => {
    const app = read('music-labeling-lab/app.js');
    expect(app).toContain(`/admin/music-filter-reviews?view=`);
    expect(app).toContain('/admin/cafes/${item.cafe_id}/music-filter-audit/${item.id}/review');
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
  });
});
