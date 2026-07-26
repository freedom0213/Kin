# Kin 页面设计 Demo

这是一个独立的交互式设计原型，不是生产 App。它由 Vite 提供本地实时预览，保存 HTML、CSS 或 JavaScript 后，浏览器会自动刷新。

首次使用先安装依赖：

```powershell
cd D:\Vibe-coding\Kin\preview
npm.cmd install
```

启动实时预览：

```powershell
npm.cmd run dev
```

浏览器打开：

```text
http://localhost:4173/kin-design-demo.html?variant=flow
```

查看方式：

- `?variant=flow`：单机交互流程
- `?variant=gallery`：全部页面画廊
- `?variant=lab`：Online / Offline 状态对照

页面底部的切换器或键盘左右方向键可以切换查看方式。

生成静态构建：

```powershell
npm.cmd run build
```

构建结果输出到 `preview/dist`，该目录不会提交到 Git。
