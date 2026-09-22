import { copyMusicLink } from './musicLink';

// 길게 누르기와 복사 버튼이 같은 결과 문구를 쓴다.
//
// iOS는 길게 누른 뒤의 pointerup에 사용자 활성화를 주지 않아 두 복사 API가 모두
// 거부된다(실기기 확인). 그래서 복사 버튼이 기본 경로이고 길게 누르기는 보조다.
// 버튼 탭에는 활성화가 있어 같은 기기에서도 복사가 된다.
export async function copyLinkForResult(videoId) {
  try {
    await copyMusicLink(videoId);
    return { type: 'success', message: '곡 링크를 복사했어요.' };
  } catch (caught) {
    if (!caught?.link) {
      return { type: 'error', message: '링크를 복사하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    return {
      type: 'error',
      message: '이 브라우저에서는 복사가 막혀 있어요. 주소를 직접 선택해 주세요.',
      link: caught.link,
    };
  }
}
