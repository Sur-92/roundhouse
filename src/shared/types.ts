// Domain types and the IPC API surface.
// Imported by main, preload, and renderer — keep zero runtime side effects.

export type ItemType =
  | 'locomotive'
  | 'rolling_stock'
  | 'building'
  | 'figurine'
  | 'track'
  | 'scenery'
  | 'accessory'
  | 'other';

export type Scale = 'Z' | 'N' | 'HO' | 'OO' | 'S' | 'O' | 'G' | 'other';

export type Condition =
  | 'new'
  | 'like_new'
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'parts';

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainSet {
  id: number;
  collection_id: number;
  name: string;
  description: string | null;
  scale: Scale | null;
  manufacturer: string | null;
  era: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: number;
  set_id: number | null;
  type: ItemType;
  name: string;
  manufacturer: string | null;
  model_number: string | null;
  scale: Scale | null;
  road_name: string | null;
  era: string | null;
  year: number | null;
  condition: Condition | null;
  original_box: 0 | 1 | null;
  purchase_date: string | null;
  purchase_price_cents: number | null;
  current_value_cents: number | null;
  storage_location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemPhoto {
  id: number;
  item_id: number;
  file_path: string;
  caption: string | null;
  display_order: number;
  created_at: string;
}

export type CollectionInput = Omit<Collection, 'id' | 'created_at' | 'updated_at'>;
export type TrainSetInput = Omit<TrainSet, 'id' | 'created_at' | 'updated_at'>;
export type ItemInput = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

export interface ItemFilter {
  setId?: number;
  collectionId?: number;
  type?: ItemType;
  scale?: Scale;
  search?: string;
}

export interface RoundhouseApi {
  collections: {
    list(): Promise<Collection[]>;
    get(id: number): Promise<Collection | null>;
    create(input: CollectionInput): Promise<Collection>;
    update(id: number, input: Partial<CollectionInput>): Promise<Collection>;
    delete(id: number): Promise<void>;
  };
  sets: {
    list(collectionId?: number): Promise<TrainSet[]>;
    get(id: number): Promise<TrainSet | null>;
    create(input: TrainSetInput): Promise<TrainSet>;
    update(id: number, input: Partial<TrainSetInput>): Promise<TrainSet>;
    delete(id: number): Promise<void>;
  };
  items: {
    list(filter?: ItemFilter): Promise<Item[]>;
    get(id: number): Promise<Item | null>;
    create(input: ItemInput): Promise<Item>;
    update(id: number, input: Partial<ItemInput>): Promise<Item>;
    delete(id: number): Promise<void>;
  };
  photos: {
    listForItem(itemId: number): Promise<ItemPhoto[]>;
    add(itemId: number): Promise<ItemPhoto[]>;
    delete(id: number): Promise<void>;
    url(filePath: string): string;
  };
}
