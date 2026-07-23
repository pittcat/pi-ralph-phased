---
title: "pi-ralph-phased 可执行开发计划"
date: 2026-07-23
type: feat
artifact_readiness: implementation-ready
package: pi-ralph-phased
audience: coding-agent
method: Spec-First + BDD + ATDD + Outside-In + TDD + Regression
note: 本文不包含生产代码；Executor 按 Unit 1→N 严格串行执行。
upstream:
  - ralph-orchestrator 需求 B（2026-07-23-003 计划 R6–R14）
pi_api_evidence: |
  @earendil-works/pi-coding-agent docs/extensions.md + dist/core/extensions/types.d.ts
  - before_agent_start 仅能 inject message / 替换 systemPrompt，不能替换 event.prompt
  - context 可返回 { messages } 改写送入 LLM 的消息
  - agent_settled + ctx.newSession({ setup, withSession }) + sendUserMessage
  - registerTool；tool_call 可 return { block: true, reason }
  - package.json "pi": { "extensions": ["./src/index.ts"] }
---

# pi-ralph-phased — Coding Agent 可执行开发计划

> **执行纪律：** Unit N 的实现、测试、重构、回归全部绿且完成标准勾选后，才能开始 Unit N+1。禁止并行/交替开发多个 Unit。禁止删断言、skip、`.only`、无解释改 golden、Mock 掉被测行为。

---

## 1. 功能目标

### 业务目标

在 **Pi headless**（`pi -p --mode json --no-session`，含 Ralph `ralph run -b pi`）场景下，当用户首包是 Ralph hat activation 长 prompt 时，扩展 `pi-ralph-phased` 接管执行节奏：

1. 识别 Ralph dump，否则完全透传；
2. 全文落盘，按 `ORIENTATION → EXECUTE → VERIFY → REPORT` 分阶段向模型披露；
3. 每阶段只让模型看到「短核心契约 + 当前阶段正文」（完整长文可 `read`）；
4. 用确定性 tool `ralph_stage_done` 推进；
5. **阶段之间必须 `newSession`（默认）重置上下文**，禁止只堆历史；
6. REPORT（实际最后阶段）之前禁止业务终态 `ralph emit`；
7. 全部完成后停止续跑，由 Ralph 既有门禁验收。

### 本次范围

- 本仓库可安装 Pi extension 包 `pi-ralph-phased`
- 纯函数域：检测、解析、短 prompt 构建、阶段状态机、早 emit 判定、落盘路径约定
- 扩展接线：`registerTool`、`before_agent_start`、`context`、`agent_settled`、`tool_call`（拦截）、`ctx.newSession`
- 自动化测试（单元 / 状态机 / Fake Extension 集成）+ 最小真实 `pi -e` smoke
- README：安装、开关、非目标、故障排查

### 非目标

- 不改 ralph-orchestrator / 需求 A（`--no-skills`）
- 不改编排、emit schema、tests 门禁、不瘦 `ralph-tools*.md` 正文
- 不依赖 `pi-tasks` / `pi-dynamic-workflows` 运行时
- 不用 LLM 总结 HARD RULE 作为推进依据
- 不做交互式 TUI 专用 UX
- 不保证「单独本扩展就能让任意厚 hat instructions 在极小上下文上稳定」——本扩展解决披露节奏与协议门闩；instructions 本身过厚仍属 Ralph 控密度

### 已知约束和假设

| ID | 约束 / 假设 | 证据或来源 |
|----|-------------|------------|
| C1 | **`before_agent_start` 不能替换用户 prompt**；只能 inject custom message / 换 systemPrompt。若只 inject 而不改 LLM messages，**全文 dump 仍会进模型** | `BeforeAgentStartEventResult` 仅 `message?` + `systemPrompt?` |
| C2 | **首轮及每轮送入 LLM 的可见文本必须经 `context` 钩子改写**（或等价：立即 `newSession` 且保证首轮 LLM 看不到全文——若无法在首轮前完成，则以 `context` 为准） | `extensions.md` → `context` 返回 `{ messages }` |
| C3 | `--no-session` = 内存 session，**同进程多轮仍累积**；阶段切换必须 `newSession`（默认） | Pi SessionManager / 既有调研 |
| C4 | 续跑必须 **await** `newSession` / `sendUserMessage` / `waitForIdle`（若 API 可用），禁止 fire-and-forget | print 模式 dispose 竞态风险 |
| C5 | Ralph 阶段标题来自 `build_custom_hat`：`### 0. ORIENTATION`、`### 0b. TOOL DISCIPLINE`、`### 1. EXECUTE`、`### 2. VERIFY`、`### 3. REPORT` | ralph-core `instructions.rs` |
| C6 | Ralph 常内联 `<ralph-tools-skill>` 等 XML；ORIENTATION 默认不附全文，延后到 EXECUTE | 需求 KD-B8 |
| C7 | 关闭开关：`RALPH_PI_PHASED=0` → 强制透传 | 需求 R10 |
| C8 | 实现前核对本机 `@earendil-works/pi-coding-agent` 的 `ExtensionAPI` 类型；**不得臆造**文档中不存在的返回字段 | Planner 硬规则 |
| C9 | 测试运行器：本仓库自选（推荐 `vitest` + TypeScript ESM）；与 Pi 官方 example 的 `type: module` 对齐 | with-deps example |
| C10 | Fake/Stub：对尚未接线的 Pi runtime，用最小 `FakePi` / `FakeExtensionContext` 隔离；接口形状以官方 types 为准，字段不够则只 stub 本 Unit 用到的方法 | Outside-In |

---

## 2. BDD 行为规格

```gherkin
Feature: pi-ralph-phased 分阶段执行 Ralph hat activation
  作为使用 Pi headless 跑 Ralph 的运营方
  我希望 Ralph 长 prompt 被按阶段披露并在阶段间重置上下文
  以便小上下文模型少被规则墙淹没，且非 Ralph 用法不受影响

  # —— 透传 / 开关 ——

  Scenario: S1 非 Ralph 短 prompt 完全透传
    Given 扩展已加载且 RALPH_PI_PHASED 未设为 0
    And 用户首包是 "Reply with exactly OK"
    When 进入 before_agent_start 与后续 context
    Then 判定为不接管
    And 送入 LLM 的 user 文本仍为原短 prompt
    And 不注册推进副作用（不写全文落盘、不进入阶段机活跃态）

  Scenario: S2 环境变量关闭时强制透传
    Given RALPH_PI_PHASED=0
    And 用户首包是合法 Ralph 风格长 prompt（含 ORIENTATION 与 EXECUTE）
    When 进入 before_agent_start
    Then 判定为不接管
    And 行为与未加载分阶段逻辑时一致（全文可见）

  Scenario: S3 解析失败时不接管
    Given 文本含 "ralph emit" 但缺少可识别的 ### N. 阶段标题结构
    When 检测与解析
    Then 判定为不接管（安全默认）

  # —— 检测与解析 ——

  Scenario: S4 识别标准 Ralph dump 并解析四阶段
    Given fixture 含 preamble、### 0. ORIENTATION、### 0b. TOOL DISCIPLINE、### 1. EXECUTE、### 2. VERIFY、### 3. REPORT
    And 可选含 <ralph-tools-skill> 块
    When 执行 detect + parse
    Then shouldTakeover 为 true
    And 阶段列表按顺序包含 orientation, tool_discipline, execute, verify, report
    And deferredSkills 抽出 ralph-tools 块且 orientation 正文不含该 XML 全文

  Scenario: S5 缺段则跳过
    Given fixture 仅有 ORIENTATION 与 REPORT
    When parse 并构建阶段队列
    Then 队列为 orientation → report
    And 不包含 execute / verify

  # —— 首轮披露 ——

  Scenario: S6 接管后首轮 LLM 不可见完整 EXECUTE
    Given 合法 Ralph dump 且扩展接管
    When 第一次 LLM context 组装完成
    Then 可见 user 文本包含当前阶段（ORIENTATION）短契约与 ORIENTATION 正文
    And 可见文本不包含完整 EXECUTE 长文
    And 可见文本包含全文落盘路径提示（可供 read）
    And 原始全文已写入落盘文件且内容等于 dump

  Scenario: S7 ORIENTATION 默认不含 deferred skill 全文
    Given dump 含 <ralph-tools-skill> 长块
    When 构建 ORIENTATION 短包
    Then 短包不含 skill XML 全文
    And EXECUTE 短包包含该 skill 全文或明确的「去路径读取」指针（实现二选一，单测锁死选定行为）

  # —— 阶段推进 ——

  Scenario: S8 ralph_stage_done 合法推进
    Given 阶段机当前为 orientation
    When 模型调用 ralph_stage_done 且 stage=orientation
    Then tool 返回成功
    And 阶段机标记 orientation 完成并准备进入下一存在阶段

  Scenario: S9 ralph_stage_done 错误 stage 拒绝
    Given 当前为 orientation
    When 调用 ralph_stage_done 且 stage=execute
    Then tool 返回错误且不推进

  Scenario: S10 重复 done 幂等
    Given orientation 已完成
    When 再次 ralph_stage_done stage=orientation
    Then 不产生第二次阶段切换副作用

  Scenario: S11 阶段切换后上下文已重置
    Given orientation 已 done 且仍有下一阶段
    When agent_settled 处理推进
    Then 调用 newSession（默认策略）
    And 新会话 kickoff 为下一阶段短包 + handoff brief（≤ 配置上限字符）
    And 新会话 messages 不含上一阶段完整 tool 轨迹

  Scenario: S12 最后阶段完成后停止续跑
    Given 当前为实际最后阶段且 ralph_stage_done 成功
    When agent_settled
    Then 不再 newSession / 不再 sendUserMessage 推进
    And 阶段机 isComplete=true

  # —— 早 emit ——

  Scenario: S13 REPORT 前拦截业务终态 emit
    Given 当前阶段不是实际最后阶段
    And publishes 列表含 topic "work.done"
    When tool_call 为 bash 且 command 匹配 ralph emit … work.done（或等价终态）
    Then 返回 block=true 与可读 reason
    And 不将当前阶段标为成功完成

  Scenario: S14 最后阶段允许终态 emit
    Given 当前为实际最后阶段
    When 同类 ralph emit 终态
    Then 不因本扩展的早终态门闩而 block（Ralph 侧门禁仍生效）

  # —— 包可加载 ——

  Scenario: S15 扩展可被 Pi 加载
    Given 本仓库 package.json 声明 pi.extensions
    When 执行 pi -e <extension-entry> -p --mode json --no-session 并对短 prompt 跑通
    Then 进程可启动且短 prompt 场景透传成功（exit 策略以 smoke 脚本约定为准）
```

---

## 3. 验收与测试策略

| Scenario | 验收条件 | 推荐测试层级 | 是否需要 E2E |
| -------- | -------- | ------------ | ------------ |
| S1 | `shouldTakeover=false`；context 改写器 no-op | 单元 + Fake 集成 | 否 |
| S2 | env=0 时 takeover false | 单元 | 否 |
| S3 | 残缺 dump → false | 单元 | 否 |
| S4 | 解析结构与 deferredSkills | 单元；Parser 可加 property | 否 |
| S5 | 队列缺段跳过 | 单元 / 状态机 | 否 |
| S6 | LLM messages 无完整 EXECUTE；落盘 equals | Fake 集成（context） | 可选 smoke |
| S7 | Orient 无 skill 全文；Execute 有约定形态 | 单元 | 否 |
| S8–S10 | 状态机 + tool execute 契约 | 单元 / 状态机 | 否 |
| S11 | FakeContext 断言 `newSession` 调用与新 messages | Fake 集成 | 是（真实 pi 抽检） |
| S12 | complete 后无 advance 调用 | 单元 + Fake | 否 |
| S13–S14 | tool_call block 矩阵 | 单元 + Fake | 否 |
| S15 | `pi -e` smoke | E2E smoke | **是（少量）** |

**额外风险驱动测试（按需，写入对应 Unit）：**

- Parser（U2）：对标题变体做 **Property / 表驱动**（多组 heading）
- StageMachine（U4）：**State-Machine Test**（全转移表）
- `ralph_stage_done`：**Idempotency**（S10）
- context 改写 vs 原文：**Differential**（改写前后 fixture diff 断言）
- 无既有生产代码：**不做** Characterization；对接真实 Pi 的 U11 才做最小 smoke

---

## 4. 需求—测试追踪矩阵

| 需求 | Scenario | 验收测试 | 单元测试 | 集成/契约测试 | E2E |
| ---- | -------- | -------- | -------- | ------------- | --- |
| R2 仅 Ralph 接管 | S1,S3,S4 | ATDD-Detect / ATDD-Takeover | `detect.test.ts` | Fake before_agent_start | S15 透传 |
| R10 关闭开关 | S2 | ATDD-KillSwitch | `detect.test.ts` | — | — |
| R3 阶段序与跳过 | S4,S5 | ATDD-Parse | `parse.test.ts` | — | — |
| R4 短契约披露 | S6,S7 | ATDD-FirstContext | `prompt-build.test.ts` | Fake `context` | 可选 |
| R5 stage_done | S8–S10 | ATDD-StageDone | `stage-machine.test.ts` `stage-done-tool.test.ts` | Fake registerTool | — |
| R6 阶段间重置 | S11 | ATDD-Reset | — | Fake `newSession` | U11 抽检 |
| R7 早终态禁 emit | S13,S14 | ATDD-EmitGuard | `emit-guard.test.ts` | Fake `tool_call` | — |
| R8 结束后停止 | S12 | ATDD-Complete | `stage-machine.test.ts` | Fake settled | — |
| R1 可安装包 | S15 | ATDD-Load | — | package 契约（读 package.json） | `smoke-print.sh` |
| R9 非事实源 | （文档+不实现 schema） | README 审查 | — | — | — |
| C1/C2 context 改写 | S6 | ATDD-FirstContext | `context-rewrite.test.ts` | Fake | — |

---

## 5. 严格串行开发单元

> **每个 Unit 的 TDD 闭环（强制）：**  
> ① 写/启用本 Unit 验收测试 → ② 跑测确认以**正确原因**红 → ③ 拆最小单元测试 Red→Green→Refactor → ④ 本 Unit 集成测 → ⑤ 回归前置 Unit 相关套件 → ⑥ 勾选完成标准 → ⑦ 才开下一 Unit。

---

### Unit 1 — Ralph dump 检测（含杀开关）

* **Unit 目标：** 纯函数决定是否接管：`shouldTakeover(prompt, env)`。
* **对应 Scenario：** S1, S2, S3, S4（仅检测布尔，不解析细节）
* **外部可观察结果：** 对给定 prompt/env 返回 `true/false`；无 IO、无 Pi。
* **输入与输出：**
  * 入：`prompt: string`，`env: { RALPH_PI_PHASED?: string }`（或 `Record<string,string|undefined>`）
  * 出：`boolean`
* **可依赖的已完成能力：** 无（仓库可为空；本 Unit 允许创建 `package.json` + vitest/tsconfig **仅当**为跑测试所必需，不实现扩展逻辑）
* **明确禁止依赖的未来能力：** parse 阶段队列、落盘、Extension hooks、newSession
* **验收测试：** `test/atdd/detect.atdd.test.ts`  
  * 短 prompt → false  
  * `RALPH_PI_PHASED=0` + 长 Ralph fixture → false  
  * 标准 Ralph fixture → true  
  * 残缺（有 ralph emit 无阶段标题）→ false
* **需要拆分的单元测试：** 标题/关键词启发式边界表（至少 5 例）
* **Red 预期失败原因：** 模块/函数不存在或恒 false/true
* **最小实现范围：** `src/detect.ts`（或等价路径）；启发式建议：`RALPH_PI_PHASED=0` 优先；否则需同时满足「至少两个 `### \\d` 阶段标题」+「Ralph 信号」（如 `ralph emit` 或 `<ralph-tools-skill>` 或 `You are ` + `ORIENTATION`）——**实现时以测试锁死，可微调但不得放宽到短句误报**
* **集成验证：** 无（纯函数）
* **回归范围：** `npm test` 本文件
* **完成标准：**
  * [ ] S1/S2/S3/S4 检测断言全绿
  * [ ] 无 skip/only
  * [ ] 导出函数有明确命名，可供 U2+ 导入
* **风险与注意事项：** 误报会污染日常 `pi -p`——宁可漏检（false）不可误检；误报用 ATDD 锁死

---

### Unit 2 — 阶段与 deferred skill 解析

* **Unit 目标：** 将 Ralph dump 解析为结构化 `ParsedRalphPrompt`。
* **对应 Scenario：** S4, S5, S7（解析侧）
* **外部可观察结果：** 得到 `preamble`、`stages[]`（id/title/body）、`deferredSkills[]`、`publishTopics[]`（尽力从 REPORT/正文提取，提取失败则空数组）
* **输入与输出：**
  * 入：完整 prompt 字符串
  * 出：`ParsedRalphPrompt`；无法解析为「≥2 个已知阶段」时返回 `null`（供检测层或上层决定透传）
* **可依赖：** Unit 1（可选：parse null ⇒ takeover false 的组合测）
* **禁止依赖：** 短 prompt 构建细节、Pi、落盘
* **验收测试：** `test/atdd/parse.atdd.test.ts` + fixtures 目录 `test/fixtures/*.md`
* **单元测试：** 表驱动标题变体；缺段；skill XML 抽出后 body 不再含全文
* **Red 原因：** parse 未实现 / 切分错误
* **最小实现范围：** `src/parse.ts` + fixtures
* **风险驱动：** 表驱动 Parser 测试；可选 property：随机打乱非标题行不产生额外 stage
* **集成验证：** 无
* **回归：** U1 + U2
* **完成标准：**
  * [ ] S4/S5 绿
  * [ ] deferredSkills 抽出行为有断言
  * [ ] `publishTopics` 提取策略写进测试注释（尽力而为，允许空）
* **风险：** 标题格式漂移——fixture 对齐 ralph `build_custom_hat` 字面量

---

### Unit 3 — 短阶段 prompt 构建

* **Unit 目标：** `buildStageUserMessage(parsed, stageId, opts) → string`
* **对应 Scenario：** S6（内容约束）, S7
* **外部可观察结果：** 指定阶段的 user 文本满足「含短契约 + 当前段；Orient 无 EXECUTE 全文；Orient 无 skill 全文」
* **输入与输出：**
  * 入：`ParsedRalphPrompt`、`stageId`、`fullPromptPath`、`handoffBrief?`
  * 出：string（≤ 可选软上限可只 warn，硬上限留给 handoff brief）
* **短契约必须包含（可观察子串）：** 当前 stage 名、单业务事件预算提醒、完整 prompt 路径、非最后阶段禁止终态 emit、要求完成时调用 `ralph_stage_done`
* **可依赖：** U2
* **禁止依赖：** StageMachine、Pi hooks
* **验收测试：** `test/atdd/prompt-build.atdd.test.ts`
* **单元测试：** Orient vs Execute 对 skill 的包含关系（**本 Unit 锁定一种行为**：推荐 Execute **内联** deferredSkills，避免模型不会 read——若选路径指针，必须在契约中写清「必须 read」）
* **Red 原因：** 构建器不存在或 Orient 仍含 EXECUTE
* **最小实现范围：** `src/prompt-build.ts`
* **回归：** U1–U3
* **完成标准：**
  * [ ] S6 内容断言（不含完整 EXECUTE）绿
  * [ ] S7 行为与选定策略一致并写进 README 草稿注释或测试名
* **风险：** 契约过长抵消收益——保持模板短小

---

### Unit 4 — 阶段状态机

* **Unit 目标：** 可测试的 `StageMachine`：队列、当前、done、跳过、complete、幂等。
* **对应 Scenario：** S5（队列）、S8–S10、S12（complete 标志）
* **外部可观察结果：** `createMachine(stageIds)` → `current`, `completeStage(id)`, `isComplete`, `nextId`
* **输入与输出：** 见上；非法 `completeStage` 返回 `{ ok:false, error }`；合法返回 `{ ok:true, advancedTo?: id }`
* **可依赖：** U2 的 stage id 枚举（共享 `src/types.ts` 若需要）
* **禁止依赖：** Pi、prompt 构建、newSession
* **验收测试：** `test/atdd/stage-machine.atdd.test.ts`
* **单元测试：** **状态机全转移表**（含缺段队列、幂等、错误 stage）
* **Red 原因：** 状态机未实现
* **最小实现范围：** `src/stage-machine.ts`
* **回归：** U1–U4
* **完成标准：**
  * [ ] S8–S10、S12 状态断言绿
  * [ ] 转移表覆盖所有合法边
* **风险：** 把「调用 newSession」耦进状态机——**禁止**；状态机只产事件/下一 id

---

### Unit 5 — 全文落盘

* **Unit 目标：** `persistFullPrompt(text, io) → absolutePath`
* **对应 Scenario：** S6（落盘 equals）
* **外部可观察结果：** 写入后可读回原文；路径稳定可测
* **输入与输出：** 入 text + `FileIo` 端口（`writeFile`/`realpath`）；出 path
* **可依赖：** 无强依赖；可与 U3 path 参数对齐
* **禁止依赖：** Pi
* **验收测试：** 用内存 Fake FS 或 temp dir
* **单元测试：** 内容 round-trip；空字符串也写（或显式拒绝——测试锁死）
* **Red 原因：** 未实现
* **最小实现范围：** `src/persist.ts`；默认目录 `os.tmpdir()` + 前缀 `pi-ralph-phased-`
* **回归：** U5 + U3（path 传入构建）
* **完成标准：**
  * [ ] S6 落盘断言绿
  * [ ] 不写 `.ralph/events.jsonl` 等 ledger
* **风险：** 敏感 prompt 落盘——README 注明 tmp 清理尽力而为

---

### Unit 6 — 早终态 emit 判定（纯函数）

* **Unit 目标：** `shouldBlockTerminalEmit({ stageIsLast, command, publishTopics }) → { block, reason? }`
* **对应 Scenario：** S13, S14
* **外部可观察结果：** 非最后阶段 + command 含 `ralph emit` + topic ∈ publishTopics（或保守：任意 `ralph emit` 当 topics 空且非最后？——**推荐：topics 非空才按列表匹配；topics 空则仅匹配明显终态字面量白名单可选**）。**本 Unit 测试必须锁死最终策略。**
* **可依赖：** 无
* **禁止依赖：** 真实 tool_call hook
* **验收测试：** `test/atdd/emit-guard.atdd.test.ts`
* **单元测试：** 命令变体（引号、`$RALPH_BIN emit`、多 topic）
* **Red 原因：** 未实现
* **最小实现范围：** `src/emit-guard.ts`
* **回归：** U6
* **完成标准：**
  * [ ] S13/S14 矩阵绿
  * [ ] 策略在测试文件头注释写明
* **风险：** 漏拦截——宁可文档承认启发式；Ralph 门禁仍是最终防线

---

### Unit 7 — `ralph_stage_done` Tool 定义（可单测 execute）

* **Unit 目标：** 实现 tool 的参数校验 + 调用 `StageMachine.completeStage`；不注册到真 Pi。
* **对应 Scenario：** S8–S10
* **外部可观察结果：** `executeStageDoneTool(args, machine) → ToolResultLike`
* **可依赖：** U4
* **禁止依赖：** 真 `pi.registerTool`（可先写 definition 对象，注册留 U8）
* **验收测试：** ATDD 调 execute 包装
* **单元测试：** 缺参、错误 stage、成功、幂等
* **Red 原因：** tool 逻辑不存在
* **最小实现范围：** `src/tools/stage-done.ts`
* **回归：** U4–U7
* **完成标准：**
  * [ ] S8–S10 经 tool 包装绿
  * [ ] summary 字段可选且**不**单独触发推进
* **风险：** 参数 schema 依赖 `typebox`——若引入依赖，写入 package.json；或手写校验避免重依赖（二选一，本 Unit 定案）

---

### Unit 8 — Extension 接线：接管、context 改写、tool 注册（Fake Pi）

* **Unit 目标：** Outside-In 垂直切片：用 **Fake `ExtensionAPI`** 加载 `src/index.ts`，验证：
  1. 短 prompt → 不改写 context
  2. Ralph dump → `before_agent_start` 建立会话态 + persist
  3. **`context` 将 LLM 可见 user 内容替换为 Orient 短包**（满足 C1/C2）
  4. `registerTool('ralph_stage_done')` 被调用
* **对应 Scenario：** S1, S6, S7（端到端在 Fake 内）
* **外部可观察结果：** Fake 记录 hooks；模拟 `context` 事件后 messages 断言
* **输入与输出：** Fake 驱动
* **可依赖：** U1–U7
* **禁止依赖：** 真实 `newSession` 推进（U9）、真实 `pi` CLI（U11）
* **验收测试：** `test/atdd/extension-first-turn.atdd.test.ts`
* **单元测试：** `context-rewrite.ts` 纯函数：给定 messages + sessionState → 新 messages
* **Red 原因：** index 未导出 / context 未改写导致全文仍在
* **最小实现范围：**
  * `src/context-rewrite.ts`
  * `src/session-state.ts`（内存态）
  * `src/index.ts`：`export default function (pi: ExtensionAPI) { ... }`
  * `test/fakes/fake-pi.ts`（只实现本 Unit 用到的 `on`/`registerTool`）
* **集成验证：** Fake 跑完 S1/S6
* **回归：** U1–U8 全套 `npm test`
* **完成标准：**
  * [ ] **证明** LLM 可见文本无完整 EXECUTE（核心门禁）
  * [ ] 透传路径 messages 深等或文本等原 prompt
  * [ ] 核对官方 `BeforeAgentStartEventResult`，不发明 `prompt:` 替换字段
* **风险与注意事项：**
  * 若发现仅靠 `context` 不够（例如 provider 另有通道），停下来用 Differential 实验记录在 `docs/spikes/`，**不得假装绿**
  * `before_agent_start` 可额外 inject 短提示，但**不能**代替 context 改写

---

### Unit 9 — agent_settled 推进 + newSession 重置（Fake Context）

* **Unit 目标：** 阶段 done 后，settled 处理器 await `newSession`，在 `setup`/`withSession` 注入下一阶段短包；complete 后不调用。
* **对应 Scenario：** S11, S12
* **外部可观察结果：** FakeContext 调用序列：`waitForIdle?` → `newSession` → 新 session 的 user kickoff 文本匹配下一阶段；complete 时 `newSession` 调用次数为 0
* **可依赖：** U8 会话态 + U4/U7
* **禁止依赖：** 真实 Pi CLI；compact 可作为配置分支但 **默认测 newSession**
* **验收测试：** `test/atdd/extension-advance.atdd.test.ts`
* **单元测试：** handoff brief 长度截断（≤ 4096 或项目常量）
* **Red 原因：** settled 未接线或只 sendUserMessage 不 newSession
* **最小实现范围：** `src/advance.ts` / `src/context-reset.ts`；**禁止**「仅 sendUserMessage 堆历史」作为默认实现
* **集成验证：** Fake 序列断言
* **回归：** 全量 `npm test`
* **完成标准：**
  * [ ] S11：断言 `newSession` 被调用且新 kickoff 无上一阶段 tool 轨迹
  * [ ] S12：complete 无 advance
  * [ ] 所有异步路径 await
* **风险：** Fake 与真 Context 形状漂移——Fake 方法名与官方 docs 一致（`newSession`, `sendUserMessage`）；缺 `waitForIdle` 则跳过该调用但注释说明

---

### Unit 10 — tool_call 早 emit 拦截接线 + 杀开关端到端（Fake）

* **Unit 目标：** 将 U6 挂到 `pi.on('tool_call')`；`RALPH_PI_PHASED=0` 时不注册接管逻辑或一切 no-op。
* **对应 Scenario：** S2（Fake 端到端）, S13, S14
* **外部可观察结果：** Fake 发出 tool_call 事件得到 `block:true|false`
* **可依赖：** U6, U8, U9
* **禁止依赖：** 真 bash
* **验收测试：** `test/atdd/extension-emit-guard.atdd.test.ts`
* **Red 原因：** 未监听 tool_call
* **最小实现范围：** index 内 tool_call handler
* **回归：** 全量
* **完成标准：**
  * [ ] S13/S14 经 Fake hook 绿
  * [ ] env=0 时即使 dump 也不改写 context（与 U1 一致）
* **风险：** 只拦 `bash` tool——若 Ralph 用其它工具发 emit，记录为剩余风险

---

### Unit 11 — 包元数据、README、真实 Pi smoke

* **Unit 目标：** 仓库可被 `pi -e` 加载；文档可跟做；最小 E2E。
* **对应 Scenario：** S15；回归 S1 在真 Pi 上抽检
* **外部可观察结果：**
  * `package.json` 含 `"type":"module"` 与 `"pi":{"extensions":["./src/index.ts"]}`
  * `scripts/smoke-print.sh`：短 prompt 透传；可选第二步用 fixture 文件（若无 API key/模型则标 `manual` 并跳过推进断言，但 **加载与透传必须自动绿**）
* **可依赖：** U1–U10
* **禁止依赖：** 修改 ralph-orchestrator
* **验收测试：**
  * 契约：测试读取 package.json 字段
  * E2E：smoke 脚本 exit 0（透传）
* **Red 原因：** pi 入口错误 / 扩展 throw
* **最小实现范围：** README.md、smoke 脚本、必要时 `peerDependencies` 注释
* **回归：** `npm test` + smoke
* **完成标准：**
  * [ ] S15 自动部分绿
  * [ ] README 含：安装、`-e`、阶段语义、`RALPH_PI_PHASED`、C1/C2 说明（context 改写）、非目标、与需求 A 边界
  * [ ] 列出未验证项（真小模型协议违规率对比等）
* **风险：** CI 无 `pi`——脚本检测命令缺失时明确 exit 并文档化

---

## 6. 最终质量门禁

Executor 在宣称「功能完成」前必须满足：

* [ ] 计划内 Scenario **S1–S15** 均有对应自动化或已声明的 manual 证据；S11 真机抽检若不做，须在 README「剩余风险」写明
* [ ] 所有单元测试通过（`npm test`）
* [ ] 所有 Fake 集成 / ATDD 通过
* [ ] 必要 E2E：`smoke-print.sh` 透传路径通过
* [ ] Lint / Typecheck / Build（若配置了）通过
* [ ] **没有**新增失败或 skip；无 `.only`；无无解释 golden 更新
* [ ] **未验证内容（必须写明）：**
  * 真实小模型上相对「一次性全文」的协议违规率对比（属运营验收，非本仓库门禁默认项）
  * 非 bash 通道的终态 emit 拦截完整性
  * print 模式下与 Ralph 并发多 hat 的长时间 soak
* [ ] **剩余风险：** 厚 EXECUTE 正文本身仍可能压垮小模型；本扩展不替代 Ralph 控密度 / 需求 A

---

## Executor 速查：串行看板

```text
U1 detect → U2 parse → U3 prompt-build → U4 stage-machine → U5 persist
  → U6 emit-guard → U7 stage-done tool → U8 Fake extension+context rewrite
  → U9 Fake newSession advance → U10 tool_call guard → U11 package+smoke+README
```

**每步出口：** 红因正确 → 实现 → 绿 → 重构 → 回归前置 → 勾完成标准 → 下一家。

**绝对禁止默认实现：** 只 `sendUserMessage` 堆阶段而不 `newSession`/`context` 清历史；假装 `before_agent_start` 已替换用户全文。
