#!/usr/bin/env bash
# 验证 dsh-tool-schema-slim 是否生效：读 web 进程日志里的投影汇总行。
#
# 判据来源：插件把汇总写到 stderr。ctx.logger 的默认 exporter 只把消息推进内存
# 环形缓冲（cordis LoggerService 构造时注册的那个），不落盘 —— 早先 grep
# dsh-web-stdout.log 永远 0 命中，判据是坏的。
#
# 用法: bash ~/workspace/deepseek-harness-plugins/dsh-tool-schema-slim/verify.sh
set -uo pipefail
LOGS=("$HOME/.dsh/logs/dsh-web-stderr.log" "$HOME/.dsh/logs/dsh-web-stdout.log")

echo "=== 日志: ${LOGS[*]} ==="
HITS=$(grep -h "\[tool-schema-slim\]" "${LOGS[@]}" 2>/dev/null | wc -l | tr -d " ")
echo "=== 最近 5 条投影记录 ==="
grep -h "\[tool-schema-slim\]" "${LOGS[@]}" 2>/dev/null | tail -5
echo
echo "命中条数: $HITS"
if [ "$HITS" -eq 0 ]; then
  echo "结论: 未生效——日志里没有投影记录。检查服务是否已重启（插件改动要重启才加载）。"
  exit 1
fi
echo
echo "判据: 每创建一个 agent 应有一条「N tools projected, arguments X -> Y chars (-Z%)」；"
echo "      条数随会话数增长，出现 skipped/失败行说明仍有工具解析不到。"
