// 재생 리더 역할 통보와 고아 playing 복구.
//
// 훅에 있을 때는 세 조각의 상태(진행 중 플래그, ACK 유실 대비 snapshot,
// 재시도 타이머)가 useEffect 클로저 변수로 흩어져 있어 흐름을 따라가기
// 어려웠다. 여기서는 한 객체 안에 모아 수명주기를 분명히 한다.
//
// 이 파일이 지키는 두 실패 모드:
//   - 과잉 복구: renderer reload마다 재생 중인 곡을 accepted로 되돌려 음악이 끊긴다
//   - 미복구: 서버에 고아 playing이 남아 다음 곡이 영영 시작되지 않는다
//
// 계약: docs/PLAYBACK.md#재생-리더와-시작-확인
import { REC_STATUS } from '../../constants/recommendationStatus';
import { acknowledgePlaybackRecovery } from './playbackRecovery.mjs';
import { markPlaybackSessionRecovered, needsPlaybackStateReset } from './playbackSession.mjs';

const RETRY_DELAY_MS = 2000;

/**
 * @param {object} deps
 * @param {object} deps.socket
 * @param {() => string} deps.getSlug
 * @param {() => object|undefined} deps.getElectronApi
 * @param {(slug: string) => Promise<{recommendations: object[], is_accepting: boolean}>} deps.getRecommendations
 * @param {(slug: string, id: string, status: string) => Promise<object>} deps.updateRec
 * @param {() => Promise<object|null>} deps.getCafeSettings  마운트 시 시작한 getMe 결과
 * @param {(isLeader: boolean) => void} deps.onLeaderChange
 * @param {(list: object[], isAccepting: boolean) => void} deps.onRecovered  복구 스냅샷 반영
 * @param {(list: object[]) => Promise<void>} deps.drainPendingAndPlay
 */
export function createPlaybackRoleFlow({
  socket,
  getSlug,
  getElectronApi,
  getRecommendations,
  updateRec,
  getCafeSettings,
  onLeaderChange,
  onRecovered,
  drainPendingAndPlay,
}) {
  let inProgress = false;
  let retryTimer = null;
  // ACK는 서버에 도착했는데 응답 패킷만 유실될 수 있다. 그때 다시 만들지 않고
  // 이어가려고 복구 결과를 들고 있는다.
  let pendingSnapshot = null;
  let pendingAutoAccept = false;

  /** Electron 메인의 실제 재생 모드. 구버전 preload에는 채널이 없다. */
  async function readPlaybackActive() {
    try {
      const isRecActive = getElectronApi()?.isRecActive;
      if (typeof isRecActive === 'function') return await isRecActive();
    } catch {
      // 채널이 없거나 응답이 없으면 세션 marker로 판단한다
    }
    return null;
  }

  function scheduleRetry() {
    // 서버의 recovery flag는 ACK 전까지 남아 있다. 일시적인 API·소켓 실패는
    // 같은 리더가 다시 역할을 요청해 복구를 재시도한다.
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (socket.connected) socket.emit('request_playback_role');
    }, RETRY_DELAY_MS);
  }

  /** ACK만 유실된 경우 — 이미 만든 스냅샷으로 마무리한다. */
  async function finishPendingRecovery() {
    const recovered = pendingSnapshot;
    const shouldDrain = pendingAutoAccept;
    pendingSnapshot = null;
    pendingAutoAccept = false;
    markPlaybackSessionRecovered(getSlug());
    if (shouldDrain) await drainPendingAndPlay(recovered);
  }

  async function recover(shouldRecover) {
    const slug = getSlug();
    const playbackActive = await readPlaybackActive();
    // 서버 프로세스만 재시작되면 registry는 새 리더로 보지만 Electron의
    // BrowserView와 sessionStorage는 계속 살아 있다. 같은 실행 세션은
    // DB playing을 되돌리지 않고 새 registry에 ACK만 보낸다.
    if (!needsPlaybackStateReset(slug, shouldRecover, { playbackActive })) {
      await acknowledgePlaybackRecovery(socket);
      markPlaybackSessionRecovered(slug);
      return;
    }

    const [{ recommendations: latest, is_accepting: isAccepting }, cafeSettings] = await Promise.all([
      getRecommendations(slug),
      getCafeSettings(),
    ]);
    // 새 리더 세션이 시작되었을 때만 서버에 남은 가짜 playing을 accepted로
    // 복구한다. follower·브라우저·renderer reload는 건드리지 않는다.
    const reset = await Promise.all(latest.map(rec => (rec.status === REC_STATUS.PLAYING
      ? updateRec(slug, rec.id, REC_STATUS.ACCEPTED)
      : rec)));
    onRecovered(reset, isAccepting);

    pendingSnapshot = reset;
    pendingAutoAccept = !!cafeSettings?.music_filter_enabled;
    await acknowledgePlaybackRecovery(socket);
    markPlaybackSessionRecovered(slug);
    pendingSnapshot = null;
    pendingAutoAccept = false;
    if (cafeSettings?.music_filter_enabled) await drainPendingAndPlay(reset);
  }

  return {
    /** socket 'playback_role' 핸들러. */
    async handleRole({ isLeader, shouldRecover }, { playbackAvailable }) {
      const next = playbackAvailable && isLeader === true;
      onLeaderChange(next);

      // 리더 승격 알림은 먼저 역할만 전달한다. 복구 필요 여부는 별도 요청으로
      // 확인하고, 실제 복구 성공 뒤 ACK로 완료한다.
      if (next && shouldRecover === undefined) {
        socket.emit('request_playback_role');
        return;
      }
      if (!next || inProgress) return;

      if (!shouldRecover) {
        if (pendingSnapshot) await finishPendingRecovery();
        else markPlaybackSessionRecovered(getSlug());
        return;
      }

      inProgress = true;
      try {
        await recover(shouldRecover);
      } catch (error) {
        console.error(error);
        scheduleRetry();
      } finally {
        inProgress = false;
      }
    },

    dispose() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    },
  };
}
