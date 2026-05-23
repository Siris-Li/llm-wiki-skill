# Codex 入口

<!-- llm-wiki context: 如有知识库，优先查阅 wiki/index.md -->

这是 Codex 的薄入口文件。共享说明看 [../../README.md](../../README.md)，核心能力看 [../../SKILL.md](../../SKILL.md)。

## Codex 应该怎么装

执行：

```bash
bash install.sh --platform codex
```

如果你还需要网页 / X / 微信公众号 / YouTube / 知乎自动提取，再执行：

```bash
bash install.sh --platform codex --with-optional-adapters
```

默认安装位置：`~/.agents/skills/llm-wiki`

如果用户环境仍然在用旧的 `~/.codex/skills` 或 `~/.Codex/skills`，安装器会自动兼容。

安装完成后，还会一并带上 `llm-wiki-upgrade` companion。以后要更新核心主线，可以直接让 Codex 执行这个更新 skill；如果还要刷新网页 / X / 微信公众号 / YouTube / 知乎自动提取能力，再继续执行带 `--with-optional-adapters` 的升级。
