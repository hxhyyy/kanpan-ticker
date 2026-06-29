# 看盘插件

在 VS Code / Cursor **状态栏** 和 **侧边栏** 同时查看美股和比特币实时价格。

参考 [LeekFund 韭菜盒子](https://github.com/LeekHub/leek-fund) 的侧边栏 TreeView 设计。

## 功能

- **侧边栏**：活动栏图标 → Stock / Crypto / Settings 三个视图
- **状态栏**：实时行情概览
- 美股（Finnhub）+ 加密货币（Binance）
- 涨跌箭头、涨跌幅、价格展示
- 工具栏：刷新、添加
- 右键删除自选

## 界面

```
活动栏 [📈]
├── Stock
│   └── US Stock(3)
│       ├── [AAPL]  +1.23%  185.50
│       ├── [NVDA]  -0.45%  890.12
│       └── [TSLA]  +2.10%  250.30
├── Crypto
│   └── Crypto(1)
│       └── [BTC]   +0.85%  97,500.00
└── Settings
    ├── 刷新行情
    ├── 添加美股
    ├── 添加加密货币
    └── 打开设置
```

## 安装

### 本地调试

```bash
cd 看盘插件
npm install
npm run compile
```

用 Cursor 打开 `看盘插件` 文件夹，按 `F5`。

### 安装 VSIX

```bash
npm run package
```

扩展面板 → `...` → **从 VSIX 安装**

## 配置

```json
{
  "kanpan.stocks": ["AAPL", "NVDA", "TSLA"],
  "kanpan.cryptoSymbols": ["BTCUSDT"],
  "kanpan.finnhubApiKey": "你的Finnhub密钥"
}
```

- 美股 API Key：https://finnhub.io （免费 60 次/分钟）
- 加密货币：Binance 公开接口，无需 Key

## 参考开源

| 项目 | 借鉴 |
|------|------|
| [LeekHub/leek-fund](https://github.com/LeekHub/leek-fund) | 侧边栏 TreeView、分组、工具栏 |
| US Stock Bar | Finnhub 美股 API |
| CryptoTickerPlus | Binance 加密货币 API |

## License

MIT
