import { describe, expect, it } from 'vitest';
import qrImageService from '../src/services/qr-image.service.js';

const { createQrImageRequest } = qrImageService;

describe('QR image request', () => {
  it('고정된 HTTPS QR 서비스와 제한된 이미지 옵션만 사용한다', () => {
    const request = createQrImageRequest('https://example.com/cafe');
    expect(request.url).toBe('https://api.qrserver.com/v1/create-qr-code/');
    expect(request.options).toMatchObject({
      params: {
        data: 'https://example.com/cafe',
        size: '600x600',
        margin: 20,
        format: 'jpg',
      },
      responseType: 'arraybuffer',
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
    });
  });

  it('비어 있거나 지나치게 긴 주소를 거절한다', () => {
    expect(() => createQrImageRequest('')).toThrow();
    expect(() => createQrImageRequest('x'.repeat(2049))).toThrow();
  });
});
