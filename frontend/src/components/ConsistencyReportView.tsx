import type { ConsistencyReport } from '../types/api';

interface ConsistencyReportViewProps {
  report?: ConsistencyReport | null;
}

export function ConsistencyReportView({ report }: ConsistencyReportViewProps) {
  if (!report) {
    return <p className="muted">尚未执行一致性检查。</p>;
  }
  return (
    <div className="stack compact">
      <div className="metric">
        <span>整体评分</span>
        <strong>{report.overall_score.toFixed(2)}</strong>
        <small>阈值 {report.threshold.toFixed(2)}</small>
      </div>
      {report.slides.map((slide) => (
        <div className={slide.revision_needed ? 'issue' : 'ok'} key={slide.slide_no}>
          <strong>第 {slide.slide_no} 页：{slide.score.toFixed(2)}</strong>
          {slide.issues.length ? <ul>{slide.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>风格一致。</p>}
        </div>
      ))}
    </div>
  );
}
