/**
 * 코퍼스 전체를 반복 채점한다.
 *
 * 고정 데이터 몇 개만 만점이면 "내가 본 결함만 고친" 상태다. 실제 저장된
 * 보고서를 전부 돌려서, 연속으로 만점이 나올 때까지 확인한다.
 *
 *   node scripts/report-quality-sweep.mjs <디렉터리…> [--rounds N]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const roundsIdx = args.indexOf('--rounds');
const rounds = roundsIdx >= 0 ? Number(args[roundsIdx + 1]) : 3;
const targets = args.filter((a, i) => !a.startsWith('--') && i !== roundsIdx + 1);

const files = targets.flatMap(t =>
  statSync(t).isDirectory()
    ? readdirSync(t).filter(f => f.endsWith('.txt')).map(f => join(t, f))
    : [t]);

if (files.length === 0) { console.error('채점할 파일이 없습니다.'); process.exit(2); }

let cleanRounds = 0;
for (let round = 1; round <= rounds; round += 1) {
  const failures = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['scripts/report-quality-rubric.mjs', file],
        { cwd: process.cwd(), stdio: 'pipe' });
    } catch (error) {
      const out = (error.stdout?.toString() || '') + (error.stderr?.toString() || '');
      const missed = out.match(/미달: ([^)\n]*)/)?.[1] ?? '실행 오류';
      const detail = out.split('\n').filter(l => l.includes('✗')).slice(0, 3)
        .map(l => l.trim()).join(' | ');
      failures.push({ file: file.split('/').pop(), missed, detail });
    }
  }
  if (failures.length === 0) {
    cleanRounds += 1;
    console.log(`  라운드 ${round}: ${files.length}개 전부 만점 ✓  (연속 ${cleanRounds}회)`);
  } else {
    cleanRounds = 0;
    console.log(`  라운드 ${round}: ${failures.length}/${files.length} 미달 ✗`);
    for (const f of failures.slice(0, 8)) {
      console.log(`     ${f.file} → ${f.missed}`);
      if (f.detail) console.log(`        ${f.detail.slice(0, 150)}`);
    }
    if (failures.length > 8) console.log(`     … 외 ${failures.length - 8}건`);
    process.exit(1);
  }
}
console.log(`\n  ★ ${files.length}개 보고서 × ${rounds}회 연속 만점`);
