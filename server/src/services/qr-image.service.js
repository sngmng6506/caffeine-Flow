const axios = require('axios');
const {
  QR_CUSTOMER_URL_MAX_LENGTH,
  QR_IMAGE_MAX_BYTES,
} = require('../constants/limits');

const QR_IMAGE_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/';

function createQrImageRequest(customerUrl) {
  const value = String(customerUrl || '').trim();
  if (!value || value.length > QR_CUSTOMER_URL_MAX_LENGTH) {
    throw new Error('QR 주소가 올바르지 않습니다');
  }
  return {
    url: QR_IMAGE_ENDPOINT,
    options: {
      params: {
        data: value,
        size: '600x600',
        margin: 20,
        format: 'jpg',
      },
      responseType: 'arraybuffer',
      timeout: 10_000,
      maxContentLength: QR_IMAGE_MAX_BYTES,
      maxBodyLength: QR_IMAGE_MAX_BYTES,
    },
  };
}

async function getQrImage(customerUrl) {
  const request = createQrImageRequest(customerUrl);
  const response = await axios.get(request.url, request.options);
  const contentType = String(response.headers?.['content-type'] || '').split(';')[0].trim();
  if (!['image/jpeg', 'image/png'].includes(contentType)) {
    throw new Error('QR 이미지 응답이 올바르지 않습니다');
  }
  const image = Buffer.from(response.data);
  if (image.length === 0 || image.length > QR_IMAGE_MAX_BYTES) {
    throw new Error('QR 이미지 크기가 올바르지 않습니다');
  }
  return { image, contentType };
}

module.exports = { createQrImageRequest, getQrImage };
