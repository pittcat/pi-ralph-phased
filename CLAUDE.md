# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## 项目概览

这是一个 TypeScript ESM 的 Pi extension 脚手架，用于 Ralph hat activation 的分阶段 prompt 披露，以及阶段之间默认通过 `newSession` 重置上下文。当前版本只有安全脚手架：扩展入口可以加载，但尚未注册 hooks 或工具，因此 Ralph prompt 仍完全透传；不要假设计划中的 S1–S15 已经实现。

项目边界是需求 B（分阶段执行）。需求 A（Ralph 默认少加载全局 skill）属于 `ralph-orchestrator`，不在本仓库实现。

## 常用命令

需要 Node.js `>=22.19.0`。

```bash
npm install
npm run typecheck       # TypeScript 严格类型检查，不生成文件
npm test                # Vitest 一次性运行；当前允许无测试
./scripts/smoke-print.sh # 需要 PATH 中存在 pi；仅验证扩展可加载
```

运行单个测试文件或测试名时使用 Vitest 的参数透传，例如：

```bash
npx vitest run test/unit/detect.test.ts
npx vitest run -t "test name"
```

测试落点和严格执行顺序见 `test/README.md` 及 `docs/plans/2026-07-23-001-feat-ralph-phased-execution-plan.md`。实现前先阅读计划中的 C1/C2 约束：`before_agent_start` 不能替换用户 prompt，必须通过 `context` 改写模型可见消息。

## 架构与模块边界

- `src/index.ts` 是唯一 Pi extension 入口和适配层边界。Pi runtime 类型、hooks、工具注册应留在入口或 adapter 中；不要让纯领域模块依赖 Pi runtime 类型。
- `src/types.ts` 定义领域契约：阶段 ID、解析后的 Ralph prompt、延迟 skill、会话状态。阶段顺序和状态转换由 `src/stage-machine.ts` 维护。
- `src/detect.ts` 负责判断是否接管 prompt；安全策略偏向 false negative，接管前应同时满足强 Ralph 信号、至少两个已识别阶段，并与解析结果一致。
- `src/parse.ts` 从 Ralph activation dump 提取 preamble、阶段、延迟 skill XML 和 publish topics。解析必须通过 fixtures 锁定 heading/XML 变体。
- `src/prompt-build.ts` 根据当前阶段构造唯一应展示给模型的 user message；ORIENTATION 不能泄露后续阶段正文或 deferred skill XML。
- `src/persist.ts` 将完整 prompt 写入 Ralph event ledger 之外的私有临时目录，并返回绝对、可读取路径；清理由 best-effort 策略负责。
- `src/session-state.ts` 保存进程内活动 Ralph 状态；后续实现需要明确多次激活、透传 prompt 和 session replacement 的清理规则。
- `src/advance.ts` 是 host-independent 的阶段推进编排 seam；不要在确认 Pi 0.81.1 的 runtime 能力前，把 `newSession` 强行接到 `agent_settled`。
- `src/tools/stage-done.ts` 放纯的 `ralph_stage_done` 执行逻辑；Pi/TypeBox tool definition 和注册放在适配层，避免领域代码重复实现 schema 校验。
- `src/emit-guard.ts` 是终止性 `ralph emit` 拦截策略的纯函数 seam。只有在表驱动测试明确 terminal topic whitelist 和 shell command 变体后才允许变为 blocking。

## 当前重要约束与未决项

- 当前 Pi 0.81.1 声明中，`before_agent_start` 只能返回 `message`/`systemPrompt`，不能替换 `event.prompt`；`context` 可返回 `{ messages }`。
- `agent_settled` handler 的 `ExtensionContext` 类型不暴露 `newSession`、`waitForIdle`、`sendUserMessage`，这些只出现在 `ExtensionCommandContext`。U9 前必须做 runtime spike 并查对应 Pi 源码/文档；不能仅用类型断言消除问题。
- EXECUTE 阶段 deferred skill 的交付方式尚未最终确定，计划建议内联提取出的 XML；U3 测试应锁定选择。
- 多次激活时的状态 key/lifetime、临时文件权限/熵/清理时机，以及 smoke test 的 credential-free 与 credentialed 边界，见 `docs/SCAFFOLD_DECISIONS.md`，实现相应单元时一并决定并测试。

## 开发顺序

严格按计划的 Unit 1→11 串行 TDD 推进：先为检测和解析建立可执行的失败测试，再实现 prompt builder、stage machine、persistence、emit guard、stage tool，随后接入 fake Pi、first-turn/advance ATDD，最后验证 package contract 和真实 Pi smoke。不要提前注册尚未有测试保障的 takeover hooks；在检测、解析、持久化和 context rewrite 测试通过前，保持 pass-through 默认行为。

## 代码风格与 TypeScript 配置

项目使用严格 TypeScript：ES2023、NodeNext ESM、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和 `verbatimModuleSyntax`。源码中的相对 import 使用 `.js` 后缀。领域函数优先保持无 IO、可独立测试；只在系统边界处理 Pi、文件系统和环境变量。

## Ralph Managed Blocks

<!-- ralph:begin hang-prevention v=sha256:272439a4f9f9b6d5ebbf4b0edda64a2f4464396077c351e1b2e83d33e4a1ee7a -->
## Command Hang Prevention Rules

1. Never run infinite-follow commands directly.
   Forbidden examples:
   - tail -f
   - tail -F
   - journalctl -f
   - adb logcat
   - dmesg -w
   - watch
   - while true

2. If follow mode is necessary, always wrap it with timeout:
   - timeout 30s tail -f <file>
   - timeout 60s adb logcat
   - timeout 30s journalctl -f

3. Prefer bounded commands:
   - tail -n 200 <file>
   - grep -n "ERROR" <file> | head -100
   - journalctl -n 300 --no-pager
   - dmesg | tail -200

4. For large files, never cat the whole file.
   Use:
   - wc -l <file>
   - tail -n 200 <file>
   - head -n 100 <file>
   - grep -n "keyword" <file> | head -50

5. Every external command that may block must have timeout.

<!-- ralph:end hang-prevention -->
