import { contextBridge, ipcRenderer } from 'electron'
import type {
  RoundhouseApi,
  Collection, CollectionInput,
  TrainSet, TrainSetInput,
  Item, ItemInput, ItemFilter,
  ItemPhoto,
  FeedbackStatus, FeedbackIssue, FeedbackInput,
  LookupKind, LookupRow, LookupInput,
  EbayConfig, EbaySearchResult
} from '@shared/types'

const api: RoundhouseApi = {
  collections: {
    list: () => ipcRenderer.invoke('collections:list') as Promise<Collection[]>,
    get: (id) => ipcRenderer.invoke('collections:get', id) as Promise<Collection | null>,
    create: (input: CollectionInput) => ipcRenderer.invoke('collections:create', input) as Promise<Collection>,
    update: (id, patch) => ipcRenderer.invoke('collections:update', id, patch) as Promise<Collection>,
    delete: (id) => ipcRenderer.invoke('collections:delete', id) as Promise<void>
  },
  sets: {
    list: (collectionId?: number) => ipcRenderer.invoke('sets:list', collectionId) as Promise<TrainSet[]>,
    get: (id) => ipcRenderer.invoke('sets:get', id) as Promise<TrainSet | null>,
    create: (input: TrainSetInput) => ipcRenderer.invoke('sets:create', input) as Promise<TrainSet>,
    update: (id, patch) => ipcRenderer.invoke('sets:update', id, patch) as Promise<TrainSet>,
    delete: (id) => ipcRenderer.invoke('sets:delete', id) as Promise<void>
  },
  items: {
    list: (filter?: ItemFilter) => ipcRenderer.invoke('items:list', filter) as Promise<Item[]>,
    get: (id) => ipcRenderer.invoke('items:get', id) as Promise<Item | null>,
    create: (input: ItemInput) => ipcRenderer.invoke('items:create', input) as Promise<Item>,
    update: (id, patch) => ipcRenderer.invoke('items:update', id, patch) as Promise<Item>,
    delete: (id) => ipcRenderer.invoke('items:delete', id) as Promise<void>,
    distinctValues: (field) => ipcRenderer.invoke('items:distinctValues', field) as Promise<string[]>
  },
  photos: {
    listForItem: (itemId) => ipcRenderer.invoke('photos:listForItem', itemId) as Promise<ItemPhoto[]>,
    add: (itemId) => ipcRenderer.invoke('photos:add', itemId) as Promise<ItemPhoto[]>,
    delete: (id) => ipcRenderer.invoke('photos:delete', id) as Promise<void>,
    setCaption: (id, caption) => ipcRenderer.invoke('photos:setCaption', id, caption) as Promise<ItemPhoto>,
    setPrimary: (itemId, photoId) => ipcRenderer.invoke('photos:setPrimary', itemId, photoId) as Promise<void>,
    reorder: (itemId, orderedIds) => ipcRenderer.invoke('photos:reorder', itemId, orderedIds) as Promise<void>,
    url: (filePath: string) => `app://photo/${filePath}`
  },
  feedback: {
    status: () => ipcRenderer.invoke('feedback:status') as Promise<FeedbackStatus>,
    list: () => ipcRenderer.invoke('feedback:list') as Promise<FeedbackIssue[]>,
    create: (input: FeedbackInput) => ipcRenderer.invoke('feedback:create', input) as Promise<FeedbackIssue>
  },
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>,
    onReleaseNotesRequested: (cb: () => void) => {
      ipcRenderer.on('roundhouse:show-release-notes', () => cb())
    },
    onMenuPaste: (cb: () => void) => {
      ipcRenderer.on('roundhouse:menu-paste', () => cb())
    }
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText') as Promise<string>
  },
  diag: {
    log: (msg: string) => ipcRenderer.invoke('diag:log', msg) as Promise<void>,
    openLog: () => ipcRenderer.invoke('diag:openLog') as Promise<string>,
    reset: () => ipcRenderer.invoke('diag:reset') as Promise<void>,
    path: () => ipcRenderer.invoke('diag:path') as Promise<string>
  },
  ebay: {
    status: () => ipcRenderer.invoke('ebay:status') as Promise<EbayConfig>,
    searchForItem: (itemId: number, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('ebay:searchForItem', itemId, opts) as Promise<EbaySearchResult>,
    openListing: (url: string) => ipcRenderer.invoke('ebay:openListing', url) as Promise<void>
  },
  lookups: {
    list: (kind: LookupKind) => ipcRenderer.invoke('lookups:list', kind) as Promise<LookupRow[]>,
    create: (kind: LookupKind, input: LookupInput) => ipcRenderer.invoke('lookups:create', kind, input) as Promise<LookupRow>,
    update: (kind: LookupKind, id: number, patch: Partial<LookupInput>) => ipcRenderer.invoke('lookups:update', kind, id, patch) as Promise<LookupRow>,
    delete: (kind: LookupKind, id: number) => ipcRenderer.invoke('lookups:delete', kind, id) as Promise<void>
  },
  files: {
    saveCsv: (defaultName: string, content: string) =>
      ipcRenderer.invoke('files:saveCsv', defaultName, content) as Promise<string | null>
  },
  print: {
    current: () => ipcRenderer.invoke('print:current') as Promise<void>
  }
}

contextBridge.exposeInMainWorld('roundhouse', api)
