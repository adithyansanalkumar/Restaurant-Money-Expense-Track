import type { Entry } from '../domain/types';

// Tiny module-level hand-off: History sets the entry, the 'add' route opens it.
let editing: Entry | null = null;
export const getEditing = () => editing;
export const setEditing = (e: Entry | null) => { editing = e; };
