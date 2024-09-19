import urljoin from 'url-join';
import { Buffer } from 'buffer';

export const imageUrlToBase64 = async (url: string) => {
  const urlWithTransformation = url.startsWith('https://ucarecdn.com/')
    ? urljoin(url, '/-/preview/')
    : url;

  try {
    const response = await fetch(urlWithTransformation, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image. Status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type')?.split(';')[0];
    const base64String = buffer.toString('base64');
    const prefix = `data:${contentType};base64,`;
    return `${prefix}${base64String}`;
  } catch (error) {
    return '';
  }
};
