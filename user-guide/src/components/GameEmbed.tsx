import { useState, useRef, useEffect } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import styles from './GameEmbed.module.css';

// Three-state hero: shows the game logo + Play Now, swaps to a live
// canvas when clicked, then loads the WebGL bundle (built separately
// by client-webgl/build.ts and copied into static/game/main.js by
// scripts/copy-assets.mjs). Boot mode is in-tab observer because
// we don't set window.GAME_SERVER_HOST — see
// memory/client-webgl/standalone-observer.md.
//
// Canvas styling mirrors client-webgl/rescale-variant-1.html: native
// 1330x750 backbuffer, browser scales it to fit the section while
// preserving aspect ratio (letterbox on mismatched viewports).

type State = 'idle' | 'launching' | 'running';

function GameEmbedInner() {
  const [state, setState] = useState<State>('idle');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== 'launching') return;
    // The bundle's main.ts grabs document.getElementById('game') at
    // module-eval time; the canvas is already in the DOM (rendered
    // before this effect fires). We inject a <script type="module">
    // rather than calling import() so webpack doesn't try to follow
    // the URL into the esbuild-built game bundle (which uses top-level
    // await and isn't part of Docusaurus's compile graph).
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/game/main.js';
    s.onload = () => setState('running');
    s.onerror = () => {
      // Failure modes: 404 on the bundle (build:client-gl never ran),
      // WebGL2 unavailable (main.ts handles that itself by replacing
      // body innerHTML during its own boot path).
      // eslint-disable-next-line no-console
      console.error('[GameEmbed] failed to load /game/main.js');
    };
    document.body.appendChild(s);
    return () => {
      // Don't remove on unmount — once main.ts has run, the module is
      // resident regardless. Cleanup is a no-op.
    };
  }, [state]);

  // Body class drives navbar hiding (CSS rule in src/css/custom.css)
  // while the game owns the screen. Cleanup ensures we restore chrome
  // even if the component unmounts mid-game.
  useEffect(() => {
    const showCanvas = state !== 'idle';
    if (showCanvas) document.body.classList.add('game-running');
    else document.body.classList.remove('game-running');
    return () => document.body.classList.remove('game-running');
  }, [state]);

  const onPlay = (): void => {
    if (state === 'idle') setState('launching');
  };

  // Exit: simplest reliable teardown is a full reload. The game module
  // loaded by the script tag has running timers / canvas refs / WebGL
  // state with no exposed shutdown hook, so trying to "soft-exit" by
  // unmounting the canvas would leave the game ticking against a
  // detached DOM. Reload trades a flash for a clean slate.
  const onExit = (): void => {
    document.body.classList.remove('game-running');
    window.location.reload();
  };

  const showCanvas = state !== 'idle';

  return (
    <div
      ref={containerRef}
      className={`${styles.hero} ${showCanvas ? styles.heroRunning : ''}`}
    >
      {!showCanvas && (
        <div className={styles.idleStack}>
          <img
            className={styles.logo}
            src="/assets/ui/game-logo.png"
            alt="Companions Online"
          />
          <button type="button" className={styles.playBtn} onClick={onPlay}>
            Play Now
          </button>
        </div>
      )}
      {showCanvas && (
        <>
          <canvas id="game" tabIndex={0} className={styles.canvas} />
          <button
            type="button"
            className={styles.exitBtn}
            onClick={onExit}
            aria-label="Exit game"
            title="Exit game"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

// Wrap in BrowserOnly: the dynamic import + window/canvas access don't
// belong in SSR. The fallback keeps the section's visual height stable
// during hydration so the page doesn't jump.
export default function GameEmbed() {
  return (
    <BrowserOnly fallback={<div className={styles.hero} />}>
      {() => <GameEmbedInner />}
    </BrowserOnly>
  );
}
