# 优学院资源批量下载器

📥 油猴脚本 - 批量下载优学院/ULEARNING课程资源

## ✨ 功能特性

- 🔍 自动拦截网络请求，捕获资源链接
- 📂 支持多种文件类型分类（PDF/Word/PPT/Excel/图片/视频/音频/压缩包等）
- ☑️ 支持全选/单选/批量下载
- 📋 支持复制选中链接
- 🎯 右上角浮动按钮，不干扰正常使用
- 📊 实时显示捕获资源数量

## 🚀 安装方式

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方链接安装脚本：
   - [从 Greasy Fork 安装](https://greasyfork.org/scripts/xxxxx)（发布后替换链接）
   - 或者直接复制 `ulearning-downloader.user.js` 的内容到 Tampermonkey 新建脚本
3. 打开优学院课程资源页面即可使用

## 📖 使用方法

1. 打开优学院课程资源页面
2. 点击右上角 📥 按钮打开面板
3. 点击「扫描页面资源」或手动点击页面上的文件夹展开内容
4. 脚本会自动捕获资源链接
5. 选择要下载的文件，点击「下载选中」或「下载全部」

## 🖼️ 支持的文件类型

| 类型 | 扩展名 |
|------|--------|
| 📄 PDF | .pdf |
| 📝 Word | .doc, .docx |
| 📊 PPT | .ppt, .pptx |
| 📈 Excel | .xls, .xlsx |
| 🖼️ 图片 | .jpg, .png, .gif, .svg, .webp |
| 🎬 视频 | .mp4, .avi, .mov, .mkv |
| 🎵 音频 | .mp3, .wav, .aac, .flac |
| 📦 压缩包 | .zip, .rar, .7z |
| 📃 文本 | .txt, .md, .csv, .json |

## 🔧 兼容性

- ✅ 支持 Chrome / Edge / Firefox 等主流浏览器
- ✅ 兼容优学院 (ulearning.cn) 及各高校定制版本
- ✅ 支持 lms.dgut.edu.cn 等东莞理工学院域名

## 📝 更新日志

### v3.6.0
- 复制链接改为复制选中的资源
- 增加更多文件类型分类

### v3.5.0
- 增加图片、视频、音频、文本等分类

### v3.4.0
- 简化逻辑，移除自动点击（会卡住）
- 改为监听DOM变化自动捕获

## ⚠️ 免责声明

本脚本仅供学习交流使用，请勿用于商业用途。请遵守学校相关规定，合理使用学习资源。

## 📄 开源协议

MIT License

## 🔗 相关链接

- [Tampermonkey](https://www.tampermonkey.net/)
- [Greasy Fork](https://greasyfork.org/)
- [优学院](https://www.ulearning.cn/)
