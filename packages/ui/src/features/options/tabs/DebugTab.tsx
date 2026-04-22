/**
 * DebugTab · 调试与日志（预留）
 * ---------------------------------------------
 * v0.2.0 占位；未来放：
 * - 日志级别切换
 * - IndexedDB 数据导出/清空
 * - 权限使用日志审计页
 */
import { Alert, Card, Typography } from 'antd';

export function DebugTab() {
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="调试与审计（v0.2.0 预留）"
        description="此 Tab 预留给未来的调试工具，包括：日志级别切换、IndexedDB 数据导出、权限使用日志审计页等。当前版本暂无可用选项。"
        style={{ marginBottom: 16 }}
      />

      <Card title="调试工具">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          计划中的能力（均延后到下一期，见 <code>docs/ROADMAP.md</code>）：
        </Typography.Paragraph>
        <ul style={{ color: '#595959', marginBottom: 0 }}>
          <li>日志级别切换（debug / info / warn / error）</li>
          <li>导出 IndexedDB 全部记忆为 JSON</li>
          <li>权限使用日志（Tool 调用 / LLM 请求次数统计）</li>
          <li>流式响应过程可视化</li>
        </ul>
      </Card>
    </>
  );
}
