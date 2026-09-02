// 손님 기기 식별.
//
// visitor ID는 신청 취소 권한의 근거다. 재방문마다 새로 발급되면 손님이
// 자기 신청을 취소하지 못하고, 반대로 표시용 별명이 visitor ID 자리에
// 들어가면 서로 다른 손님이 같은 신원을 갖는다. 두 값은 끝까지 분리한다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceName, getVisitorId } from './deviceName';

beforeEach(() => localStorage.clear());

describe('getVisitorId', () => {
  it('한 번 발급하면 계속 같은 값을 준다', () => {
    const first = getVisitorId();
    expect(getVisitorId()).toBe(first);
  });

  it('저장된 값이 있으면 새로 만들지 않는다', () => {
    localStorage.setItem('cf_visitor_id', 'existing-id');
    expect(getVisitorId()).toBe('existing-id');
  });

  it('DB visitor_id 컬럼에 들어가는 UUID 형식이다', () => {
    expect(getVisitorId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('getDeviceName', () => {
  it('한 번 만든 별명을 유지한다', () => {
    const first = getDeviceName();
    expect(getDeviceName()).toBe(first);
  });

  it('별명과 visitor ID는 다른 키에 따로 저장한다', () => {
    getDeviceName();
    getVisitorId();
    expect(localStorage.getItem('cf_device_name')).not.toBe(localStorage.getItem('cf_visitor_id'));
  });

  it('표시용 별명이지 신원이 아니다 — 서로 다른 기기에서 겹칠 수 있다', () => {
    const names = new Set();
    for (let i = 0; i < 50; i += 1) {
      localStorage.clear();
      names.add(getDeviceName());
    }
    // 조합 수가 유한하므로 유일성을 기대하지 않는다. 취소 권한은 visitor ID로만 판단한다.
    expect(names.size).toBeGreaterThan(1);
  });
});
