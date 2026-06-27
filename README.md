# 优学院资源批量下载器 | ULEARNING Resource Downloader

[![GitHub stars](https://img.shields.io/github/stars/tian11111/ulearning-downloader?style=social)](https://github.com/tian11111/ulearning-downloader/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/tian11111/ulearning-downloader?style=social)](https://github.com/tian11111/ulearning-downloader/network/members)
[![GitHub issues](https://img.shields.io/github/issues/tian11111/ulearning-downloader)](https://github.com/tian11111/ulearning-downloader/issues)
[![GitHub license](https://img.shields.io/github/license/tian11111/ulearning-downloader)](https://github.com/tian11111/ulearning-downloader/blob/main/LICENSE)
[![Greasy Fork Version](https://img.shields.io/greasyfork/v/XXXXX)](https://greasyfork.org/scripts/XXXXX)

> 📥 **优学院/ULEARNING课程资源批量下载油猴脚本** - 一键批量下载优学院平台上的PDF、Word、PPT、Excel、视频、音频等学习资料

## 🎯 项目简介

**优学院资源批量下载器**是一款专为大学生设计的**油猴脚本(Tampermonkey/Greasemonkey Userscript)**，用于批量下载[优学院(ULEARNING)](https://www.ulearning.cn/)在线学习平台上的课程资源。

### 🔥 核心功能

- **智能拦截** - 自动拦截网络请求，实时捕获资源链接
- **批量下载** - 支持全选/单选/批量下载，一键保存所有课程资料
- **分类管理** - 按文件类型自动分类（PDF/Word/PPT/Excel/图片/视频/音频/压缩包）
- **链接复制** - 支持复制选中资源链接，方便使用其他下载工具
- **实时显示** - 浮动面板实时显示已捕获资源数量

## 🚀 快速安装

### 从 GitHub 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 下载 [优学院资源批量下载.user.js](https://github.com/tian11111/ulearning-downloader/raw/main/优学院资源批量下载.user.js)
3. 在 Tampermonkey 中新建脚本，粘贴下载的内容
4. 保存并启用脚本

### 方法三：直接安装

1. 安装 Tampermonkey 扩展
2. 点击下方按钮直接安装：

[![安装脚本](https://img.shields.io/badge/安装脚本-Tampermonkey-00bfff?style=for-the-badge)](https://github.com/tian11111/ulearning-downloader/raw/main/优学院资源批量下载.user.js)

## 📖 使用教程

### 基本使用

1. **打开优学院** - 登录优学院平台，进入课程资源页面
2. **点击图标** - 点击右上角 📥 浮动按钮打开下载面板
3. **扫描资源** - 点击「扫描页面资源」按钮，或手动展开文件夹
4. **选择文件** - 勾选需要下载的文件（支持全选/反选）
5. **开始下载** - 点击「下载选中」或「下载全部」按钮

### 高级功能

- **按类型筛选** - 使用顶部筛选按钮快速找到特定类型文件（PDF/Word/PPT等）
- **复制链接** - 选中文件后点击「复制链接」，可粘贴到IDM等专业下载工具
- **查看日志** - 点击📋按钮查看资源捕获日志

## 🖼️ 支持的文件类型

| 类型 | 扩展名 | 说明 |
|------|--------|------|
| 📄 PDF | `.pdf` | PDF文档 |
| 📝 Word | `.doc`, `.docx` | Word文档 |
| 📊 PPT | `.ppt`, `.pptx` | PowerPoint演示文稿 |
| 📈 Excel | `.xls`, `.xlsx` | Excel表格 |
| 🖼️ 图片 | `.jpg`, `.png`, `.gif`, `.svg`, `.webp` | 图片文件 |
| 🎬 视频 | `.mp4`, `.avi`, `.mov`, `.mkv`, `.flv` | 视频文件 |
| 🎵 音频 | `.mp3`, `.wav`, `.aac`, `.flac` | 音频文件 |
| 📦 压缩包 | `.zip`, `.rar`, `.7z` | 压缩文件 |
| 📃 文本 | `.txt`, `.md`, `.csv`, `.json` | 文本文件 |

## 🔧 兼容性

### 浏览器支持

| 浏览器 | 支持状态 |
|--------|----------|
| Google Chrome | ✅ 完全支持 |
| Microsoft Edge | ✅ 完全支持 |
| Mozilla Firefox | ✅ 完全支持 |
| Safari | ⚠️ 需要 Tampermonkey 支持 |
| Opera | ✅ 完全支持 |

### 平台支持

- ✅ 优学院 (ulearning.cn) 主站
- ✅ 东莞理工学院 (lms.dgut.edu.cn)

## 📋 常见问题 (FAQ)

### Q: 脚本安装后不显示图标？
**A:** 请刷新优学院页面，确保脚本已启用。检查 Tampermonkey 扩展图标是否显示数字。

### Q: 无法下载某些文件？
**A:** 部分文件可能需要登录权限或有防盗链保护。请确保已登录优学院账号。

### Q: 下载速度很慢？
**A:** 优学院服务器可能有限速。建议使用「复制链接」功能，配合 IDM 等专业下载工具。

### Q: 支持批量下载整个文件夹吗？
**A:** 脚本会自动捕获页面上所有可见的资源链接。展开文件夹后点击「扫描页面资源」即可。

### Q: 如何更新脚本？
**A:** 从 Greasy Fork 安装的脚本会自动更新。手动安装的需要重新下载安装。

## 🛠️ 开发相关

### 技术栈

- JavaScript (ES6+)
- Tampermonkey/Greasemonkey API
- DOM Mutation Observer
- XMLHttpRequest/Fetch 拦截

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/tian11111/ulearning-downloader.git

# 进入目录
cd ulearning-downloader

# 在 Tampermonkey 中导入脚本进行测试
```

## 📝 更新日志

### v3.6.0 (最新)
- ✨ 复制链接改为复制选中的资源
- ✨ 增加更多文件类型分类
- 🐛 修复已知问题

### v3.5.0
- ✨ 增加图片、视频、音频、文本等分类
- 🎨 优化界面显示

### v3.4.0
- 🔧 简化逻辑，移除自动点击（会卡住）
- 🔧 改为监听DOM变化自动捕获

## ⚠️ 免责声明

本脚本**仅供学习交流使用**，请勿用于商业用途。请遵守学校相关规定，合理使用学习资源。使用本脚本产生的任何后果由用户自行承担。

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

## 🔗 相关链接

- [Tampermonkey 官网](https://www.tampermonkey.net/) - 油猴脚本管理器
- [Greasy Fork](https://greasyfork.org/) - 用户脚本分享平台
- [优学院官网](https://www.ulearning.cn/) - 在线学习平台
- [GitHub 仓库](https://github.com/tian11111/ulearning-downloader) - 源代码

## 💡 关键词

优学院, ULEARNING, 油猴脚本, Tampermonkey, Userscript, 批量下载, 课程资源, 学习资料, PDF下载, 视频下载, 课件下载, 在线学习, 大学课程, 学习工具, 脚本, 下载器, 优学院下载, ulearning downloader, 优学院批量下载, 优学院资源下载, 优学院课件下载, 优学院PDF下载, 优学院视频下载

---

如果这个脚本对你有帮助，请给个 ⭐ Star 支持一下！
