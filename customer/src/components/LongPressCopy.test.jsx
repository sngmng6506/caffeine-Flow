// 길게 눌러 곡 링크 복사.
//
// 손님 화면에서 가장 오해하기 쉬운 상호작용이다. 탭과 길게 누르기가 같은
// 요소를 공유하므로, 판정이 느슨해지면 곡을 누를 때마다 링크가 복사되고
// 엄격해지면 아무리 눌러도 복사되지 않는다. 둘 다 화면을 봐야만 드러나는
// 버그라 여기서 시간과 좌표를 직접 넣어 고정한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act, cleanup } from '@testing-library/react';
import LongPressCopy from './LongPressCopy';

const LONG_PRESS_MS = 550;

const copyMusicLink = vi.hoisted(() => vi.fn(async () => 'https://youtu.be/vid'));
vi.mock('../musicLink', () => ({ copyMusicLink }));

function press(element, overrides = {}) {
  fireEvent.pointerDown(element, { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...overrides });
}

function release(element, overrides = {}) {
  fireEvent.pointerUp(element, { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...overrides });
}

async function hold(ms = LONG_PRESS_MS) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

function setup(props = {}) {
  const onResult = vi.fn();
  render(
    <LongPressCopy videoId="vid" onResult={onResult} {...props}>
      <div data-testid="card">곡 카드</div>
    </LongPressCopy>,
  );
  return { onResult, card: screen.getByTestId('card') };
}

beforeEach(() => {
  vi.useFakeTimers();
  // vi.fn()은 config의 restoreMocks 대상이 아니다. 호출 기록이 다음 테스트로
  // 새면 "복사하지 않는다" 계열이 전부 거짓 실패한다.
  copyMusicLink.mockClear();
  copyMusicLink.mockResolvedValue('https://youtu.be/vid');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('복사 판정', () => {
  it('길게 누른 뒤 떼면 복사한다', async () => {
    const { onResult, card } = setup();
    press(card);
    await hold();
    await act(async () => { release(card); });

    expect(copyMusicLink).toHaveBeenCalledWith('vid');
    expect(onResult).toHaveBeenCalledWith({ type: 'success', message: '곡 링크를 복사했어요.' });
  });

  it('짧게 누르면 복사하지 않는다', async () => {
    const { card } = setup();
    press(card);
    await hold(LONG_PRESS_MS - 50);
    await act(async () => { release(card); });

    expect(copyMusicLink).not.toHaveBeenCalled();
  });

  it('누른 채 많이 움직이면 스크롤로 보고 취소한다', async () => {
    const { card } = setup();
    press(card);
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 0, clientY: 40 });
    await hold();
    await act(async () => { release(card); });

    expect(copyMusicLink).not.toHaveBeenCalled();
  });

  it('손떨림 정도로 움직이면 그대로 복사한다', async () => {
    const { card } = setup();
    press(card);
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 3, clientY: 4 });
    await hold();
    await act(async () => { release(card); });

    expect(copyMusicLink).toHaveBeenCalled();
  });

  it('다른 손가락의 이동은 현재 누름을 취소하지 않는다', async () => {
    const { card } = setup();
    press(card);
    fireEvent.pointerMove(card, { pointerId: 2, clientX: 0, clientY: 999 });
    await hold();
    await act(async () => { release(card); });

    expect(copyMusicLink).toHaveBeenCalled();
  });

  it('취소된 포인터는 복사하지 않는다', async () => {
    const { card } = setup();
    press(card);
    await hold();
    fireEvent.pointerCancel(card, { pointerId: 1 });
    await act(async () => { release(card); });

    expect(copyMusicLink).not.toHaveBeenCalled();
  });

  it('보조 버튼과 보조 포인터는 무시한다', async () => {
    const { card } = setup();
    press(card, { button: 2 });
    await hold();
    await act(async () => { release(card); });
    expect(copyMusicLink).not.toHaveBeenCalled();

    press(card, { isPrimary: false });
    await hold();
    await act(async () => { release(card); });
    expect(copyMusicLink).not.toHaveBeenCalled();
  });
});

describe('탭과의 충돌', () => {
  it('복사한 뒤의 click은 삼켜 카드가 함께 열리지 않게 한다', async () => {
    const onClick = vi.fn();
    const onResult = vi.fn();
    render(
      <LongPressCopy videoId="vid" onResult={onResult}>
        <div data-testid="card" onClick={onClick}>곡 카드</div>
      </LongPressCopy>,
    );
    const card = screen.getByTestId('card');

    press(card);
    await hold();
    await act(async () => { release(card); });
    fireEvent.click(card);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('복사하지 않은 탭은 그대로 통과시킨다', async () => {
    const onClick = vi.fn();
    render(
      <LongPressCopy videoId="vid">
        <div data-testid="card" onClick={onClick}>곡 카드</div>
      </LongPressCopy>,
    );
    const card = screen.getByTestId('card');

    press(card);
    await act(async () => { release(card); });
    fireEvent.click(card);

    expect(onClick).toHaveBeenCalled();
  });

  it('한 번 삼킨 뒤 다음 탭은 살린다', async () => {
    const onClick = vi.fn();
    render(
      <LongPressCopy videoId="vid">
        <div data-testid="card" onClick={onClick}>곡 카드</div>
      </LongPressCopy>,
    );
    const card = screen.getByTestId('card');

    press(card);
    await hold();
    await act(async () => { release(card); });
    fireEvent.click(card);
    fireEvent.click(card);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('자식 요소 존중', () => {
  it('안쪽 버튼을 누른 것은 복사로 보지 않는다', async () => {
    const onResult = vi.fn();
    render(
      <LongPressCopy videoId="vid" onResult={onResult}>
        <div data-testid="card"><button type="button">투표</button></div>
      </LongPressCopy>,
    );
    press(screen.getByRole('button'));
    await hold();
    await act(async () => { release(screen.getByRole('button')); });

    expect(copyMusicLink).not.toHaveBeenCalled();
  });

  it('자식의 원래 핸들러를 덮어쓰지 않는다', async () => {
    const onPointerDown = vi.fn();
    render(
      <LongPressCopy videoId="vid">
        <div data-testid="card" onPointerDown={onPointerDown}>곡 카드</div>
      </LongPressCopy>,
    );
    press(screen.getByTestId('card'));
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('disabled면 복사 표시도 동작도 없다', async () => {
    const { onResult, card } = setup({ disabled: true });
    expect(card.className).not.toContain('copyable-track');

    press(card);
    await hold();
    await act(async () => { release(card); });
    expect(copyMusicLink).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('복사 실패', () => {
  it('실패해도 화면을 죽이지 않고 안내만 바꾼다', async () => {
    copyMusicLink.mockRejectedValueOnce(new Error('copy_failed'));
    const { onResult, card } = setup();

    press(card);
    await hold();
    await act(async () => { release(card); });

    expect(onResult).toHaveBeenCalledWith({
      type: 'error',
      message: '링크를 복사하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  });
});
