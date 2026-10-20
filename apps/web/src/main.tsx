import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../brandbook/assets/tokens.css';
import './foundation.css';

// Temporary BASE-01 entry point. FE-01 replaces it with the shared app shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <p>Рядом</p>
      <h1>Основа приложения подготовлена</h1>
      <p>Это проверка сборки. Пользовательские экраны и операции ещё не реализованы.</p>
    </main>
  </StrictMode>,
);
