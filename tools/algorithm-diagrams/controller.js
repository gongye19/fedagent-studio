/* Isolated playback adapter. The diagram is explanatory; it never runs a task. */
(() => {
  let playing = false;
  let visible = true;
  let elapsed = 0;
  let previous = 0;
  let frame = 0;
  const duration = JSON.parse(document.getElementById('live-config').textContent).canvas.duration;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function tick(now) {
    if (previous) elapsed += (now - previous) / 1000;
    previous = now;
    window.seek(elapsed % duration);
    frame = requestAnimationFrame(tick);
  }
  function update() {
    cancelAnimationFrame(frame);
    previous = 0;
    const active = playing && visible && !document.hidden && window.__ready;
    document.getElementById('stage').dataset.playing = String(Boolean(active));
    if (active) frame = requestAnimationFrame(tick);
  }
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'fedagent-diagram-control') return;
    playing = event.data.playing === true;
    visible = event.data.visible === true;
    update();
  });
  document.addEventListener('visibilitychange', update);
  reduced.addEventListener('change', () => { if (reduced.matches) { playing = false; update(); } });
  new ResizeObserver(() => dispatchEvent(new Event('resize'))).observe(document.documentElement);
  function ready() {
    if (!window.__ready || !document.documentElement.clientWidth || !document.documentElement.clientHeight) { requestAnimationFrame(ready); return; }
    dispatchEvent(new Event('resize'));
    // The existing geometry check only reads the rendered DOM.
    const problems = window.__check();
    const stage = document.getElementById('stage');
    stage.dataset.layoutProblems = JSON.stringify(problems);
    stage.dataset.ready = 'true';
    parent.postMessage({type: 'fedagent-diagram-ready', problems}, '*');
    update();
  }
  ready();
})();
