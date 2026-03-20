# yexam

YouTube 视频测验生成器。根据 YouTube 视频字幕生成单选题，检验理解程度。

立刻使用：https://yexam.jerryshell.workers.dev

## 功能

- 粘贴 YouTube 链接生成测验题目
- 支持中英文
- 即时评分与答案反馈
- 内置缓存避免重复请求字幕

## 环境变量

```bash
OPENROUTER_API_KEY=你的密钥
OPENROUTER_MODEL=模型名称
```

## 开发

```bash
bun install
bun dev
```

## 构建

```bash
bun build
bun preview
```

## 命令

```bash
bun lint        # 代码检查
bun lint:fix    # 自动修复
bun fmt         # 格式化
bun fmt:check   # 检查格式
```
