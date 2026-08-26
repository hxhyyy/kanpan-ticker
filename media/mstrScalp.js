(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  let state = {
    loading: true,
    error: null,
    window: '1h',
    report: null,
  };

  function fmt(n) {
    if (n == null || !Number.isFinite(n)) return '-';
    return n.toFixed(2);
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function sideText(side) {
    if (side === 'long') return 'lo';
    if (side === 'short') return 'hi';
    return '--';
  }

  function toolbar(window, loading) {
    const wins = ['1h', '2h', '4h']
      .map((w) => {
        const cls = window === w ? 'link on' : 'link';
        return `<button class="${cls}" data-window="${w}">${w}</button>`;
      })
      .join(' · ');
    const tail = loading ? ' · …' : '';
    return `<div class="toolbar">${wins} · <button class="link" data-refresh>sync</button>${tail}</div>`;
  }

  function render() {
    const { loading, error, window, report } = state;
    const bar = toolbar(window, loading && !report);

    if (loading && !report) {
      root.innerHTML = `${bar}<pre class="block dim">loading…</pre>`;
      bindEvents();
      return;
    }

    if (error && !report) {
      root.innerHTML = `${bar}<pre class="block err">${error}</pre>`;
      bindEvents();
      return;
    }

    if (!report) {
      root.innerHTML = `${bar}<pre class="block dim">no data</pre>`;
      bindEvents();
      return;
    }

    const r = report;
    const a = r.action;
    const pos = r.range.positionPct;

    const lines = [
      `// mstr ${r.window} ${r.interval}`,
      `px ${fmt(r.mstrPrice)}  ${sideText(a.side)}  tgt ${fmt(r.targetMove)}`,
      `lo ${fmt(r.range.support)}  md ${fmt(r.range.mid)}  hi ${fmt(r.range.resistance)}`,
      `w ${fmt(r.range.width)}  atr ${fmt(r.range.atr)}  pos ${pos.toFixed(0)}%  in ${r.range.inRangePct.toFixed(0)}%`,
      `in ${fmt(a.entryZone[0])}~${fmt(a.entryZone[1])}  out ${fmt(a.takeProfit)} (+${fmt(a.expectedMove)})  sl ${fmt(a.stopLoss)}`,
      `btc ${fmt(r.btc.price)}  b ${r.btc.beta.toFixed(2)}  map ${fmt(r.btc.mappedSupport)}~${fmt(r.btc.mappedResistance)}`,
      `scr ${r.score}  ${r.scoreHint}`,
      `@ ${fmtTime(r.refreshedAt)}  px~2s  an~1m`,
    ];

    if (error) {
      lines.push(`! ${error}`);
    }

    root.innerHTML = `${bar}<pre class="block">${lines.join('\n')}</pre>`;
    bindEvents();
  }

  function bindEvents() {
    root.querySelectorAll('[data-window]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.getAttribute('data-window');
        if (w) vscode.postMessage({ type: 'setWindow', window: w });
      });
    });
    const refreshBtn = root.querySelector('[data-refresh]');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'update') {
      state = {
        loading: !!msg.loading,
        error: msg.error || null,
        window: msg.window || '1h',
        report: msg.report || null,
      };
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
