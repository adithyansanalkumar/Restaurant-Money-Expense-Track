import { afterEach, expect, test, vi } from 'vitest';
import { shareOrDownload } from './share';

const blob = new Blob(['x']);
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });

test('shares files when canShare says yes', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  expect(await shareOrDownload(blob, 'a.xlsx')).toBe('shared');
  expect(share.mock.calls[0][0].files[0].name).toBe('a.xlsx');
});

test('cancelling the share sheet is not an error', async () => {
  Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })), configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  expect(await shareOrDownload(blob, 'a.xlsx')).toBe('shared');
});

test('falls back to a download link', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await shareOrDownload(blob, 'a.xlsx')).toBe('downloaded');
  expect(click).toHaveBeenCalled();
});
