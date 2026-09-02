// 신청곡 재생 명령 계층.
//
// 훅 안에 있던 startPlaying / playNextOrStop / drainPendingAndPlay를 옮겼다.
// 셋 다 "리더인가", "이미 재생 중인가", "AI 통과곡인가"를 판단해 Electron과
// 서버 상태를 같은 순서로 움직이는 코드라, React 상태 관리와 섞여 있을 이유가
// 없다. 의존성을 인자로 받으므로 브라우저 없이 단독 테스트할 수 있다.
//
// 계약: docs/PLAYBACK.md#재생-리더와-시작-확인
//       docs/AI_CHANGE_GUARDRAILS.md#app-boundary-contract
import { REC_STATUS } from '../../constants/recommendationStatus';
import { byPriority, isAutoAcceptEligible } from './queuePolicy';
import { requestElectronPlayback } from './playbackBridge.mjs';
import { runPlaybackTransition } from './playbackTransition.mjs';

/**
 * @param {object} deps
 * @param {() => string} deps.getSlug              현재 카페 slug (slug는 변경 가능하다)
 * @param {() => object|undefined} deps.getElectronApi
 * @param {(slug: string, id: string, status: string) => Promise<object>} deps.updateRec
 * @param {() => boolean} deps.isPlaybackAvailable  Electron 재생 채널 존재 여부
 * @param {() => boolean} deps.isLeader             이 화면이 재생 리더인가
 * @param {() => boolean} deps.isAutoAcceptOn       AI 자동수락이 켜져 있는가
 * @param {() => object[]} deps.getRecommendations  최신 스냅샷
 * @param {(rec: object) => void} deps.storeRecommendation  한 곡 갱신 반영
 * @param {(list: object[]) => void} deps.replaceRecommendations 스냅샷 통째 반영
 */
export function createPlaybackCommands({
  getSlug,
  getElectronApi,
  updateRec,
  isPlaybackAvailable,
  isLeader,
  isAutoAcceptOn,
  getRecommendations,
  storeRecommendation,
  replaceRecommendations,
}) {
  /**
   * 소켓 add 이벤트와 수동 수락이 겹쳐도 renderer에서는 한 번에 한 곡만
   * playing 전환을 요청한다. 서버도 카페 잠금으로 최종 불변식을 보장한다.
   */
  async function startPlaying(rec) {
    if (!isPlaybackAvailable() || !isLeader()) return null;
    return runPlaybackTransition(async () => {
      if (getRecommendations().some(item => item.status === REC_STATUS.PLAYING)) return null;
      // Electron이 URL 검증과 화면 navigation을 받아들인 뒤에만 DB를
      // playing으로 바꾼다. 서버 갱신 실패 시 실제 플레이어도 즉시 복구한다.
      const result = await requestElectronPlayback(getElectronApi(), rec.video_id);
      if (!result?.ok) throw new Error(result?.error || '신청곡 재생을 시작하지 못했습니다.');
      try {
        const playing = await updateRec(getSlug(), rec.id, REC_STATUS.PLAYING);
        storeRecommendation(playing);
        return playing;
      } catch (error) {
        getElectronApi()?.endRec();
        throw error;
      }
    });
  }

  /**
   * 다음 곡 재생 또는 정지.
   * 1) accepted 1순위 재생
   * 2) AI 필터가 켜져 있으면 필터 통과 pending 1순위를 승격해 재생
   * 3) 모두 없으면 BGM으로 복귀
   */
  async function playNextOrStop(snapshot) {
    const nextAccepted = snapshot.filter(rec => rec.status === REC_STATUS.ACCEPTED).sort(byPriority)[0];
    if (nextAccepted) {
      try {
        await startPlaying(nextAccepted);
      } catch (error) {
        console.error(error);
      }
      return;
    }

    if (isAutoAcceptOn()) {
      const nextPending = snapshot.filter(isAutoAcceptEligible).sort(byPriority)[0];
      if (nextPending) {
        try {
          const accepted = await updateRec(getSlug(), nextPending.id, REC_STATUS.ACCEPTED);
          storeRecommendation(accepted);
          await startPlaying(accepted);
        } catch (error) {
          console.error(error);
        }
        return;
      }
    }

    getElectronApi()?.endRec();
  }

  /** AI 통과 pending을 accepted로 승격하고, 재생 중인 곡이 없으면 첫 곡을 시작한다. */
  async function drainPendingAndPlay(base) {
    if (!isLeader()) return;
    let snapshot = base || getRecommendations();
    const pendingList = snapshot.filter(isAutoAcceptEligible);

    if (pendingList.length > 0) {
      const updates = (await Promise.all(
        pendingList.map(rec => updateRec(getSlug(), rec.id, REC_STATUS.ACCEPTED).catch(() => null)),
      )).filter(Boolean);
      const updateMap = Object.fromEntries(updates.map(update => [update.id, update]));
      snapshot = snapshot.map(rec => updateMap[rec.id] || rec);
      replaceRecommendations(snapshot);
    }

    if (snapshot.some(rec => rec.status === REC_STATUS.PLAYING)) return;

    const firstAccepted = snapshot.filter(rec => rec.status === REC_STATUS.ACCEPTED).sort(byPriority)[0];
    if (!firstAccepted) return;

    try {
      await startPlaying(firstAccepted);
    } catch (error) {
      console.error(error);
    }
  }

  return { startPlaying, playNextOrStop, drainPendingAndPlay };
}
