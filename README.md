# pi-ralph-phased

Pi extension：Ralph hat activation 分阶段披露 + 阶段间上下文重置（默认 `newSession`）。

> 当前状态：**仅脚手架**。扩展入口可加载，但尚未注册接管 hooks，所有
> Ralph prompt 都安全透传。不要把当前版本当作计划 S1–S15 的实现。

## 开发计划（Coding Agent 执行入口）

**[docs/plans/2026-07-23-001-feat-ralph-phased-execution-plan.md](docs/plans/2026-07-23-001-feat-ralph-phased-execution-plan.md)**

含：Spec / BDD Scenarios / ATDD 矩阵 / **Unit 1→11 严格串行 TDD** / 质量门禁。

> 实现前必读计划中的约束 **C1/C2**：`before_agent_start` 不能替换用户 prompt，必须用 `context` 改写 LLM 可见消息。

脚手架已把模块边界、类型、测试落点和 TODO 建好。实现前还要处理
[脚手架决策与未决项](docs/SCAFFOLD_DECISIONS.md)，尤其是当前 Pi 0.81.1
中 `agent_settled` 的 context 类型不暴露 `newSession` 这一冲突。

## 脚手架检查

```bash
npm install
npm run typecheck
npm test
./scripts/smoke-print.sh
```

其中 smoke 当前只验证扩展能被 Pi 加载，不验证分阶段行为。

## 边界

- 本仓库 = 需求 B（分阶段）
- 需求 A（Ralph 默认少加载全局 skill）在 ralph-orchestrator，不在这里
