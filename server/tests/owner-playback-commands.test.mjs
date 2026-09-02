// 신청곡 재생 명령 계층 검증.
//
// 훅에서 분리하기 전에는 React를 띄우지 않고는 이 로직에 닿을 수 없었다.
// 이제 의존성을 주입해 브라우저 없이 직접 검증한다. 훅 테스트(owner)가 배선을
// 보고, 여기서는 판단 순서와 실패 경로를 본다.
//
// 계약: docs/PLAYBACK.md#재생-리더와-시작-확인
import { describe, it, expect, vi } from 'vitest';
import { createPlaybackCommands } from '../../owner/src/pages/dashboard/playbackCommands.mjs';

const PLAYING = 'playing';
const ACCEPTED = 'accepted';
const PENDING = 'pending';

function rec(overrides = {}) {
  return {
    id: 'rec-1',
    video_id: 'vid-1',
    status: PENDING,
    filter_status: 'accepted',
    votes: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(overrides = {}) {
  const state = {
    list: overrides.list || [],
    leader: overrides.leader ?? true,
    available: overrides.available ?? true,
    autoAccept: overrides.autoAccept ?? true,
  };
  const electronApi = {
    playRec: vi.fn(async () => ({ ok: true })),
    endRec: vi.fn(),
    supportsPlayRecAck: true,
    ...overrides.electronApi,
  };
  const updateRec = overrides.updateRec
    || vi.fn(async (_slug, id, status) => ({ ...rec({ id }), status }));
  const stored = [];
  const replaced = [];

  const commands = createPlaybackCommands({
    getSlug: () => 'test-cafe',
    getElectronApi: () => electronApi,
    updateRec,
    isPlaybackAvailable: () => state.available,
    isLeader: () => state.leader,
    isAutoAcceptOn: () => state.autoAccept,
    getRecommendations: () => state.list,
    storeRecommendation: (updated) => {
      stored.push(updated);
      state.list = state.list.map(item => (item.id === updated.id ? updated : item));
    },
    replaceRecommendations: (snapshot) => {
      replaced.push(snapshot);
      state.list = snapshot;
    },
  });

  return { commands, electronApi, updateRec, state, stored, replaced };
}

describe('startPlaying', () => {
  it('리더가 아니면 Electron을 건드리지 않는다', async () => {
    const { commands, electronApi, updateRec } = setup({ leader: false });
    expect(await commands.startPlaying(rec())).toBeNull();
    expect(electronApi.playRec).not.toHaveBeenCalled();
    expect(updateRec).not.toHaveBeenCalled();
  });

  it('Electron 재생 채널이 없으면 시작하지 않는다', async () => {
    const { commands, updateRec } = setup({ available: false });
    expect(await commands.startPlaying(rec())).toBeNull();
    expect(updateRec).not.toHaveBeenCalled();
  });

  it('이미 재생 중인 곡이 있으면 새 곡을 시작하지 않는다', async () => {
    const { commands, electronApi } = setup({ list: [rec({ id: 'a', status: PLAYING })] });
    expect(await commands.startPlaying(rec({ id: 'b' }))).toBeNull();
    expect(electronApi.playRec).not.toHaveBeenCalled();
  });

  it('Electron이 navigation을 거절하면 DB를 바꾸지 않는다', async () => {
    const { commands, updateRec } = setup({
      electronApi: { playRec: vi.fn(async () => ({ ok: false, error: 'URL 거절' })) },
    });
    await expect(commands.startPlaying(rec())).rejects.toThrow('URL 거절');
    expect(updateRec).not.toHaveBeenCalled();
  });

  it('DB 갱신이 실패하면 플레이어를 되돌리고 오류를 전파한다', async () => {
    const { commands, electronApi } = setup({
      updateRec: vi.fn(async () => { throw new Error('DB 실패'); }),
    });
    await expect(commands.startPlaying(rec())).rejects.toThrow('DB 실패');
    expect(electronApi.endRec).toHaveBeenCalled();
  });

  it('성공하면 playing으로 바꾸고 반영한다', async () => {
    const { commands, stored } = setup({ list: [rec()] });
    const played = await commands.startPlaying(rec());
    expect(played.status).toBe(PLAYING);
    expect(stored).toHaveLength(1);
  });
});

describe('playNextOrStop', () => {
  it('accepted가 있으면 우선순위 1순위를 재생한다', async () => {
    const older = rec({ id: 'old', status: ACCEPTED, created_at: '2026-01-01T00:00:00.000Z' });
    const newer = rec({ id: 'new', status: ACCEPTED, created_at: '2026-01-02T00:00:00.000Z' });
    const { commands, electronApi } = setup({ list: [newer, older] });
    await commands.playNextOrStop([newer, older]);
    expect(electronApi.playRec).toHaveBeenCalledTimes(1);
  });

  it('accepted가 없고 자동수락이 켜져 있으면 통과 pending을 승격해 재생한다', async () => {
    const { commands, updateRec, electronApi } = setup({ list: [rec()] });
    await commands.playNextOrStop([rec()]);
    expect(updateRec).toHaveBeenCalledWith('test-cafe', 'rec-1', ACCEPTED);
    expect(electronApi.playRec).toHaveBeenCalled();
  });

  it('자동수락이 꺼져 있으면 pending을 승격하지 않고 BGM으로 돌아간다', async () => {
    const { commands, updateRec, electronApi } = setup({ list: [rec()], autoAccept: false });
    await commands.playNextOrStop([rec()]);
    expect(updateRec).not.toHaveBeenCalled();
    expect(electronApi.endRec).toHaveBeenCalled();
  });

  it('필터를 거치지 않은 곡은 승격 대상이 아니다', async () => {
    const skipped = rec({ filter_status: 'skipped' });
    const { commands, updateRec, electronApi } = setup({ list: [skipped] });
    await commands.playNextOrStop([skipped]);
    expect(updateRec).not.toHaveBeenCalled();
    expect(electronApi.endRec).toHaveBeenCalled();
  });

  it('재생할 곡이 없으면 BGM으로 복귀한다', async () => {
    const { commands, electronApi } = setup();
    await commands.playNextOrStop([]);
    expect(electronApi.endRec).toHaveBeenCalled();
  });
});

describe('drainPendingAndPlay', () => {
  it('리더가 아니면 아무것도 하지 않는다', async () => {
    const { commands, updateRec } = setup({ leader: false, list: [rec()] });
    await commands.drainPendingAndPlay();
    expect(updateRec).not.toHaveBeenCalled();
  });

  it('통과 pending을 모두 승격한 뒤 첫 곡만 재생한다', async () => {
    const list = [rec({ id: 'a' }), rec({ id: 'b' }), rec({ id: 'c' })];
    const { commands, updateRec, electronApi } = setup({ list });
    await commands.drainPendingAndPlay(list);
    expect(updateRec.mock.calls.filter(([, , status]) => status === ACCEPTED)).toHaveLength(3);
    expect(electronApi.playRec).toHaveBeenCalledTimes(1);
  });

  it('일부 승격이 실패해도 나머지로 진행한다', async () => {
    const list = [rec({ id: 'a' }), rec({ id: 'b' })];
    const updateRec = vi.fn(async (_slug, id, status) => {
      if (id === 'a' && status === ACCEPTED) throw new Error('네트워크');
      return { ...rec({ id }), status };
    });
    const { commands, electronApi } = setup({ list, updateRec });
    await commands.drainPendingAndPlay(list);
    expect(electronApi.playRec).toHaveBeenCalledTimes(1);
  });

  it('이미 재생 중이면 승격만 하고 새로 시작하지 않는다', async () => {
    const list = [rec({ id: 'playing', status: PLAYING }), rec({ id: 'pending' })];
    const { commands, updateRec, electronApi } = setup({ list });
    await commands.drainPendingAndPlay(list);
    expect(updateRec).toHaveBeenCalledWith('test-cafe', 'pending', ACCEPTED);
    expect(electronApi.playRec).not.toHaveBeenCalled();
  });
});
