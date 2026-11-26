export type Id = string;
export type Cents = number;
export type ISODate = string; // YYYY-MM-DD

export interface Base { id: Id; updatedAt: number; deviceId: string; deleted: boolean }

export interface Entry extends Base {
  kind: 'expense' | 'income';
  date: ISODate;
  amountIncl: Cents;
  amountExcl?: Cents;
  tax?: Cents;
  categoryId: Id;
  supplierId?: Id;
  channel?: string;
  method: 'cash' | 'card' | 'transfer' | 'other';
  status?: 'paid' | 'credit';
  dueDate?: ISODate;
  note?: string;
  photoId?: Id;
  createdBy: string;
}

export interface Payment extends Base {
  entryId: Id;
  date: ISODate;
  amount: Cents;
  method: Entry['method'];
  createdBy: string;
}

export interface Supplier extends Base { name: string; defaultCategoryId?: Id }

export interface Category extends Base { name: string; kind: 'expense' | 'income'; archived: boolean }

export interface SharedSettings extends Base {
  restaurantName: string;
  country: string;
  currency: string;
  billLanguage: 'fra' | 'eng';
  taxView: 'incl' | 'excl';
  photoBackup: boolean;
  ocrMode: 'device' | 'gemini';
}
