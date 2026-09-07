import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import * as storage from './lib/storage';
import * as landscapes from './lib/landscapes';
import './styles.css';

// Ułatwienia dla testów w przeglądarce (tylko tryb deweloperski)
if (import.meta.env.DEV) {
  const w = window as unknown as { __mneme?: typeof useStore; __mnemeStorage?: typeof storage; __mnemeLandscapes?: typeof landscapes };
  w.__mneme = useStore;
  w.__mnemeStorage = storage;
  w.__mnemeLandscapes = landscapes;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
