import { copyMusicLink } from './musicLink';

// 복사 결과를 손님에게 보여 줄 문구로 바꾼다.
//
// 복사는 링크 버튼 탭이 유일한 경로다. iOS는 길게 누른 뒤의 pointerup에 사용자
// 활성화를 주지 않아 두 복사 API가 모두 거부되지만(실기기 확인) 버튼 탭에는
// 활성화가 있어 같은 기기에서도 복사가 된다.
export async function copyLinkForResult(videoId) {
  try {
    await copyMusicLink(videoId);
    return { type: 'success', message: '곡 링크를 복사했어요.' };
  } catch {
    return { type: 'error', message: '링크를 복사하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
}
