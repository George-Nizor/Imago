import { lazy, Suspense, useEffect } from 'react';
import { StartScreen } from './components/StartScreen';
import { useEditorStore } from './store/editorStore';
import { useBrandStore } from './store/brandStore';
import { DropImportOverlay, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { StatusCenter } from './components/StatusCenter';
import { makeErrorNotice, reportDiagnostic } from './lib/diagnostics';
import { isImagoDocumentId, parseImagoDocumentEnvelope } from './lib/documentImport';
import './styles.css';

const Header = lazy(() => import('./components/Header').then((module) => ({ default: module.Header })));
const Toolbar = lazy(() => import('./components/Toolbar').then((module) => ({ default: module.Toolbar })));
const CanvasStage = lazy(() =>
  import('./components/CanvasStage').then((module) => ({ default: module.CanvasStage })),
);
const Filmstrip = lazy(() =>
  import('./components/Filmstrip').then((module) => ({ default: module.Filmstrip })),
);
const LayersPanel = lazy(() =>
  import('./components/LayersPanel').then((module) => ({ default: module.LayersPanel })),
);
const PropertiesPanel = lazy(() =>
  import('./components/PropertiesPanel').then((module) => ({ default: module.PropertiesPanel })),
);
const TemplateSlotsPanel = lazy(() =>
  import('./components/TemplateSlotsPanel').then((module) => ({
    default: module.TemplateSlotsPanel,
  })),
);

function useDeepLinkWorkflow() {
  const brand = useBrandStore((s) => s.brand);
  const doc = useEditorStore((s) => s.doc);

  useEffect(() => {
    if (doc) return;
    let disposed = false;
    const apply = async () => {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash.includes('=') ? hash : `workflow=${hash}`);
      const workflow = params.get('workflow');
      const handoff = params.get('handoff');
      try {
        if (handoff) {
          if (!isImagoDocumentId(handoff)) throw new Error('Invalid handoff ID');
          const response = await fetch(`/__imago_mcp/document/${encodeURIComponent(handoff)}`, {
            credentials: 'omit',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error('Handoff document unavailable');
          const payload = await response.json();
          if (disposed) return;
          useEditorStore.getState().loadDocument(parseImagoDocumentEnvelope(payload));
        } else if (workflow === 'thumbnail') {
          useEditorStore.getState().newThumbnail(brand);
        } else if (workflow === 'title-card') {
          useEditorStore.getState().newTitleCard(brand);
        }
      } catch (cause) {
        reportDiagnostic('ui', cause);
        useEditorStore
          .getState()
          .setNotice(makeErrorNotice('ui', 'The requested workflow could not be opened.'));
      }
      if (handoff || workflow === 'thumbnail' || workflow === 'title-card') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    };
    const onHashChange = () => void apply();
    void apply();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      disposed = true;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [brand, doc]);
}

export default function App() {
  const doc = useEditorStore((s) => s.doc);
  useKeyboardShortcuts();
  useDeepLinkWorkflow();

  if (!doc) {
    return (
      <>
        <StartScreen />
        <StatusCenter />
      </>
    );
  }

  return (
    <Suspense fallback={<EditorLoading />}>
      <div className="app">
        <Header />
        <div className="workspace">
          <Toolbar />
          <div className="stage-column">
            <CanvasStage />
            <Filmstrip />
          </div>
          <aside className="right-rail">
            <TemplateSlotsPanel />
            <LayersPanel />
            <PropertiesPanel />
          </aside>
        </div>
        <DropImportOverlay />
        <StatusCenter />
      </div>
    </Suspense>
  );
}

function EditorLoading() {
  return (
    <main className="editor-loading" role="status" aria-live="polite">
      <img src="./imago-mark.svg" alt="" />
      <span className="status-pulse" />
      <p>Preparing your composition…</p>
    </main>
  );
}
