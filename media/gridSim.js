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

  function dirLabel(d) {
    if (d === 'long') return '做多';
    if (d === 'short') return '做空';
    return '中性';
  }

  function modeLabel(m) {
    return m === 'geometric' ? '等比' : '等差';
  }

  function stopLabel(s) {
    if (s === 'stopLoss') return '触发止损';
    if (s === 'takeProfit') return '触发止盈';
    return '未触发';
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

  function render(opts) {
    const preserveForm = !!(opts && opts.preserveForm);
    let draft = null;
    if (preserveForm && document.getElementById('lower')) {
      try {
        draft = readForm();
      } catch (_) {
        draft = null;
      }
    }

    const { loading, error, params, result } = state;
    const p = draft ||
      params || {
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
      body = '<pre class="block dim">回测中…</pre>';
    } else if (error && !result) {
      body = `<pre class="block err">${error}</pre>`;
    } else if (result) {
      const r = result;
      const b = r.backtest;
      const lines = [
        `// 网格 ${r.params.symbol} · 近${r.params.days}天 · 5分钟K`,
        `现价 ${fmt(r.currentPrice)}  每格利润 ${(r.profitPerGridPct * 100).toFixed(3)}%  每格约 ${fmt(r.perGridUsdt)}U`,
        `下限 ${fmt(r.params.lower)}  上限 ${fmt(r.params.upper)}  格数 ${r.params.gridCount}  ${modeLabel(r.params.gridType)}`,
        `区间内 ${fmt(r.oscillation.inRangePct, 0)}%  适合网格 ${r.oscillation.suitable ? '是' : '否'}  ${r.oscillation.reason}`,
        `成交 ${b.tradeCount}次  净利 ${b.netProfitUsdt >= 0 ? '+' : ''}${fmt(b.netProfitUsdt)}U  收益率 ${b.netRoiPct >= 0 ? '+' : ''}${fmt(b.netRoiPct)}%`,
        `最大回撤 ${fmt(b.maxDrawdownPct)}%  期末 ${fmt(b.finalEquity)}U  止损止盈 ${stopLabel(b.stopped)}`,
      ];
      if (r.optimizeMeta) {
        lines.push(`扫参 试了${r.optimizeMeta.tried}组  通过${r.optimizeMeta.passed}组`);
      }
      if (r.alternatives && r.alternatives.length) {
        for (let i = 0; i < r.alternatives.length; i++) {
          const a = r.alternatives[i];
          lines.push(
            `备选${i + 1} 下限${fmt(a.lower)} 上限${fmt(a.upper)} 格数${a.gridCount} ${modeLabel(a.gridType)} 收益${a.netRoiPct >= 0 ? '+' : ''}${fmt(a.netRoiPct)}% 回撤${fmt(a.maxDrawdownPct)}%`
          );
        }
      }
      lines.push(`K线 ${b.candleCount}根  更新 ${fmtTime(r.refreshedAt)}${loading ? ' …' : ''}`);
      if (error) lines.push(`! ${error}`);
      body = `<pre class="block">${lines.join('\n')}</pre>`;
    } else {
      body = '<pre class="block dim">填写参数后点「回测」或「最优」</pre>';
    }

    root.innerHTML = `
      <div class="toolbar">
        <button class="link" data-run>回测</button> ·
        <button class="link" data-auto>估区间</button> ·
        <button class="link" data-opt>最优</button>
      </div>
      <div class="form">
        <label>交易对</label><input id="symbol" value="${p.symbol || 'MSTRUSDT'}" />
        <label>方向</label>
        <select id="direction">
          <option value="neutral" ${p.direction === 'neutral' ? 'selected' : ''}>中性</option>
          <option value="long" ${p.direction === 'long' ? 'selected' : ''}>做多</option>
          <option value="short" ${p.direction === 'short' ? 'selected' : ''}>做空</option>
        </select>
        <label>下限</label><input id="lower" type="number" step="0.01" value="${p.lower}" />
        <label>上限</label><input id="upper" type="number" step="0.01" value="${p.upper}" />
        <label>格数</label><input id="gridCount" type="number" step="1" value="${p.gridCount}" />
        <label>模式</label>
        <select id="gridType">
          <option value="arithmetic" ${p.gridType === 'arithmetic' ? 'selected' : ''}>等差</option>
          <option value="geometric" ${p.gridType === 'geometric' ? 'selected' : ''}>等比</option>
        </select>
        <label>投入U</label><input id="investment" type="number" step="1" value="${p.investment}" />
        <label>杠杆</label><input id="leverage" type="number" step="1" value="${p.leverage}" />
        <label>手续费%</label><input id="feeRate" type="number" step="0.001" value="${feePct}" />
        <label>天数</label><input id="days" type="number" step="1" value="${p.days}" />
        <label>最大回撤%</label><input id="maxDdPct" type="number" step="1" value="${p.maxDdPct ?? 20}" />
        <label>止损价</label><input id="stopLoss" type="number" step="0.01" value="${p.stopLoss ?? ''}" placeholder="可选" />
        <label>止盈价</label><input id="takeProfit" type="number" step="0.01" value="${p.takeProfit ?? ''}" placeholder="可选" />
      </div>
      <div class="hint dim">你填：投入/杠杆/手续费/天数/最大回撤 · 最优会自动找：下限/上限/格数/模式</div>
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
    if (msg?.type === 'pleaseRun') {
      vscode.postMessage({ type: 'run', params: readForm() });
      return;
    }
    if (msg?.type === 'pleaseOptimize') {
      vscode.postMessage({ type: 'optimize', params: readForm() });
      return;
    }
    if (msg?.type === 'update') {
      const wasLoading = state.loading;
      state = {
        loading: !!msg.loading,
        error: msg.error || null,
        params: msg.params || null,
        result: msg.result || null,
      };
      // 回测进行中：保留输入框；结束后用实际跑完的参数回填
      render({ preserveForm: !!state.loading });
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
