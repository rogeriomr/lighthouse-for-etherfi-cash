import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// fontes servidas pelo próprio site (nada de Google Fonts: nenhuma requisição a terceiros); o navegador só baixa
// os subconjuntos de caracteres que a página usa (unicode-range) e mostra o texto antes (font-display: swap)
import '@fontsource-variable/inter/wght.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import './styles/app.css';
import App from './App';
import { RootErrorBoundary } from './components/ErrorBoundary';

// a raiz inteira (idioma, dados e telas) fica dentro de uma rede: storage corrompido ou bloqueado não dá tela branca
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
