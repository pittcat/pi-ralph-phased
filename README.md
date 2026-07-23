# pi-ralph-phased

面向 Pi 的 Ralph 扩展：将一次完整的 Ralph activation prompt 分阶段披露，并在阶段之间默认重置会话上下文，避免后续阶段内容过早进入模型上下文。

## 安装与加载

本仓库要求 Node.js `>=22.19.0`。安装开发依赖后，可以直接从源码加载：

```bash
npm install
pi -e ./src/index.ts
```

`-e` 用于显式加载 extension 入口。作为 Pi package 使用时，`package.json` 中的 `pi.extensions` 已声明 `./src/index.ts`，支持 Pi 按 package metadata 自动加载，无需重复指定 `-e`。

## 阶段语义

扩展识别结构完整且具有强 Ralph 信号的 activation prompt，并按以下阶段推进：

1. **ORIENTATION**：仅披露前言、当前阶段说明和必要引用，不泄露后续阶段正文或 deferred skill XML。
2. **PLAN**：披露计划阶段所需内容。
3. **EXECUTE**：披露执行阶段及延迟到该阶段的 skill 内容。
4. **VERIFY**：披露验证阶段内容。
5. **PUBLISH**：披露发布阶段内容；终止性 `ralph emit` 受允许 topic 约束。

阶段完成通过 `ralph_stage_done` 工具推进。非 Ralph prompt、信号不足或解析不一致的 prompt 保持安全透传。

### 杀开关

设置 `RALPH_PI_PHASED=0` 可禁用接管并恢复 prompt 透传：

```bash
RALPH_PI_PHASED=0 pi -e ./src/index.ts
```

## C1/C2：模型上下文改写

Pi 0.81.1 的 `before_agent_start` 返回值不能替换原始 `event.prompt`。因此扩展不会尝试在该 hook 中替换用户 prompt，而是在 `context` hook 返回 `{ messages }`，改写模型实际可见的 user message。原始 activation prompt 会保存到 event ledger 之外的私有临时文件；阶段 prompt 只向模型暴露当前阶段允许看到的内容。

## 开发与验证

```bash
npm run typecheck
npm test
./scripts/smoke-print.sh
```

烟测仅执行 `pi -e ./src/index.ts --help`，验证真实 Pi 二进制可以加载 extension，不调用模型，也不需要凭据。如果 `pi` 不在 `PATH` 中，脚本会明确报告自动跳过并以状态 0 退出；这不等同于真实 Pi 验证通过。

## 非目标与边界

本仓库只实现需求 B：Ralph activation 的分阶段执行与上下文重置。需求 A（让 Ralph 默认少加载全局 skill）属于 `ralph-orchestrator`，不在本仓库实现，也不应由本扩展改变全局 skill 加载策略。

## 未验证项与已知风险

- 尚未完成小模型与基线行为的对比验证。
- 对非 bash 工具或其他命令通道中的终止性 emit 尚无统一拦截保证。
- 尚未完成 `print`/长时间运行场景的 soak 测试。
- 阶段推进使用 Pi 0.81.1 的 `ExtensionAPI.sendUserMessage` 触发下一轮，并由 `context` hook 丢弃上一阶段历史；仍需用真实模型完成整条阶段链路的行为烟测。
- 当本机缺少 `pi` 二进制时，smoke 只会自动跳过；发布或部署前仍需在安装了匹配版本 Pi 的环境中执行真实加载烟测。
