# 看盘插件

在 VS Code / Cursor **状态栏** 和 **侧边栏** 查看美股和比特币实时价格。

## 功能

- **多数据源**：东方财富 / 新浪 / 腾讯 / Finnhub / 自动回退
- **盘前盘后**：新浪、东财、Finnhub 延长时段支持
- **侧边栏**：Stock / Crypto / Settings
- **界面切换数据源**：Settings → 切换美股数据源

## 美股数据源

| 数据源 | API Key | 盘前盘后 | 说明 |
|--------|---------|---------|------|
| 自动（默认） | 可选 | ✅ | 东财→新浪→腾讯→Finnhub |
| 东方财富 | 不需要 | ✅ | 国内访问友好 |
| 新浪财经 | 不需要 | ✅ | LeekFund 同款逻辑 |
| 腾讯财经 | 不需要 | ✅ | 国内稳定 |
| Finnhub 盘前盘后 | 需要 | ✅ | `trade=true` |
| Finnhub 盘中 | 需要 | ❌ | 仅常规时段 |

## 切换数据源

### 方式一：侧边栏（推荐）

1. 打开左侧 **看盘插件** 图标
2. 进入 **Settings**
3. 点击 **切换美股数据源**
4. 在列表中选择

Stock 视图标题栏也有数据源切换按钮。

### 方式二：设置

```json
{
  "kanpan.stockDataSource": "auto",
  "kanpan.autoFallbackOrder": ["eastmoney", "sina", "tencent", "finnhubExtended", "finnhub"],
  "kanpan.finnhubApiKey": ""
}
```

## 安装

```bash
cd 看盘插件
npm install
npm run compile
```

F5 调试，或 `npm run package` 生成 VSIX 安装。

## License

MIT
