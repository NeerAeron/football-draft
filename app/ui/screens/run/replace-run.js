// One question before a new World Cup draft replaces a run in progress: every way to start
// one (the setup's Start, "Play again" with ?go=1, a challenge link) goes through ask().
//
//   const replace = useReplaceRun();
//   html`<${Button} onClick=${() => replace.ask(start)}>Start<//> ${replace.dialog}`;
//
// No run in progress: start() runs at once. Otherwise the dialog asks; "Start new" forgets the
// run (clearRun) and then starts, "Keep run" does nothing.
import { useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { Button } from '../../components/button.js';
import { Modal } from '../../components/modal.js';
import { runInProgress, clearRun } from '../../lib/run-store.js';

export function useReplaceRun() {
  const [next, setNext] = useState(null);
  const ask = start => {
    if (runInProgress()) setNext(() => start);
    else start();
  };
  const keep = () => setNext(null);
  const replace = () => {
    const start = next;
    setNext(null);
    clearRun();
    start?.();
  };
  const dialog = html`<${Modal}
    open=${!!next}
    onClose=${keep}
    title="Start a new World Cup?"
    description="Your run in progress will be lost."
    size="sm"
    class="replace-run"
    footer=${html`<${Button} variant="ghost" onClick=${keep} data-testid="keep-run">Keep run<//>
      <${Button} variant="danger" onClick=${replace} data-testid="replace-run">Start new<//>`}
  />`;
  return { ask, dialog, asking: !!next };
}
