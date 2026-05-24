# French Cards PWA

一个纯前端离线卡片 sample。它不需要 Python 后端，不调用 API，卡片和复习记录保存在当前浏览器的 IndexedDB 里。

## 本地运行

在这个目录执行：

```bash
python3 -m http.server 8765
```

然后打开：

```text
http://127.0.0.1:8765
```

## 导入格式

每行一张卡片：

```text
maison | 房子 | une grande maison | 一栋大房子
prendre | 拿；乘坐 | Je prends le métro. | 我坐地铁。
```

也支持 tab、逗号、中文逗号、分号、中文分号。

## 保存和离线

- 卡片数据保存在浏览器本地 IndexedDB。
- 设置保存在 localStorage。
- Service Worker 会缓存应用壳，让它在支持的环境里离线打开。
- 浏览器本地数据不是永久备份。清理网站数据、卸载浏览器或卸载 PWA 都可能删除它，所以重要词表请用“导出 JSON”备份。

## 手机上的现实限制

手机浏览器通常要求 HTTPS 才能稳定安装 PWA 和启用离线缓存。局域网 HTTP 可以用于测试，但 iPhone 上不一定能稳定安装。最稳的做法是只部署这个空应用壳到 HTTPS，词表数据仍然只保存在手机本地。
