import { ensureFolder, uploadBlob } from '../sync/drive';
import { ledgerParentFolder } from '../sync/share';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Saves an export to the "Exports" subfolder of the ledger folder (owner) or of this account's own folder (joined). */
export async function saveExportToDrive(blob: Blob, filename: string): Promise<void> {
  const parent = await ensureFolder('Exports', await ledgerParentFolder());
  await uploadBlob(filename, parent, blob, XLSX_MIME);
}
