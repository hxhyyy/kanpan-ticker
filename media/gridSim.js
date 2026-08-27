(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  let state = {
    loading: false,
    error: null,
    params: null,
    result: null,
  };

  function fmt(n, d) {
    if (n == null || !Number.isFinite(n)) return '-';
    return Number(n).toFixed(d != null ? d : 2);
  }

  function fmtTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function readForm() {
    const g = (id) => document.getElementById(id);
    return {
      symbol: g('symbol')?.value || 'MSTRUSDT',
      direction: g('direction')?.value || 'neutral',
      lower: parseFloat(g('lower')?.value),
      upper: parseFloat(g('upper')?.value),
      gridCount: parseInt(g('gridCount')?.value, 10),
      gridType: g('gridType')?.value || 'arithmetic',
      investment: parseFloat(g('investment')?.value),
      leverage: parseFloat(g('leverage')?.value),
      feeRate: parseFloat(g('feeRate')?.value) / 100,
      days: parseInt(g('days')?.value, 10),
      maxDdPct: parseFloat(g('maxDdPct')?.value) || 20,
      stopLoss: g('stopLoss')?.value ? parseFloat(g('stopLoss').value) : undefined,
      takeProfit: g('takeProfit')?.value ? parseFloat(g('takeProfit').value) : undefined,
    };
  }

  function render() {
    const { loading, error, params, result } = state;
    const p = params || {
      symbol: 'MSTRUSDT',
      direction: 'neutral',
      lower: 123,
      upper: 127,
      gridCount: 30,
      gridType: 'arithmetic',
      investment: 1000,
      leverage: 3,
      feeRate: 0.0004,
      days: 5,
      maxDdPct: 20,
    };

    const feePct = ((p.feeRate || 0.0004) * 100).toFixed(3);

    let body = '';
    if (loading && !result) {
      body = '<pre class="block dim">running…</pre>';
    } else if (error && !result) {
      body = `<pre class="block err">${error}</pre>`;
    } else if (result) {
      const r = result;
      const b = r.backtest;
      const lines = [
        `// grid ${r.params.symbol} ${r.params.days}d 5m`,
        `px ${fmt(r.currentPrice)}  ppg ${(r.profitPerGridPct * 100).toFixed(3)}%  /grid ${fmt(r.perGridUsdt)}U`,
        `lo ${fmt(r.params.lower)}  hi ${fmt(r.params.upper)}  n=${r.params.gridCount}  ${r.params.gridType === 'arithmetic' ? 'arith' : 'geo'}`,
        `in ${fmt(r.oscillation.inRangePct, 0)}%  suit ${r.oscillation.suitable ? 'y' : 'n'}  ${r.oscillation.reason}`,
        `fills ${b.tradeCount}  net ${b.netProfitUsdt >= 0 ? '+' : ''}${fmt(b.netProfitUsdt)}U  roi ${b.netRoiPct >= 0 ? '+' : ''}${fmt(b.netRoiPct)}%`,
        `maxDD ${fmt(b.maxDrawdownPct)}%  eq ${fmt(b.finalEquity)}U  stop ${b.stopped}`,
      ];
      if (r.optimizeMeta) {
        lines.push(`opt tried ${r.optimizeMeta.tried}  pass ${r.optimizeMeta.passed}`);
      }
      if (r.alternatives && r.alternatives.length) {
        for (const a of r.alternatives) {
          lines.push(
            `alt lo ${fmt(a.lower)} hi ${fmt(a.upper)} n=${a.gridCount} ${a.gridType === 'arithmetic' ? 'a' : 'g'} roi ${a.netRoiPct >= 0 ? '+' : ''}${fmt(a.netRoiPct)}% dd ${fmt(a.maxDrawdownPct)}%`
          );
        }
      }
      lines.push(`n=${b.candleCount} @ ${fmtTime(r.refreshedAt)}${loading ? ' …' : ''}`);
      if (error) lines.push(`! ${error}`);
      body = `<pre class="block">${lines.join('\n')}</pre>`;
    } else {
      body = '<pre class="block dim">set params · run / opt</pre>';
    }

    root.innerHTML = `
      <div class="toolbar">
        <button class="link" data-run>run</button> ·
        <button class="link" data-auto>auto</button> ·
        <button class="link" data-opt>opt</button>
      </div>
      <div class="form">
        <label>sym</label><input id="symbol" value="${p.symbol || 'MSTRUSDT'}" />
        <label>dir</label>
        <select id="direction">
          <option value="neutral" ${p.direction === 'neutral' ? 'selected' : ''}>neutral</option>
          <option value="long" ${p.direction === 'long' ? 'selected' : ''}>long</option>
          <option value="short" ${p.direction === 'short' ? 'selected' : ''}>short</option>
        </select>
        <label>lo</label><input id="lower" type="number" step="0.01" value="${p.lower}" />
        <label>hi</label><input id="upper" type="number" step="0.01" value="${p.upper}" />
        <label>n</label><input id="gridCount" type="number" step="1" value="${p.gridCount}" />
        <label>mode</label>
        <select id="gridType">
          <option value="arithmetic" ${p.gridType === 'arithmetic' ? 'selected' : ''}>arith</option>
          <option value="geometric" ${p.gridType === 'geometric' ? 'selected' : ''}>geo</option>
        </select>
        <label>inv</label><input id="investment" type="number" step="1" value="${p.investment}" />
        <label>lev</label><input id="leverage" type="number" step="1" value="${p.leverage}" />
        <label>fee%</label><input id="feeRate" type="number" step="0.001" value="${feePct}" />
        <label>days</label><input id="days" type="number" step="1" value="${p.days}" />
        <label>maxDD%</label><input id="maxDdPct" type="number" step="1" value="${p.maxDdPct ?? 20}" />
        <label>sl</label><input id="stopLoss" type="number" step="0.01" value="${p.stopLoss ?? ''}" placeholder="-" />
        <label>tp</label><input id="takeProfit" type="number" step="0.01" value="${p.takeProfit ?? ''}" placeholder="-" />
      </div>
      <div class="hint dim">you set: inv/lev/fee/days/maxDD · opt finds: lo/hi/n/mode</div>
      ${body}
    `;

    root.querySelector('[data-run]')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'run', params: readForm() });
    });
    root.querySelector('[data-auto]')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'autoRange' });
    });
    root.querySelector('[data-opt]')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'optimize', params: readForm() });
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'update') {
      state = {
        loading: !!msg.loading,
        error: msg.error || null,
        params: msg.params || null,
        result: msg.result || null,
      };
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
