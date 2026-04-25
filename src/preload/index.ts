import { contextBridge, ipcRenderer } from 'electron'
import type {
  RoundhouseApi,
  Collection, CollectionInput,
  TrainSet, TrainSetInput,
  Item, ItemInput, ItemFilter,
  ItemPhoto
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
    delete: (id) => ipcRenderer.invoke('items:delete', id) as Promise<void>
  },
  photos: {
    listForItem: (itemId) => ipcRenderer.invoke('photos:listForItem', itemId) as Promise<ItemPhoto[]>,
    add: (itemId) => ipcRenderer.invoke('photos:add', itemId) as Promise<ItemPhoto[]>,
    delete: (id) => ipcRenderer.invoke('photos:delete', id) as Promise<void>,
    url: (filePath: string) => `app://photo/${filePath}`
  }
}

contextBridge.exposeInMainWorld('roundhouse', api)
