import { ReportLayout } from './analyst-report-v5/report-layout';
import type { AnalystReportDashboardProps } from './analyst-report-v5/types';

export function AnalystReportDashboard(props: AnalystReportDashboardProps) {
  return <ReportLayout {...props} />;
}
