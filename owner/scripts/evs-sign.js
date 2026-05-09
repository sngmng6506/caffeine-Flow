const { execSync } = require('child_process');

// electron-builder afterPack 훅 — Windows 빌드 후 CastLabs EVS 서명
// Windows는 electron-builder의 code-sign(signtool) 이후에 EVS 서명해야 함
exports.default = async function(context) {
  if (context.electronPlatformName !== 'win32') return;
  console.log('[EVS] Signing with CastLabs EVS:', context.appOutDir);
  try {
    execSync(`python -m castlabs_evs.vmp sign-pkg "${context.appOutDir}"`, { stdio: 'inherit' });
    console.log('[EVS] Signing complete');
  } catch (e) {
    console.error('[EVS] Signing failed — EVS 계정 로그인 여부 확인:', e.message);
    throw e;
  }
};
