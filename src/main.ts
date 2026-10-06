import { storage } from './core/storage';

// the store reads saved progress at import time, so native storage must hydrate first
await storage.init();
await import('./boot');
