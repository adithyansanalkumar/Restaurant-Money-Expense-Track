import type { Entry } from '../domain/types';

// Tiny module-level hand-off: History sets the entry, the 'add' route opens it.
let editing: Partial<Entry> | null = null;
export const getEditing = (): Partial<Entry> | null => editing;
export const setEditing = (e: Partial<Entry> | null) => { editing = e; };
