// Domain types and the IPC API surface.
// Imported by main, preload, and renderer — keep zero runtime side effects.

// As of v0.3.0 these are free-form strings. The dropdown options come
// from the item_types / item_scales / item_conditions lookup tables,
// which the user manages from the Settings page. Items still store
// raw string values; deleting a lookup row doesn't break existing
// items.
export type ItemType = string;
export type Scale = string;
export type Condition = string;

export type LookupKind = 'type' | 'scale' | 'condition';

export interface LookupRow {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_system: 0 | 1;
  created_at: string;
}

export interface LookupInput {
  value: string;
  label: string;
  sort_order?: number;
}

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
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from item_photos: relative path of the primary photo, if any. */
  primary_photo_path?: string | null;
}

export interface ItemPhoto {
  id: number;
  item_id: number;
  file_path: string;
  caption: string | null;
  display_order: number;
  is_primary: 0 | 1;
  created_at: string;
}


export type FeedbackCategory = 'bug' | 'feature' | 'question' | 'other';
export type FeedbackState = 'open' | 'closed';

export interface FeedbackStatus {
  configured: boolean;
  repo?: string;
  submitter?: string;
}

export interface FeedbackIssue {
  number: number;
  title: string;
  body: string;
  state: FeedbackState;
  category: FeedbackCategory;
  created_at: string;
  closed_at: string | null;
  url: string;
  comments: number;
}

export interface FeedbackInput {
  category: FeedbackCategory;
  title: string;
  body: string | null;
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
  /** When set, restricts to items with or without any photos. */
  hasPhotos?: boolean;
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
    distinctValues(field: 'type' | 'scale' | 'condition'): Promise<string[]>;
  };
  photos: {
    listForItem(itemId: number): Promise<ItemPhoto[]>;
    add(itemId: number): Promise<ItemPhoto[]>;
    delete(id: number): Promise<void>;
    setCaption(id: number, caption: string | null): Promise<ItemPhoto>;
    setPrimary(itemId: number, photoId: number): Promise<void>;
    reorder(itemId: number, orderedIds: number[]): Promise<void>;
    url(filePath: string): string;
  };
  feedback: {
    status(): Promise<FeedbackStatus>;
    list(): Promise<FeedbackIssue[]>;
    create(input: FeedbackInput): Promise<FeedbackIssue>;
  };
  app: {
    version(): Promise<string>;
    onReleaseNotesRequested(cb: () => void): void;
  };
  lookups: {
    list(kind: LookupKind): Promise<LookupRow[]>;
    create(kind: LookupKind, input: LookupInput): Promise<LookupRow>;
    update(kind: LookupKind, id: number, patch: Partial<LookupInput>): Promise<LookupRow>;
    delete(kind: LookupKind, id: number): Promise<void>;
  };
  files: {
    saveCsv(defaultName: string, content: string): Promise<string | null>;
  };
  print: {
    current(): Promise<void>;
  };
}
