export async function shareOrDownload(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'shared'; // user closed the sheet: not an error
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
