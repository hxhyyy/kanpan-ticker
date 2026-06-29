# 看盘插件

在 VS Code / Cursor 状态栏同时查看 **美股** 和 **比特币（加密货币）** 实时价格。

参考开源项目：

- [US Stock Bar](https://marketplace.visualstudio.com/items?itemName=site-zhou.us-stock-bar) — Finnhub 美股
- [CryptoTickerPlus](https://marketplace.visualstudio.com/items?itemName=buyu.crypto-ticker-plus) — Binance 加密货币
- [Chef5/stock-bar](https://github.com/Chef5/stock-bar) — 多市场股票监控
- [robertcalvert/vscode-crypto-ticker](https://github.com/robertcalvert/vscode-crypto-ticker) — 加密货币 ticker

## 功能

- 状态栏显示美股 + 加密货币
- 绿涨红跌，悬停查看详情
- 自定义显示格式、别名、刷新间隔
- 隐身模式（隐藏涨跌颜色）
- 命令：添加美股 / 添加加密货币 / 刷新 / 显示 / 隐藏

## 安装

### 方式一：本地调试

```bash
cd 看盘插件
npm install
npm run compile
```

用 Cursor 打开 `看盘插件` 文件夹，按 `F5` 启动调试。

### 方式二：安装 VSIX

```bash
npm run package
```

扩展面板 → `...` → **从 VSIX 安装** → 选择生成的 `kanpan-ticker-0.1.0.vsix`

## 配置

设置里搜索 `kanpan`，或写入 `settings.json`：

```json
{
  "kanpan.stocks": ["AAPL", "NVDA", "TSLA"],
  "kanpan.cryptoSymbols": ["BTCUSDT", "ETHUSDT"],
  "kanpan.finnhubApiKey": "你的Finnhub密钥",
  "kanpan.refreshInterval": 10000,
  "kanpan.format": "{symbol} {price} {change} {icon}",
  "kanpan.monochrome": false,
  "kanpan.onlyRefreshWhenFocused": false
}
```

### Finnhub API Key（美股必需）

1. 打开 https://finnhub.io 注册免费账号
2. Dashboard 复制 API Key
3. 填入 `kanpan.finnhubApiKey`

免费版 60 次/分钟。

### 加密货币

使用 Binance 公开 API，**无需 API Key**。交易对格式：`BTCUSDT`、`ETHUSDT`。

## 命令

`Ctrl+Shift+P` 打开命令面板：

| 命令 | 说明 |
|------|------|
| 看盘插件: 立即刷新 | 手动刷新行情 |
| 看盘插件: 显示 | 显示状态栏 |
| 看盘插件: 隐藏 | 隐藏状态栏 |
| 看盘插件: 添加美股 | 交互式添加股票代码 |
| 看盘插件: 添加加密货币 | 交互式添加交易对 |

## License

MIT
