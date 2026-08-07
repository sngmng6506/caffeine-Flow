import { REC_STATUS } from '../../constants/recommendationStatus';
import { FILTER_STATUS } from '../../constants/musicFilterStatus';

export function byPriority(a, b) {
  return b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at);
}

// AI 필터를 실제 통과한 pending 곡만 자동수락 대상으로 본다.
// 필터 OFF에서 들어온 skipped 곡은 사장님 수동 판단 대상으로 남긴다.
export function isAutoAcceptEligible(rec) {
  return rec.status === REC_STATUS.PENDING && rec.filter_status === FILTER_STATUS.ACCEPTED;
}
