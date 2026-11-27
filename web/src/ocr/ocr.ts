/** Read a bill photo on the device. tesseract.js is loaded lazily (separate chunk) and fetches
 *  its worker, core and language data from its default CDN on first use (cached by the service worker). */
export async function readBill(blob: Blob, lang: 'fra' | 'eng'): Promise<string> {
  const { default: Tesseract } = await import('tesseract.js');
  const { data } = await Tesseract.recognize(blob, lang);
  return data.text;
}
