import { useEffect } from 'react';
import { StartScreen } from './components/StartScreen';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { CanvasStage } from './components/CanvasStage';
import { LayersPanel } from './components/LayersPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { useEditorStore } from './store/editorStore';
import { useBrandStore } from './store/brandStore';
import { DropImportOverlay, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePrefetchModels } from './hooks/usePrefetchModels';
import './styles.css';

function useDeepLinkWorkflow() {
  const brand = useBrandStore((s) => s.brand);
  const doc = useEditorStore((s) => s.doc);

  useEffect(() => {
    if (doc) return;
    const apply = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash.includes('=') ? hash : `workflow=${hash}`);
      const workflow = params.get('workflow');
      if (workflow === 'thumbnail') {
        useEditorStore.getState().newThumbnail(brand);
      } else if (workflow === 'title-card') {
        useEditorStore.getState().newTitleCard(brand);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [brand, doc]);
}

export default function App() {
  const doc = useEditorStore((s) => s.doc);
  useKeyboardShortcuts();
  usePrefetchModels();
  useDeepLinkWorkflow();

  if (!doc) {
    return <StartScreen />;
  }

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <Toolbar />
        <CanvasStage />
        <aside className="right-rail">
          <LayersPanel />
          <PropertiesPanel />
        </aside>
      </div>
      <DropImportOverlay />
    </div>
  );
}
