import { initRouter } from './router'
import './global'

console.log('Roundhouse renderer ready. API present:', typeof window.roundhouse !== 'undefined')

initRouter()
