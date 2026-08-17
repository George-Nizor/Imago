import { Component, type ErrorInfo, type ReactNode } from 'react';
import { diagnosticCode, reportDiagnostic } from '../lib/diagnostics';
import { Icon } from './Icon';

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportDiagnostic('ui', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-screen" role="alert" aria-labelledby="fatal-title">
        <img src="./imago-mark.svg" alt="" />
        <span className="eyebrow">Recovery</span>
        <h1 id="fatal-title">The editor hit an unexpected problem.</h1>
        <p>Reload Imago to start a fresh local session. No files were uploaded.</p>
        <code>{diagnosticCode('ui')}</code>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          <Icon name="reload" /> Reload Imago
        </button>
      </main>
    );
  }
}
