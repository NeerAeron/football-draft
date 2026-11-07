/**
 * ErrorBoundary — catches render errors below it and shows a recoverable panel instead of a
 * blank screen. The shell wraps every screen in one (keyed by route, so navigating resets it).
 *   fallback(error, reset)  optional custom renderer
 *   onError(error)          optional reporter
 * The error is also logged with console.error (the browser smoke test fails on it — good).
 */
import { Component, html } from '../lib/html.js';
import { EmptyState } from './empty-state.js';
import { Button } from './button.js';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = () => this.setState({ error: null });
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error('[ui] screen crashed:', error);
    this.props.onError?.(error);
  }
  render({ children, fallback }, { error }) {
    if (!error) return children;
    if (fallback) return fallback(error, this.reset);
    return html`<div class="container-narrow screen">
      <${EmptyState}
        icon="triangle-alert"
        tone="coral"
        size="lg"
        title="Something broke"
        message=${html`This screen hit an error. Your saved data is safe.<br /><code
            class="error-detail"
            >${String(error?.message || error)}</code
          >`}
        action=${html`<div class="cluster" style="justify-content:center">
          <${Button} variant="primary" icon="rotate-ccw" onClick=${this.reset}>Try again<//>
          <${Button} variant="secondary" href="#/" icon="house" onClick=${this.reset}>Home<//>
        </div>`}
      />
    </div>`;
  }
}
