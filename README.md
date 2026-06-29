# Kanpan Ticker（码上看盘）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-green)](https://cursor.com/)

**Real-time stock & crypto ticker for VS Code / Cursor** — US stocks, A-shares, and crypto in your **status bar** and **sidebar**, without leaving the editor.

**在 VS Code / Cursor 里边写代码边看行情** — 支持美股、A 股、加密货币，状态栏 + 侧边栏双视图。

> 中文副标题 **码上看盘** · 灵感来自 [LeekFund](https://github.com/LeekHub/leek-fund) · MIT 开源

**搜索关键词：** `vscode stock ticker` · `crypto ticker` · `A-share` · `status bar` · `看盘` · `LeekFund alternative`

[English](#english) · [中文文档](#功能特性) · [Install](#安装) · [Contributing](#contributing)

---

## English

**Kanpan Ticker** is a lightweight market watcher for developers:

- **US stocks** — East Money, Sina, Tencent, Finnhub (auto fallback, pre/post market)
- **A-shares (China)** — Sina Finance, search by code or Chinese name
- **Crypto** — Binance spot pairs (BTC, ETH, …)
- **Status bar** + **sidebar** tree view
- Drag-and-drop reorder, red/green color schemes (US / CN)

```bash
git clone https://github.com/hxhyyy/kanpan-ticker.git
cd kanpan-ticker && npm install && npm run package
# Install the .vsix via Extensions: Install from VSIX...
```

---

## 功能特性

### 行情监控

| 市场 | 数据源 | 说明 |
|------|--------|------|
| 美股 | 东财 / 新浪 / 腾讯 / Finnhub | 多源自动回退，支持盘前盘后 |
| A 股 | 新浪财经 | 支持代码、中文名称、拼音搜索 |
| 加密货币 | Binance | 无需 API Key，默认 1 秒刷新 |

### 界面

- **侧边栏 TreeView**：Stock（美股 + A 股）/ Crypto / Settings
- **状态栏 Ticker**：可自选显示哪些标的，支持左侧/右侧
- **涨跌幅着色**：美国惯例（绿涨红跌）/ 中国惯例（红涨绿跌）/ 自定义
- **拖拽排序**：同一分组内鼠标拖动调整顺序，也支持 ↑ ↓ 按钮

### 其他

- 右键 **添加到状态栏** / **从状态栏移除**
- 美股 **盘前 / 盘中 / 盘后 / 休市** 时段标识
- 加密货币显示 **成交量**
- 隐身模式（隐藏涨跌颜色）

---

## 安装

### 方式一：从 VSIX 安装（推荐）

1. 下载 [Releases](https://github.com/hxhyyy/kanpan-ticker/releases) 中的 `.vsix` 文件
2. 在 VS Code / Cursor 中按 `Ctrl+Shift+P`（macOS：`Cmd+Shift+P`）
3. 执行 **Extensions: Install from VSIX...**
4. 选择 `.vsix` 文件，完成后 **Reload Window**

### 方式二：从源码构建

```bash
git clone https://github.com/hxhyyy/kanpan-ticker.git
cd kanpan-ticker
npm install
npm run compile
npm run package
```

生成的 `kanpan-ticker-x.x.x.vsix` 按方式一安装。

### 方式三：本地调试

```bash
npm install
npm run watch   # 终端 1：监听编译
# 在 VS Code 中按 F5 启动 Extension Development Host
```

---

## 快速上手

1. 点击左侧活动栏 **Kanpan Ticker** 图标
2. 在 **US Stock** / **A Stock** / **Crypto** 分组旁点击 **+** 添加标的
3. 右键某一行 → **添加到状态栏**，底部即可常驻显示
4. 进入 **Settings** → **涨跌颜色方案**，选择 **中国惯例** 或 **美国惯例**

### 添加 A 股

支持多种输入方式：

| 输入 | 示例 |
|------|------|
| 6 位代码 | `600519` |
| 带前缀 | `sh600519` |
| 中文名称 | `贵州茅台`、`上证指数` |
| 拼音 | `GZMT` |

同名代码（如 `000001`）会弹出选择：**上证指数** 或 **平安银行**。

### 添加美股

输入 ticker 即可，如 `AAPL`、`NVDA`、`TSLA`。

### 添加加密货币

输入 Binance 交易对，如 `BTCUSDT`、`ETHUSDT`。

---

## 侧边栏操作

| 操作 | 方法 |
|------|------|
| 添加美股 | US Stock 行右侧 **+** |
| 添加 A 股 | A Stock 行右侧 **+** |
| 添加加密货币 | Crypto 标题栏 **+** |
| 调整顺序 | 拖拽条目，或悬停点击 **↑ ↓** |
| 固定到状态栏 | 右键 → **添加到状态栏** |
| 删除 | 悬停点击 **垃圾桶** 或右键删除 |
| 切换美股数据源 | Settings → 切换美股数据源 |

---

## 配置说明

在设置中搜索 `kanpan`，或编辑 `settings.json`：

```json
{
  "kanpan.stocks": ["AAPL", "NVDA", "TSLA"],
  "kanpan.aShares": ["sh600519", "sz300750"],
  "kanpan.cryptoSymbols": ["BTCUSDT", "ETHUSDT"],

  "kanpan.stockDataSource": "auto",
  "kanpan.autoFallbackOrder": ["eastmoney", "sina", "tencent", "finnhubExtended", "finnhub"],
  "kanpan.finnhubApiKey": "",

  "kanpan.stockRefreshInterval": 2000,
  "kanpan.cryptoRefreshInterval": 1000,

  "kanpan.colorScheme": "cn",
  "kanpan.statusBarPosition": "left",
  "kanpan.statusBarItems": [],
  "kanpan.showChangePercent": true,
  "kanpan.showVolume": true,
  "kanpan.monochrome": false,

  "kanpan.format": "{symbol} {price} {change} {icon}",
  "kanpan.aliases": {
    "BTCUSDT": "BTC",
    "ETHUSDT": "ETH"
  }
}
```

### 常用配置项

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `kanpan.stocks` | `["AAPL","NVDA","TSLA"]` | 美股列表 |
| `kanpan.aShares` | `["sh600519","sz300750"]` | A 股列表 |
| `kanpan.cryptoSymbols` | `["BTCUSDT"]` | 加密货币列表 |
| `kanpan.stockDataSource` | `auto` | 美股数据源 |
| `kanpan.colorScheme` | `us` | 涨跌颜色：`us` / `cn` / `custom` |
| `kanpan.statusBarItems` | `[]` | 状态栏显示的标的，如 `stock:AAPL` |
| `kanpan.stockRefreshInterval` | `2000` | 股票刷新间隔（毫秒） |
| `kanpan.cryptoRefreshInterval` | `1000` | 加密货币刷新间隔（毫秒） |
| `kanpan.statusBarPosition` | `left` | 状态栏位置：`left` / `right` |
| `kanpan.format` | 见上 | 状态栏格式，支持 `{symbol}` `{price}` `{change}` `{volume}` `{icon}` |

### 状态栏条目格式

```
stock:AAPL
ashare:sh600519
crypto:BTCUSDT
```

---

## 美股数据源

| 数据源 | API Key | 盘前盘后 | 说明 |
|--------|---------|----------|------|
| `auto`（默认） | 可选 | ✅ | 按优先级自动回退 |
| `eastmoney` | 不需要 | ✅ | 东方财富，国内访问友好 |
| `sina` | 不需要 | ✅ | 新浪财经 |
| `tencent` | 不需要 | ✅ | 腾讯财经 |
| `finnhubExtended` | 需要 | ✅ | Finnhub 含延长时段 |
| `finnhub` | 需要 | ❌ | Finnhub 常规时段 |

Finnhub Key 免费申请：[https://finnhub.io](https://finnhub.io)

---

## 项目结构

```
kanpan-ticker/
├── src/
│   ├── extension.ts          # 插件入口
│   ├── marketService.ts      # 行情刷新、状态栏、自选股 CRUD
│   ├── providers.ts          # Binance、报价格式化
│   ├── stockSources.ts       # 美股多数据源
│   ├── aShareSources.ts      # A 股新浪 + 东财搜索
│   ├── colorSettings.ts      # 涨跌颜色方案
│   ├── quoteDecoration.ts    # 侧边栏涨跌幅角标
│   ├── session.ts            # 美股交易时段
│   └── sidebar/
│       ├── treeProviders.ts  # 侧边栏 TreeView
│       └── reorder.ts        # 拖拽排序
├── resources/
│   └── kanpan.svg            # 活动栏图标
├── package.json
└── README.md
```

---

## 开发

### 环境要求

- Node.js 18+
- VS Code / Cursor 1.85+

### 命令

```bash
npm run compile   # 编译 TypeScript
npm run watch     # 监听模式
npm run package   # 打包 VSIX
```

---

## 常见问题

**Q: 安装后设置项找不到？**  
A: 安装或升级后请 **Reload Window**。旧版 VSIX 可能缺少新配置项。

**Q: A 股搜「上证指数」却变成平安银行？**  
A: 请升级到 v0.4.2+，已修复 `000001` 同码不同所的问题。

**Q: 状态栏颜色看不清？**  
A: v0.5.0+ 已对状态栏使用高对比亮色文字，请升级并重选颜色方案。

**Q: Finnhub 无数据？**  
A: 在设置中填写 `kanpan.finnhubApiKey`，或切换为 `auto` / 新浪 / 东财等免 Key 源。

---

## 免责声明

本插件仅供 **个人学习与技术交流**，行情数据来自第三方公开接口，**不构成任何投资建议**。数据可能存在延迟或误差，请勿用于实际交易决策。使用本插件即表示您自行承担相关风险。

---

## 开源协议

[MIT License](./LICENSE)

---

## 致谢

- [LeekFund](https://github.com/LeekHub/leek-fund) — 侧边栏看盘交互参考
- [Finnhub](https://finnhub.io) — 美股 API
- [Binance](https://www.binance.com) — 加密货币 API
- 东方财富 / 新浪财经 / 腾讯财经 — A 股与美股国内数据源

---

## Contributing

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交改动：`git commit -m "feat: add something"`
4. 推送并发起 PR

---

## 让更多人看到（维护者提示）

推送到 GitHub 后建议：

1. 仓库 **Topics** 添加：`vscode-extension` `stock-ticker` `crypto` `a-share` `cursor` `finance`
2. 发一个 **GitHub Release**，附上 `.vsix` 和截图
3. 中文社区可分享到：V2EX、掘金、知乎（标题带「VS Code 看盘」「LeekFund 替代」）
4. 英文社区：Reddit r/vscode、Hacker News Show HN
5. 后续可发布到 [VS Code Marketplace](https://marketplace.visualstudio.com/)

---

如果这个项目对你有帮助，欢迎 **Star ⭐** — 这是开源项目最容易被搜到的方式。
