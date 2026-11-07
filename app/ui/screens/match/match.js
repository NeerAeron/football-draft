// #/match — the match screen. Plays the request handed over with requestMatch()
// (lib/match-store.js, docs/ui-match.md): pre-kickoff → Key Moments / Full / Instant →
// full-time report. `?demo=1` builds a request from two real club XIs.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { useStore } from '../../lib/store.js';
import { navigate } from '../../lib/router.js';
import { loadCatalog } from '../../../services/catalog.js';
import { Button, Card, EmptyState, Modal, Skeleton } from '../../components/index.js';
import { matchStore, requestMatch, rematch } from '../../lib/match-store.js';
import { MatchController } from './controller.js';
import { PreMatch } from './prematch.js';
import { LiveMatch } from './live.js';
import { ResultView } from './result.js';
import { TacticsSheet } from './tactics.js';
import { buildDemoRequest } from './demo.js';

function useDemo(query) {
  const key = query.demo ? JSON.stringify(query) : null;
  const [state, setState] = useState(key ? 'loading' : 'off');
  useEffect(() => {
    if (!key) return setState('off');
    let live = true;
    setState('loading');
    loadCatalog()
      .then(catalog => {
        if (!live) return;
        requestMatch(buildDemoRequest(catalog, query), { go: false });
        setState('ready');
      })
      .catch(error => {
        console.error('[match] demo failed', error);
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

function sidesOf(request) {
  return request.meta.sides.map((s, i) => ({
    ...s,
    name: s.name || request.config.teams[i].name,
    short: s.short || request.config.teams[i].short,
  }));
}

function NoMatch() {
  return html`<div class="screen container-narrow match-none" data-screen="match">
    <${Card} variant="raised" padding="lg">
      <${EmptyState}
        icon="ball"
        tone="volt"
        size="lg"
        level=${1}
        title="No match lined up"
        message="Draft a team or pick an exhibition to play a match."
        action=${html`<div class="cluster">
          <${Button} variant="primary" icon="house" href="#/">Home<//>
          <${Button} variant="secondary" icon="play" href="#/match?demo=1">Watch a demo<//>
        </div>`}
      />
    <//>
  </div>`;
}

function Playing({ request, onExit }) {
  const controller = useMemo(() => new MatchController(request), [request]);
  useEffect(() => () => controller.dispose(), [controller]);
  const phase = useStore(controller.hud, s => s.phase);
  const result = useStore(controller.hud, s => s.result);
  const [tacticsFor, setTacticsFor] = useState(null);
  const tactics = useStore(controller.hud, s => s.tactics);
  const access = useStore(controller.hud, s => s.access);
  const teams = useMemo(() => sidesOf(request), [request]);
  const openTactics = t => {
    controller.refreshTactics();
    setTacticsFor(t);
  };
  const sheet = html`<${TacticsSheet}
    open=${tacticsFor != null}
    onClose=${() => setTacticsFor(null)}
    teams=${teams}
    tactics=${tactics}
    access=${access}
    userSides=${controller.userSides}
    onSet=${(t, k, v) => controller.setTactic(t, k, v)}
  />`;
  if (phase === 'finished' && result)
    return html`<${Finished} result=${result} controller=${controller} />`;
  if (phase === 'pre')
    return html`<${PreMatch}
        controller=${controller}
        onExit=${() => onExit(false)}
        onTactics=${openTactics}
      />${sheet}`;
  return html`<${LiveMatch}
      controller=${controller}
      teams=${teams}
      onExit=${() => onExit(true)}
      onTactics=${openTactics}
    />${sheet}`;
}

function Finished({ result, controller }) {
  const momentum = result.momentum || controller?.hud.get().momentum.samples || [];
  return html`<${ResultView}
    result=${result}
    momentum=${momentum}
    onContinue=${() => navigate(matchStore.get()?.request.meta.returnTo || '#/')}
    onRematch=${() => rematch()}
    onHome=${() => navigate('/')}
  />`;
}

export default function MatchScreen({ query = {} }) {
  const demo = useDemo(query);
  const state = useStore(matchStore);
  const [confirm, setConfirm] = useState(false);
  if (demo === 'loading')
    return html`<div class="screen match-screen" data-screen="match" aria-busy="true">
      <h1 class="visually-hidden">Loading match</h1>
      <div class="container">
        <${Skeleton} variant="rect" height=${320} label="Loading match" />
      </div>
    </div>`;
  if (demo === 'error' || !state?.request) return html`<${NoMatch} />`;
  const request = state.request;
  const leave = () => navigate(request.meta.returnTo || '#/');
  const body =
    state.status === 'done' && state.result
      ? html`<${Finished} result=${state.result} />`
      : html`<${Playing}
          key=${`${request.id}:${request.seed}`}
          request=${request}
          onExit=${midMatch => (midMatch ? setConfirm(true) : leave())}
        />`;
  return html`<div class="screen match-screen" data-screen="match">
    ${body}
    <${Modal}
      open=${confirm}
      onClose=${() => setConfirm(false)}
      title="Leave the match?"
      description="The match stops here and no result is saved. You can start it again from kick-off."
      size="sm"
      footer=${html`<${Button} variant="ghost" onClick=${() => setConfirm(false)}>Keep watching<//>
        <${Button}
          variant="danger"
          onClick=${() => {
            setConfirm(false);
            leave();
          }}
          >Leave<//
        >`}
    />
  </div>`;
}
