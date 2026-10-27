# dsh-tool-schema-slim

压缩每步重发的工具说明——**不改任何工具行为**，只把散文式描述截短。

## 为什么要改定义本身

DSH 每一步都会把工具定义重新发给模型。在 `ptc` 模式下，这份定义是**由注册的 schema 渲染出来的 SDK 声明**（`sdkSchemas(scope)`），占系统提示词的六成以上；而 `system-prompt/assemble` 自上版起已不再携带 tools 数组，在那儿改是无效的。

`schemaOf()` 每次组装都直接读定义对象上的 `description`，所以唯一能同时覆盖 native 工具块和 PTC SDK 声明的位置，就是**定义本身**。本插件在 `agent/created` 时把每个 agent 可见的工具定义**就地改写**：只截短 `description` 散文，`execute`、`output`、超时与安全标志以及一切结构键逐字保留。

早先的实现是在 scope 里注册一份同名影子副本，两件事让它退场：与官方插件在同一 scope 注册同名工具（例如团队工具的 `send_message`）会撞名，直接让会话创建失败；影子副本又只覆盖自己那一层，父层与全局层仍是全量。就地改写绕开注册表——不占名字、不占层，任何可见工具都被覆盖。

## 效果（本机 45 个工具、默认 `160 / 80 / 24`）

| 项 | 字符 | 说明 |
| --- | ---: | --- |
| `ToolArgsMap` 原始 | 28,904 | 其中注释 22,705（79%） |
| 参数说明截到 80 | 约 −9,000 | 单次系统提示词约 −2,250 tok |
| 参数说明截到 40 | 约 −13,700 | 约 −3,420 tok |

默认档取 80：既能砍掉大段示例与重复叮嘱，又保留「这个参数是干什么的」这一句。

上表是参数部分的单独口径。运行期日志报的是**整块**（工具描述 + 参数），因为只量 `parameters` 会低估一半左右的收益——工具描述同样被截断，但早先的统计没把它算进去。

## 配置

写进插件自带的 `cordis.patch.yml`（**profile 层不要再写同 id 条目**）：

```yaml
- id: tool-schema-slim
  config:
    mode: terse                    # off = 完全关掉
    toolDescriptionChars: 160      # 每个工具描述的上限，0 = 全删
    parameterDescriptionChars: 80  # 顶层参数说明上限
    nestedDescriptionChars: 24     # 两层及更深参数说明上限，0 = 全删
    rootDescriptionChars: 0        # 参数根节点说明，默认丢弃
    keepTools: []                  # 原样透传的工具名
    minChars: 0                    # 参数已小于此值的工具跳过
    logSavings: true               # 每个 agent 首次投影记一条日志
    reportTools: false             # 再按工具逐条打 before/after（调参时开）
    projectOutput: false           # 同时压输出 schema 里的 description
```

## Model Experience

- 工具名、参数名、`type` / `required` / `enum` / `const` / `items` / `oneOf` 等一切影响填参的结构**逐字保留**，仅描述变短——模型仍知道每个工具做什么、必填什么。
- 长描述优先在**句末**截断，其次退到逗号、分号、空格这类从句边界，两种情况都补 `…`，不会断在词中间；中文句号、分号、问号、叹号与英文对应标点都识别。补上省略号后仍超出上限时先剪掉末尾一个字符，保证长度不越界。
- `execute`、`output.render`、超时与安全标志按**引用**继承，派发路径零改动，参数校验、并发分类和审批全部走原定义。
- 投影对自身输出**幂等**：第二次投影返回「无变化」，因此 `scope.effect` 重新求值不会反复改写，工具块字节稳定。
- 任一步出错（`view()` 抛错、单工具投影抛错、事件处理器异常）都只记一条 stderr 诊断并放行，绝不让提示词优化拖垮一次对话。

### KV Cache effect

**正向**。投影只依赖注册时的 schema，与轮次无关：同一工具集每次产出完全相同的字节，系统提示词前缀保持稳定，上游 prompt cache 不会被本插件打断。

与「在装配阶段改写提示词」的方案相比这是关键差别——那种做法改的是已发送历史里的内容，会破坏前缀缓存；本插件改的是**注册层**，前缀从一开始就是压缩后的固定形态。

## Known Limitations and Deferred Work

- **只在 agent 创建时投影一次**。运行期新注册的工具（例如插件热加载）不会被自动投影，需等下一个 agent。这是刻意的取舍：监听 `agent/pre-step` 能覆盖动态工具，但会引入每步求值的抖动风险。
- **不删除任何 schema 键**。只截断 `description`；`title`、`examples`、`default` 等注解键原样保留。要更激进的裁剪需另开配置项，未实现。
- **默认档位是按中文与英文混合语料调的**。纯英文工具说明在 80 字符下的信息损失比中文小，可以调到 120；纯中文复杂工具（如 `schedule_*`）建议单独放宽。
- **输出 schema 默认不压，实测也不值得压**。`ToolOutputMap` 会渲染 `output.schema` 里各字段的 `description`，本机 31 个工具的输出 schema 合计 34,785 字符，看着比参数侧整块（30,506）还大；但按同一套 caps 投影后是 34,665 —— **只省 120 字符（0.3%）**。那 34K 几乎全是属性名与类型结构，散文极少。`projectOutput` 因此保持默认关闭。
- **跳过只读的定义**。PTC 的 `run_code` 把 `description` / `parameters` 定义成每次读取都重新求值的 getter，赋值直接抛 `TypeError`。插件沿原型链检查属性描述符，遇到非数据属性就静默略过（不记失败），协议段因此保持宿主原样。
- **未实现 dry-run 报表**。首次投影只有一条汇总日志；按工具列明 before/after 需要额外做设置页，未做。

## 安装与卸载

```bash
dsh plugin --profile web add link:$HOME/workspace/deepseek-harness-plugins/dsh-tool-schema-slim
```

卸载：`dsh plugin --profile web remove dsh-tool-schema-slim`。还原靠 `ctx.effect` 的丢弃回调：插件 scope 销毁时把原始 `description` / `parameters` 写回定义对象，卸载后立刻恢复全量定义，无残留。

## 自测

```bash
cd dsh-tool-schema-slim && node --test 'test/*.test.js'   # 18 个用例
bash dsh-tool-schema-slim/verify.sh                          # 线上日志里的投影记录
```

覆盖：就地改写、agent-plane 与全局两层都覆盖、投影幂等、结构键保真、`execute`/`output` 引用不变、`off` 与 `keepTools` 生效、`view()` 抛错不中断、dispose 还原原文。

### 日志通道

汇总行（`[tool-schema-slim] N tools projected, tool block X -> Y chars (-Z%)`）走的是 **stderr**，不是 `ctx.logger`。cordis 的 `LoggerService` 构造时只注册一个把消息推进内存环形缓冲的 exporter，没有 console exporter，所以 `ctx.logger.info/warn` 永远不会出现在 `dsh-web-*.log` 里——`verify.sh` 早先 grep 日志永远是 0 命中，就是这个原因。诊断行改成 `console.error` 后，launchd 的 `StandardErrorPath` 能直接收到。