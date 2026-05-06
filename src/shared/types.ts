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

/** v0.5.0: a Collection is one of two kinds. */
export type CollectionKind = 'trains' | 'coins';

export type LookupKind = 'type' | 'scale' | 'condition';

export interface LookupRow {
  id: number;
  kind: CollectionKind;
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
  kind: CollectionKind;
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
  collection_id: number | null;
  type: ItemType;
  name: string;
  // Train fields (sparse for coins)
  manufacturer: string | null;
  model_number: string | null;
  scale: Scale | null;
  road_name: string | null;
  era: string | null;
  // Coin fields (sparse for trains)
  country: string | null;
  face_value: number | null;
  denomination: string | null;
  mint_mark: string | null;
  quantity: number;
  // Shared
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

export type ItemMediaType = 'photo' | 'video';

export interface ItemPhoto {
  id: number;
  item_id: number;
  file_path: string;
  caption: string | null;
  display_order: number;
  is_primary: 0 | 1;
  /** 'photo' (image) or 'video'. Stored on the same table — historic
   *  name kept for back-compat. Defaults to 'photo' on legacy rows. */
  media_type: ItemMediaType;
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

// ─── eBay integration ────────────────────────────────────────

export interface EbayConfig {
  configured: boolean;
  marketplace?: string;  // e.g. 'EBAY_US'
}

export interface EbayPrice {
  value: string;
  currency: string;
}

export interface EbayListing {
  itemId: string;
  title: string;
  price: EbayPrice;
  imageUrl: string | null;
  condition: string | null;
  url: string;
  buyingOption: string;       // e.g. 'FIXED_PRICE', 'AUCTION'
  endTime?: string;            // ISO timestamp for auctions
  seller: {
    username: string;
    feedbackPercentage?: string;
  };
}

export interface EbaySearchResult {
  query: string;
  total: number;
  listings: EbayListing[];
  fetchedAt: string;
}


export type CollectionInput = Omit<Collection, 'id' | 'created_at' | 'updated_at'>;
export type TrainSetInput = Omit<TrainSet, 'id' | 'created_at' | 'updated_at'>;
export type ItemInput = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

/** Result of an xlsx → items import. */
export interface ImportResult {
  inserted: number;
  skipped: number;
  warnings: string[];
  /** True when the user dismissed the file picker. */
  canceled?: boolean;
}

/** Result of a Backup → .zip operation. */
export interface BackupResult {
  zipPath: string;
  sizeBytes: number;
  itemCount: number;
  photoCount: number;
  videoCount: number;
  durationMs: number;
  /** True when the user dismissed the file picker. */
  canceled?: boolean;
}

export interface ItemFilter {
  setId?: number;
  collectionId?: number;
  collectionKind?: CollectionKind;
  type?: ItemType;
  scale?: Scale;
  country?: string;
  search?: string;
  /** When set, restricts to items with or without any photos. */
  hasPhotos?: boolean;
}

export interface RoundhouseApi {
  collections: {
    list(kind?: CollectionKind): Promise<Collection[]>;
    get(id: number): Promise<Collection | null>;
    getByKind(kind: CollectionKind): Promise<Collection | null>;
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
    onMenuPaste(cb: () => void): void;
  };
  clipboard: {
    readText(): Promise<string>;
  };
  diag: {
    log(msg: string): Promise<void>;
    openLog(): Promise<string>;
    reset(): Promise<void>;
    path(): Promise<string>;
  };
  ebay: {
    status(): Promise<EbayConfig>;
    searchForItem(itemId: number, opts?: { force?: boolean }): Promise<EbaySearchResult>;
    openListing(url: string): Promise<void>;
  };
  lookups: {
    list(kind: LookupKind, collectionKind: CollectionKind): Promise<LookupRow[]>;
    create(kind: LookupKind, collectionKind: CollectionKind, input: LookupInput): Promise<LookupRow>;
    update(kind: LookupKind, id: number, patch: Partial<LookupInput>): Promise<LookupRow>;
    delete(kind: LookupKind, id: number): Promise<void>;
    reorder(kind: LookupKind, orderedIds: number[]): Promise<void>;
  };
  files: {
    saveCsv(defaultName: string, content: string): Promise<string | null>;
    showInFolder(filePath: string): Promise<void>;
  };
  import: {
    fromXlsx(kind: CollectionKind): Promise<ImportResult>;
  };
  backup: {
    create(): Promise<BackupResult>;
  };
  print: {
    current(): Promise<void>;
  };
}
