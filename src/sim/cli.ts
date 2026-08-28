import { comparePolicies, type ComparisonResult } from './compare';

function integer(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** Formats a comparison result as a Markdown table. */
export function formatComparisonMarkdown(result: ComparisonResult): string {
  const lines = [
    `Sapporo 12 床 × 90 晚 = 1,080 bed-nights；rate ¥5,000/晚；${result.seedCount} seeds`,
    '',
    '| 需求 | Policy | 入住率 | 季收入 (¥) | 95% CI (¥) | 流失bn | Stranded | 被迫拆房 |',
    '|---:|:---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of result.rows) {
    lines.push(
      `| ${(row.demandRatio * 100).toFixed(0)}% | ${row.policy} | ${(row.occupancy.mean * 100).toFixed(1)}% | ${integer(row.revenue.mean)} | ±${integer(row.revenue.ci95)} | ${integer(row.lostBedNights.mean)} | ${integer(row.strandedBedNights.mean)} | ${row.forcedSplits.mean.toFixed(1)} |`,
    );
  }
  return lines.join('\n');
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  console.log(formatComparisonMarkdown(comparePolicies()));
}
